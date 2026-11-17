// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// node --test tools/dev-wizard.test.mjs
//
// Pins what `npm run dev:wizard` builds and starts, so a run stays apart
// from the real program and its data, and reaches nothing but loopback.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import { WIZARD, untilOK, wizardPlan } from "./dev-wizard.mjs";

const plan = wizardPlan({ root: "/repo", dir: "/tmp/w", exe: ".exe" });

test("the desktop program and the identity service are built with the devfake tag", () => {
  const tagged = plan.builds.filter((b) => b.args.includes("devfake"));
  assert.deepEqual(
    tagged.map((b) => b.args.at(-1)),
    ["./cmd/once-dark-studio-desktop", "./cmd/identity"],
  );
  for (const b of plan.builds)
    assert.ok(
      b.args[b.args.indexOf("-o") + 1].startsWith(join("/tmp/w", "bin")),
    );
});

test("the devfake builds carry the address of fake-services", () => {
  for (const b of plan.builds.filter((b) => b.args.includes("devfake")))
    assert.equal(
      b.args[b.args.indexOf("-ldflags") + 1],
      `-X main.fakeServices=http://${WIZARD.fake}`,
    );
});

test("the program runs on its own port and data folder, with no tray or browser", () => {
  const args = plan.desktop.args;
  const value = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(value("--port"), String(WIZARD.port));
  assert.notEqual(WIZARD.port, 47821);
  assert.equal(value("--data-dir"), join("/tmp/w", "data"));
  assert.equal(value("--identity"), join("/tmp/w", "bin", "identity.exe"));
  assert.ok(args.includes("--no-tray") && args.includes("--no-browser"));
});

test("the settings keep secrets in a file and start with no Google client", () => {
  const config = JSON.parse(plan.files[join("/tmp/w", "data", "config.json")]);
  assert.equal(config.secrets, "file");
  assert.equal(config.google, undefined);
});

test("every service listens on loopback only", () => {
  assert.match(WIZARD.fake, /^127\.0\.0\.1:\d+$/);
  for (const args of plan.containers) {
    const published = args.filter((_, i) => args[i - 1] === "-p");
    assert.ok(published.length > 0);
    for (const p of published) assert.match(p, /^127\.0\.0\.1:/);
  }
});

test("untilOK waits for a 200 and gives up on anything else", async () => {
  let status = 503;
  const server = createServer((_, res) => res.writeHead(status).end());
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    await assert.rejects(
      untilOK(url, { limitMs: 200, everyMs: 50 }),
      /status 503/,
    );
    status = 200;
    await untilOK(url, { limitMs: 1000, everyMs: 50 });
  } finally {
    server.close();
  }
});
