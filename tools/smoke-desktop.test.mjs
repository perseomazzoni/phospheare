// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  builtAppProblem,
  desktopInfoProblem,
  identitySessionProblem,
} from "./smoke-desktop.mjs";

test("the smoke command refuses missing arguments before unpacking an archive", () => {
  const script = fileURLToPath(new URL("./smoke-desktop.mjs", import.meta.url));
  // A command must follow `--`; a stray argument is refused the same way.
  for (const args of [[], ["missing.zip"], ["missing.zip", "1.0.0", "stray"]]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage: node tools\/smoke-desktop\.mjs/);
  }
});

test("the release smoke accepts its own program, built SPA and running identity", () => {
  assert.equal(
    desktopInfoProblem(
      { program: "once-dark-studio-desktop", version: "1.2.3" },
      "1.2.3",
    ),
    null,
  );
  assert.equal(
    builtAppProblem({
      status: 200,
      body: '<script type="module" src="/assets/index.js"></script>',
    }),
    null,
  );
  assert.equal(
    identitySessionProblem({ status: 200, body: '{"writerId":null}\n' }),
    null,
  );
});

test("the release smoke rejects another program or version", () => {
  for (const info of [
    { program: "other", version: "1.2.3" },
    { program: "once-dark-studio-desktop", version: "1.2.2" },
  ])
    assert.match(desktopInfoProblem(info, "1.2.3"), /\/desktop\/info names/);
});

test("the release smoke rejects a placeholder app and unsuccessful app responses", () => {
  assert.match(
    builtAppProblem({
      status: 200,
      body: "<p>This copy was built without the writing app.</p>",
    }),
    /without the built SPA/,
  );
  assert.match(
    builtAppProblem({ status: 503, body: '<script type="module"></script>' }),
    /answered 503/,
  );
});

test("the release smoke rejects an identity service that cannot answer", () => {
  for (const session of [
    { status: 503, body: '{"code":"identity-unavailable"}' },
    { status: 404, body: '{"code":"no-session"}' },
    { status: 200, body: '{"writerId":"w1"}' },
    { status: 200, body: "<html>" },
  ])
    assert.match(
      identitySessionProblem(session),
      /did not answer that no session is open/,
      session.body,
    );
});
