// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// node --test tools/check-sarif.test.mjs

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const SCRIPT = fileURLToPath(new URL("./check-sarif.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "check-sarif-"));
after(() => rmSync(dir, { recursive: true, force: true }));

/** Runs the check on one run of `tool` holding a single result. */
function check(tool, rule) {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.sarif`);
  const result = {
    ruleId: "js/xss",
    message: { text: "xss" },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: "missing.ts" },
          region: { startLine: 5 },
        },
      },
    ],
    ...(rule ? { rule } : {}),
  };
  writeFileSync(
    file,
    JSON.stringify({ version: "2.1.0", runs: [{ tool, results: [result] }] }),
  );
  return spawnSync(process.execPath, [SCRIPT, file], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "false" },
  });
}

const xss = (severity) => ({
  id: "js/xss",
  properties: { "security-severity": severity },
});

test("a high finding from a query pack fails, as CodeQL references it", () => {
  const run = check(
    {
      driver: { name: "CodeQL", rules: [] },
      extensions: [{ name: "codeql/javascript-queries", rules: [xss("7.8")] }],
    },
    { id: "js/xss", index: 0, toolComponent: { index: 0 } },
  );
  assert.equal(run.status, 1, run.stdout);
  assert.match(run.stdout, /error missing\.ts:5 js\/xss \(7\.8\)/);
});

test("the component index picks among the extensions", () => {
  const run = check(
    {
      driver: { name: "CodeQL", rules: [xss("2.0")] },
      extensions: [
        { name: "first", rules: [xss("3.0")] },
        { name: "second", rules: [xss("9.1")] },
      ],
    },
    { id: "js/xss", toolComponent: { index: 1 } },
  );
  assert.equal(run.status, 1, run.stdout);
  assert.match(run.stdout, /\(9\.1\)/);
});

test("a result naming no component is looked up in every component", () => {
  const run = check({ driver: { name: "Scanner", rules: [xss("8.0")] } });
  assert.equal(run.status, 1, run.stdout);
});

test("a finding below high is printed and passes", () => {
  const run = check(
    {
      driver: { name: "CodeQL", rules: [] },
      extensions: [{ name: "codeql/javascript-queries", rules: [xss("5.0")] }],
    },
    { id: "js/xss", toolComponent: { index: 0 } },
  );
  assert.equal(run.status, 0, run.stdout);
  assert.match(run.stdout, /warning missing\.ts:5 js\/xss \(5\)/);
});
