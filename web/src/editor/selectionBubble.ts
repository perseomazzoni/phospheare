// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { onScreen } from "../ui/overlay/onScreen";

// Where the bubble that points at a selection goes. The arithmetic is kept
// away from the DOM because every interesting case is a position near an
// edge.
//
// The box is clamped, the tail is not. `tail` is measured from the bubble's
// left edge after clamping, so the point stays on the selection however far
// the box moved.
//
// The bubble sits above the selection unless above is behind the titlebar and
// the bar, where the writer cannot click it. Below is only the fallback,
// because a bubble under a selection covers the line the writer reads next.

/** Between the selection and the bubble's near edge. */
const GAP = 9;

/**
 * How much room the chrome needs at the top, in pixels. The titlebar is 40
 * tall and the bar starts at 40; this clears the titlebar, which is what a
 * bubble over a Section's opening line runs into.
 */
const CLEARANCE = 46;

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Placement {
  /** Both in the host's coordinate space, where the bubble is positioned. */
  left: number;
  top: number;
  /** The selection's centre, from the bubble's left edge. Drives `--tail`. */
  tail: number;
  /** Flipped under the selection because above was behind the chrome. */
  below: boolean;
}

/** How near the bubble's ends its tail may come: its 6px half and 6 more. */
const TAIL_INSET = 12;

export function placeBubble(
  selection: Rect,
  host: Rect,
  box: { width: number; height: number },
  page?: { left: number; right: number },
): Placement {
  const centre = selection.left + selection.width / 2 - host.left;

  const above = selection.top - host.top - box.height - GAP;
  const below = above < CLEARANCE;
  const wanted = below ? selection.bottom - host.top + GAP : above;

  const at = onScreen(centre - box.width / 2, wanted, box, {
    width: host.width,
    height: host.height,
  });

  // Kept on the page, in window coordinates, where it has the room: the
  // panel and the Dock stand over the page, and a bubble under either loses
  // its end commands.
  let left = at.left;
  if (page && page.right - page.left >= box.width) {
    const min = page.left - host.left;
    const max = page.right - host.left - box.width;
    left = Math.min(Math.max(left, min), max);
  }

  // The tail points at the selection while it can, and stays on the bubble
  // when the bubble is held off it. An unmeasured bubble has no ends.
  const tail =
    box.width < 2 * TAIL_INSET
      ? centre - left
      : Math.min(Math.max(centre - left, TAIL_INSET), box.width - TAIL_INSET);
  return { left, top: at.top, tail, below };
}
