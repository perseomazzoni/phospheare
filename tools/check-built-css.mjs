// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Fails when Lightning CSS turned a build's CSS into something a browser
// cannot read, in the two ways it has:
//
// - `--lightningcss-light` or `--lightningcss-dark`: a `light-dark()` lowered
//   for a browser older than `build.cssTarget`. Only a stylesheet's own
//   `color-scheme` defines them, and the theme sets `color-scheme` inline, so
//   the value is invalid.
// - a `-webkit-` property whose rule lost the standard one. Lightning CSS
//   keeps the last of a pair it merges, so `backdrop-filter` written before
//   `-webkit-backdrop-filter` leaves only the copy Chrome and Firefox ignore.
//
//     node tools/check-built-css.mjs web/dist web/dist/demo
//
// Each folder's `assets` is read: its `.css` files, and its `.js` files, which
// hold the theme sheets as strings. The other mistakes of a build show in
// `web/e2e/build-parity.spec.ts`, which compares computed styles.
//
// Exit 0 when every file passes, 1 with a finding, 2 on a bad argument.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Prefixed properties with no standard twin, or whose values differ from it
// (`-webkit-mask-composite: xor` is `mask-composite: exclude`).
const PREFIX_ONLY = new Set([
  "app-region",
  "box-orient",
  "font-smoothing",
  "line-clamp",
  "mask-composite",
  "tap-highlight-color",
  "text-fill-color",
  "text-size-adjust",
  "text-stroke",
  "touch-callout",
  "user-drag",
]);

const dirs = process.argv.slice(2);
if (dirs.length === 0 || dirs.some((d) => !existsSync(join(d, "assets")))) {
  console.error("usage: node tools/check-built-css.mjs <build folder>...");
  process.exit(2);
}

const findings = [];
for (const dir of dirs) {
  const assets = join(dir, "assets");
  for (const name of readdirSync(assets).filter((f) => /\.(css|js)$/.test(f))) {
    const file = join(assets, name);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/--lightningcss-(?:light|dark)/g))
      findings.push(`${file}: ${m[0]} near "${text.slice(m.index - 60, m.index + 40)}"`);
    // A rule's selector and its declarations; nested blocks are matched at
    // their innermost level.
    for (const rule of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const [, selector, body] = rule;
      if (selector.includes("::-webkit-")) continue;
      for (const p of body.matchAll(/(?:^|;)\s*-webkit-([a-z-]+)\s*:/g)) {
        const prop = p[1];
        if (PREFIX_ONLY.has(prop)) continue;
        if (new RegExp(`(?:^|;)\\s*${prop}\\s*:`).test(body)) continue;
        findings.push(
          `${file}: -webkit-${prop} without ${prop} in "${selector.trim().slice(-80)}"`,
        );
      }
    }
  }
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  console.error(`\n${findings.length} finding(s) in the built CSS.`);
  process.exit(1);
}
console.log(`The built CSS in ${dirs.join(", ")} has no lowering a browser cannot read.`);
