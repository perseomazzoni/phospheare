// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// node --test tools/go-modules.test.mjs
//
// Pins how the license check and the notices read `identity/go.mod` and `desktop/go.mod` without a Go
// toolchain.

import { test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { escapeModulePath, goModules, parseGoMod } from "./go-modules.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("both require forms are read, with their indirect marks", () => {
  const modules = parseGoMod(
    [
      "module example.test/m",
      "",
      "go 1.26.0",
      "",
      "require example.test/single v1.0.0",
      "",
      "require (",
      "\texample.test/direct v0.2.0",
      "\texample.test/indirect v0.3.0 // indirect",
      ")",
      "",
      "replace example.test/single => ../single",
    ].join("\r\n"),
  );
  assert.deepEqual(modules, [
    { path: "example.test/single", version: "v1.0.0", indirect: false },
    { path: "example.test/direct", version: "v0.2.0", indirect: false },
    { path: "example.test/indirect", version: "v0.3.0", indirect: true },
  ]);
});

test("every module identity and desktop require has a recorded license", () => {
  const modules = goModules(ROOT);
  assert.ok(modules.length > 0);
  for (const m of modules) assert.ok(m.license, m.path);
});

test("capitals in a module path are escaped as the module cache spells them", () => {
  assert.equal(escapeModulePath("github.com/BurntSushi/toml"), "github.com/!burnt!sushi/toml");
  assert.equal(escapeModulePath("golang.org/x/crypto"), "golang.org/x/crypto");
});
