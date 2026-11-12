// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// node --test tools/notice-texts.test.mjs
//
// Pins which files the notices take from a package, and that a package with
// none takes its kept text or none at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEPT_DIR, noticeFiles, packageTexts } from "./notice-texts.mjs";

function dirWith(files) {
  const dir = mkdtempSync(join(tmpdir(), "notice-texts-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

test("license, notice and third-party notice files are taken, other files are not", () => {
  const dir = dirWith({
    "LICENSE.txt": "mit\r\n",
    NOTICE: "apache notice",
    "ThirdPartyNoticeText.txt": "bundled",
    "CopyrightNotice.txt": "copyright",
    "README.md": "readme",
    "index.js": "code",
  });
  mkdirSync(join(dir, "licenses"));
  assert.deepEqual(
    noticeFiles(dir).map((f) => f.file),
    ["CopyrightNotice.txt", "LICENSE.txt", "NOTICE", "ThirdPartyNoticeText.txt"],
  );
  assert.equal(noticeFiles(dir).find((f) => f.file === "LICENSE.txt").text, "mit");
});

test("a package's own texts win over a kept one", () => {
  const kept = dirWith({ "pkg@1.0.0.txt": "kept" });
  const dir = dirWith({ LICENSE: "own" });
  assert.deepEqual(packageTexts(dir, "pkg", "1.0.0", kept), [{ file: "LICENSE", text: "own" }]);
});

test("a package with no text takes its kept one, by exact name and version", () => {
  const kept = dirWith({ "pkg@1.0.0.txt": "kept", "@scope+pkg@2.0.0.txt": "scoped" });
  const dir = dirWith({ "index.js": "code" });
  assert.deepEqual(packageTexts(dir, "pkg", "1.0.0", kept), [{ file: "pkg@1.0.0.txt", text: "kept" }]);
  assert.equal(packageTexts(dir, "@scope/pkg", "2.0.0", kept)[0].text, "scoped");
  assert.equal(packageTexts(dir, "pkg", "1.0.1", kept), null);
});

test("every kept text names the repository it was read from", () => {
  for (const f of readdirSync(KEPT_DIR))
    assert.match(readFileSync(join(KEPT_DIR, f), "utf8"), /^Source: https:\/\/github\.com\//, f);
});
