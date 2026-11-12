// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Runs the development servers from the settings in `.env` at the repository
// root.
//
//     node tools/dev.mjs identity   # the identity service alone
//     node tools/dev.mjs full       # the identity service and the web app
//
// The identity service runs with `go run` when Go is on the path, and in the
// `golang:1.26` image otherwise. Only the `IDENTITY_*` entries of `.env`
// reach it; the process environment wins over the file. The Google client
// secret reaches Docker by name (`-e NAME`), so it never appears in a command
// line, a process listing or the shell's history.
//
// In `full`, the web app starts once the identity service answers. Its port
// and proxy target follow `IDENTITY_PUBLIC_ORIGINS` and `IDENTITY_LISTEN`,
// and Vite runs with `--strictPort`: a dev server that moved to another port
// would be an origin the identity service refuses. Either server ending
// stops the other.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { get } from "node:http";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// Without a trailing separator, which would break Docker's `-v path:/repo`.
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** What the identity service is given when `.env` says nothing. */
export const DEV_DEFAULTS = {
  IDENTITY_PUBLIC_ORIGINS: "http://localhost:5173",
  IDENTITY_LISTEN: "127.0.0.1:47821",
  // Relative to `identity/`, where `.keys/` is ignored by git.
  IDENTITY_SEAL_KEYS_FILE: ".keys/seal.keys",
};

/** The entries the identity service cannot start without. */
export const REQUIRED = [
  "IDENTITY_GOOGLE_CLIENT_ID",
  "IDENTITY_GOOGLE_CLIENT_SECRET",
];

/** The image the identity service runs in without Go, as CI builds it. */
export const GO_IMAGE = "golang:1.26";

/**
 * The identity service's environment: the defaults, then the `IDENTITY_*`
 * entries of `.env` (`file`), then those of the process (`env`).
 *
 * @returns the settings and the names of the required ones still empty.
 */
export function identitySettings(file, env) {
  const pick = (source) =>
    Object.fromEntries(
      Object.entries(source).filter(
        ([name, value]) => name.startsWith("IDENTITY_") && value !== "",
      ),
    );
  const settings = { ...DEV_DEFAULTS, ...pick(file), ...pick(env) };
  return {
    settings,
    missing: REQUIRED.filter((name) => !settings[name]),
  };
}

export function portOf(listen) {
  const port = Number(listen.slice(listen.lastIndexOf(":") + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`IDENTITY_LISTEN is not host:port: ${listen}`);
  return port;
}

/**
 * The command that runs the identity service from `root`. Its standard input
 * is a pipe this process holds, and the service stops when it closes, so a
 * closed terminal leaves no service, or container, running. In the container
 * the service listens on every address of its own network, and the port is
 * published on this computer's loopback only. The binary is built first and
 * run with `exec`, so it receives Docker's stop signal itself.
 */
export function identityCommand(settings, { root, hasGo }) {
  const held = { ...settings, IDENTITY_STOP_ON_STDIN_CLOSE: "true" };
  if (hasGo)
    return {
      command: "go",
      args: ["run", "./cmd/identity"],
      cwd: join(root, "identity"),
      env: held,
      stdinPipe: true,
    };
  const port = portOf(settings.IDENTITY_LISTEN);
  const inside = { ...held, IDENTITY_LISTEN: `0.0.0.0:${port}` };
  return {
    command: "docker",
    args: [
      "run",
      "--rm",
      "--init",
      "-i",
      // Named by its port, so services on different ports run side by side.
      "--name",
      `phospheare-identity-${port}`,
      "-p",
      `127.0.0.1:${port}:${port}`,
      "-v",
      `${root}:/repo`,
      "-v",
      "phospheare-gomod:/go/pkg/mod",
      // The build cache outlives the container, so only the first start
      // compiles everything.
      "-v",
      "phospheare-gobuild:/root/.cache/go-build",
      "-w",
      "/repo/identity",
      ...Object.keys(inside).flatMap((name) => ["-e", name]),
      GO_IMAGE,
      "sh",
      "-c",
      "echo 'Building the identity service.' && go build -o /tmp/identity ./cmd/identity && exec /tmp/identity serve",
    ],
    cwd: root,
    env: inside,
    stdinPipe: true,
  };
}

/**
 * The web app's dev server arguments for the first public origin: its port,
 * strictly, and the proxy target for the identity service.
 */
export function webCommand(settings) {
  const origin = new URL(settings.IDENTITY_PUBLIC_ORIGINS.split(",")[0].trim());
  const port = origin.port || (origin.protocol === "https:" ? "443" : "80");
  return {
    // The workspace's own script, so the flags reach Vite and not npm.
    args: [
      "run",
      "dev",
      "--workspace",
      "@phospheare/web",
      "--",
      "--port",
      port,
      "--strictPort",
    ],
    env: {
      PHOSPHEARE_IDENTITY_ORIGIN: `http://127.0.0.1:${portOf(settings.IDENTITY_LISTEN)}`,
    },
  };
}

/**
 * npm, run with `args`. Under `npm run`, the npm that started this process
 * runs on this Node (`npm_execpath`); elsewhere npm is looked up, through
 * `npm.cmd` on Windows, where Node starts a `.cmd` only through a shell and
 * the arguments, fixed words and a port number, need no quoting.
 */
function npmCommand(args) {
  const cli = process.env.npm_execpath;
  if (cli && cli.endsWith(".js"))
    return { command: process.execPath, args: [cli, ...args] };
  if (process.platform === "win32")
    return { command: `npm.cmd ${args.join(" ")}`, args: [], shell: true };
  return { command: "npm", args };
}

/**
 * Resolves once the identity service answers HTTP on `port`, any answer
 * counting, or rejects after `limitMs`. A refused or dropped connection is
 * not an answer: Docker accepts on a published port before the service in
 * the container listens, then closes the connection.
 */
export function untilAnswering(
  port,
  { limitMs = 5 * 60_000, everyMs = 500 } = {},
) {
  const deadline = Date.now() + limitMs;
  return new Promise((done, fail) => {
    const attempt = () => {
      const req = get(
        { host: "127.0.0.1", port, path: "/identity/session", timeout: 2000 },
        (res) => {
          res.resume();
          done();
        },
      );
      req.on("timeout", () => req.destroy());
      req.on("error", () => {
        if (Date.now() > deadline)
          fail(
            new Error(`the identity service did not answer on port ${port}`),
          );
        else setTimeout(attempt, everyMs);
      });
    };
    attempt();
  });
}

function readDotEnv(root) {
  const path = join(root, ".env");
  return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
}

function hasCommand(command, args) {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}

/** Copies `stream` to `out` line by line, each line behind `label`. */
function labelled(stream, out, label) {
  createInterface({ input: stream }).on("line", (line) =>
    out.write(`${label} ${line}\n`),
  );
}

function run(child, label) {
  const proc = spawn(child.command, child.args, {
    cwd: child.cwd,
    env: { ...process.env, ...child.env },
    shell: child.shell ?? false,
    stdio: [
      child.stdinPipe ? "pipe" : "inherit",
      label ? "pipe" : "inherit",
      label ? "pipe" : "inherit",
    ],
  });
  if (label) {
    labelled(proc.stdout, process.stdout, label);
    labelled(proc.stderr, process.stderr, label);
  }
  return proc;
}

function main(mode) {
  if (mode !== "identity" && mode !== "full") {
    console.error("Usage: node tools/dev.mjs identity|full");
    return 2;
  }
  const { settings, missing } = identitySettings(readDotEnv(ROOT), process.env);
  if (missing.length > 0) {
    console.error(
      `Missing in .env: ${missing.join(", ")}.\n` +
        "Copy .env.example to .env and fill in the Google Web client's ID and secret.",
    );
    return 1;
  }
  const hasGo = hasCommand("go", ["version"]);
  if (!hasGo && !hasCommand("docker", ["version"])) {
    console.error("The identity service needs Go 1.26 or Docker.");
    return 1;
  }
  const identity = identityCommand(settings, { root: ROOT, hasGo });
  console.log(
    `identity: ${hasGo ? "go run" : `${GO_IMAGE} in Docker`}, ` +
      `on ${settings.IDENTITY_LISTEN}, for ${settings.IDENTITY_PUBLIC_ORIGINS}`,
  );
  if (mode === "identity") {
    run(identity).on("exit", (code) => process.exit(code ?? 1));
    return null;
  }
  const procs = [run(identity, "[identity]")];
  // Ctrl+C reaches every server from the terminal; this process waits for
  // them to finish rather than leaving one running.
  process.on("SIGINT", () => {});
  let first = null;
  const watch = (proc) =>
    proc.on("exit", (code) => {
      if (first === null) {
        first = code ?? 1;
        for (const other of procs) if (other !== proc) other.kill();
      }
      if (procs.every((p) => p.exitCode !== null || p.signalCode !== null))
        process.exit(first);
    });
  watch(procs[0]);
  // The web app starts once the service answers: the landing asks for the
  // service once when it opens, and shows Google sign-in only if it answered.
  untilAnswering(portOf(settings.IDENTITY_LISTEN)).then(
    () => {
      if (first !== null) return;
      const web = webCommand(settings);
      const proc = run(
        { ...npmCommand(web.args), cwd: ROOT, env: web.env },
        "[web]",
      );
      procs.push(proc);
      watch(proc);
    },
    (err) => {
      console.error(`${err.message}.`);
      procs[0].kill();
    },
  );
  return null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const code = main(process.argv[2]);
  if (code !== null) process.exit(code);
}
