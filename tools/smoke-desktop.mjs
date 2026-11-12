// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Starts a packaged desktop archive as released and checks it answers, on the
// platform the archive is for:
//
//     node tools/smoke-desktop.mjs <archive> <version> [-- <command>...]
//
// 1. The archive is unpacked and the program started with a placeholder
//    Google client, so it starts the identity service; Google is never asked.
//    The client's id is in `config.json`, its secret in the file vault
//    (`"secrets": "file"`), since a runner has no password store.
// 2. `/desktop/info` names the program and the version.
// 3. `/app` serves the built SPA.
// 4. `/identity/session` answers 200 with no writer, so the identity service
//    runs and answers through the program.
// 5. With a command after `--`, it runs while the program is up, with
//    `PLAYWRIGHT_BASE_URL` naming the program: the release runs the browser
//    smoke this way. Its exit code other than 0 fails the smoke.
// 6. The setup API's quit stops it: the program exits with 0 and no identity
//    service from the archive is left running. The quit carries the launch's
//    key, which the program writes, in the setup address, only to a standard
//    output that reaches somewhere: here, this script's pipe. A Windows build
//    has no console, so no interrupt could stop it.
//
// Exit 0 when every check passes, 1 when one fails, 2 on a bad argument.

import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const PROGRAM = "once-dark-studio-desktop";

export function desktopInfoProblem(info, version) {
  return info.program === PROGRAM && info.version === version
    ? null
    : `/desktop/info names ${info.program} ${info.version}`;
}

export function builtAppProblem(app) {
  return app.status === 200 && app.body.includes('type="module"')
    ? null
    : `/app answered ${app.status} without the built SPA`;
}

export function identitySessionProblem(session) {
  let body = null;
  try {
    body = JSON.parse(session.body);
  } catch {
    // Not the identity service's JSON.
  }
  return session.status === 200 && body?.writerId === null
    ? null
    : "/identity/session did not answer that no session is open";
}

async function main() {
  const [archive, version, ...rest] = process.argv.slice(2);
  const command = rest[0] === "--" ? rest.slice(1) : [];
  if (!archive || !version || (rest.length > 0 && command.length === 0)) {
    console.error(
      "usage: node tools/smoke-desktop.mjs <archive> <version> [-- <command>...]",
    );
    process.exit(2);
  }

  const PORT = 47891;
  const windows = process.platform === "win32";
  const exeName = windows ? `${PROGRAM}.exe` : PROGRAM;
  const identityName = windows ? "identity.exe" : "identity";

  const dir = mkdtempSync(join(tmpdir(), "smoke-"));
  let output = "";
  let child = null;
  const data = join(dir, "data");
  mkdirSync(data);
  writeFileSync(
    join(data, "config.json"),
    '{"google":{"clientId":"smoke.apps.googleusercontent.com"},"secrets":"file"}\n',
  );
  writeFileSync(
    join(data, "secrets.json"),
    '{"google-client-secret":"smoke"}\n',
    { mode: 0o600 },
  );
  // GNU tar reads the Linux `.tar.gz`, bsdtar the macOS `.tar.gz` and the
  // Windows `.zip`. On Windows the system's own `tar.exe` is bsdtar, and is
  // named by its path: Git Bash puts its GNU tar first on `PATH`.
  const tar = windows
    ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
    : "tar";
  execFileSync(tar, ["-xf", archive, "-C", dir]);

  /** The first file named `name` under `root`. */
  function find(root, name) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isFile() && entry.name === name) return path;
      if (entry.isDirectory()) {
        const found = find(path, name);
        if (found) return found;
      }
    }
    return null;
  }

  const exe = find(dir, exeName);
  const identity = find(dir, identityName);
  if (!exe || !identity)
    fail(`${archive} holds no ${exeName} or ${identityName}`);

  child = spawn(
    exe,
    ["--port", String(PORT), "--data-dir", data, "--no-browser", "--no-tray"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolve) =>
    child.on("exit", (code) => resolve(code)),
  );

  /** Fails the smoke with `message`, after the program's own words. */
  function fail(message) {
    if (output) console.log(output);
    console.error(`smoke: ${message}`);
    if (child && child.exitCode === null) child.kill();
    process.exit(1);
  }

  /**
   * One request to the program. It listens on 127.0.0.1 and answers only for
   * its own `Host`, `localhost:<port>`.
   */
  function call(method, path, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port: PORT,
          method,
          path,
          headers: { Host: `localhost:${PORT}`, ...headers },
          timeout: 5000,
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode, body }));
        },
      );
      req.on("timeout", () => req.destroy(new Error("timed out")));
      req.on("error", reject);
      req.end();
    });
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Whether an identity service from the unpacked archive runs. On macOS the
   * temporary folder answers to two paths (`/var` and `/private/var`), so a
   * process is matched by the folder's own unique name.
   */
  function running() {
    if (windows) {
      const list = execFileSync(
        "tasklist",
        ["/FI", `IMAGENAME eq ${identityName}`, "/FO", "CSV", "/NH"],
        { encoding: "utf8" },
      );
      return list.includes(`"${identityName}"`);
    }
    const list = execFileSync("ps", ["-A", "-o", "args="], {
      encoding: "utf8",
    });
    const tag = basename(dir);
    return list
      .split("\n")
      .some((line) => line.includes(tag) && /[/\\]identity(\s|$)/.test(line));
  }

  let info = null;
  for (let i = 0; i < 30 && !info; i++) {
    try {
      const res = await call("GET", "/desktop/info");
      if (res.status === 200) info = JSON.parse(res.body);
    } catch {
      // Not answering yet.
    }
    if (!info) await sleep(1000);
  }
  if (!info) fail("/desktop/info never answered");
  console.log(`/desktop/info: ${JSON.stringify(info)}`);
  const infoProblem = desktopInfoProblem(info, version);
  if (infoProblem) fail(infoProblem);

  const app = await call("GET", "/app");
  const appProblem = builtAppProblem(app);
  if (appProblem) fail(appProblem);

  // The identity service starts after the port answers, so it is given a moment.
  let session = null;
  for (let i = 0; i < 30; i++) {
    session = await call("GET", "/identity/session");
    if (!identitySessionProblem(session)) break;
    await sleep(1000);
  }
  console.log(`/identity/session: ${session.body.trim()}`);
  const sessionProblem = identitySessionProblem(session);
  if (sessionProblem) fail(sessionProblem);
  if (!running()) fail("no identity service runs from the archive");

  if (command.length > 0) {
    console.log(`running: ${command.join(" ")}`);
    const run = spawnSync(command[0], command.slice(1), {
      stdio: "inherit",
      shell: windows,
      env: { ...process.env, PLAYWRIGHT_BASE_URL: `http://localhost:${PORT}` },
    });
    if (run.error) fail(`the command did not start: ${run.error.message}`);
    if (run.status !== 0) fail(`the command exited with ${run.status}`);
  }

  const key = /\/desktop\/setup\/#k=([\w-]+)/.exec(output)?.[1];
  if (!key) fail("the program wrote no setup address to its output");
  const quit = await call("POST", "/desktop/setup/api/quit", {
    "X-Phospheare-Admin": "1",
    "X-Phospheare-Setup-Key": key,
  });
  if (quit.status !== 202) fail(`the quit answered ${quit.status}`);

  const code = await Promise.race([exited, sleep(15000).then(() => "late")]);
  if (code === "late") fail("the program was still running 15s after the quit");
  if (code !== 0) fail(`the program exited with ${code}`);
  if (running()) fail("the identity service outlived the program");

  console.log(
    `${PROGRAM} ${version} answers /desktop/info, serves the built SPA at /app, passes /identity/ to the identity service, and quits cleanly with it.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
