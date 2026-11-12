// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Fails when a source file does not open with the license header, and writes
// the header where it is missing.
//
//     node tools/check-headers.mjs          # list the files without it
//     node tools/check-headers.mjs --fix    # add it to them
//
// The header is the copyright line, the SPDX identifier and one sentence that
// names `LICENSE`, as a comment in the file's own syntax: `//` in TypeScript,
// JavaScript and Go, `/* */` in CSS, `<!-- -->` in HTML, `#` in shell and
// Python, and `--` in SQL. It sits after a shebang in a script and first
// everywhere else. The roots and extensions below include declarations,
// scripts and the web entry page. A file passes when its SPDX line is among
// its first lines, so the copyright year may differ between files.
//
// Exit 0 when every file has the header (or `--fix` wrote it), 1 with files
// missing it, 2 on a bad argument.

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const HEADER = [
  "Copyright (C) 2026 Perseo Mazzoni",
  "SPDX-License-Identifier: AGPL-3.0-or-later",
  "Free software under the GNU Affero General Public License, version 3 or",
  "later; the full text is in `LICENSE`.",
];
const MARK = HEADER[1];
const HEAD_LINES = 8;

// ── What is scanned ──────────────────────────────────────────────────────────

const ROOTS = [
  "web/src",
  "web/e2e",
  "web/scripts",
  "tools",
  "identity",
  "desktop",
  "docs/brand",
];
const ROOT_FILES = [
  "web/index.html",
  "web/eslint.config.js",
  "web/export-matrix.config.ts",
  "web/playwright.config.ts",
  "web/vite.config.ts",
];
const SKIP_DIRS = new Set([
  "node_modules",
  "vendor",
  "dist",
  "coverage",
  "test-results",
  "md-templates",
]);
const SCRIPT = new Set([".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs"]);
const EXTENSIONS = new Set([
  ...SCRIPT,
  ".go",
  ".css",
  ".html",
  ".sh",
  ".sql",
  ".py",
]);

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(extname(entry))) out.push(full);
  }
}

function filesToScan() {
  const out = [];
  for (const dir of ROOTS) walk(join(root, dir), out);
  for (const file of ROOT_FILES)
    if (existsSync(join(root, file))) out.push(join(root, file));
  return out;
}

// ── The header in each syntax ────────────────────────────────────────────────

const hasHeader = (source) =>
  source.split("\n", HEAD_LINES).some((line) => line.includes(MARK));

const lineComments = (prefix) =>
  HEADER.map((line) => `${prefix}${line}`).join("\n");

/** The source with the header written in, for a file that lacks it. */
function withHeader(file, source) {
  const ext = extname(file);
  const body = (text) => text.replace(/^\n+/, "");
  if (ext === ".css") return `/* ${HEADER.join("\n   ")} */\n\n${body(source)}`;
  if (ext === ".html")
    return `<!--\n${HEADER.map((line) => `  ${line}`).join("\n")}\n-->\n${body(source)}`;
  if (ext === ".sql") return `${lineComments("-- ")}\n\n${body(source)}`;
  const shebang = /^#![^\n]*\n/.exec(source);
  const head = shebang ? shebang[0] : "";
  const prefix = [".sh", ".py"].includes(ext) ? "# " : "// ";
  return `${head}${lineComments(prefix)}\n\n${body(source.slice(head.length))}`;
}

// ── Run ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const fix = args.includes("--fix");
const unknown = args.filter((a) => a !== "--fix");
if (unknown.length) {
  console.error(`unknown argument: ${unknown.join(" ")}`);
  process.exit(2);
}

let missing = 0;
for (const file of filesToScan()) {
  const source = readFileSync(file, "utf8");
  if (hasHeader(source)) continue;
  const rel = relative(root, file).split(sep).join("/");
  if (fix) {
    writeFileSync(file, withHeader(file, source));
    console.log(`added: ${rel}`);
  } else {
    missing++;
    console.log(`missing: ${rel}`);
  }
}

if (missing) {
  console.error(
    `\n${missing} file(s) without the license header. Add it: node tools/check-headers.mjs --fix`,
  );
  process.exitCode = 1;
} else if (!fix) {
  console.log("headers present");
}
