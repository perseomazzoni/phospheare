// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Runs the desktop program against stand-ins for Google, deSEC and Let's
// Encrypt, so the whole setup page can be walked by hand, again and again,
// with no real account, email or certificate:
//
//     npm run dev:wizard
//
// It needs Go on the path and Docker running. Each run:
//
// 1. Makes a new folder in the system's temporary folder and builds into it
//    `fake-services`, and the desktop program and the identity service
//    with the `devfake` tag and the address of `fake-services`. These two
//    builds use the stand-ins with no setting at run time; a release build
//    has none of their code.
// 2. Starts Pebble, Let's Encrypt's test authority, and its DNS,
//    `pebble-challtestsrv`, in Docker, published on this computer's
//    loopback only.
// 3. Starts `fake-services`, whose control page gives the Google test
//    client, chooses Google's answers and clicks deSEC's activation link.
//    Then it starts the desktop program on its own port, with a new data
//    folder and its secrets in a file, so the setup page starts from nothing
//    each run. The setup page's links to Google Cloud Console lead to
//    pages of `fake-services`. The `devfake` build keeps its login entry
//    in memory and its home network on loopback, so a run never touches
//    the real program's data, login entry or the system's password store.
//
// The program prints the setup page's address, with its key, to this
// terminal. Ctrl+C, or Quit on the setup page, stops everything and removes
// the containers and the folder.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** The ports and names this mode uses, away from the real program's. */
export const WIZARD = {
  port: 47831,
  fake: "127.0.0.1:47890",
  network: "phospheare-wizard",
  pebble: "phospheare-wizard-pebble",
  dns: "phospheare-wizard-challtestsrv",
};

/**
 * The commands of one run, from the repository at `root` into the folder
 * `dir`. `exe` is the executables' suffix: ".exe" on Windows.
 */
export function wizardPlan({ root, dir, exe }) {
  const bin = (name) => join(dir, "bin", name + exe);
  const desktop = join(root, "desktop");
  const fakeURL = `http://${WIZARD.fake}`;
  const devfake = [
    "-tags",
    "devfake",
    "-ldflags",
    `-X main.fakeServices=${fakeURL}`,
  ];
  return {
    builds: [
      {
        cwd: desktop,
        args: [
          "build",
          ...devfake,
          "-o",
          bin("desktop"),
          "./cmd/once-dark-studio-desktop",
        ],
      },
      {
        cwd: join(root, "identity"),
        args: ["build", ...devfake, "-o", bin("identity"), "./cmd/identity"],
      },
      {
        cwd: desktop,
        args: ["build", "-o", bin("fake-services"), "./cmd/fake-services"],
      },
    ],
    containers: [
      [
        "run",
        "-d",
        "--rm",
        "--name",
        WIZARD.dns,
        "--network",
        WIZARD.network,
        "-p",
        "127.0.0.1:8055:8055",
        "ghcr.io/letsencrypt/pebble-challtestsrv:latest",
        "-management",
        ":8055",
        "-dnsserver",
        ":8053",
        "-http01",
        "",
        "-https01",
        "",
        "-tlsalpn01",
        "",
        "-doh",
        "",
      ],
      [
        "run",
        "-d",
        "--rm",
        "--name",
        WIZARD.pebble,
        "--network",
        WIZARD.network,
        "-p",
        "127.0.0.1:14000:14000",
        "-e",
        "PEBBLE_VA_NOSLEEP=1",
        "-e",
        "PEBBLE_WFE_NONCEREJECT=0",
        "ghcr.io/letsencrypt/pebble:latest",
        "-config",
        "/test/config/pebble-config.json",
        "-dnsserver",
        `${WIZARD.dns}:8053`,
      ],
    ],
    fake: {
      command: bin("fake-services"),
      args: [
        "--addr",
        WIZARD.fake,
        "--pebble",
        "https://localhost:14000/dir",
        "--challtestsrv",
        "http://localhost:8055",
      ],
    },
    desktop: {
      command: bin("desktop"),
      args: [
        "--port",
        String(WIZARD.port),
        "--data-dir",
        join(dir, "data"),
        "--identity",
        bin("identity"),
        "--no-tray",
        "--no-browser",
      ],
    },
    // No Google client yet: the setup page starts at the Google steps.
    files: {
      [join(dir, "data", "config.json")]: '{"secrets":"file"}\n',
    },
    control: `${fakeURL}/`,
  };
}

/** Resolves once `url` answers 200, or rejects after `limitMs`. */
export function untilOK(url, { limitMs = 60_000, everyMs = 500 } = {}) {
  const deadline = Date.now() + limitMs;
  return new Promise((done, fail) => {
    const again = (why) => {
      if (Date.now() > deadline)
        fail(new Error(`${url} did not answer: ${why}`));
      else setTimeout(attempt, everyMs);
    };
    const attempt = () => {
      const req = get(url, { timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) done();
        else again(`status ${res.statusCode}`);
      });
      req.on("timeout", () => req.destroy());
      req.on("error", (err) => again(err.message));
    };
    attempt();
  });
}

function quiet(command, args) {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}

function removeContainers() {
  spawnSync("docker", ["rm", "-f", WIZARD.pebble, WIZARD.dns], {
    stdio: "ignore",
  });
  spawnSync("docker", ["network", "rm", WIZARD.network], { stdio: "ignore" });
}

function labelled(proc, label) {
  for (const [stream, out] of [
    [proc.stdout, process.stdout],
    [proc.stderr, process.stderr],
  ])
    createInterface({ input: stream }).on("line", (line) =>
      out.write(`${label} ${line}\n`),
    );
}

async function main() {
  if (!quiet("go", ["version"])) {
    console.error("npm run dev:wizard needs Go 1.26 on the path.");
    return 1;
  }
  if (!quiet("docker", ["info"])) {
    console.error("npm run dev:wizard needs Docker running, for Pebble.");
    return 1;
  }
  // A new folder that only this user can reach, each run; the end of the
  // run removes it.
  const dir = mkdtempSync(join(tmpdir(), "phospheare-dev-wizard-"));
  const clean = () => {
    removeContainers();
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    } catch (err) {
      console.error(`${dir} was not removed: ${err.message}`);
    }
  };
  const plan = wizardPlan({
    root: ROOT,
    dir,
    exe: process.platform === "win32" ? ".exe" : "",
  });

  mkdirSync(join(dir, "data"));
  for (const [path, text] of Object.entries(plan.files))
    writeFileSync(path, text, { mode: 0o600 });
  for (const build of plan.builds) {
    console.log(`Building ${build.args.at(-1)}.`);
    if (
      spawnSync("go", build.args, { cwd: build.cwd, stdio: "inherit" })
        .status !== 0
    ) {
      clean();
      return 1;
    }
  }

  removeContainers();
  quiet("docker", ["network", "create", WIZARD.network]);
  for (const args of plan.containers) {
    if (
      spawnSync("docker", args, { stdio: ["ignore", "ignore", "inherit"] })
        .status !== 0
    ) {
      clean();
      return 1;
    }
  }

  // Ctrl+C reaches every process from the terminal, and each stops by
  // itself: the program stops its identity service first. Otherwise the
  // first process to end stops the others. The containers go last.
  const procs = [];
  let interrupted = false;
  let first = null;
  process.on("SIGINT", () => {
    interrupted = true;
  });
  const ended = (code) => {
    first ??= code ?? 1;
    const running = procs.filter(
      (p) => p.exitCode === null && p.signalCode === null,
    );
    if (!interrupted) for (const p of running) p.kill();
    if (running.length === 0) {
      clean();
      process.exit(first);
    }
  };

  const fake = spawn(plan.fake.command, plan.fake.args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  labelled(fake, "[fake]");
  procs.push(fake);
  fake.on("exit", ended);
  try {
    await untilOK(`http://${WIZARD.fake}/acme/dir`);
  } catch (err) {
    console.error(`${err.message}.`);
    fake.kill();
    return null;
  }

  console.log(`\nFake Google and deSEC control page: ${plan.control}\n`);
  const desktop = spawn(plan.desktop.command, plan.desktop.args, {
    stdio: "inherit",
  });
  procs.push(desktop);
  desktop.on("exit", ended);
  return null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => {
    if (code !== null) process.exit(code);
  });
}
