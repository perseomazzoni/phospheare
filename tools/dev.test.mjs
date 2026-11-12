// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// node --test tools/dev.test.mjs
//
// Pins how the development servers read `.env` and what they are started
// with, so the Google client secret stays out of every command line.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEV_DEFAULTS,
  identityCommand,
  identitySettings,
  portOf,
  untilAnswering,
  webCommand,
} from "./dev.mjs";

const CLIENT = {
  IDENTITY_GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
  IDENTITY_GOOGLE_CLIENT_SECRET: "s3cret",
};

test("the defaults fill what .env leaves out, and the process wins over the file", () => {
  const { settings, missing } = identitySettings(
    { ...CLIENT, IDENTITY_LISTEN: "127.0.0.1:5000" },
    { IDENTITY_LISTEN: "127.0.0.1:6000" },
  );
  assert.deepEqual(missing, []);
  assert.equal(settings.IDENTITY_LISTEN, "127.0.0.1:6000");
  assert.equal(
    settings.IDENTITY_PUBLIC_ORIGINS,
    DEV_DEFAULTS.IDENTITY_PUBLIC_ORIGINS,
  );
  assert.equal(settings.IDENTITY_SEAL_KEYS_FILE, ".keys/seal.keys");
});

test("only IDENTITY_ entries reach the service, and empty ones count as missing", () => {
  const { settings, missing } = identitySettings(
    {
      IDENTITY_GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
      IDENTITY_GOOGLE_CLIENT_SECRET: "",
      OPENROUTER_APP_KEY: "unrelated",
    },
    { PATH: "/usr/bin" },
  );
  assert.deepEqual(missing, ["IDENTITY_GOOGLE_CLIENT_SECRET"]);
  assert.equal("OPENROUTER_APP_KEY" in settings, false);
  assert.equal("PATH" in settings, false);
});

test("with Go, the service runs from identity/ with its settings in the environment", () => {
  const { settings } = identitySettings(CLIENT, {});
  const run = identityCommand(settings, { root: "/repo-root", hasGo: true });
  assert.equal(run.command, "go");
  assert.deepEqual(run.args, ["run", "./cmd/identity"]);
  assert.match(run.cwd, /identity$/);
  assert.equal(run.env.IDENTITY_GOOGLE_CLIENT_SECRET, "s3cret");
});

test("in Docker, values pass by name only, and the port opens on loopback", () => {
  const { settings } = identitySettings(CLIENT, {});
  const run = identityCommand(settings, { root: "/repo-root", hasGo: false });
  assert.equal(run.command, "docker");
  assert.equal(
    run.args.some((arg) => arg.includes("s3cret")),
    false,
  );
  assert.ok(run.args.includes("IDENTITY_GOOGLE_CLIENT_SECRET"));
  assert.ok(run.args.includes("127.0.0.1:47821:47821"));
  assert.ok(run.args.includes("phospheare-identity-47821"));
  assert.ok(run.args.includes("/repo-root:/repo"));
  assert.ok(run.args.includes("-i"));
  assert.equal(run.stdinPipe, true);
  assert.equal(run.env.IDENTITY_STOP_ON_STDIN_CLOSE, "true");
  assert.equal(run.env.IDENTITY_LISTEN, "0.0.0.0:47821");
  assert.equal(run.env.IDENTITY_GOOGLE_CLIENT_SECRET, "s3cret");
});

test("the web app takes the public origin's port strictly and proxies to the service", () => {
  const { settings } = identitySettings(
    {
      ...CLIENT,
      IDENTITY_PUBLIC_ORIGINS: "http://localhost:5180, http://localhost:5181",
      IDENTITY_LISTEN: "127.0.0.1:47900",
    },
    {},
  );
  const web = webCommand(settings);
  assert.deepEqual(web.args, [
    "run",
    "dev",
    "--workspace",
    "@phospheare/web",
    "--",
    "--port",
    "5180",
    "--strictPort",
  ]);
  assert.equal(web.env.PHOSPHEARE_IDENTITY_ORIGIN, "http://127.0.0.1:47900");
});

test("the service counts as up at its first HTTP answer, not at a dropped connection", async () => {
  const { createServer } = await import("node:net");
  const { createServer: createHttp } = await import("node:http");
  // A listener that closes every connection, as Docker's published port
  // does before the service in the container listens.
  const dropping = createServer((socket) => socket.destroy());
  await new Promise((r) => dropping.listen(0, "127.0.0.1", r));
  const port = dropping.address().port;
  await assert.rejects(
    untilAnswering(port, { limitMs: 300, everyMs: 50 }),
    /did not answer/,
  );
  await new Promise((r) => dropping.close(r));

  const answering = createHttp((_req, res) => res.writeHead(404).end());
  await new Promise((r) => answering.listen(port, "127.0.0.1", r));
  await untilAnswering(port, { limitMs: 2000, everyMs: 50 });
  await new Promise((r) => answering.close(r));
});

test("a listen address without a port is refused", () => {
  assert.equal(portOf("[::1]:47821"), 47821);
  assert.throws(() => portOf("localhost"), /host:port/);
});
