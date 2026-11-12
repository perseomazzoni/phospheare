// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { visionPalette, visionTone, generate } from "./palette";

// Every colour the generator yields at 55 / 2 / 95. Vision's whole look is
// drawn from these, so a change to the formula that moves one of them moves
// the theme.

describe("Vision's palette at its dials", () => {
  it("once dark", () => {
    expect(visionPalette("light")).toEqual({
      sheet: "#F8F8F6",
      t1: "#1E1E1D",
      t2: "#3A3A39",
      t3: "#656563",
      t4: "#8A8988",
      prose: "#1E1E1D",
      hair: "rgba(30,30,29,0.123)",
      hairFirm: "rgba(30,30,29,0.215)",
      wash: "rgba(30,30,29,0.046)",
      spineB: "#ADACAB",
      gilt: "#D3AC41",
      spark: "#107C73",
      selection: "rgba(211,172,65,0.22)",
      find: "rgba(211,172,65,0.36)",
      crimson: "#A8203A",
      ember: "#A4481B",
      lift: "500",
      inkRgb: "30, 30, 29",
    });
  });

  it("still dark", () => {
    expect(visionPalette("dark")).toEqual({
      sheet: "#141312",
      t1: "#EEEDEC",
      t2: "#CCCCCA",
      t3: "#989896",
      t4: "#70706E",
      prose: "#DFDFDE",
      hair: "rgba(238,237,236,0.113)",
      hairFirm: "rgba(238,237,236,0.195)",
      wash: "rgba(238,237,236,0.046)",
      spineB: "#464645",
      gilt: "#E1B850",
      spark: "#7FCFC4",
      selection: "rgba(225,184,80,0.20)",
      find: "rgba(225,184,80,0.34)",
      crimson: "#E8808A",
      ember: "#E5925E",
      lift: "460",
      inkRgb: "238, 237, 236",
    });
  });
});

describe("the generator", () => {
  it("walks the top fifth of the dial into Total: no tint, a black night", () => {
    const total = generate("dark", 1, 0.02, 255);
    expect(total.sheet).toBe("#000000");
    expect(total.t1).toBe("#FFFFFF");
  });

  it("extrapolates along the palette's own line", () => {
    // The first ink's lightness on paper lands on the first ink.
    expect(visionTone(0.3 - 0.12 * 0.55)).toBe(visionPalette("light").t1);
    expect(visionTone(0)).toBe("#000000");
  });
});
