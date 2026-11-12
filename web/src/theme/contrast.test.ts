// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  contrast,
  MARK_PAIRS,
  parseColor,
  resolve,
  TEXT_PAIRS,
} from "./domain/contrast";
import { allThemes } from "./application/registry";
import "./index";

// Every shipped theme's inks on the grounds they are set on, held to WCAG 2:
// text at 4.5:1 (1.4.3), the focus ring and a control's mark at 3:1 (1.4.11).
// A theme's own tokens resolve too: an ink may be drawn from them.

describe("contrast", () => {
  it("measures black on white at 21:1, a half-black ink on white lower", () => {
    const tokens = {
      "--paper": "#fff",
      "--ink": "#000",
      "--half": "rgba(0, 0, 0, 0.5)",
      "--mixed": "color-mix(in srgb, #000 50%, transparent)",
    };
    expect(contrast(tokens, "--ink", "--paper")).toBeCloseTo(21, 5);
    expect(contrast(tokens, "--half", "--paper")).toBeCloseTo(3.95, 1);
    expect(contrast(tokens, "--mixed", "--paper")).toBeCloseTo(3.95, 1);
  });

  it("judges no value it cannot read whole by the first colour in it", () => {
    for (const value of [
      "color-mix(in srgb, #000 50%, #fff)",
      "linear-gradient(#000, #fff)",
      "light-dark(#000, #fff)",
      "#000 #fff",
    ])
      expect(parseColor(value), value).toBeNull();
  });

  it("follows a var() to its fallback only when the name is not stated", () => {
    const tokens = { "--a": "#111", "--b": "var(--a, #222)" };
    expect(resolve(tokens, "var(--b)")).toBe("#111");
    expect(resolve(tokens, "var(--typo, #222)")).toBe("#222");
    expect(resolve(tokens, "var(--typo)")).toBeNull();
    expect(resolve({ "--x": "var(--x)" }, "var(--x)")).toBeNull();
  });

  it("is run over the shipped themes", () => {
    expect(allThemes().length).toBeGreaterThanOrEqual(8);
  });
});

describe.each(
  allThemes().map((t) => [t.id, { ...t.own, ...t.tokens }] as const),
)("%s", (_id, tokens) => {
  it.each(TEXT_PAIRS)("sets %s on %s at 4.5:1", (ink, ground) => {
    const ratio = contrast(tokens, ink, ground);
    expect(ratio, "a colour this test cannot read").not.toBeNull();
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it.each(MARK_PAIRS)("draws %s on %s at 3:1", (ink, ground) => {
    expect(contrast(tokens, ink, ground)).toBeGreaterThanOrEqual(3);
  });
});
