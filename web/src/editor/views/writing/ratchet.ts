// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The ratchet: the typewriter's wheel steps the page one visual line per
// notch. This is the arithmetic that turns a wheel or touch delta into whole
// lines.
//
// - A mouse wheel reports notches in `deltaMode === 'line'` with a magnitude
//   set by the OS (Chromium sends ±3 per notch), so a line-mode event is one
//   line whatever magnitude it carries.
// - A trackpad reports small pixel deltas; the fraction of a line carries to
//   the next event.

/** `WheelEvent.deltaMode`, as literals so the module needs no DOM types. */
export const DELTA_MODE_PIXEL = 0;
export const DELTA_MODE_LINE = 1;
export const DELTA_MODE_PAGE = 2;

/**
 * Normalize one wheel delta to pixels. Line and page modes are a notch: one
 * line in the sign's direction. Pixel mode passes through untouched.
 */
export function deltaToPixels(
  deltaY: number,
  deltaMode: number,
  lineHeight: number,
): number {
  switch (deltaMode) {
    case DELTA_MODE_LINE:
    case DELTA_MODE_PAGE:
      return Math.sign(deltaY) * lineHeight;
    default:
      return deltaY;
  }
}

/**
 * `feed` takes a normalized pixel delta and returns the number of whole
 * line-heights it crossed (positive down, negative up), carrying any
 * fraction of a line to the next event.
 */
export class LineRatchet {
  private remainder = 0;

  feed(deltaPx: number, lineHeight: number): number {
    if (!Number.isFinite(deltaPx) || lineHeight <= 0) return 0;
    this.remainder += deltaPx;
    // `|| 0` folds the `-0` that `Math.trunc` yields for a negative sub-line
    // fraction.
    const steps = Math.trunc(this.remainder / lineHeight) || 0;
    if (steps !== 0) this.remainder -= steps * lineHeight;
    return steps;
  }

  /**
   * Drop the carried fraction, when the line height changes: the leftover is
   * in the old size's pixels.
   */
  reset(): void {
    this.remainder = 0;
  }
}
