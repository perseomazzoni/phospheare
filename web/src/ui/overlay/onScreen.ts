// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Keeping a floating thing on screen. A menu opened at the pointer, a tooltip
// under its control, a bubble over a selection and the ghost that follows a
// dragged row all hang off a point rather than sitting in the layout, and any
// of them can be asked to appear at the edge of the window.
//
// The rule: nothing is drawn closer than `MARGIN` to an edge, and a box that
// would overhang is pulled back rather than clipped or scrolled to. Pulled
// back rather than flipped: which side of the anchor something belongs on is
// the caller's decision (a tooltip flips above its control, a bubble below its
// selection). This only guarantees the result is visible.
//
// Pure arithmetic over numbers, tested in Node without a DOM: the caller
// measures, this decides.

/** How close to an edge anything may be drawn. */
export const MARGIN = 8;

export interface Box {
  width: number;
  height: number;
}

export interface Bounds {
  width: number;
  height: number;
}

/**
 * Where to draw a box of `size` that wants its top-left at `x, y`.
 *
 * `bounds` defaults to the window, which every caller wants except one drawing
 * inside a scroll container it must not escape.
 */
export function onScreen(
  x: number,
  y: number,
  size: Box,
  bounds: Bounds = viewport(),
): { left: number; top: number } {
  return {
    left: clamp(x, size.width, bounds.width),
    top: clamp(y, size.height, bounds.height),
  };
}

/** The same answer as CSS pixels, for a caller writing straight to `style`. */
export function onScreenPx(
  x: number,
  y: number,
  size: Box,
  bounds: Bounds = viewport(),
): { left: string; top: string } {
  const at = onScreen(x, y, size, bounds);
  return { left: `${at.left}px`, top: `${at.top}px` };
}

/**
 * A box wider than the space it has to fit in is pinned to the leading edge
 * rather than centred in the overflow: the start of a menu item is what a
 * reader needs, and the end is what they can live without.
 */
function clamp(at: number, extent: number, available: number): number {
  const max = available - extent - MARGIN;
  if (max <= MARGIN) return MARGIN;
  return Math.max(MARGIN, Math.min(at, max));
}

function viewport(): Bounds {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  return { width: window.innerWidth, height: window.innerHeight };
}
