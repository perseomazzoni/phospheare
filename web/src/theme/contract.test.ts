// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
// Read through Vite rather than the filesystem, so this test needs no Node
// types in an app that otherwise has none.
import CSS from "../styles/base.css?raw";
import { EDITOR_CSS } from "../editor/editorSheets.fixture";
import WEBAPP_CSS from "../webapp/webapp.css?raw";
import { THEME_TOKENS } from "./domain/tokens";
import { matte } from "./themes/matte";
import { shine } from "./themes/shine";
import { vision } from "./themes/vision";
import { radiant } from "./themes/radiant";
import type { Theme } from "./domain/types";
import { allThemes } from "./application/registry";
import "./index";
import { declarationsOf, rulesOf, SCRIPTED } from "../styles/css.fixture";

/** A stylesheet or a module with its comments taken out. */
const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** Every source file of the app, as text. */
const FRAME_SOURCES = import.meta.glob<string>("/src/**/*.{ts,tsx,css}", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** The app's code, past the themes' own files and the contract's list. */
const CODE = Object.entries(FRAME_SOURCES)
  .filter(
    ([path]) =>
      /\.tsx?$/.test(path) &&
      !/\.test\.tsx?$/.test(path) &&
      !path.startsWith("/src/theme/themes/") &&
      path !== "/src/theme/domain/tokens.ts",
  )
  .map(([, text]) => withoutComments(text))
  .join("\n");

// Imported directly rather than through the registry: this is a check on the
// themes the app ships, and it should not depend on registration order or on
// another test file having cleared the registry.
const SHIPPED: Theme[] = [
  matte.light,
  matte.dark,
  shine.dark,
  shine.light,
  vision.light,
  vision.dark,
  radiant.light,
  radiant.dark,
];

/**
 * Custom properties a stylesheet defines, anywhere: under `@media` too, where
 * a value would stand on some screens and not others.
 */
function declaredIn(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const { prop, value } of declarationsOf(css))
    if (prop.startsWith("--")) found.set(prop, value.replace(/s+/g, " "));
  return found;
}

const declaredInCss = () => declaredIn(CSS);

describe("the theme contract", () => {
  // `defineFamily` throws on a contract token a family leaves out, and keeps
  // every other token it states as its own, so a misspelt token (`--acent`)
  // would build and draw nothing. Each own token is read by the theme's
  // sheet, by another of its tokens, or by the app's code.
  it.each(SHIPPED.map((t) => [t.id, t] as const))(
    "%s states no token that nothing reads",
    async (_id, theme) => {
      const reads = new Set(
        [
          await theme.sheet(),
          ...Object.values(theme.tokens),
          ...Object.values(theme.own),
          CODE,
        ].flatMap((text) =>
          [...withoutComments(text).matchAll(/var\(\s*(--[\w-]+)/g)].map(
            (m) => m[1],
          ),
        ),
      );
      expect(
        Object.keys(theme.own).filter(
          (name) =>
            !reads.has(name) && !new RegExp(`${name}(?![\\w-])`).test(CODE),
        ),
      ).toEqual([]);
    },
  );

  it.each(SHIPPED.map((t) => [t.id, t] as const))(
    "%s leaves no token blank",
    (_id, theme) => {
      const blank = Object.entries(theme.tokens)
        .filter(([, value]) => value.trim() === "")
        .map(([token]) => token);
      expect(blank).toEqual([]);
    },
  );

  // A writer chooses a theme and then its variant, and the two variants are
  // named the same in every theme. So each family ships both, each variant's
  // id is `<family>-<scheme>` (what the account stores, and what the
  // profile's preference domain names in `portableDoc.ts`), and each carries
  // the shared name.
  it("ships every theme as a light and a dark variant", () => {
    const families = new Map<string, Set<string>>();
    for (const theme of SHIPPED) {
      const schemes = families.get(theme.family) ?? new Set<string>();
      schemes.add(theme.scheme);
      families.set(theme.family, schemes);
    }
    for (const [family, schemes] of families) {
      expect([family, [...schemes].sort()]).toEqual([
        family,
        ["dark", "light"],
      ]);
    }
  });

  it.each(SHIPPED.map((t) => [t.id, t] as const))(
    "%s is named for its family and its scheme",
    (_id, theme) => {
      expect(theme.id).toBe(`${theme.family}-${theme.scheme}`);
      expect(theme.label).toBe(
        theme.scheme === "light" ? "once dark" : "still dark",
      );
    },
  );

  it("gives every shipped theme a distinct id", () => {
    const ids = SHIPPED.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The list above is the registry's, so a theme registered and not listed
  // is not one these checks pass over.
  it("checks every theme the app registers", () => {
    expect(SHIPPED.map((t) => t.id).sort()).toEqual(
      allThemes()
        .map((t) => t.id)
        .sort(),
    );
  });

  it("lists no token twice", () => {
    expect(new Set<string>(THEME_TOKENS).size).toBe(THEME_TOKENS.length);
  });

  // A name the code builds (`--spine-${at}`, `` `--${role}` ``, `"--" + k`)
  // is read under every name it could build, so the check below could not
  // tell which ones are read.
  it("is read by its whole name wherever the code reads it", () => {
    expect(
      [
        ...CODE.matchAll(
          /var\(\s*--[\w-]*\$\{|(?:setProperty\(|\[)\s*`--[\w-]*\$\{|["'`]--["'`]\s*\+/g,
        ),
      ].map((m) => m[0]),
    ).toEqual([]);
  });

  // The contract holds exactly what is read past a theme's own sheet: what
  // the app's code names, what the Settings tile draws another theme's
  // preview with, and what the contrast check holds to WCAG. Every other
  // token a theme states is its own.
  it("holds exactly the tokens read past a theme's sheet", async () => {
    const code = Object.entries(FRAME_SOURCES)
      .filter(
        ([path]) =>
          !/\.test\.tsx?$/.test(path) &&
          !path.startsWith("/src/theme/themes/") &&
          path !== "/src/theme/domain/tokens.ts",
      )
      .map(([, text]) => withoutComments(text))
      .join("\n");
    const sheets = await Promise.all(SHIPPED.map((theme) => theme.sheet()));
    const tiles = sheets
      .flatMap((css) =>
        rulesOf(css)
          .filter((rule) => rule.selectors.some((one) => /\.tile-/.test(one)))
          .flatMap((rule) => rule.decls.map((decl) => decl.value)),
      )
      .join("\n");
    const stated = new Set(
      SHIPPED.flatMap((theme) => [
        ...Object.keys(theme.tokens),
        ...Object.keys(theme.own),
      ]),
    );
    const read = [...stated].filter((name) => {
      const named = new RegExp(`${name}(?![\\w-])`);
      return named.test(code) || named.test(tiles);
    });
    expect(read.sort()).toEqual([...THEME_TOKENS].sort());
  });
});

// The framework has no values of its own: the page wears a theme or nothing.
// `base.css` holds the framework's motion and geometry, and no theme's value.
describe("base.css holds the framework's own values alone", () => {
  it("defines no contract token", () => {
    const declared = declaredInCss();
    expect(THEME_TOKENS.filter((token) => declared.has(token))).toEqual([]);
  });

  it("defines nothing but the framework's motion and geometry", () => {
    const known = new Set<string>([
      // Motion, the same under every theme: curves, durations and delays.
      "--e-out",
      "--e-in",
      "--e-spring",
      "--e-in-out",
      "--t-tap",
      "--t",
      "--t-slow",
      "--t-bounce",
      "--t-press",
      "--t-veil",
      "--t-char-fade",
      "--t-reveal",
      "--t-stage",
      "--d-stagger",
      "--d-panel",
      "--d-beat",
      "--d-settle",
      "--d-tip",
      // The display's own geometry, not the theme's. A notch is a property of
      // the hardware that no theme can restyle and every theme must respect,
      // so these are read from `env()` in `base.css` and sit outside the
      // contract that themes fill in. Listing them here keeps
      // the gate catching a real stray.
      "--safe-top",
      "--safe-right",
      "--safe-bottom",
      "--safe-left",
      // The top band's height, shared by the Library's header and the
      // editor's titlebar. Geometry rather than a theme value, like the four
      // above; it lives in `base.css` because the two halves that consume it
      // load at different times.
      "--header-h",
      // A coarse pointer's floors (`@media (pointer: coarse)`): the smallest
      // target a fingertip hits, the type size below which WebKit zooms on
      // focus, and the bar's controls raised to the first.
      "--tap",
      "--tap-font",
      "--bar-act",
      // The wrapping field's resting height, scoped to
      // `.ui-input-wrap`: its padding centres one line from it, and the coarse
      // floor swaps it for `--tap`. Geometry again, never a theme's to set.
      "--field-h",
      // The loading dots' own unit and palette (`.ui-dots`), scoped to that
      // element so a caller can re-tone or resize one loader in a block; the
      // save chip points the palette at `currentColor`. Component-local, never
      // a theme's to set: `light-dark()` already follows the theme's scheme.
      "--dots-u",
      "--dots-dim",
      "--dots-hot",
      "--dots-cy",
      "--dots-c0",
      "--dots-c1",
      "--dots-c2",
      "--dots-c3",
      "--dots-c4",
      "--dots-c5",
      "--dots-c6",
      // The import list's line of beads (`.import-group`): where a row's
      // bead sits and how tall its tick and a joined line are, which every
      // line between two beads is measured from. Item-local geometry, never
      // a theme's to set.
      "--rail-step",
      "--rail-pad",
      "--depth",
      "--tick-h",
      "--head-h",
      "--sub-h",
      "--group-pad",
      "--join-w",
      "--join-h",
      "--bead",
      "--bead-x",
    ]);
    expect([...declaredInCss().keys()].filter((t) => !known.has(t))).toEqual(
      [],
    );
  });
});

/** Custom properties a stylesheet declares anywhere. */
const declaredAnywhere = (css: string) => new Set(declaredIn(css).keys());

describe("the custom properties script writes", () => {
  it("are each written by the app's code", () => {
    expect(
      SCRIPTED.filter((name) => !new RegExp(`${name}(?![\\w-])`).test(CODE)),
    ).toEqual([]);
  });
});

// The two halves draw with the theme; neither gets to be the theme. A contract
// token defined in one of their stylesheets would be a value the theme picker
// cannot reach, and only on the screens that half owns.
describe("neither half redefines the theme", () => {
  it.each([
    ["editor", EDITOR_CSS],
    ["webapp", WEBAPP_CSS],
  ])("%s defines no contract token of its own", (_half, css) => {
    const known = new Set<string>(THEME_TOKENS);
    expect([...declaredIn(css).keys()].filter((t) => known.has(t))).toEqual([]);
  });

  // A `var()` reference to a token that exists nowhere is a dead rule: the
  // declaration becomes invalid at computed-value time and the browser drops
  // it, so a typo like `--hairline` (no such token) renders the border
  // invisible with every gate still green. Reference-checking catches what
  // declaration-checking cannot. A custom property is known when the theme
  // supplies it or any stylesheet declares it, locally or in a media block;
  // only a reference to a name declared nowhere is a dead rule.
  it.each([
    ["editor", EDITOR_CSS],
    ["webapp", WEBAPP_CSS],
    ["base", CSS],
  ])("%s references no unknown token in var()", (_half, css) => {
    const known = new Set<string>([
      ...THEME_TOKENS,
      ...declaredAnywhere(CSS),
      ...declaredAnywhere(EDITOR_CSS),
      ...declaredAnywhere(WEBAPP_CSS),
      ...SCRIPTED,
    ]);
    const referenced = new Set<string>();
    for (const m of withoutComments(css).matchAll(/var\(\s*(--[\w-]+)/g)) {
      referenced.add(m[1]);
    }
    expect([...referenced].filter((t) => !known.has(t))).toEqual([]);
  });

  // The same for the code's own `var()`s: an inline style or an SVG
  // attribute that names a token reads the contract, a frame value or one
  // the code writes, and a misspelt one draws nothing.
  it("the app's code references no unknown token in var()", () => {
    const known = new Set<string>([
      ...THEME_TOKENS,
      ...declaredAnywhere(CSS),
      ...declaredAnywhere(EDITOR_CSS),
      ...declaredAnywhere(WEBAPP_CSS),
      ...SCRIPTED,
    ]);
    const referenced = [...CODE.matchAll(/var\(\s*(--[\w-]+)/g)].map(
      (m) => m[1],
    );
    expect(referenced.length).toBeGreaterThan(0);
    expect([...new Set(referenced)].filter((t) => !known.has(t))).toEqual([]);
  });
});
