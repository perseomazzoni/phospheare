// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { hex, oklchToRgb } from "./oklch";

describe("oklch to srgb", () => {
  it("clips out-of-gamut colours rather than wrapping them", () => {
    expect(oklchToRgb(1, 0, 0)).toEqual([255, 255, 255]);
    expect(oklchToRgb(0, 0, 0)).toEqual([0, 0, 0]);
    expect(oklchToRgb(0.7, 0.4, 30).every((v) => v >= 0 && v <= 255)).toBe(
      true,
    );
  });

  it("spells bytes as upper-case hex", () => {
    expect(hex([14, 110, 115])).toBe("#0E6E73");
  });
});
