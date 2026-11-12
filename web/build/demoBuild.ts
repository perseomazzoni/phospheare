// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What `build:demo` builds differently from the full program, beyond its own
// root (`src/demo/main.tsx`): the modules it replaces with a twin, and the
// locale strings it leaves out. `vite.config.ts` applies both; the gate in
// `demoBoundary.ts` then checks the result.
//
// Build tooling: only `vite.config.ts` imports it, so it is in no bundle.

import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { moduleName } from "./demoBoundary.ts";

/**
 * The site's pages other than `/`: the demo editor (`DEMO_PATH`) and the
 * site's two legal texts (`legal/compose.demo.ts`). A static host has no
 * rewrite rules, so each page gets its own copy of the built page, and the
 * router inside it reads the address. Written out rather than imported, so
 * `vite.config.ts` loads no app module; the test checks them against the
 * routes.
 */
export const DEMO_PAGES: readonly string[] = [
  "/app/editor/demo",
  "/legal",
  "/privacy",
];

/**
 * The copies of the built page the site needs: `<page>/index.html` for each
 * of `DEMO_PAGES`, which the host serves for the page's address, and
 * `404.html`, which it serves with a 404 for every address it has no file
 * for. That copy's router shows "not found".
 */
export function demoPageFiles(): string[] {
  return [
    ...DEMO_PAGES.map((page) => `${page.replace(/^\/+/, "")}/index.html`),
    "404.html",
  ];
}

/**
 * Modules the demo build replaces with the `.demo` file beside them, as
 * `web/src/`-relative paths without the extension. A twin keeps its
 * original's exports, so no importer changes.
 */
export const DEMO_TWINS: readonly string[] = [
  "preferences/compose",
  "legal/compose",
];

const TWIN_NAMES = new Set(DEMO_TWINS.map((twin) => twin.split("/").pop()));

/**
 * Whether an import specifier can name a module with a twin: its last
 * segment, without an extension, is the file name of one. Every other import
 * needs no resolving to know it has none.
 */
export function mayHaveTwin(source: string): boolean {
  const last =
    source
      .replace(/[?#].*$/, "")
      .split("/")
      .pop() ?? "";
  return TWIN_NAMES.has(last.replace(/\.[cm]?[jt]sx?$/, ""));
}

/** The twin's path for a resolved module id, or `null` when it has none. */
export function demoTwin(id: string, srcRoot: string): string | null {
  if (!DEMO_TWINS.includes(moduleName(id, srcRoot))) return null;
  return id.replace(/(\.[cm]?[jt]sx?)(?=[?#]|$)/, ".demo$1");
}

/**
 * The files under `public/` the demo build leaves out: the icons an
 * installed program or a home-screen link shows. The site is not a program
 * to install.
 */
export const DEMO_LEFT_OUT_PUBLIC: readonly string[] = [
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
];

/** The extensions of the files under `public/` that hold text. */
const TEXT_FILES = new Set([
  ".txt",
  ".json",
  ".webmanifest",
  ".svg",
  ".html",
  ".xml",
  ".css",
  ".js",
  ".md",
]);

/**
 * Every text file under `dir`, as the gate's `[file, text]` pairs named
 * `public/<path>`: Vite copies them into the build beside the bundle, so
 * they reach the site as its own files do.
 */
export function publicTexts(dir: string): [string, string][] {
  const texts: [string, string][] = [];
  for (const entry of readdirSync(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !TEXT_FILES.has(extname(entry.name).toLowerCase()))
      continue;
    const path = join(entry.parentPath, entry.name);
    const name = relative(dir, path).replace(/\\/g, "/");
    texts.push([`public/${name}`, readFileSync(path, "utf8")]);
  }
  return texts.sort(([a], [b]) => a.localeCompare(b));
}

/** Locale sections only the stripped features read. */
export const PRUNED_SECTIONS: readonly string[] = [
  "auth",
  "library",
  "sync",
  "connect",
  "export",
  "import",
  "accountData",
];

/**
 * Keys inside a pruned section that the kept code reads: the legal page's
 * way home, the titlebar's account label and a storage message.
 */
export const KEPT_KEYS: readonly string[] = [
  "auth.backHome",
  "library.accountFor",
  "library.accountWithoutGoogle",
  "library.openFailed",
];

/**
 * Keys outside the pruned sections that only stripped code reads: the
 * landing's sign-in, and the full program's legal texts, which the site
 * replaces with its own (`legal/compose.demo.ts`).
 */
export const PRUNED_KEYS: readonly string[] = [
  "landing.head.logIn",
  "landing.head.logInShort",
  "landing.head.withoutAccount",
  "landing.hero.start",
  "landing.withoutAccount",
  "landing.noFolders",
  "legal.notice",
  "legal.privacy",
  "legal.terms",
  "legal.links.terms",
];

type Strings = { [key: string]: string | Strings };

/**
 * The locale without the pruned sections, keeping `KEPT_KEYS`, and without
 * `PRUNED_KEYS`.
 */
export function pruneLocale(locale: Strings): Strings {
  const pruned = pruneSections(locale);
  for (const key of PRUNED_KEYS) dropPath(pruned, key.split("."));
  return pruned;
}

function pruneSections(locale: Strings): Strings {
  const pruned: Strings = { ...locale };
  for (const section of PRUNED_SECTIONS) {
    const strings = locale[section];
    delete pruned[section];
    if (typeof strings !== "object") continue;
    const kept: Strings = {};
    for (const key of KEPT_KEYS) {
      const [head, ...rest] = key.split(".");
      if (head !== section) continue;
      const value = rest.reduce<string | Strings | undefined>(
        (node, part) => (typeof node === "object" ? node[part] : undefined),
        strings,
      );
      if (value !== undefined) setPath(kept, rest, value);
    }
    if (Object.keys(kept).length) pruned[section] = kept;
  }
  return pruned;
}

/**
 * Deletes the key at `path`. Each object on the path is copied first, so the
 * source locale keeps the key.
 */
function dropPath(target: Strings, path: string[]) {
  let node = target;
  for (const part of path.slice(0, -1)) {
    const next = node[part];
    if (typeof next !== "object") return;
    node = node[part] = { ...next };
  }
  delete node[path[path.length - 1] as string];
}

function setPath(target: Strings, path: string[], value: string | Strings) {
  let node = target;
  for (const part of path.slice(0, -1)) {
    const next = node[part];
    node = typeof next === "object" ? next : (node[part] = {});
  }
  node[path[path.length - 1] as string] = value;
}
