// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import BASE from "../../styles/base.css?raw";
import { EDITOR_CSS as EDITOR } from "../../editor/editorSheets.fixture";
import WEBAPP from "../../webapp/webapp.css?raw";
import { THEME_TOKENS } from "../domain/tokens";
import { allThemes } from "../application/registry";
import type { Theme } from "../domain/types";
import "../index";
import {
  declarationsOf,
  misread,
  parseCss,
  rulesOf,
  SCRIPTED,
  type Declared,
} from "../../styles/css.fixture";
import {
  erasures,
  writtenTogether,
  type RootAttributes,
} from "../../styles/tune.fixture";

// Each theme's sheet (`themes/<family>/theme.css`), the whole of its paint,
// checked rule by rule, as the browser parses it: a missing brace drops
// every rule after it, and a `var()` naming a token nobody declares draws
// nothing with every gate green.

const SHEETS = await Promise.all(
  allThemes().map(
    async (theme) =>
      [theme.id, await theme.sheet(), Object.keys(theme.own), theme] as const,
  ),
);

/** Custom properties a stylesheet declares anywhere. */
function declared(css: string): Set<string> {
  return new Set(
    declarationsOf(css)
      .map(({ prop }) => prop)
      .filter((prop) => prop.startsWith("--")),
  );
}

describe.each(SHEETS)("%s's sheet", (_id, css, own) => {
  it("parses whole, and reads as the browser reads it", () => {
    expect(() => parseCss(css)).not.toThrow();
    expect(misread(css)).toEqual([]);
  });

  // A contract token comes from the theme's tokens, written on the root; a
  // sheet that declared one would answer it twice. The frame's own knobs are
  // its geometry and motion, and a sheet that set one would move the app;
  // the code's own (`SCRIPTED`) are the same.
  it("declares no contract token and none of the frame's knobs", () => {
    const taken = new Set<string>([
      ...THEME_TOKENS,
      ...SCRIPTED,
      ...declared(BASE),
      ...declared(EDITOR),
      ...declared(WEBAPP),
    ]);
    expect([...declared(css)].filter((n) => taken.has(n))).toEqual([]);
  });

  // A read with a fallback is checked too: a misspelt name draws the
  // fallback with every gate green. A theme's own tokens are its sheet's to
  // read.
  it("reads no custom property that nothing declares", () => {
    const known = new Set<string>([
      ...THEME_TOKENS,
      ...SCRIPTED,
      ...own,
      ...declared(css),
      ...declared(BASE),
      ...declared(EDITOR),
      ...declared(WEBAPP),
    ]);
    const read = declarationsOf(css).flatMap(({ value }) =>
      [...value.matchAll(/var\(\s*(--[\w-]+)\s*[,)]/g)].map((m) => m[1]),
    );
    expect(read.filter((name) => !known.has(name))).toEqual([]);
  });
});

// ── Paint, never place ───────────────────────────────────────────────────────
//
// The frame owns every area, size, behaviour and motion (`editor.css`), so a
// writer who changes theme finds everything where it was and working as it
// did. A theme's sheet paints: colour, ground, edge, shadow, the face, its
// weight, style, case and tracking. They set no size (type included: the
// skin picks the face, not the size), no place, no layout, hide nothing,
// write no text, and move nothing. A mark drawn on an absolutely positioned
// pseudo-element with no text takes no room; a positioning context takes
// none either.

const PLACE =
  /^(width|height|min-width|min-height|max-width|max-height|padding(-[a-z-]+)?|margin(-[a-z-]+)?|gap|row-gap|column-gap|inset(-[a-z-]+)?|top|left|right|bottom|translate|transform|position|grid(-[a-z-]+)?|flex(-[a-z-]+)?|order|align-[a-z-]+|justify-[a-z-]+|place-[a-z-]+|overflow(-[xy])?|text-align|clip-path|clip|white-space|text-indent|display|visibility|content-visibility|pointer-events|font-size|line-height|field-sizing|scrollbar-width|scrollbar-gutter|scroll-(padding|margin)(-[a-z-]+)?|transition(-[a-z-]+)?|animation(-[a-z-]+)?|vertical-align|zoom|scale|rotate|inline-size|block-size|(min|max)-(inline|block)-size|aspect-ratio|float|clear|box-sizing|columns|column-(count|width|span)|writing-mode|direction|z-index|(-webkit-)?line-clamp|-webkit-box-orient|contain(-intrinsic-[a-z-]+)?|container(-[a-z]+)?|offset(-[a-z-]+)?)$/;

/**
 * A width other than a hairline: 1px, or 2px for the press rule and the
 * focus ring, in any unit.
 */
const WIDTHS =
  /(?<![\d.])(?!(?:0|1px|2px)(?![\w.%]))\d*\.?\d+(px|r?em|ch|ex|vw|vh|vmin|vmax|%|pt|cm|mm|in|lh)\b|\b(thin|medium|thick)\b/;

/** A border written away: no width, or no style. */
const BORDER_SIDES =
  /^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-width|-style)?$/;
const GONE = /^(0(\.0+)?([a-z%]+)?|none|hidden)$/;

/** A mark: an absolutely positioned pseudo-element with no text. */
function isMark(selectors: string[], decls: Declared[]): boolean {
  return (
    selectors.length > 0 &&
    selectors.every((one) => /::(before|after)$/.test(one)) &&
    decls.some(
      ({ prop, value }) => prop === "position" && value === "absolute",
    ) &&
    decls.every(
      ({ prop, value }) => prop !== "content" || /^(""|''|none)$/.test(value),
    )
  );
}

/** The declarations of a sheet that size, place, hide, write or move. */
function placing(css: string): string[] {
  const byRule = new Map<string, Declared[]>();
  for (const decl of declarationsOf(css)) {
    const key = `${decl.within.join("|")} ${decl.selector}`;
    byRule.set(key, [...(byRule.get(key) ?? []), decl]);
  }
  return [...byRule.values()].flatMap((decls) => {
    const mark = isMark(decls[0].selectors, decls);
    const room = (p: string) =>
      mark &&
      /^(width|height|inset(-[a-z-]+)?|top|left|right|bottom|position|translate|transform)$/.test(
        p,
      );
    // A mark may sit behind what it marks, never over it.
    const under = (p: string, v: string) =>
      mark && p === "z-index" && Number(v) <= 0;
    return decls
      .filter(({ prop: p, value: v }) => {
        const opacity = /^([\d.]+)(%)?$/.exec(v);
        return (
          (PLACE.test(p) &&
            !room(p) &&
            !under(p, v) &&
            !(p === "position" && v === "relative")) ||
          // The shorthand sets a size, even as `inherit`.
          p === "font" ||
          (p === "content" && !/^(""|''|none)$/.test(v)) ||
          (p === "opacity" &&
            opacity !== null &&
            Number(opacity[1]) / (opacity[2] ? 100 : 1) < 0.1) ||
          (/^border(-[a-z]+)*(-width)?$/.test(p) &&
            !/radius|color|style|image/.test(p) &&
            WIDTHS.test(v)) ||
          // A border taken away moves what it held; a theme paints it clear.
          (BORDER_SIDES.test(p) &&
            v.split(/\s+/).some((word) => GONE.test(word))) ||
          (/^outline(-width)?$/.test(p) && WIDTHS.test(v))
        );
      })
      .map(({ selector, prop, value }) => `${selector} { ${prop}: ${value} }`);
  });
}

/**
 * The rules a family places on its own: layout that only it draws, written
 * in its own sheet so no other theme moves. Every other rule in its sheet
 * still only paints.
 */
const PLACED: Record<string, string[]> = {
  shine: [
    // The panel's spine a thin rule of bars.
    ".dt-ident .spine-bars",
    // The path's number and the Section's name on one baseline.
    ".titlebar-idx, .titlebar-name",
    // The command bar clear of the titlebar's rule, and the Dock's top on it.
    '.editor-shell:not([data-phone="1"]) .bar-stack .ui-bar',
    '.editor-shell:not([data-narrow="1"]):not([data-phone="1"]) .ed-dock',
    // The panel head and its fold on the Dock head's line.
    '.editor-shell:not([data-narrow="1"]):not([data-phone="1"]) .dt-root',
    '.editor-shell:not([data-narrow="1"]):not([data-phone="1"]) .dt-collapse',
    // The Library's wordmark, card titles and scope at their own sizes.
    ".app-wordmark",
    ".project-title",
    ".projects-list .project-title",
    ".shelf-scope",
    // The editor's wait in the attached panel's place.
    ".ed-skeleton-panel",
  ],
  radiant: [
    // The attached panel's head and its fold on the Dock head's line.
    '.editor-shell:not([data-narrow="1"]):not([data-phone="1"]) .dt-root',
    '.editor-shell:not([data-narrow="1"]):not([data-phone="1"]) .dt-collapse',
    // The Library's spine clipped to a capsule.
    ".project-spine :is(.spine-bars, .spine-empty)",
  ],
  vision: [
    // The Desk's rules clear of the counts under them.
    ".sr-parts",
    // A note's actions set as words on one line.
    ".cm-card :is(.cm-buttons, .cm-confirm, .cm-composer-actions)",
    ".cm-card :is(.cm-buttons, .cm-confirm, .cm-composer-actions) .ui-btn",
    // An ask for a search inset from its rule.
    ".ai-workspace .ai-ask",
    // The contents as an index: the buttons stacked, the facts a list, the
    // shape a thin rule.
    '.editor-shell:not([data-rail="1"]) .dt-dock-buttons',
    '.editor-shell:not([data-rail="1"]) .dt-meta',
    ".dt-tag",
    ".dt-ident .spine-bars",
    // The index's page glyph not drawn, and the fold and the row's menu
    // under the hand (shown on touch).
    ".dt-chevron.placeholder > .dt-file-icon",
    ".dt-row > .dt-cell > button.dt-chevron, .dt-row .dt-more",
    // The index's rows set close.
    ".dt-row",
    ".dt-row > .dt-lead",
    // The fold's glyph inside its clasp.
    ".dt-collapse svg",
    // The Assistant's busy spark still, in gold.
    '.dock-head .ui-bar-track button[data-busy="1"] svg',
    // The Library as a book's opening: the greeting and each book's title
    // over their marks, the imprint at the foot, the gold rule inside the
    // edge lit as the edge is.
    ".lib-title",
    ".lib-title::before, .lib-title::after, .projects-grid .project-title::before, .projects-grid .project-title::after",
    ".lib-title::before, .projects-grid .project-title::before",
    ".projects-grid .project",
    ".projects-grid .project::before",
    ".project::before",
    ".project-gone:is(:hover, :focus-within)::before",
    ".project:is(:hover, :focus-within)::before",
    ".project-attention::before",
    ".project-attention:is(:hover, :focus-within)::before",
    ".projects-grid .project::after",
    ".projects-grid .project-title",
    ".projects-grid .project-where",
    ".projects-grid .project-where > svg",
    ".projects-grid .project-where > .ui-dots",
    ".projects-grid .project:has(.project-sync)",
    ".projects-grid .project:has(.project-sync)::after",
    ".projects-grid .project:has(.project-sync) .project-when",
    ".projects-grid .project-sync",
    ".projects-grid .project-sync::before",
    ".projects-grid .project-stats > .project-when",
    ".projects-list .project, .projects-list .project:is(:hover, :focus-within)",
    ".projects-list .project::before",
    // The folio's number in its ruled square.
    ".ed-folio > span",
    // The crop marks at the face's corners, which only Vision draws.
    ".crop-frame",
    '.editor-shell:not([data-narrow="1"]):not([data-henosis="full"]) .crop-frame',
    '.editor-shell[data-margin="1"]:not([data-narrow="1"]):not( [data-henosis="full"] ):has(.cm-layer[data-mode="notes"]) .crop-frame',
    '.editor-shell[data-henosis="full"]:not([data-narrow="1"]) .crop-frame',
    '.editor-shell[data-phone="1"] .crop-frame',
    ".crop",
    ".crop-tl",
    ".crop-tr",
    ".crop-bl",
    ".crop-br",
    // The running head and the folio, which only Vision draws.
    ".editor-surface > .ed-runhead",
    ".editor-surface > .ed-folio",
    ".editor-surface:has(> .ed-folio)",
    '.editor-shell[data-margin="1"]:not([data-phone="1"]) .editor-surface[data-desk="0"]:has(.cm-layer[data-mode="notes"]) > .ed-runhead',
    '.editor-shell[data-margin="1"]:not([data-phone="1"]) .editor-surface[data-desk="0"]:has(.cm-layer[data-mode="notes"]) > .ed-folio',
    '.editor-shell[data-phone="1"] .editor-surface > .ed-runhead',
    '.editor-surface[data-desk="0"]:not([data-view="scroll"]) :is(.ed-runhead, .ed-folio)',
    // The shape drawn as rules, which only Vision draws.
    ".spine-rules",
    ".spine-rules :is(.sr-nums, .sr-parts, .sr-counts)",
    ".spine-rules :is(.sr-nums, .sr-counts)",
    ".sr-nums",
    ".sr-counts",
    ".sr-part",
    '.sr-rule[data-empty="1"]',
    ".sr-room",
    // The Dock's faces named in words, which only Vision sets.
    ':root[data-dock-tabs="words"] .dock-head',
    ':root[data-dock-tabs="words"] .dock-head .ui-bar-track',
    ':root[data-dock-tabs="words"] .dock-head .ui-bar-track-thumb',
    ':root[data-dock-tabs="words"] .dock-head .ui-bar-track button',
    ':root[data-dock-tabs="words"] .dock-head .ui-bar-track button:not([data-busy="1"]) > svg',
    ':root[data-dock-tabs="words"] .dock-head .ui-bar-track[data-fit="1"] button',
    // The contents as a classical index: "Contents" between its squares,
    // air above each Part, the rows' sizes for a pointer.
    ".dt-region-head > .dt-region-label",
    ".dt-region-head > .dt-region-label::before, .dt-region-head > .dt-region-label::after",
    ".dt-part .dt-idx",
    ".editor > h1:first-child",
    ".editor > h1",
    ".editor > hr",
    ".editor > hr + p",
    ".dt-row.dt-part",
    ".dt-row.dt-section",
    ".dt-row .dt-idx",
    ".dt-words",
    ".dt-add",
    // A Part's Sections in its own columns, close, a long title wrapping,
    // the summary mark under the hand.
    ".dt-part + .dt-children > .dt-branch > .dt-row.dt-section",
    ".dt-section .dt-label",
    ".dt-row .dt-summary",
    // A row's summary mark and menu over its end, under the hand.
    ".dt-row > .dt-cell > .dt-summary, .dt-row > .dt-actions",
    ".dt-row > .dt-actions",
    ".dt-row > .dt-cell > .dt-summary",
    // The panel on one measure: folds hung in the margin, every piece on
    // the numbers' line and the counts' edge.
    ".dt-row > .dt-chevron, .dt-row > .dt-cell > .dt-chevron",
    ".dt-content > .dt-add-row, .dt-part + .dt-children > .dt-add-row",
    ".dt-add-row > .dt-cell > .dt-add",
    ".dt-bin-head",
    '.editor-shell:not([data-rail="1"]) :is(.dt-dock-buttons, .dt-meta)',
    '.editor-shell:not([data-rail="1"]) .dt-dock-button',
    '.editor-shell:not([data-rail="1"]) .dt-dock-button > .dt-lead',
    '.editor-shell:not([data-rail="1"]) .dt-dock-button-chevron',
    '.editor-shell:not([data-rail="1"]) .dt-foot',
    // The selection's band on the panel's measure.
    ".dt-moving",
    // A Section's tick on its number; the notes' verdigris squares.
    ".dt-row.dt-section > .dt-chevron.placeholder",
    ".dt-row.dt-section > .dt-idx",
    ".dt-row.dt-section:hover:has(.dt-check) > .dt-idx",
    ".dt-row.dt-section:focus-within:has(.dt-check) > .dt-idx, .doc-tree[data-selecting] .dt-row.dt-section:has(.dt-check) > .dt-idx",
    ':root[data-comments="notes"] .cm-marker[data-at="end"]::after',
    ':root[data-comments="notes"] :is(.cm-layer[data-mode="notes"], .cm-float) .cm-name::before',
    // The text cut on the crop marks' top line, a short fade under it.
    ':root[data-under-bar="cut"] .editor-shell:not([data-phone="1"]):not([data-henosis="full"]) .editor-surface',
    // The Dock's and the peeking panel's gold rules laid over what they
    // hold, fading in with the leaf.
    ".ed-dock::after",
    ".doc-tree::after",
    // The command bar easing into its leaf with the panels.
    ".bar-stack .ui-bar",
    // The Library's books between crop marks, as lines in the list.
    ':root[data-crop="1"] .projects-list .project, :root[data-crop="1"] .projects-list .project:is(:hover, :focus-within)',
  ],
};

describe("a theme's sheet", () => {
  it.each(SHEETS)(
    "%s's paint, and never size, place, hide or move",
    (_id, css, _own, theme) => {
      const own = PLACED[theme.family] ?? [];
      expect(
        placing(css).filter(
          (found) => !own.some((selector) => found.startsWith(`${selector} {`)),
        ),
      ).toEqual([]);
    },
  );

  it("tells placing from painting", () => {
    const flagged = (css: string) => placing(css).length;
    expect(flagged(".a { border: none !important }")).toBe(1);
    expect(flagged(".a { opacity: 0 !important }")).toBe(1);
    expect(flagged(".a { opacity: 0% }")).toBe(1);
    expect(flagged(".a { opacity: .01 }")).toBe(1);
    expect(flagged(".a { border-width: 0 0 0 0 }")).toBe(1);
    expect(flagged(".a { border-block: none }")).toBe(1);
    expect(flagged(".a { border-top: 0 solid }")).toBe(1);
    expect(flagged(".a { content-visibility: hidden }")).toBe(1);
    expect(
      flagged(".a::after, .ui-btn { position: absolute; width: 4px }"),
    ).toBe(2);
    expect(flagged(".a::after { position: absolute; z-index: 9 }")).toBe(1);
    expect(flagged(".a::after { position: absolute; z-index: -1 }")).toBe(0);
    expect(flagged(".a::after { position: fixed; inset: 0 }")).toBe(2);
    expect(flagged(".a::after { position: absolute; display: none }")).toBe(1);
    expect(flagged(".a::after { position: absolute; inset: 0 }")).toBe(0);
    expect(flagged(".a { border-color: red; opacity: 0.6 }")).toBe(0);
  });
});

// ── The previews ─────────────────────────────────────────────────────────────
//
// Settings draws a tile of every theme with the worn theme's sheet, the
// tile's face in its own theme's tokens. So each sheet draws a face the same
// way, or a theme's preview would change with the theme worn around it.

describe("the theme tiles' faces", () => {
  it("are drawn alike in every sheet", () => {
    const faces = SHEETS.map(([, css]) =>
      rulesOf(css)
        .filter(({ selectors }) =>
          selectors.every((one) => /^\.tile-/.test(one)),
        )
        .map(
          ({ selectors, decls }) =>
            `${selectors.join(", ")} { ${decls
              .map(({ prop, value }) => `${prop}: ${value}`)
              .join("; ")} }`,
        ),
    );
    expect(faces[0].length).toBeGreaterThan(10);
    for (const face of faces) expect(face).toEqual(faces[0]);
  });
});

// ── A theme's own touches keep the paint's states ───────────────────────────
//
// A sheet that tunes a copy of the paint (`@layer paint, tune`) restates,
// after a touch, every state and variant of the paint the touch would erase
// (`tune.fixture.ts`). A sheet that is all paint has no touches.

/** The root a theme leaves (`adapters/page.ts`). */
function rootOf(theme: Theme): RootAttributes {
  return {
    theme: theme.id,
    comments: theme.frame.comments,
    underBar: theme.frame.underBar,
    dockTabs: theme.frame.dockTabs,
    panel: theme.frame.panel,
    crop: theme.decorations.pageCorners === "crop" ? "1" : "0",
    marginRule: theme.decorations.marginRule,
  };
}

/** The classes the markup writes on one element, across the app. */
const WRITTEN = new Set(
  Object.values(
    import.meta.glob<string>(["../../**/*.tsx", "!../../**/*.test.tsx"], {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ).flatMap((source) => [...writtenTogether(source)]),
);

describe("a theme's own touches", () => {
  it("are read in every sheet that tunes a copy, both layers whole", () => {
    const layered = SHEETS.filter(([, css]) =>
      rulesOf(css).some(({ within }) => within.includes("layer tune")),
    );
    for (const [id, css] of layered)
      expect(
        rulesOf(css).some(({ within }) => within.includes("layer paint")),
        id,
      ).toBe(true);
    expect(layered.length).toBeGreaterThanOrEqual(6);
  });

  // The largest sheet takes seconds to cross with every written class, more
  // under coverage, so the default five-second limit is too close.
  it.each(SHEETS)(
    "%s's keep every state of the paint",
    (_id, css, _own, theme) => {
      expect(
        erasures(css, rootOf(theme), WRITTEN).map(
          ({ touch, state, props }) =>
            `${touch} erases ${state} [${props.join(", ")}]`,
        ),
      ).toEqual([]);
    },
    20_000,
  );

  it("finds a touch that erases a state, a variant, or a state above it", () => {
    const sheet = (tune: string) =>
      `@layer paint, tune;
       @layer paint {
         .row:hover { background: blue }
         .row.active { background: green }
         .card-gone:hover { border-color: grey }
         .card.card-gone { color: grey }
         .verdict[data-v="bad"] b { color: red }
         .sheet .tile { color: white }
       }
       @layer tune { ${tune} }`;
    const found = (tune: string) => erasures(sheet(tune), {}).length;
    expect(found(".row:hover { background: pink }")).toBe(1);
    expect(found(".card:hover { border-color: gold }")).toBe(1);
    expect(found(".x .verdict b { color: black }")).toBe(1);
    // A variant with no state, and a context the touch does not ask for.
    expect(found(".card { color: black }")).toBe(1);
    expect(found(".tile { color: black }")).toBe(1);
    expect(found(".y .tile { color: black }")).toBe(0);
    expect(
      found(
        ".row:hover { background: pink } .row.active { background: green }",
      ),
    ).toBe(0);
    expect(found(".row:disabled { background: pink }")).toBe(0);
  });

  it("reads which classes the markup writes on one element", () => {
    const written = writtenTogether(
      [
        '<b className={`chip${on ? " chip-on" : ""}`} />',
        'const classes = ["ui-btn", `ui-btn-${variant}`].join(" ");',
        '<i className="chip-label" />',
      ].join("\n"),
    );
    expect(written.has(".chip .chip-on")).toBe(true);
    expect(written.has(".ui-btn .ui-btn-*")).toBe(true);
    expect([...written].some((one) => one.includes("chip-label"))).toBe(false);
    const sheet = `@layer paint, tune;
      @layer paint { .chip-off { color: grey } .ui-btn-primary { color: white } }
      @layer tune { .chip { color: black } .ui-btn { color: black } }`;
    expect(erasures(sheet, {}).length).toBe(0);
    expect(
      erasures(sheet, {}, new Set([".chip .chip-off", ".ui-btn .ui-btn-*"]))
        .length,
    ).toBe(2);
  });
});
