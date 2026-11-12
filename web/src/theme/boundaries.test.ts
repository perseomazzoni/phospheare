// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { moduleImports } from "../testing/moduleImports.fixture";

// Pins the theme's layers. A layer that imports the one outside it still
// compiles, so the rules are read from the source text, as in
// `auth/sessions/boundaries.test.ts`:
//
// - the domain (tokens, types, families, choices, geometry) imports no other
//   layer and no React;
// - the application is plain functions, and it states what it needs of the
//   page, the account and the device as interfaces of its own: no React, and
//   no implementation, which `compose.ts` wires in;
// - `page.ts` and `device.ts` implement those interfaces for the browser and
//   import no React;
// - the provider (`ThemeContext.tsx`) and its hooks (`useChrome.ts`) are the
//   only React files, and reach the implementations only through
//   `compose.ts`;
// - each family is data on the domain;
// - `compose.ts` wires the implementations into the application, and alone
//   reaches outside the module, for the app's preferences; `index.ts`
//   registers the families and hands the app what it uses;
// - a file in no layer, or importing a name built at run time, fails;
// - the editor reaches the theme through `theme/editor.ts` only, so it
//   reads the frame's options and numbers and never a theme's id, palette
//   or stylesheet.

const raw = (files: Record<string, unknown>) => files as Record<string, string>;

const THEME = raw(
  import.meta.glob(["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"], {
    eager: true,
    query: "?raw",
    import: "default",
  }),
);
const EDITOR = raw(
  import.meta.glob(
    ["../editor/**/*.{ts,tsx}", "!../editor/**/*.test.{ts,tsx}"],
    { eager: true, query: "?raw", import: "default" },
  ),
);

/**
 * Every module a source names: imports, re-exports, side effects, dynamic
 * imports and `require`, as `moduleImports` reads them, then Vite's globs and
 * asset URLs, which only the text shows. A name built at run time cannot be
 * checked, and is answered as `?` so the layer test refuses it.
 */
function specifiers(source: string): string[] {
  const modules = moduleImports(source).map((found) =>
    found.built ? "?" : found.specifier,
  );
  const assets = [
    ...source.matchAll(
      /(?:\bimport\.meta\.glob\w*\(\s*\[?\s*|\bnew URL\(\s*)["'`]([^"'`$]+)["'`]/g,
    ),
  ].map((m) => m[1]);
  return [...modules, ...assets];
}

/** The theme layer a path inside `theme/` belongs to. */
function layerOf(path: string): string {
  const [first] = path.replace(/^\.\//, "").split("/");
  return first.replace(/\.(ts|tsx)$/, "");
}

/** Where a theme file's relative import lands, from the theme's root. */
function resolve(file: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const url = new URL(spec, `file:///theme/${file.replace(/^\.\//, "")}`);
  return url.pathname.startsWith("/theme/")
    ? url.pathname.slice("/theme/".length)
    : `../${url.pathname.slice(1)}`;
}

const ALLOWED: Record<string, RegExp> = {
  domain: /^domain$/,
  application: /^(domain|application)$/,
  // The browser's page and storage, behind the application's interfaces.
  page: /^(domain|application)$/,
  device: /^application$/,
  // The React side: the provider, and the hooks over it.
  ThemeContext: /^(domain|application|compose)$/,
  useChrome: /^(domain|application|ThemeContext)$/,
  themes: /^(domain|themes)$/,
  // The composition root wires the implementations into the application,
  // with the app's preferences for the account.
  compose: /^(application|page|device|\.\.)$/,
  // The module's face: the families registered, and what the app may use.
  index: /^(application|compose|ThemeContext|themes|domain)$/,
};

/** React, its renderer and its runtimes, which only the React side reaches. */
const REACT = /^react(-dom)?(\/|$)/;
const REACT_SIDE = new Set(["ThemeContext", "useChrome"]);

// The one entry point that faces out: the editor's entry point hands it the
// provider's hooks, over the registered themes.
const EDITOR_PORT = /^(domain|useChrome|index)$/;

describe("the theme's layers", () => {
  it("reads every layer's imports", () => {
    expect(Object.keys(THEME).length).toBeGreaterThan(20);
    expect(resolve("./application/choice.ts", "../domain/choice")).toBe(
      "domain/choice",
    );
    expect(resolve("./compose.ts", "../preferences/compose")).toBe(
      "../preferences/compose",
    );
    expect(specifiers(`import "../index";`)).toEqual(["../index"]);
    expect(specifiers(`() => import("./theme.css?inline")`)).toEqual([
      "./theme.css?inline",
    ]);
    expect(specifiers("import(`./${name}`)")).toEqual(["?"]);
    expect(specifiers(`require("./page")`)).toEqual(["./page"]);
    expect(specifiers(`import { jsx } from "react/jsx-runtime";`)).toEqual([
      "react/jsx-runtime",
    ]);
    expect(specifiers(`import {\n  a,\n  b,\n} from\n  "../page";`)).toEqual([
      "../page",
    ]);
    expect(specifiers(`export { a } from "./page";`)).toEqual(["./page"]);
    expect(specifiers(`import.meta.glob(["./themes/*.css"])`)).toEqual([
      "./themes/*.css",
    ]);
    expect(specifiers(`new URL("./mark.svg", import.meta.url)`)).toEqual([
      "./mark.svg",
    ]);
    expect(specifiers(`// import "../index";\nconst s = 'from "x"';`)).toEqual(
      [],
    );
  });

  it("keeps each layer to the layers it may reach", () => {
    const crossings: string[] = [];
    for (const [file, source] of Object.entries(THEME)) {
      const layer = layerOf(file);
      const allowed = file === "./editor.ts" ? EDITOR_PORT : ALLOWED[layer];
      if (!allowed) {
        crossings.push(`${file} is in no layer`);
        continue;
      }
      // JSX needs no import of React to compile, so a .tsx file is React.
      if (!REACT_SIDE.has(layer) && file.endsWith(".tsx"))
        crossings.push(`${file} is a component`);
      for (const spec of specifiers(source)) {
        if (REACT.test(spec) && !REACT_SIDE.has(layer))
          crossings.push(`${file} imports ${spec}`);
        if (spec === "?") crossings.push(`${file} imports a built name`);
        const target = resolve(file, spec);
        if (target === null || target.endsWith(".css?inline")) continue;
        const reached = target.startsWith("../") ? ".." : layerOf(target);
        if (!allowed.test(reached)) crossings.push(`${file} → ${spec}`);
      }
    }
    expect(crossings).toEqual([]);
  });

  it("lets the editor reach the theme through its entry point only", () => {
    expect(Object.keys(EDITOR).length).toBeGreaterThan(50);
    let ported = 0;
    for (const [file, source] of Object.entries(EDITOR))
      for (const spec of specifiers(source)) {
        if (!/(?:\.\.\/)+theme(?:\/|$)/.test(spec)) continue;
        expect(spec, `${file} reaches past theme/editor`).toMatch(
          /(?:\.\.\/)+theme\/editor$/,
        );
        ported += 1;
      }
    // The editor does read the theme, so a glob that found nothing cannot pass.
    expect(ported).toBeGreaterThan(0);
  });
});
