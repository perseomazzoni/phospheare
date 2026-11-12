// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { MARGIN, onScreen, onScreenPx } from "./onScreen";

// Pure arithmetic, so it runs in Node: the caller measures, `onScreen` decides.

const BOUNDS = { width: 1000, height: 800 };
const BOX = { width: 140, height: 62 };

describe("onScreen", () => {
  it("leaves a box that already fits exactly where it was asked for", () => {
    expect(onScreen(300, 200, BOX, BOUNDS)).toEqual({ left: 300, top: 200 });
  });

  it("pulls a box back from the trailing edge rather than letting it overhang", () => {
    // 980 + 140 would end 120px past the right edge.
    expect(onScreen(980, 200, BOX, BOUNDS).left).toBe(1000 - 140 - MARGIN);
  });

  it("pulls a box down from the top edge", () => {
    expect(onScreen(300, -40, BOX, BOUNDS).top).toBe(MARGIN);
  });

  it("pulls a box up from the bottom edge", () => {
    expect(onScreen(300, 790, BOX, BOUNDS).top).toBe(800 - 62 - MARGIN);
  });

  it("clamps both axes at once", () => {
    expect(onScreen(9999, 9999, BOX, BOUNDS)).toEqual({
      left: 1000 - 140 - MARGIN,
      top: 800 - 62 - MARGIN,
    });
  });

  // A menu item's start is what a reader needs and its end is what they can
  // spare, so a box with nowhere to fit is pinned to the leading edge rather
  // than centred in its own overflow.
  it("pins a box wider than its bounds to the leading edge", () => {
    const wide = { width: 2000, height: 62 };
    expect(onScreen(400, 100, wide, BOUNDS).left).toBe(MARGIN);
  });

  it("answers in CSS pixels when asked to", () => {
    expect(onScreenPx(9999, 10, BOX, BOUNDS)).toEqual({
      left: `${1000 - 140 - MARGIN}px`,
      top: "10px",
    });
  });

  // With no DOM the default bounds are zero, which still yields a number
  // rather than `NaN` in a style attribute.
  it("survives being asked without a window", () => {
    const at = onScreen(100, 100, BOX);
    expect(Number.isFinite(at.left)).toBe(true);
    expect(Number.isFinite(at.top)).toBe(true);
  });
});
