// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LEGAL_PATHS } from "../src/legal/domain/paths";
import { LEGAL_SET } from "../src/legal/compose.demo";
import { DEMO_PATH } from "../src/webapp/entry/landing/content";
import {
  DEMO_PAGES,
  DEMO_SITE_DIR,
  DEMO_TWINS,
  PRERENDERED_PAGES,
  PRERENDER_OUT_DIR,
  demoPageFiles,
  demoTwin,
  mayHaveTwin,
  pageFile,
  pageUrl,
  prerenderedHtml,
  publicTexts,
  pruneLocale,
  robotsWithSitemap,
  sitemapXml,
} from "./demoBuild";

const SRC = "C:\\repo\\web\\src";
const webSrc = fileURLToPath(new URL("../src/", import.meta.url));

describe("demoTwin", () => {
  it("points a listed module at the .demo file beside it", () => {
    expect(demoTwin("C:/repo/web/src/preferences/compose.ts", SRC)).toBe(
      "C:/repo/web/src/preferences/compose.demo.ts",
    );
  });

  it("points the log's index at the twin that keeps nothing", () => {
    expect(demoTwin("C:/repo/web/src/log/index.ts", SRC)).toBe(
      "C:/repo/web/src/log/index.demo.ts",
    );
    expect(demoTwin("C:/repo/web/src/log/compose.ts", SRC)).toBeNull();
  });

  it("leaves every other module alone", () => {
    expect(demoTwin("C:/repo/web/src/preferences/types.ts", SRC)).toBeNull();
  });

  it("names twins that exist beside their originals", () => {
    for (const twin of DEMO_TWINS)
      expect(existsSync(`${webSrc}${twin}.demo.ts`), twin).toBe(true);
  });
});

describe("mayHaveTwin", () => {
  it("lets through a specifier that ends in a twin's file name", () => {
    expect(mayHaveTwin("./compose")).toBe(true);
    expect(mayHaveTwin("../../preferences/compose.ts")).toBe(true);
    expect(mayHaveTwin("../legal/compose?import")).toBe(true);
  });

  it("lets through an import of a folder whose index has a twin", () => {
    expect(mayHaveTwin("../log")).toBe(true);
    expect(mayHaveTwin("../../log/index.ts")).toBe(true);
  });

  it("stops every other specifier before it is resolved", () => {
    expect(mayHaveTwin("react")).toBe(false);
    expect(mayHaveTwin("./composer")).toBe(false);
    expect(mayHaveTwin("../ui/StatusNotice")).toBe(false);
  });
});

describe("demoPageFiles", () => {
  it("lists the demo editor and each legal text the site serves", () => {
    expect([...DEMO_PAGES].sort()).toEqual(
      [
        DEMO_PATH,
        ...LEGAL_SET.map((document) => LEGAL_PATHS[document.id]),
      ].sort(),
    );
  });

  it("gives each page its own index.html, and the not-found page", () => {
    expect(demoPageFiles()).toEqual([
      "app/editor/demo/index.html",
      "legal/index.html",
      "privacy/index.html",
      "404.html",
    ]);
  });
});

describe("the prerendered pages", () => {
  const SITE = "https://example.org";
  const TEMPLATE = [
    "<head>",
    '    <meta property="og:title" content="Name" />',
    '    <meta property="og:type" content="website" />',
    "    <title>Name</title>",
    "</head>",
    '<body><div id="root"></div></body>',
  ].join("\n");
  const PAGE = {
    body: "<main><h1>Costs $5 &amp; more</h1></main>",
    state: "en a b moving",
    title: 'Notice "one" — Name',
    url: `${SITE}/legal/`,
  };

  it("are the landing and the legal texts, never the demo editor", () => {
    expect([...PRERENDERED_PAGES].sort()).toEqual(
      ["/", ...LEGAL_SET.map((document) => LEGAL_PATHS[document.id])].sort(),
    );
    expect(PRERENDERED_PAGES).not.toContain(DEMO_PATH);
  });

  it("each have one file and one address, which ends in a slash", () => {
    expect(PRERENDERED_PAGES.map(pageFile)).toEqual([
      "index.html",
      "legal/index.html",
      "privacy/index.html",
    ]);
    expect(PRERENDERED_PAGES.map((page) => pageUrl(SITE, page))).toEqual([
      `${SITE}/`,
      `${SITE}/legal/`,
      `${SITE}/privacy/`,
    ]);
  });

  it("go into the built page with their title and canonical address", () => {
    const html = prerenderedHtml(TEMPLATE, PAGE);
    expect(html).toContain(
      '<div id="root" data-prerendered="en a b moving"><main><h1>Costs $5 &amp; more</h1></main></div>',
    );
    expect(html).toContain("<title>Notice &quot;one&quot; — Name</title>");
    expect(html).toContain(
      '<meta property="og:title" content="Notice &quot;one&quot; — Name" />',
    );
    expect(html).toContain(
      [
        '    <meta property="og:type" content="website" />',
        `    <meta property="og:url" content="${SITE}/legal/" />`,
        `    <link rel="canonical" href="${SITE}/legal/" />`,
      ].join("\n"),
    );
  });

  it("refuse a built page that lost an anchor", () => {
    for (const anchor of [
      '<div id="root"></div>',
      "<title>Name</title>",
      '<meta property="og:type" content="website" />',
    ])
      expect(() => prerenderedHtml(TEMPLATE.replace(anchor, ""), PAGE)).toThrow(
        /has no/,
      );
  });

  it("are listed in the sitemap, which robots.txt names", () => {
    expect(sitemapXml(SITE)).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        `  <url><loc>${SITE}/</loc></url>`,
        `  <url><loc>${SITE}/legal/</loc></url>`,
        `  <url><loc>${SITE}/privacy/</loc></url>`,
        "</urlset>",
        "",
      ].join("\n"),
    );
    expect(robotsWithSitemap("User-agent: *\nAllow: /\n\n", SITE)).toBe(
      `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`,
    );
  });

  it("are built by build:demo into the folders the plugin reads", () => {
    const script = (
      JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      ) as { scripts: Record<string, string> }
    ).scripts["build:demo"];
    expect(script).toContain(`--outDir ${DEMO_SITE_DIR} `);
    expect(script).toContain("--ssr src/demo/prerender.tsx");
    expect(script).toContain(`--outDir ${PRERENDER_OUT_DIR} `);
  });
});

describe("publicTexts", () => {
  it("reads the text files Vite copies into the build, and no image", () => {
    const texts = publicTexts(
      fileURLToPath(new URL("../public/", import.meta.url)),
    );
    const names = texts.map(([name]) => name);
    expect(names).toContain("public/robots.txt");
    expect(names.every((name) => !/\.(png|webp|woff2)$/.test(name))).toBe(true);
  });
});

describe("pruneLocale", () => {
  it("drops the pruned sections and keeps the listed keys", () => {
    const pruned = pruneLocale({
      auth: { backHome: "Home", tryAgain: "Again" },
      sync: { pending: "x" },
      library: { accountFor: "For {{email}}", nested: { a: "b" } },
      editor: { save: "Save" },
    });
    expect(pruned).toEqual({
      auth: { backHome: "Home" },
      library: { accountFor: "For {{email}}" },
      editor: { save: "Save" },
    });
  });

  it("leaves both shipped locales with the kept keys and no pruned section", () => {
    for (const language of ["en", "it"]) {
      const locale = JSON.parse(
        readFileSync(`${webSrc}locales/${language}.json`, "utf8"),
      );
      const pruned = pruneLocale(locale);
      expect(pruned.sync, language).toBeUndefined();
      expect(pruned.export, language).toBeUndefined();
      expect(pruned.auth, language).toEqual({ backHome: locale.auth.backHome });
      expect(Object.keys(pruned.library as object).sort(), language).toEqual([
        "accountFor",
        "accountWithoutGoogle",
        "openFailed",
      ]);
      expect(pruned.editor ?? pruned.dock, language).toBeDefined();
      const landing = pruned.landing as Record<string, Record<string, unknown>>;
      expect(landing.head?.logIn, language).toBeUndefined();
      expect(landing.noFolders, language).toBeUndefined();
      expect(landing.hero?.try, language).toBe(locale.landing.hero.try);
      expect(locale.landing.head.logIn, language).toBeDefined();
      // The site keeps no log, so no word of it ships.
      expect(pruned.log, language).toBeUndefined();
      const settings = pruned.settings as Record<string, unknown>;
      expect(settings.showLog, language).toBeUndefined();
      expect(settings.accountId, language).toBeUndefined();
    }
  });
});
