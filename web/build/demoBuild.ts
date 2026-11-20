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
 * The landing's address for each language (`src/demo/languagePaths.ts`), the
 * default one first. Written out rather than imported, as `DEMO_PAGES` is.
 */
export const LANDING_PAGES: Readonly<Record<string, string>> = {
  en: "/",
  it: "/it",
};

/** The landing's addresses other than "/". */
const OTHER_LANDINGS = Object.values(LANDING_PAGES).filter(
  (page) => page !== "/",
);

/**
 * The site's pages other than `/`: the demo editor (`DEMO_PATH`), the
 * site's two legal texts (`legal/compose.demo.ts`) and the landing in the
 * other languages. A static host has no rewrite rules, so each page gets its
 * own copy of the built page, and the router inside it reads the address.
 * Written out rather than imported, so `vite.config.ts` loads no app module;
 * the test checks them against the routes.
 */
export const DEMO_PAGES: readonly string[] = [
  "/app/editor/demo",
  "/legal",
  "/privacy",
  ...OTHER_LANDINGS,
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
 * The pages rendered to HTML at build time (`src/demo/prerender.tsx`): the
 * landing in each language and the legal texts. The demo editor is left out:
 * it is the program, not text to index, and `robots.txt` keeps crawlers out
 * of `/app/`.
 */
export const PRERENDERED_PAGES: readonly string[] = [
  "/",
  ...OTHER_LANDINGS,
  "/legal",
  "/privacy",
];

/**
 * The pages search engines may index and the sitemap offers: the landing,
 * in each language. The legal texts carry the Author's name and contact,
 * which the Author chose to keep out of search results: they stay online and
 * linked from the landing, and carry `noindex` (`prerenderedHtml`).
 */
export const SITEMAP_PAGES: readonly string[] = Object.values(LANDING_PAGES);

/**
 * The other languages of a page, as `[hreflang, address]` pairs: for the
 * landing, each of its addresses, and "/" again as the one for every other
 * language (`x-default`), since "/" follows the visitor's language. Every
 * other page has one language and no pairs.
 */
export function alternatesOf(
  site: string,
  page: string,
): (readonly [string, string])[] {
  if (!SITEMAP_PAGES.includes(page)) return [];
  return [
    ...Object.entries(LANDING_PAGES).map(
      ([language, landing]) => [language, pageUrl(site, landing)] as const,
    ),
    ["x-default", pageUrl(site, "/")] as const,
  ];
}

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

/**
 * The picture a link to the site shows (Open Graph), shipped by the demo
 * build at the site's root from `docs/brand/`, and its size in pixels.
 */
export const LINK_PREVIEW = {
  file: "link-preview.png",
  width: 1200,
  height: 630,
} as const;

/**
 * The program's source repository, as the landing names it (`SOURCE_URL`).
 * Written out, as `DEMO_PAGES` is.
 */
export const SOURCE_REPOSITORY = "https://github.com/perseomazzoni/phospheare";

/** The Open Graph locale of each language the pages are rendered in. */
const OG_LOCALES: Readonly<Record<string, string>> = {
  en: "en_GB",
  it: "it_IT",
};

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
  /** The language the page is rendered in. */
  language: string;
  /** What the page says it is, or `null` to keep the built page's own. */
  description: string | null;
  /** What the link preview's picture shows, in the page's language. */
  imageAlt: string;
  /** The product's name. */
  product: string;
  url: string;
  /** False for a page search engines must leave out of their results. */
  indexed: boolean;
  /** The page in its other languages (`alternatesOf`). */
  alternates: readonly (readonly [string, string])[];
  /** The theme a first visit gets, as the theme writes it (`themeMarkup`). */
  theme: PaintedTheme;
}

/**
 * What a theme puts on the page: the root's inline properties and data
 * attributes, and its style element. The shape of `ThemeMarkup` in
 * `src/theme/page.ts`, written out, as `DEMO_PAGES` is.
 */
export interface PaintedTheme {
  style: [string, string][];
  dataset: Record<string, string>;
  sheet: string;
  sheetId: string;
}

/**
 * The root element's attributes that put `theme` on the page before any
 * script runs, as `applyTheme` would: each data attribute, then the inline
 * properties.
 */
function themeAttributes(theme: PaintedTheme): string {
  const data = Object.entries(theme.dataset).map(
    ([name, value]) =>
      ` data-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}="${escapeHtml(value)}"`,
  );
  const style = theme.style.map(([name, value]) => `${name}: ${value}`);
  return `${data.join("")} style="${escapeHtml(style.join("; "))}"`;
}

/** The theme's style element, or "" for a theme with no sheet. */
function themeSheet(theme: PaintedTheme): string {
  if (!theme.sheet) return "";
  // Inside a style element, only its end tag ends the text.
  if (/<\/style/i.test(theme.sheet))
    throw new Error("the theme's sheet holds </style");
  return `<style id="${escapeHtml(theme.sheetId)}">${theme.sheet}</style>`;
}

/**
 * The built page with a prerendered page in it: its language and its theme,
 * so it paints as the script will leave it, the markup
 * inside `#root`, the state it was rendered in on `#root`, its own title and
 * description, and the link preview's address, picture and locale. An
 * indexed page names its address as the canonical link, then the page in
 * each of its languages, and says what the program is in data a search
 * engine reads (`structuredData`); any other page asks search engines not to
 * index it instead, since a canonical link would say the opposite. A
 * template without one of the anchors throws, so a change to `index.html`
 * cannot silently ship pages without their text.
 */
export function prerenderedHtml(
  template: string,
  page: PrerenderedPage,
): string {
  const url = escapeHtml(page.url);
  const title = escapeHtml(page.title);
  const describe = (whole: string, name: string) =>
    page.description === null
      ? whole
      : `<meta ${name} content="${escapeHtml(page.description)}" />`;
  const head = (indent: string) =>
    [
      `<meta property="og:url" content="${url}" />`,
      `<meta property="og:locale" content="${OG_LOCALES[page.language] ?? page.language}" />`,
      `<meta property="og:image" content="${escapeHtml(previewUrl(page.url))}" />`,
      `<meta property="og:image:width" content="${LINK_PREVIEW.width}" />`,
      `<meta property="og:image:height" content="${LINK_PREVIEW.height}" />`,
      `<meta property="og:image:alt" content="${escapeHtml(page.imageAlt)}" />`,
      '<meta name="twitter:card" content="summary_large_image" />',
      ...(page.indexed
        ? [
            `<link rel="canonical" href="${url}" />`,
            ...page.alternates.map(
              ([language, address]) =>
                `<link rel="alternate" hreflang="${escapeHtml(language)}" href="${escapeHtml(address)}" />`,
            ),
            ...(page.description === null
              ? []
              : [
                  `<script type="application/ld+json">${structuredData(page, page.description)}</script>`,
                ]),
          ]
        : ['<meta name="robots" content="noindex" />']),
    ]
      .map((line) => `${indent}${line}\n`)
      .join("");
  // Each swap is a function, so a `$` in the page's text is never read as a
  // replacement pattern.
  const swaps: [RegExp, (indent: string, whole: string) => string][] = [
    [
      /<html lang="[^"]*">/,
      () =>
        `<html lang="${escapeHtml(page.language)}"${themeAttributes(page.theme)}>`,
    ],
    [
      /([ \t]*)<\/head>/,
      (indent) => {
        const sheet = themeSheet(page.theme);
        return sheet
          ? `${indent}  ${sheet}\n${indent}</head>`
          : `${indent}</head>`;
      },
    ],
    [
      /<div id="root"><\/div>/,
      () =>
        `<div id="root" data-prerendered="${escapeHtml(page.state)}">${page.body}</div>`,
    ],
    [/<title>[^<]*<\/title>/, () => `<title>${title}</title>`],
    [
      /<meta\s+name="description"\s+content="[^"]*"\s*\/>/,
      (_indent, whole) => describe(whole, 'name="description"'),
    ],
    [
      /<meta property="og:title" content="[^"]*" \/>/,
      () => `<meta property="og:title" content="${title}" />`,
    ],
    [
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/>/,
      (_indent, whole) => describe(whole, 'property="og:description"'),
    ],
    [
      /([ \t]*)<meta property="og:type" content="website" \/>\r?\n/,
      (indent) =>
        `${indent}<meta property="og:type" content="website" />\n` +
        head(indent),
    ],
  ];
  return swaps.reduce((html, [anchor, swap]) => {
    if (!anchor.test(html))
      throw new Error(`the built page has no ${anchor.source} to fill`);
    return html.replace(anchor, (whole, indent?: string) =>
      swap(typeof indent === "string" ? indent : "", whole),
    );
  }, template);
}

/** The link preview's picture, at the root of the page's site. */
function previewUrl(pageUrl: string): string {
  return new URL(`/${LINK_PREVIEW.file}`, pageUrl).href;
}

/**
 * What the program is, as schema.org data in JSON-LD, for a search engine
 * or an assistant that reads the page. It states only facts the site
 * states. It names no author: the Author's name stays out of search
 * results, as on the legal texts. It carries no rating, since none exists.
 * Google lists no category for writing tools, and `BusinessApplication`,
 * its category for work tools, is the nearest. `<` is escaped, so no text
 * can close the script element.
 */
export function structuredData(
  page: PrerenderedPage,
  description: string,
): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: page.product,
    description,
    url: page.url,
    inLanguage: page.language,
    image: previewUrl(page.url),
    applicationCategory: "BusinessApplication",
    operatingSystem: "Windows, macOS, Linux",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
    license: "https://www.gnu.org/licenses/agpl-3.0.html",
    sameAs: [SOURCE_REPOSITORY],
  }).replace(/</g, "\\u003c");
}

/** The sitemap of `SITEMAP_PAGES` (sitemaps.org protocol 0.9). */
export function sitemapXml(site: string): string {
  const urls = SITEMAP_PAGES.map(
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
