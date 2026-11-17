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
  DEMO_TWINS,
  demoPageFiles,
  demoTwin,
  mayHaveTwin,
  publicTexts,
  pruneLocale,
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
