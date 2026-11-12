// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { radiantPalette } from "./palette";

// Pins Radiant's palette value for value, and the four text tiers' WCAG 2
// ratios on the sheet.

/** WCAG 2 relative luminance of `#RRGGBB`. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe("Radiant's palette", () => {
  it("sets the sheet on a neutral desk on paper", () => {
    expect(radiantPalette("light")).toEqual({
      canvas: "#F5F6F7",
      sheet: "#FFFFFF",
      raised: "#FFFFFF",
      sheetEdge: "rgba(29,33,38,0.09)",
      contact: "0 1px 2px rgba(29,33,38,0.04)",
      t1: "#1D2126",
      t2: "#3E444C",
      t3: "#5E636B",
      t4: "#868B93",
      prose: "#1D2126",
      hair: "rgba(29,33,38,0.1)",
      hairFirm: "rgba(29,33,38,0.16)",
      wash: "rgba(29,33,38,0.05)",
      rowSel: "rgba(29,33,38,0.07)",
      pressed: "rgba(29,33,38,0.09)",
      onPrimary: "#FFFFFF",
      spineA: "#3E444C",
      spineB: "#B4B8BE",
      spinePlan: "rgba(29,33,38,0.07)",
      cardActive: "rgba(29,33,38,0.3)",
      lifted: "0 6px 20px rgba(29,33,38,0.07), 0 1px 2px rgba(29,33,38,0.05)",
      spark: "#0E6E73",
      selection: "rgba(14,110,115,0.16)",
      find: "rgba(14,110,115,0.26)",
      crimson: "#A8203A",
      ember: "#8F5A14",
      inkRgb: "29, 33, 38",
    });
  });

  it("sets the sheet a step above the desk on the night", () => {
    expect(radiantPalette("dark")).toEqual({
      canvas: "#08090B",
      sheet: "#0E1013",
      raised: "#16171A",
      sheetEdge: "rgba(247,248,248,0.07)",
      contact: "none",
      t1: "#F7F8F8",
      t2: "#D0D6E0",
      t3: "#8A8F98",
      t4: "#62666D",
      prose: "#D9DDE3",
      hair: "rgba(247,248,248,0.07)",
      hairFirm: "rgba(247,248,248,0.11)",
      wash: "rgba(247,248,248,0.04)",
      rowSel: "rgba(247,248,248,0.07)",
      pressed: "rgba(247,248,248,0.1)",
      onPrimary: "#08090B",
      spineA: "#D0D6E0",
      spineB: "#4A4F57",
      spinePlan: "rgba(247,248,248,0.06)",
      cardActive: "rgba(247,248,248,0.28)",
      lifted: "0 16px 40px rgba(0,0,0,0.5)",
      spark: "#3BE8E5",
      selection: "rgba(59,232,229,0.20)",
      find: "rgba(59,232,229,0.32)",
      crimson: "#E8808A",
      ember: "#D8B36E",
      inkRgb: "247, 248, 248",
    });
  });

  it.each([
    ["light", [16.2, 9.8, 6.0, 3.4]],
    ["dark", [17.9, 13, 5.9, 3.3]],
  ] as const)(
    "sets four text tiers with no cliff between them (%s)",
    (scheme, want) => {
      const p = radiantPalette(scheme);
      const got = [p.t1, p.t2, p.t3, p.t4].map((t) =>
        Number(ratio(t, p.sheet).toFixed(1)),
      );
      expect(got).toEqual(want);
    },
  );

  it.each(["light", "dark"] as const)(
    "holds the third ink to 4.5:1 on the strongest wash over the desk (%s)",
    (scheme) => {
      const p = radiantPalette(scheme);
      const alpha = Number(p.pressed.match(/[\d.]+(?=\))/)?.[0]);
      const ink = parseInt(p.t1.slice(1), 16);
      const desk = parseInt(p.canvas.slice(1), 16);
      const ground =
        "#" +
        [16, 8, 0]
          .map((shift) => {
            const a = (ink >> shift) & 255;
            const b = (desk >> shift) & 255;
            return Math.round(a * alpha + b * (1 - alpha))
              .toString(16)
              .padStart(2, "0");
          })
          .join("");
      expect(ratio(p.t3, ground)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("keeps the night's prose under its first ink, near 14:1", () => {
    const p = radiantPalette("dark");
    expect(ratio(p.prose, p.sheet)).toBeLessThan(ratio(p.t1, p.sheet));
    expect(ratio(p.prose, p.sheet)).toBeCloseTo(14.0, 1);
  });

  it("puts the night's sheet and raised surfaces above the desk", () => {
    const p = radiantPalette("dark");
    expect(luminance(p.sheet)).toBeGreaterThan(luminance(p.canvas));
    expect(luminance(p.raised)).toBeGreaterThan(luminance(p.sheet));
  });
});
