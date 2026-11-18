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
 * The pages rendered to HTML at build time (`src/demo/prerender.tsx`) and
 * listed in the sitemap: the landing and the legal texts. The demo editor
 * is left out: it is the program, not text to index, and `robots.txt` keeps
 * crawlers out of `/app/`.
 */
export const PRERENDERED_PAGES: readonly string[] = ["/", "/legal", "/privacy"];

/**
 * Where `build:demo` writes the site, and where its second step writes the
 * prerender's Node build, which does not ship. Both relative to `web/`.
 */
export const DEMO_SITE_DIR = "dist/demo";
export const PRERENDER_OUT_DIR = "dist/demo-prerender";

/** The site's written file for a page: `index.html` in its folder. */
export function pageFile(page: string): string {
  const folder = page.replace(/^\/+|\/+$/g, "");
  return folder ? `${folder}/index.html` : "index.html";
}

/**
 * A page's one address. The host answers `/legal` with a redirect to
 * `/legal/`, the folder that holds its file, so the canonical form ends in
 * "/".
 */
export function pageUrl(site: string, page: string): string {
  const folder = page.replace(/^\/+|\/+$/g, "");
  return folder ? `${site}/${folder}/` : `${site}/`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** What the prerender gives the build for one page. */
export interface PrerenderedPage {
  body: string;
  state: string;
  title: string;
  url: string;
}

/**
 * The built page with a prerendered page in it: the markup inside `#root`,
 * the state it was rendered in on `#root`, its own title, and its address as
 * the canonical link and the link preview's. A template without one of the
 * anchors throws, so a change to `index.html` cannot silently ship pages
 * without their text.
 */
export function prerenderedHtml(
  template: string,
  page: PrerenderedPage,
): string {
  const url = escapeHtml(page.url);
  const title = escapeHtml(page.title);
  // Each swap is a function, so a `$` in the page's text is never read as a
  // replacement pattern.
  const swaps: [RegExp, (indent: string) => string][] = [
    [
      /<div id="root"><\/div>/,
      () =>
        `<div id="root" data-prerendered="${escapeHtml(page.state)}">${page.body}</div>`,
    ],
    [/<title>[^<]*<\/title>/, () => `<title>${title}</title>`],
    [
      /<meta property="og:title" content="[^"]*" \/>/,
      () => `<meta property="og:title" content="${title}" />`,
    ],
    [
      /([ \t]*)<meta property="og:type" content="website" \/>/,
      (indent) =>
        `${indent}<meta property="og:type" content="website" />\n` +
        `${indent}<meta property="og:url" content="${url}" />\n` +
        `${indent}<link rel="canonical" href="${url}" />`,
    ],
  ];
  return swaps.reduce((html, [anchor, swap]) => {
    if (!anchor.test(html))
      throw new Error(`the built page has no ${anchor.source} to fill`);
    return html.replace(anchor, (_whole, indent?: string) =>
      swap(typeof indent === "string" ? indent : ""),
    );
  }, template);
}

/** The sitemap of the prerendered pages (sitemaps.org protocol 0.9). */
export function sitemapXml(site: string): string {
  const urls = PRERENDERED_PAGES.map(
    (page) => `  <url><loc>${escapeHtml(pageUrl(site, page))}</loc></url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

/** `robots.txt` with the sitemap's absolute address after its rules. */
export function robotsWithSitemap(robots: string, site: string): string {
  return `${robots.trimEnd()}\n\nSitemap: ${site}/sitemap.xml\n`;
}

/**
 * Modules the demo build replaces with the `.demo` file beside them, as
 * `web/src/`-relative paths without the extension. A twin keeps its
 * original's exports, so no importer changes. The log's twins keep and read
 * nothing: the site has no log.
 */
export const DEMO_TWINS: readonly string[] = [
  "preferences/compose",
  "legal/compose",
  "log/index",
  "project/logRef",
];

/**
 * The last segment an import of each twin's original can end in: its file
 * name, and for an `index` file the folder's name too, as `"../log"` is.
 */
const TWIN_NAMES = new Set(
  DEMO_TWINS.flatMap((twin) => {
    const [file, folder] = twin.split("/").reverse();
    return file === "index" && folder ? [file, folder] : [file];
  }),
);

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
  "log",
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
 * landing's sign-in, the settings lines that lead to the log and name the
 * account, and the full program's legal texts, which the site replaces with
 * its own (`legal/compose.demo.ts`).
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
  "settings.showLog",
  "settings.accountId",
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
