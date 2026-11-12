// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Writes the third-party notices.
//
//     node tools/generate-notices.mjs                  # web/dist/third-party-notices.txt
//     node tools/generate-notices.mjs --out <file>     # anywhere else
//     node tools/generate-notices.mjs --web-only --out web/dist/demo/third-party-notices.txt
//
// The file is written into `web/dist` before the release builds, so
// `once-dark-studio-desktop` embeds it and serves it beside the app as
// `/third-party-notices.txt`. It is generated, not committed, because a
// committed copy goes stale with every dependency update.
//
// `--web-only` leaves out the Go modules, for the demo site: it serves the web
// app alone, with no desktop program, and needs no Go toolchain.
//
// Two sources, each with full license texts:
//
//   * `package-lock.json`: the npm packages the SPA bundle ships, texts from
//     `node_modules`, or from `tools/notices` for a package that ships none
//     (`notice-texts.mjs`);
//   * `identity/go.mod` and `desktop/go.mod`: the Go modules
//     `once-dark-studio-desktop` links, texts from the Go
//     module cache (`GOMODCACHE`, or `go env GOMODCACHE`), and the Go
//     standard library's license from `GOROOT` (or `go env GOROOT`).
//
// It needs `npm ci` at the root to have run. It runs `go mod download` in
// `desktop/` and `identity/` itself when a module is not in the cache; a text
// still missing fails the run (`notice-texts.mjs`). The output is
// deterministic: sorted, LF line endings, no dates.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { escapeModulePath, goModules as listGoModules } from "./go-modules.mjs";
import { noticeFiles, packageTexts } from "./notice-texts.mjs";
import { FORBIDDEN_PACKAGES } from "../web/build/demoBoundary.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outAt = process.argv.indexOf("--out");
const OUT =
  outAt > 0 && process.argv[outAt + 1]
    ? resolve(process.argv[outAt + 1])
    : join(root, "web/dist/third-party-notices.txt");

const WEB_ONLY = process.argv.includes("--web-only");

const PRODUCT = JSON.parse(
  readFileSync(join(root, "product.json"), "utf8"),
).name;
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function licenseOf(v) {
  if (typeof v.license === "string") return v.license;
  return v.license ? JSON.stringify(v.license) : "not declared in the lockfile";
}

// ── npm packages ─────────────────────────────────────────────────────────────

/**
 * The lockfile keys a workspace's runtime dependencies resolve to, with their
 * own dependencies, leaving out `leaveOut` and everything only they bring.
 * A name resolves as Node resolves it: the nearest `node_modules` up from
 * the package that asks.
 */
function runtimeTree(lock, workspace, leaveOut) {
  const found = new Set();
  const visit = (from, names) => {
    for (const name of names) {
      if (leaveOut.has(name)) continue;
      let base = from;
      let key = null;
      for (;;) {
        const candidate = `${base ? `${base}/` : ""}node_modules/${name}`;
        if (lock.packages[candidate]) {
          key = candidate;
          break;
        }
        if (!base) break;
        // One package up, or the root once no `node_modules` is left.
        const up = base.replace(/\/?node_modules\/(@[^/]+\/)?[^/]+$/, "");
        base = up === base ? "" : up;
      }
      if (!key || found.has(key)) continue;
      found.add(key);
      const entry = lock.packages[key];
      visit(key, [
        ...Object.keys(entry.dependencies ?? {}),
        ...Object.keys(entry.optionalDependencies ?? {}),
      ]);
    }
  };
  visit(workspace, Object.keys(lock.packages[workspace].dependencies ?? {}));
  return found;
}

/**
 * The packages a lockfile ships: every top-level entry not flagged dev, or,
 * with `only`, the entries at those keys.
 */
function npmPackages(base, { skip = new Set(), only = null } = {}) {
  const lock = JSON.parse(
    readFileSync(join(root, base, "package-lock.json"), "utf8"),
  );
  const keep = only ? only(lock) : null;
  const seen = new Map();
  for (const [key, v] of Object.entries(lock.packages)) {
    if (!key.startsWith("node_modules/") || v.link) continue;
    if (keep && !keep.has(key)) continue;
    const name = v.name ?? key.replace(/^.*node_modules\//, "");
    if (skip.has(name)) continue;
    if (v.dev) continue;
    const id = `${name}@${v.version}`;
    if (!seen.has(id))
      seen.set(id, {
        name,
        version: v.version,
        license: licenseOf(v),
        dir: join(root, base, key),
      });
  }
  const packages = [...seen.values()].sort(byName);
  if (packages.some((p) => !existsSync(p.dir)))
    fail(
      `${join(base, "node_modules")} is missing: run \`npm ci\` there first, the license texts are read from it.`,
    );
  return packages;
}

function link(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const repo =
    typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const url = pkg.homepage ?? repo ?? "";
  return url.replace(/^git\+/, "").replace(/\.git$/, "");
}

function npmEntries(packages) {
  const out = [];
  for (const p of packages) {
    const url = link(p.dir);
    const files = packageTexts(p.dir, p.name, p.version);
    if (files === null)
      fail(
        `${p.name}@${p.version} ships no license text: add the text from its repository at that version as tools/notices/${p.name.replace("/", "+")}@${p.version}.txt.`,
      );
    // The lockfile only knows what package.json declares. A package that
    // declares nothing but ships an MIT text is MIT, and says so.
    const license =
      p.license.startsWith("not declared") && /^MIT License/.test(files[0].text)
        ? "MIT (stated in its LICENSE file)"
        : p.license;
    out.push(`### ${p.name} ${p.version}\n`);
    out.push(`License: ${license}${url ? `  \nSource: ${url}` : ""}\n`);
    for (const f of files) out.push("```text\n" + f.text + "\n```\n");
  }
  return out;
}

// The demo site leaves out the packages its gate forbids, and what only they
// bring in, so its notices name what it ships.
const webPackages = npmPackages(".", {
  skip: new Set(["@phospheare/web"]),
  only: WEB_ONLY
    ? (lock) => runtimeTree(lock, "web", new Set(FORBIDDEN_PACKAGES))
    : null,
});

// ── Go modules ───────────────────────────────────────────────────────────────

function goEnv(name) {
  if (process.env[name]) return process.env[name];
  try {
    return execFileSync("go", ["env", name], { encoding: "utf8" }).trim();
  } catch {
    return fail(
      `No ${name}: set it, or install Go and run \`go mod download\` in desktop/.`,
    );
  }
}

const cache = WEB_ONLY ? "" : goEnv("GOMODCACHE");
const goroot = WEB_ONLY ? "" : goEnv("GOROOT");
if (!WEB_ONLY && !existsSync(join(goroot, "LICENSE")))
  fail(`No Go license at ${join(goroot, "LICENSE")}.`);
const goModules = (WEB_ONLY ? [] : listGoModules(root))
  .map((m) => ({
    name: m.path,
    version: m.version,
    license: m.license ?? "not recorded in tools/go-modules.mjs",
    dir: join(cache, `${escapeModulePath(m.path)}@${m.version}`),
  }))
  .sort(byName);
// A first build on a new computer has an empty module cache: the modules are
// downloaded once, here, and then every text must be there.
const missing = () =>
  goModules.find((m) => !existsSync(m.dir) || noticeFiles(m.dir).length === 0);
if (missing()) {
  for (const module of ["desktop", "identity"]) {
    try {
      execFileSync("go", ["mod", "download"], {
        cwd: join(root, module),
        stdio: "inherit",
      });
    } catch {
      fail(`\`go mod download\` failed in ${module}/.`);
    }
  }
}
const absent = missing();
if (absent)
  fail(
    `${absent.name}@${absent.version} has no license text in ${cache}, even after \`go mod download\`.`,
  );

// ── The notices file ─────────────────────────────────────────────────────────

const origin = WEB_ONLY
  ? `This file is generated by \`node tools/generate-notices.mjs --web-only\` from
\`package-lock.json\` for the demo site, which serves it as
\`/third-party-notices.txt\`.`
  : `This file is generated by \`node tools/generate-notices.mjs\` from
\`package-lock.json\` and \`identity/go.mod\` and \`desktop/go.mod\` for each release. \`once-dark-studio-desktop\`
serves it as \`/third-party-notices.txt\`.`;

const out = [];
out.push(`# Third-party notices

${PRODUCT} includes and depends on the open-source components below. Each
keeps its own license; none of it is covered by the license in \`LICENSE\`.

${origin}

## Fonts

The fonts in \`web/public/fonts\` (\`/fonts\` in the served app) are bundled
with the web app. Each family's license text sits beside the font files.

| Family | License | License text |
|---|---|---|
| Geist, Geist Mono | SIL Open Font License 1.1 | \`web/public/fonts/LICENSE-Geist.txt\`, \`LICENSE-GeistMono.txt\` |
| Newsreader (the weight- and optical-size-axis cut) | SIL Open Font License 1.1 | \`web/public/fonts/LICENSE-Newsreader.txt\` |
| Brygada 1918 (Vision's face, the weight-axis cut, \`brygada-*\`) | SIL Open Font License 1.1 | \`web/public/fonts/LICENSE-Brygada1918.txt\` |
| Tinos, Cousine, Courier Prime, Newsreader (static, for export) | see the files | \`web/public/fonts/export/LICENSE-*.txt\` |

## Web app (npm)

${webPackages.length} packages ship in ${WEB_ONLY ? "the demo site's build" : "the production build"} or its dependency
tree. Build and test tools are not listed.
`);
out.push(...npmEntries(webPackages));

if (!WEB_ONLY) {
  out.push(`## Desktop program (Go)

${goModules.length} modules are linked into \`once-dark-studio-desktop\`, as \`identity/go.mod\` and \`desktop/go.mod\`
requires them, and the Go standard library and runtime.
`);
  out.push("### Go standard library and runtime\n");
  out.push("License: BSD-3-Clause  \nSource: https://go.dev/\n");
  for (const f of noticeFiles(goroot))
    out.push("```text\n" + f.text + "\n```\n");
  for (const m of goModules) {
    out.push(`### ${m.name} ${m.version}\n`);
    out.push(
      `License: ${m.license}  \nSource: https://pkg.go.dev/${m.name}@${m.version}\n`,
    );
    for (const f of noticeFiles(m.dir))
      out.push("```text\n" + f.text + "\n```\n");
  }
}

const text = out.join("\n").replace(/\n{3,}/g, "\n\n");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, text);
console.log(`wrote ${OUT} (${webPackages.length} npm, ${goModules.length} Go)`);
