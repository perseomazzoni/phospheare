// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The frame lays the app out and paints nothing: with no theme on the page
// the app works as it does under any theme, in the browser's own colours and
// faces. Every colour, ground, edge, corner, shadow, frost, face, weight,
// style, case and tracking is a theme's, in its sheet
// (`theme/themes/<family>/theme.css`). Each exception below is the frame's
// own and the same under every theme.

import { describe, expect, it } from "vitest";
import { THEME_TOKENS } from "../theme/domain/tokens";
import {
  declarationsOf,
  misread,
  parseCss,
  withoutPseudo,
  type Declared,
} from "./css.fixture";

const PAINT =
  /^(color|background(-[a-z-]+)?|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?-color|border(-[a-z-]+)?-radius|border-image(-[a-z-]+)?|outline(-[a-z-]+)?|(-webkit-)?box-shadow|text-shadow|filter|(-webkit-)?backdrop-filter|mix-blend-mode|font|font-(family|weight|style|stretch|width|palette|feature-settings|variation-settings|kerning|optical-sizing)|font-variant(-[a-z-]+)?|font-synthesis(-[a-z-]+)?|letter-spacing|word-spacing|text-transform|text-decoration(-[a-z-]+)?|text-underline-(offset|position)|text-emphasis(-[a-z-]+)?|-webkit-text-fill-color|-webkit-text-stroke(-[a-z-]+)?|-webkit-font-smoothing|-moz-osx-font-smoothing|text-rendering|fill(-[a-z-]+)?|stroke(-[a-z-]+)?|stop-color|flood-color|lighting-color|paint-order|column-rule-color|caret-color|accent-color|scrollbar-color|-webkit-tap-highlight-color|color-scheme|(-webkit-)?mask(-[a-z-]+)?)$/;

/** A border shorthand's width and style take room; a colour in it paints. */
const BORDER =
  /^(border(-(top|right|bottom|left|block|inline)(-(start|end))?)?|column-rule)$/;
const ROOM =
  /^(-?[\d.]+[a-z%]*|thin|medium|thick|(calc|min|max|clamp)\(.*|none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/i;

/** Every colour CSS names, and the system's own. */
const NAMED =
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext".split(
    " ",
  );

/** A colour written out rather than read from a token. */
function literalColour(value: string): boolean {
  // Names, strings and addresses are not colours, whatever words they hold.
  const bare = value
    .replace(/"[^"]*"|'[^']*'/g, "")
    .replace(/url\([^)]*\)/gi, "")
    .replace(/--[\w-]+/g, "");
  return (
    /#[0-9a-f]{3,8}\b/i.test(bare) ||
    /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(bare) ||
    bare
      .toLowerCase()
      .split(/[^a-z-]+/)
      .some((word) => NAMED.includes(word))
  );
}

// The product's own marks: the logo, the same for everyone, and the
// login splash with its own night sky. A rule is theirs only when every
// selector in its list names one, outside a `:not()`.
const PRODUCT = /brand-mark|app-logo|login-splash/;
const isProduct = (item: string) => PRODUCT.test(withoutPseudo(item, "not"));

/** The palettes the frame keeps: the kindling loader's and the splash's. */
const OWN_PALETTE = /^--(dots|splash)-/;

/**
 * What a mark reads of the theme on the page: the wordmark beside the logo
 * is in the page's ink (the figure takes its colours from the scheme alone,
 * `BrandMark.test.tsx`), and the splash's name is in the label's voice.
 */
const MARK_VOICE = new Set([
  "--ink",
  "--f-chrome",
  "--bold-weight",
  "--label-tracking",
  "--label-case",
  "--label-caps",
]);

/**
 * The busy spectrum the assistant's stop and spark run through: the
 * product's own, like the loader's dots, and the same under every theme.
 */
const OWN_KEYFRAMES = new Set(["aiStopRainbow", "aiSparkRainbow"]);

const CONTRACT = new Set<string>(THEME_TOKENS);

/** The system's own colours, drawn when the writer forces theirs. */
const FORCED = /^media \(forced-colors: ?active\)$/;

const reads = (value: string) =>
  [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);

function isPaint(prop: string, value: string): boolean {
  if (PAINT.test(prop)) return true;
  return (
    BORDER.test(prop) &&
    value.split(/\s+(?![^(]*\))/).some((word) => !ROOM.test(word))
  );
}

const shown = ({ selector, prop, value }: Declared) =>
  `${selector} { ${prop}: ${value} }`;

/** Each paint declaration left in a frame stylesheet, with its rule. */
function paint(css: string): string[] {
  return declarationsOf(css)
    .filter(
      ({ within }) =>
        // The faces it loads, the system's colours under forced colours,
        // and its animations, read apart below.
        !within.some(
          (at) =>
            at.startsWith("font-face") ||
            FORCED.test(at) ||
            /^(-webkit-)?keyframes /.test(at),
        ),
    )
    .filter((decl) => {
      const { selectors, prop, value } = decl;
      // A mark paints in its own colours, never a theme's.
      if (selectors.length > 0 && selectors.every(isProduct))
        return (
          isPaint(prop, value) &&
          reads(value).some(
            (name) => !OWN_PALETTE.test(name) && !MARK_VOICE.has(name),
          )
        );
      return prop.startsWith("--")
        ? literalColour(value) && !OWN_PALETTE.test(prop)
        : isPaint(prop, value);
    })
    .map(shown);
}

/**
 * Each keyframe step that paints with anything but the contract. The frame's
 * shared animations move through a theme's colours by name, so a theme
 * recolours them and no theme leaves them unpainted.
 */
function keyframePaint(css: string): string[] {
  return declarationsOf(css)
    .filter(({ within }) => {
      const frames = within.find((at) => /^(-webkit-)?keyframes /.test(at));
      return frames && !OWN_KEYFRAMES.has(frames.split(" ")[1]);
    })
    .filter(({ prop, value }) => isPaint(prop, value))
    .filter(
      ({ value }) =>
        literalColour(value) ||
        reads(value).some(
          (name) => !CONTRACT.has(name) && !OWN_PALETTE.test(name),
        ),
    )
    .map(shown);
}

// ── The frame's stylesheets ──────────────────────────────────────────────────
//
// Read from what the app imports: each entry the code imports, and each
// stylesheet an entry imports, so a stylesheet added to the frame is held to
// it with no list to keep.

const SOURCES = import.meta.glob<string>(["/src/**/*.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const STYLESHEETS = import.meta.glob<string>(["/src/**/*.css"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const at = (spec: string, from: string) =>
  new URL(spec, `file://${from}`).pathname.replace(/^\/[A-Z]:/, "");

/** Each stylesheet the app's code imports, by path and the query it asks. */
const IMPORTS = Object.entries(SOURCES)
  .filter(
    ([path]) =>
      !/\.(test|fixture)\.tsx?$/.test(path) && !/\/test\w+\.ts$/.test(path),
  )
  .flatMap(([path, text]) =>
    [
      ...text.matchAll(
        /\bimport\s*(?:\(\s*|[\w*{}\s,]+\s+from\s+)?["']([^"'?]+\.css)(\?[^"']*)?["']/g,
      ),
    ].map((m) => ({ from: path, path: at(m[1], path), query: m[2] ?? "" })),
  );

/**
 * A theme's sheet, which the theme writes into its own layer: a family's
 * own, or the paint every family shares (`sharedPaint.ts`).
 */
const SHEET = /^\/src\/theme\/themes\/(?:[\w-]+\/theme|shared)\.css$/;

const ENTRIES = [
  ...new Set(
    IMPORTS.filter((one) => !SHEET.test(one.path)).map((one) => one.path),
  ),
];

/** What an entry brings in `layer(frame)`, or itself when it wraps itself. */
function frameOf(entry: string): string[] {
  const imported = [
    ...(STYLESHEETS[entry] ?? "").matchAll(/@import\s+["']([^"']+)["']/g),
  ].map((m) => at(m[1], entry));
  return imported.length > 0 ? imported : [entry];
}

const FRAME = [...new Set(ENTRIES.flatMap(frameOf))].map(
  (path) => [path.replace(/^\/src\//, ""), STYLESHEETS[path] ?? ""] as const,
);

describe("the frame", () => {
  it("is read from the stylesheets the app imports", () => {
    expect(FRAME.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        "styles/base.css",
        "editor/editor.css",
        "webapp/webapp.css",
        "editor/views/view/adapters/typewriter.css",
      ]),
    );
  });

  it.each(FRAME)("%s paints nothing", (_file, css) => {
    expect(paint(css)).toEqual([]);
  });

  it.each(FRAME)("%s animates paint through the contract alone", (_f, css) => {
    expect(keyframePaint(css)).toEqual([]);
  });

  it.each(FRAME)("%s reads as the browser reads it", (_f, css) => {
    expect(misread(css)).toEqual([]);
  });

  it("tells paint from what only looks like it", () => {
    const flagged = (css: string) => paint(css).length;
    expect(flagged(".a { COLOR: red }")).toBe(1);
    expect(flagged(".a { color: red !important }")).toBe(1);
    expect(flagged(".a { --ground: crimson }")).toBe(1);
    expect(flagged(".a { --ground: whitesmoke }")).toBe(1);
    expect(flagged(".a { --ground: color(display-p3 1 0 0) }")).toBe(1);
    expect(flagged(".shell:not(.login-splash) .ui-btn { color: #f00 }")).toBe(
      1,
    );
    expect(
      flagged("@media (forced-colors: active), all { .a { color: red } }"),
    ).toBe(1);
    expect(flagged('.a { content: "/*"; color: red }')).toBe(1);
    expect(flagged(".a { -webkit-box-shadow: 0 0 1px var(--x) }")).toBe(1);
    expect(flagged(".a { --gap: var(--field) }")).toBe(0);
    expect(flagged(".login-splash .name { color: #fff }")).toBe(0);
    expect(
      flagged("@media (forced-colors: active) { .a { color: Canvas } }"),
    ).toBe(0);
  });
});

// A stylesheet outside the frame's layer beats every theme whatever its
// weight, so each one the app imports is the frame's: its entry imports each
// file `layer(frame)`, or the file wraps itself, whole, in `@layer frame`.
describe("the frame's layer", () => {
  it("reads the app's imports", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
    expect(ENTRIES.length).toBeGreaterThanOrEqual(4);
  });

  it("takes each stylesheet as an entry, and only a theme's sheet inline", () => {
    expect(
      IMPORTS.filter((one) =>
        SHEET.test(one.path) ? one.query !== "?inline" : one.query !== "",
      ).map((one) => `${one.from} → ${one.path}${one.query}`),
    ).toEqual([]);
  });

  it.each(ENTRIES)("%s sits in the frame's layer", (entry) => {
    const nodes = parseCss(STYLESHEETS[entry] ?? "").nodes.filter(
      (node) => node.type !== "comment",
    );
    const wrapped =
      nodes.length === 1 &&
      nodes[0].type === "atrule" &&
      nodes[0].name === "layer" &&
      nodes[0].params === "frame" &&
      nodes[0].nodes !== undefined;
    const imports = nodes.every(
      (node) =>
        node.type === "atrule" &&
        node.nodes === undefined &&
        ((node.name === "layer" && /^frame,\s*theme$/.test(node.params)) ||
          (node.name === "import" &&
            /^["'][^"']+["']\s+layer\(frame\)$/.test(node.params))),
    );
    expect(wrapped || imports).toBe(true);
  });

  it.each(FRAME)("%s imports nothing past its entry", (_f, css) => {
    expect(/@import\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, ""))).toBe(false);
  });
});
