// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The spacing scale the frame commits to: a 4px base with 2px half-steps up
// to 16, then 20, 24, 28, 32, 40 and 48, and a hairline's 1. Every padding,
// margin and gap in the app's stylesheets stands on it. A length past 48 is a
// layout distance rather than a step of the rhythm, so the scale leaves it be.
//
// A value off the scale is allowed only when another size derives it: a
// height halved, a box beside a gap, a fallback that is a height. Each one is
// listed below with the sizes it comes from, and the list must match the
// stylesheets both ways: a new value off the scale fails here, and so does an
// exception left behind once its value is gone.

import { describe, expect, it } from "vitest";
import BASE_CSS from "./base.css?raw";
import { EDITOR_CSS } from "../editor/editorSheets.fixture";
import WEBAPP_CSS from "../webapp/webapp.css?raw";
import { declarationsOf } from "./css.fixture";

const SCALE = new Set([
  0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48,
]);

const SPACING = /^(padding|margin|gap|row-gap|column-gap)(-[a-z-]+)?$/;

/**
 * Every padding, margin or gap declaration holding a px or rem length up to
 * 48 that is off the scale, a rem read at the root's 16px, as
 * `selector { prop: value }`.
 */
function offScale(css: string): string[] {
  const found = new Set<string>();
  for (const { selector, prop, value } of declarationsOf(css)) {
    if (!SPACING.test(prop)) continue;
    for (const n of value.matchAll(/(?<![\w.-])(-?\d*\.?\d+)(px|rem)\b/g)) {
      const px = Math.abs(Number(n[1])) * (n[2] === "rem" ? 16 : 1);
      if (px <= 48 && !SCALE.has(px))
        found.add(`${selector} { ${prop}: ${value} }`);
    }
  }
  return [...found].sort();
}

// The derived values, by file, each with the sizes it comes from.
const DERIVED: Record<string, string[]> = {
  "base.css": [
    // (4 - 10) / 2: the 10px thumb centred on the 4px track.
    ".ui-slider-input::-webkit-slider-thumb { margin-top: -3px }",
    // The tick row's own arithmetic: its padding, its 15px box, its gap.
    ".export-choose { margin: 0 0 6px calc(8px + 15px + 10px) }",
    // The access card's 26px sigil and its 12px gap: a wrapped action starts
    // under the name.
    ".ui-access-text + * { margin-left: calc(26px + 12px) }",
    // Half the cut's 14px height, so it takes no room in the column.
    ".import-cut { margin-block: -7px }",
    // 5 + 34 + 5 and the hairlines are the bar's 46px height.
    ".ui-bar { padding: 5px }",
    // The cell's 6 + 6, one pixel moved to centre the glyph and word by ink.
    '.ui-bar-track[data-fit="1"] button:has(> svg + span) { padding-inline: 5px 7px }',
    // The text starts after the glyph's cell, a height (38), nudged to its ink.
    ".ui-bar-find-input { padding: 0 var(--bar-find-tail, 96px) 0 calc(var(--bar-act, 38px) - 3px) }",
  ],
  "editor.css": [
    // (40 - 30) / 2: the 30px track centred in the panel head's 40px.
    ".dock-head { padding: 5px 10px }",
    // The disc's own 7px height: it hangs above the point it marks.
    ".rev-rail-head { margin-top: -7px }",
    // Under the words: the glyph's 11px slot and the row's 8px gap.
    ".dt-search-excerpt { margin-left: calc(11px + 8px) }",
    // On touch: the button's own 11px width, so it grows about its centre.
    ".dt-summary { margin-inline: calc((11px - var(--tap)) / 2) }",
    // Under the words: the glyph's 11px and the evidence's 6px gap.
    ".ai-trace-row.is-web small { padding-inline-start: 17px }",
    // 44 is the tap height's fallback, a height rather than a space.
    '.editor-shell[data-phone="1"] .editor-surface { padding-bottom: calc(var(--bar-act, 44px) + 40px + var(--kb, 0px)) }',
  ],
  "webapp.css": [],
};

describe("the spacing scale", () => {
  it.each([
    ["base.css", BASE_CSS],
    ["editor.css", EDITOR_CSS],
    ["webapp.css", WEBAPP_CSS],
  ] as const)(
    "holds %s on the scale, but for the values other sizes derive",
    (file, css) => {
      expect(offScale(css)).toEqual([...DERIVED[file]].sort());
    },
  );

  it("counts a value on the scale as on it, and a stray one as off", () => {
    expect(offScale(".a { padding: 4px 10px; gap: 2px; }")).toEqual([]);
    expect(offScale(".a { margin: 0 7px; }")).toEqual([".a { margin: 0 7px }"]);
    expect(offScale(".a { padding: 0.4375rem; }")).toEqual([
      ".a { padding: 0.4375rem }",
    ]);
    expect(offScale(".a { gap: 0.5rem; }")).toEqual([]);
    // Past 48, a layout distance.
    expect(offScale(".a { padding-bottom: 96px; }")).toEqual([]);
  });
});
