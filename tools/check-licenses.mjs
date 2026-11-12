// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Fails when a dependency the product ships is under a license outside the
// allow-list.
//
//     node tools/check-licenses.mjs
//
// The allow-list holds permissive licenses only. A copyleft dependency, even a
// weak one, would bind the code that links it, and the product could not be
// offered under a commercial license beside the project's own. It reads the
// lockfile, `identity/go.mod` and `desktop/go.mod`, and needs no install:
//
//   * npm, `package-lock.json`: every package the lockfile does not flag dev,
//     since the SPA bundle that `once-dark-studio-desktop` embeds ships them;
//   * Go, `identity/go.mod` and `desktop/go.mod`: every required module,
//     with the license `tools/go-modules.mjs` records for it.
//
// A license expression passes when one alternative of each OR passes, and an
// AND passes only when all its parts do.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { goModules } from "./go-modules.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ALLOWED = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSL-1.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT-0",
  "PSF-2.0",
  "Python-2.0",
  "Unlicense",
  "Zlib",
]);

// Packages whose lockfile entry declares no license, with the license their
// own license file carries. An entry is checked against that file before it
// is added here.
const DECLARED_IN_LICENSE_FILE = new Map([["png-js", "MIT"]]);

/** Whether a license expression is satisfied by the allow-list. */
function allowed(expression) {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let at = 0;
  // or := and ("OR" and)*; and := atom ("AND" atom)*; atom := id | "(" or ")"
  const or = () => {
    let ok = and();
    while (tokens[at] === "OR") {
      at++;
      ok = and() || ok;
    }
    return ok;
  };
  const and = () => {
    let ok = atom();
    while (tokens[at] === "AND") {
      at++;
      ok = atom() && ok;
    }
    return ok;
  };
  const atom = () => {
    if (tokens[at] === "(") {
      at++;
      const ok = or();
      at++;
      return ok;
    }
    return ALLOWED.has(tokens[at++]);
  };
  const ok = or();
  return ok && at === tokens.length;
}

const offenders = [];
const check = (ecosystem, name, license) => {
  const declared = license ?? DECLARED_IN_LICENSE_FILE.get(name);
  if (!declared || !allowed(declared))
    offenders.push(
      `${ecosystem} ${name}: ${declared ?? "no license declared"}`,
    );
};

const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
for (const [key, v] of Object.entries(lock.packages)) {
  if (!key.includes("node_modules/") || v.link || v.dev) continue;
  const name = v.name ?? key.replace(/^.*node_modules\//, "");
  check("npm", name, typeof v.license === "string" ? v.license : undefined);
}

for (const m of goModules(root)) check("go", m.path, m.license);

if (offenders.length > 0) {
  console.error("Dependencies under a license outside the allow-list:");
  for (const line of [...new Set(offenders)].sort()) console.error(`  ${line}`);
  console.error(`Allowed: ${[...ALLOWED].join(", ")}.`);
  process.exit(1);
}
console.log("licenses clean");
