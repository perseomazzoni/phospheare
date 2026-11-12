// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The revision rail's pure seam: the wheel grammar and the rail's geometry,
// settled in Node so the stepping and the marker positions are pinned
// without a browser.
//
// One wheel notch is one step. Wheel-up (a negative delta) walks the
// timeline older, matching "oldest on top"; wheel-down walks back toward
// Now. A wheel-down at Now is a no-op, which the session enforces; the math
// only counts steps. A trackpad streams pixel deltas, so the paper's
// `LineRatchet` gears the rail too: a full line-height of travel is one
// step, and the leftover carries.
//
// Only the browser's measurement (the foot's real height, the surface's real
// span) feeds `measureRail`, `markerPosition` and `railGeometry`. Walked
// back, the marker is hollowed (the CSS ring), because the preview is never
// the head.

import { deltaToPixels, type LineRatchet } from "../views/writing/ratchet";

/** The hairline's inset left of the prose column's own edge. */
export const RAIL_INSET = 16;

/** How many steps a wheel event means, given a fresh or carried accumulator.
 * Returns negative steps for wheel-up (older). */
export function wheelSteps(
  ratchet: LineRatchet,
  deltaY: number,
  deltaMode: number,
): number {
  return ratchet.feed(deltaToPixels(deltaY, deltaMode, 1), 1);
}

export interface RailMeasure {
  /** The hairline's distance from the shell's left edge, in shell coords. */
  left: number;
  /** The rail's distance from the shell's top: the surface's own top. */
  top: number;
  /** The visible rail span: the surface's own height. */
  height: number;
}

/** The rail's span inside the surface: a theme whose page is a face inside
 * the scroller (`--rail-inset-top`, `--rail-inset-bottom`) keeps the rail
 * on it. */
export interface RailInset {
  top: number;
  bottom: number;
}

/** Measure the rail against the `.editor-shell`, its containing block. The
 * prose column is flex-centred behind the panel's own padding, so the
 * paper's left edge is a measured offset, never a constant, as for the save
 * gutter's marks. */
export function measureRail(
  shell: HTMLElement,
  surface: HTMLElement,
  editor: HTMLElement,
  inset: RailInset = { top: 0, bottom: 0 },
): RailMeasure {
  const shellRect = shell.getBoundingClientRect();
  const surfaceRect = surface.getBoundingClientRect();
  const editorRect = editor.getBoundingClientRect();
  return {
    left: editorRect.left - shellRect.left - RAIL_INSET,
    top: surfaceRect.top - shellRect.top + inset.top,
    height: surfaceRect.height - inset.top - inset.bottom,
  };
}

/**
 * The marker's position along the rail as a ratio from the top: 0 at the
 * oldest step, 1 at Now, the rail's bottom. The preview walk at depth
 * `walkDepth` sits the marker `walkDepth` steps back from Now: the walk's
 * own position, never the engine's head, which stays at the tip the whole
 * walk. A timeline with a single state sits the marker at the rail's end,
 * Now with nothing behind it.
 */
export function markerPosition(walkDepth: number, undoDepth: number): number {
  if (undoDepth <= 0) return 1;
  return Math.min(Math.max((undoDepth - walkDepth) / undoDepth, 0), 1);
}

/** The band's two 7px air gaps, under the rail's end and under the chip. */
export const RAIL_GAP = 7;

/** The smallest rail span that stays grabbable, so a very short surface
 * never collapses the rail into a nub the marker cannot ride. */
export const RAIL_MIN = 40;

/** The rail's span and the foot column's seat. The foot column (the
 * "Now" label and the chip) is `footH` tall; the rail ends `RAIL_GAP` above
 * it, and the chip's bottom rests `RAIL_GAP` above the surface's bottom
 * edge. The band is the foot plus the two gaps, so the marker and the chip
 * never share an axis segment and the walk spans the whole rail with no
 * dead zone. */
export interface RailGeometry {
  /** The rail's visible span, in shell coordinates. */
  railHeight: number;
  /** The foot column's top, `RAIL_GAP` under the rail's end. */
  footTop: number;
}

export function railGeometry(
  measure: RailMeasure,
  footH: number,
): RailGeometry {
  const railHeight = Math.max(measure.height - footH - 2 * RAIL_GAP, RAIL_MIN);
  return { railHeight, footTop: measure.top + railHeight + RAIL_GAP };
}
