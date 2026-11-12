// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
// Reads the source rather than rendering it, so the suite runs in Node.
// TypeScript already proves every name has a glyph; these rows pin the rules
// every glyph obeys so the set works as a set, as `theme/contract.test.ts`
// does for the stylesheets.
import SOURCE from "./icons.tsx?raw";
import { ICON_NAMES } from "./icons";
import { appIcons } from "./appIcons";

/** The source with its comments removed, so prose cannot trip these checks. */
const code = SOURCE.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the icon set", () => {
  it("draws every glyph on the same grid", () => {
    // One grid for every glyph.
    expect([...code.matchAll(/viewBox="([^"]*)"/g)].map((m) => m[1])).toEqual([
      "0 0 24 24",
    ]);
    expect(code).not.toMatch(/viewBox=\{/);
  });

  it("takes its colour from the text around it", () => {
    // A hardcoded colour breaks the glyph under another theme, unnoticed until
    // someone opens the screen that uses it.
    const hexes = [...code.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    expect(hexes).toEqual([]);

    const named = [
      ...code.matchAll(
        /\b(?:fill|stroke)="(?!none|currentColor|var\()([^"]+)"/g,
      ),
    ];
    expect(named.map((m) => m[0])).toEqual([]);
  });

  it("never draws a glyph out of a font", () => {
    // SVG `<text>` renders unevenly at 14px and is a shape only once a font
    // has loaded.
    expect(code).not.toMatch(/<text[\s>]/);
  });

  it("offers the seven glyphs no library has", () => {
    // These glyphs are why the set is a local module rather than a dependency.
    for (const name of [
      "mark",
      "part",
      "section",
      "golden",
      "disk",
      "drive",
      "custody",
    ]) {
      expect(ICON_NAMES).toContain(name);
    }
  });

  it("keeps the timeline buttons on their own glyphs", () => {
    // The snapshot button is the camera, a moment kept; the history button is
    // the clock, a step taken. The clock glyph is named `snapshot` in the set,
    // because `history` names the feature, not the drawing.
    expect(appIcons.snapshot).toBe("camera");
    expect(appIcons.history).toBe("snapshot");
  });

  it("keeps the kind glyph off any vendor's mark", () => {
    // `remote` is the other half of `local`: it draws the kind, not a backend.
    // `drive` is a vendor's own mark, so the kind glyph stays the same
    // when a second remote provider registers.
    expect(appIcons.remote).not.toBe(appIcons.drive);
    expect(appIcons.remote).not.toBe(appIcons.driveOff);
    expect(appIcons.remote).not.toBe(appIcons.local);
  });

  it("keeps every rect and circle inside the grid", () => {
    // A shape that strays past 24 is clipped on one screen and off-centre on
    // another.
    //
    // Only the geometry attributes, which are always absolute. The numbers in
    // `d=""` are not comparable, because relative commands carry deltas, and
    // telling the two apart needs a path parser this guard does not justify.
    //
    // Each shape's extent is checked, not each number alone, so a rect that
    // starts inside and runs past the edge fails, and so does a negative
    // value or one that is not a plain number.
    const shapes = [...code.matchAll(/<(rect|circle)\b([^>]*)>/g)];
    expect(shapes.length).toBeGreaterThan(0);
    const strayed = shapes.flatMap(([tag, kind, attrs]) => {
      const num = (name: string, absent = Number.NaN) => {
        const found = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
        return found ? Number(found[1]) : absent;
      };
      const [left, top, right, bottom] =
        kind === "rect"
          ? [
              num("x", 0),
              num("y", 0),
              num("x", 0) + num("width"),
              num("y", 0) + num("height"),
            ]
          : [
              num("cx") - num("r"),
              num("cy") - num("r"),
              num("cx") + num("r"),
              num("cy") + num("r"),
            ];
      const inside = [left, top, right, bottom].every(
        (edge) => Number.isFinite(edge) && edge >= 0 && edge <= 24,
      );
      return inside ? [] : [tag];
    });
    expect(strayed).toEqual([]);
  });

  // `/verify`'s fourth verdict: four equal dashes and gaps, a dash centred on
  // each cardinal; twelve read as a spinner at 12px. The wrapper draws
  // round caps, and a round cap at stroke 3 adds 1.5 to each end of every
  // dash, closing the gaps toward the plain ring of the "implausible" verdict.
  // The entry's own butt cap keeps the two verdicts apart.
  it("cuts the unsettled ring with butt caps and four equal dashes", () => {
    const entry = /dashedRing: \(([\s\S]*?)\),\n/.exec(code)?.[1] ?? "";
    expect(entry).toMatch(/strokeLinecap="butt"/);
    const radius = Number(/ r="([\d.]+)"/.exec(entry)?.[1]);
    const dash = Number(/strokeDasharray="([\d.]+)"/.exec(entry)?.[1]);
    const offset = Number(/strokeDashoffset=\{([\d.]+)\}/.exec(entry)?.[1]);
    expect(dash).toBeCloseTo((2 * Math.PI * radius) / 8, 3);
    expect(offset).toBeCloseTo(0.5 * dash, 3);
  });

  it("draws each verdict as a degree, and can't-tell apart from implausible", () => {
    expect([
      appIcons.verdictPlausible,
      appIcons.verdictDoubtful,
      appIcons.verdictImplausible,
      appIcons.verdictUnsettled,
    ]).toEqual(["disc", "halfDisc", "ring", "dashedRing"]);
    // The same family as `/map`'s marks, so one verdict reads one way.
    expect(appIcons.verdictPlausible).toBe(appIcons.fitFull);
    expect(appIcons.verdictImplausible).toBe(appIcons.fitNone);
  });
});
