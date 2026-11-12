// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import product from "../../product.json";
import indexHtml from "../index.html?raw";
import {
  PRODUCT,
  PRODUCT_NAME_PLACEHOLDER,
  injectProductName,
  productNames,
} from "./product";

describe("productNames", () => {
  it("derives every form from the one name", () => {
    expect(productNames("Once Dark Studio")).toEqual({
      name: "Once Dark Studio",
      kebab: "once-dark-studio",
      pascal: "OnceDarkStudio",
      flat: "oncedarkstudio",
      upper: "ONCE DARK STUDIO",
      lower: "once dark studio",
    });
  });

  it("folds diacritics out of the forms that end up in paths and headers", () => {
    const names = productNames("Quill Ü");
    expect(names.name).toBe("Quill Ü");
    expect(names.kebab).toBe("quill-u");
    expect(names.pascal).toBe("QuillU");
    expect(names.flat).toBe("quillu");
  });

  it("splits on punctuation and collapses runs of it", () => {
    const names = productNames("  ink & paper — 2 ");
    expect(names.name).toBe("ink & paper — 2");
    expect(names.kebab).toBe("ink-paper-2");
    expect(names.pascal).toBe("InkPaper2");
  });

  it("folds an accented Italian name", () => {
    expect(productNames("Città Studio").flat).toBe("cittastudio");
  });

  // The derived forms end up in paths and URNs, so whatever the name, they
  // are plain ASCII; a letter with no ASCII form splits.
  it("keeps every derived form plain ASCII", () => {
    for (const name of ["Straße Studio", "Øl", "Łódź", "Δέλτα Ink"]) {
      const names = productNames(name);
      expect(names.kebab).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(names.pascal).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it("refuses a name with no ASCII form at all", () => {
    expect(() => productNames("日本")).toThrow(/ASCII form/);
  });

  it("refuses a name with nothing to derive from", () => {
    expect(() => productNames("")).toThrow(/product\.json/);
    expect(() => productNames("  — ")).toThrow(/product\.json/);
    expect(() => productNames(undefined)).toThrow(/product\.json/);
  });

  it("reads the name from product.json", () => {
    expect(PRODUCT.name).toBe(product.name.trim());
  });
});

// Every shipped source file, as text. Tests and fixtures are left out:
// they are not shipped, and some hold files written under an earlier product
// name, to show such a file opens.
const SOURCES = import.meta.glob<string>(
  [
    "./**/*.{ts,tsx}",
    "!./**/*.{test,spec}.{ts,tsx}",
    "!./**/project.fixture.ts",
    "!./**/mockDrive.fixture.ts",
    "!./**/document.fixture.ts",
  ],
  { query: "?raw", import: "default", eager: true },
);

// The About pane's source link; the repository's address is the one string
// allowed to spell the working name.
const REPOSITORY_URL = "https://github.com/perseomazzoni/phospheare";

describe("the working name in shipped code", () => {
  // "Phospheare" names the project, so comments, identifiers and class names
  // may carry it. A string literal may not, in any case: every
  // string in shipped code can end up on screen, in a file the app writes, or
  // among the names the browser keeps (cookies, storage keys, the database),
  // where developer tools show it and a second brand of this code would
  // collide with it. The exceptions are `REPOSITORY_URL` and the two files
  // that name the identity service's protocol and its cookies, which the
  // desktop's service fixes.
  it("is never written in a string outside a comment", () => {
    const offenders = Object.entries(SOURCES)
      .filter(
        ([path]) =>
          !["./platform/identifiers.ts", "./legal/domain/facts.ts"].includes(
            path,
          ),
      )
      .filter(([, text]) =>
        /["'`][^"'`\n]*phospheare/i.test(
          text
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|[^:"`'])\/\/.*$/gm, "$1")
            .split(`"${REPOSITORY_URL}"`)
            .join('""'),
        ),
      )
      .map(([path]) => path);
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });
});

describe("injectProductName", () => {
  it("fills every placeholder in index.html and leaves no internal name behind", () => {
    const html = injectProductName(indexHtml);
    expect(html).not.toContain(PRODUCT_NAME_PLACEHOLDER);
    // Comments included: the page ships as written, and view-source is
    // something a visitor can open.
    expect(html).not.toMatch(/phospheare/i);
    expect(html).toContain(`<title>${PRODUCT.name}</title>`);
    expect(html).toContain(
      `<meta property="og:title" content="${PRODUCT.name}" />`,
    );
  });

  it("escapes a name that would otherwise break an attribute", () => {
    expect(
      injectProductName(`<a title="%PRODUCT_NAME%">`, `Ink "&" <Co>`),
    ).toBe(`<a title="Ink &quot;&amp;&quot; &lt;Co&gt;">`);
  });
});
