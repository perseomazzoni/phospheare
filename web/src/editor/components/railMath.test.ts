// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { LineRatchet } from "../views/writing/ratchet";
import {
  markerPosition,
  measureRail,
  railGeometry,
  RAIL_GAP,
  RAIL_MIN,
  wheelSteps,
} from "./railMath";

// The revision rail's arithmetic: the wheel grammar (one notch, one step;
// wheel-up walks older) and the geometry (the measured margin offset, the
// head marker's ratio along the walk, the foot band's span and seat).
// Everything here is numbers — the wiring is the component's tests.

describe("wheelSteps", () => {
  it("a line-mode notch is exactly one step, whatever magnitude the OS attached", () => {
    const ratchet = new LineRatchet();
    expect(wheelSteps(ratchet, -3, 1)).toBe(-1); // wheel-up: older
    expect(wheelSteps(ratchet, 3, 1)).toBe(1); // wheel-down: newer
  });

  it("a page-mode notch is one step too", () => {
    const ratchet = new LineRatchet();
    expect(wheelSteps(ratchet, -120, 2)).toBe(-1);
    expect(wheelSteps(ratchet, 120, 2)).toBe(1);
  });

  it("a trackpad accumulates pixel deltas into whole steps, carrying the leftover", () => {
    const ratchet = new LineRatchet();
    // Halves are exact in binary — the accumulation test must not trip over
    // the floating point that real trackpad deltas bring.
    expect(wheelSteps(ratchet, 0.5, 0)).toBe(0);
    expect(wheelSteps(ratchet, 0.5, 0)).toBe(1); // one full line crossed
    expect(wheelSteps(ratchet, 0.5, 0)).toBe(0);
    expect(wheelSteps(ratchet, 0.5, 0)).toBe(1);
    expect(wheelSteps(ratchet, -1.5, 0)).toBe(-1); // over-shoot carries
    expect(wheelSteps(ratchet, -0.5, 0)).toBe(-1); // leftover completes a line
  });

  it("a fresh ratchet per session keeps bursts from leaking across walks", () => {
    const a = new LineRatchet();
    const b = new LineRatchet();
    expect(wheelSteps(a, 0.7, 0)).toBe(0);
    expect(wheelSteps(b, 0.7, 0)).toBe(0);
    expect(wheelSteps(a, 0.7, 0)).toBe(1);
    expect(wheelSteps(b, 0.7, 0)).toBe(1);
  });
});

describe("markerPosition", () => {
  it("sits the marker at the rail's end on a fresh timeline — Now, nothing behind", () => {
    expect(markerPosition(0, 0)).toBe(1);
  });

  it("tracks the preview walk: deeper walks ride higher, Now rests at the rail's end", () => {
    expect(markerPosition(3, 3)).toBe(0); // walked to the root — oldest
    expect(markerPosition(2, 3)).toBeCloseTo(1 / 3);
    expect(markerPosition(1, 3)).toBeCloseTo(2 / 3);
    expect(markerPosition(0, 3)).toBe(1); // at Now — the rail's bottom
  });

  it("never exceeds the rail's end, never dips below the root", () => {
    expect(markerPosition(Number.MAX_SAFE_INTEGER, 0)).toBeLessThanOrEqual(1);
    expect(markerPosition(Number.MAX_SAFE_INTEGER, 0)).toBeGreaterThan(0.99);
    expect(markerPosition(Number.MAX_SAFE_INTEGER, 5)).toBe(0);
  });
});

describe("measureRail", () => {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({
      left,
      top,
      width,
      height,
    }) as DOMRect;

  const shell = {
    getBoundingClientRect: () => rect(100, 50, 800, 600),
  } as unknown as HTMLElement;
  const surface = {
    getBoundingClientRect: () => rect(100, 80, 800, 560),
  } as unknown as HTMLElement;
  const editor = {
    getBoundingClientRect: () => rect(300, 80, 500, 500),
  } as unknown as HTMLElement;

  it("measures the margin offset from the shell, never assumes it", () => {
    const m = measureRail(shell, surface, editor);
    expect(m.left).toBe(300 - 100 - 16);
    expect(m.top).toBe(80 - 50);
    expect(m.height).toBe(560);
  });

  it("keeps to a theme's face inside the surface", () => {
    const m = measureRail(shell, surface, editor, { top: 50, bottom: 18 });
    expect(m.top).toBe(80 - 50 + 50);
    expect(m.height).toBe(560 - 50 - 18);
  });
});

describe("railGeometry", () => {
  // The rail's rhythm: the rail ends in `RAIL_GAP` of open air over
  // the foot and the chip rests `RAIL_GAP` above the surface's bottom —
  // the band is the foot plus the two gaps, so the marker and the chip never
  // share an axis segment and the walk spans the whole rail with zero dead
  // zone. The unit test pins the numbers the e2e asserts as real boxes.
  const measure = { left: 100, top: 40, height: 560 };

  it("ends the rail 7px over the foot and seats the foot 7px under it", () => {
    const g = railGeometry(measure, 56);
    // band = 56 + 14; the rail spans what remains, the foot sits a gap below.
    expect(g.railHeight).toBe(560 - 56 - 2 * RAIL_GAP);
    expect(g.footTop).toBe(40 + g.railHeight + RAIL_GAP);
    // And the chip's seat follows from the same rhythm: its bottom rests
    // `RAIL_GAP` above the surface's bottom edge.
    expect(g.footTop + 56).toBe(40 + 560 - RAIL_GAP);
  });

  it("shrinks the rail with the foot — the band is the foot plus the two gaps", () => {
    const g = railGeometry(measure, 200);
    expect(g.railHeight).toBe(560 - 200 - 2 * RAIL_GAP);
    expect(g.footTop).toBe(40 + g.railHeight + RAIL_GAP);
  });

  it("never collapses the rail below its grabbable floor", () => {
    const g = railGeometry({ left: 100, top: 40, height: 30 }, 56);
    expect(g.railHeight).toBe(RAIL_MIN);
    // The foot still sits a gap under the floored rail — the rail and the
    // chip keep their air even when the surface cannot hold the full band.
    expect(g.footTop).toBe(40 + RAIL_MIN + RAIL_GAP);
  });

  it("keeps the floor even on a degenerate zero-height surface", () => {
    const g = railGeometry({ left: 100, top: 40, height: 0 }, 56);
    expect(g.railHeight).toBe(RAIL_MIN);
    expect(g.footTop).toBe(40 + RAIL_MIN + RAIL_GAP);
  });
});
