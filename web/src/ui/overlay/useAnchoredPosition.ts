// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useLayoutEffect, useState, type RefObject } from "react";

// Hanging a panel from its trigger, shared by `Menu` and `Popover`, which are
// the same object with different contents: a panel portalled to `<body>`,
// positioned from the box of the button that opened it. One copy, so a fix to
// where a menu lands is a fix to where a popover lands.

export type AnchoredPlacement = "below-end" | "above-start" | "above-end";

export interface AnchoredPosition {
  top?: number;
  bottom?: number;
  left: number;
  width?: number;
  /**
   * The room between the trigger and the window's edge on the side the panel
   * opens to. A panel taller than that scrolls inside itself instead of
   * running off the screen, as the command menu does in a short window.
   */
  maxHeight: number;
}

/** Distance kept from the viewport edge, so a panel never opens offscreen. */
const EDGE = 8;

export function useAnchoredPosition(
  open: boolean,
  anchor: HTMLElement | null,
  panel: RefObject<HTMLElement | null>,
  placement: AnchoredPlacement,
): AnchoredPosition | null {
  const [at, setAt] = useState<AnchoredPosition | null>(null);

  // Before paint, or the panel shows for a frame at the top left corner. Fixed
  // coordinates, because it is portalled to `<body>` and a card inside a
  // scrolling shelf is not an ancestor it can be positioned against.
  useLayoutEffect(() => {
    if (!open || !anchor || !panel.current) return;
    const a = anchor.getBoundingClientRect();
    // The panel's laid-out size, not its drawn box: it grows in from 95%
    // (`uiMenuIn` in `base.css`), and on this first frame the drawn box is
    // the animation's, short of the size it settles at, which would set it
    // past its trigger's edge and the window's.
    const p = {
      width: panel.current.offsetWidth,
      height: panel.current.offsetHeight,
    };
    // "above-start" is the command palette's shape: over the field, aligned
    // with its left edge, and as wide as it, so the list reads as the field's
    // own contents rather than as a tooltip.
    //
    // "above-end" is the default flipped, for a trigger at the bottom of the
    // window: the default would be clamped by the viewport and land over the
    // button that opened it, which a panel must never cover.
    const above = placement !== "below-end";
    const startAligned = placement === "above-start";
    // Clamped to the top edge, so a downward panel taller than the room under
    // its trigger is not lifted off the top.
    const top = Math.max(
      EDGE,
      Math.min(a.bottom + 4, window.innerHeight - p.height - EDGE),
    );
    setAt({
      // Pinned by its bottom edge when it opens upwards, which takes its own
      // height out of the arithmetic. The height measured here is at the
      // panel's natural width, before this placement widens it to the
      // anchor's, and a position built from that height could overlap the
      // field.
      bottom: above ? window.innerHeight - a.top + 4 : undefined,
      top: above ? undefined : top,
      left: startAligned
        ? Math.max(EDGE, Math.min(a.left, window.innerWidth - p.width - EDGE))
        : // Right-aligned to the trigger, which is where an overflow button sits.
          Math.max(
            EDGE,
            Math.min(a.right - p.width, window.innerWidth - p.width - EDGE),
          ),
      // Applied as a minimum, after the height above was measured at the
      // panel's natural width. Only the palette wants it: a menu as wide as
      // the small button that opened it would be unreadable.
      width: startAligned ? a.width : undefined,
      maxHeight: Math.max(
        0,
        above ? a.top - 4 - EDGE : window.innerHeight - top - EDGE,
      ),
    });
  }, [open, anchor, placement, panel]);

  return at;
}

/**
 * The placement's style: `top` or `bottom`, never both, and hidden until
 * placed.
 */
export function anchoredStyle(
  at: AnchoredPosition | null,
): React.CSSProperties {
  return {
    // `top` is the default placement's, and `bottom` is how an upward panel
    // avoids depending on its own height.
    top: at?.bottom === undefined ? (at?.top ?? 0) : undefined,
    bottom: at?.bottom,
    left: at?.left ?? 0,
    minWidth: at?.width,
    maxHeight: at?.maxHeight,
    // Held out of sight rather than unmounted for the measuring pass: the
    // panel has to exist to be measured, and it must not flash at 0,0.
    visibility: at ? "visible" : "hidden",
  };
}
