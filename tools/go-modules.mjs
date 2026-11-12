// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The Go modules `once-dark-studio-desktop` and the identity service are
// built from, read from `desktop/go.mod` and `identity/go.mod` with no Go
// toolchain, and the license each one carries.
//
// `go.mod` lists every module that provides a package to the build, direct or
// indirect, because module graph pruning (Go 1.17 and later) requires it. Its
// `require` list is therefore the shipped set for every target `build.sh`
// cross-compiles, including modules only one operating system links, which a
// `go list` on a single platform would miss.
//
// Go modules declare no license in any file the toolchain reads, so
// `GO_LICENSES` records each module's license by hand, from the `LICENSE` in
// the module at that version. A module missing from it is reported as having
// no declared license, and a new dependency fails the license check until its
// file has been read and the module added.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** SPDX identifiers keyed by module path, each read from the module's own `LICENSE`. */
export const GO_LICENSES = new Map([
  ["fyne.io/systray", "Apache-2.0"],
  ["github.com/godbus/dbus/v5", "BSD-2-Clause"],
  ["golang.org/x/crypto", "BSD-3-Clause"],
  ["golang.org/x/sys", "BSD-3-Clause"],
  ["rsc.io/qr", "BSD-3-Clause"],
]);

/**
 * Parses the `require` directives of a `go.mod` text, in both the single-line
 * and the block form.
 *
 * @returns `{ path, version, indirect }` per required module, in file order.
 */
export function parseGoMod(text) {
  const out = [];
  const take = (line) => {
    const indirect = /\/\/\s*indirect\b/.test(line);
    const [path, version] = line.replace(/\/\/.*$/, "").trim().split(/\s+/);
    if (path && version) out.push({ path, version, indirect });
  };
  let inBlock = false;
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (inBlock) {
      if (line.startsWith(")")) inBlock = false;
      else take(line);
    } else if (/^require\s*\($/.test(line)) inBlock = true;
    else if (line.startsWith("require ")) take(line.slice("require ".length));
  }
  return out;
}

/** The repository's own modules, which are not third-party code. */
const OWN = "github.com/perseomazzoni/phospheare/";

/**
 * The third-party modules `identity/go.mod` and `desktop/go.mod` require,
 * each once, with its recorded license or `undefined`.
 */
export function goModules(root) {
  const seen = new Map();
  for (const dir of ["identity", "desktop"]) {
    const text = readFileSync(join(root, dir, "go.mod"), "utf8");
    for (const m of parseGoMod(text)) {
      if (!m.path.startsWith(OWN) && !seen.has(m.path)) seen.set(m.path, { ...m, license: GO_LICENSES.get(m.path) });
    }
  }
  return [...seen.values()];
}

/**
 * The module cache's directory name for a module path: each capital letter is
 * written as `!` and its lower case, as the Go toolchain escapes it.
 */
export function escapeModulePath(path) {
  return path.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
}
