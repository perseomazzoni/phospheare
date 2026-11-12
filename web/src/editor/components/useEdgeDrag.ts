// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useRef } from "react";
import { startDragSession, type DragSession } from "./dragSession";

// ── The edge drag ────────────────────────────────────────────────────────────
//
// The contract behind every panel that takes its width from an edge the
// writer drags: the dock's left edge, and the structure panel's right one.
// `useSplitDrag` owns a fraction of a measured box and its own state; this
// one is handed a width in pixels and never measures anything.
//
// The width is the start width plus the distance dragged, never read back
// off a box: jsdom measures nothing.
//
// ── One rule per input device ────────────────────────────────────────────────
//
// The pointer is spatial: it follows the edge it is holding, so dragging
// left grows a panel pinned to the right. That is what `side` decides, and
// all it decides.
//
// A focusable separator that takes arrow keys is a widget, and the
// window-splitter pattern says what it owes a writer who cannot see it: the
// value, the two ends of its travel, and what it moves. Without those it is
// reachable and unusable. `separatorProps` carries all four, for both edges.
//
// The keyboard is a magnitude, not a direction: ArrowRight means "more" and
// ArrowLeft "less" on either side, and Home/End are the floor and the cap.
// On the dock ArrowRight is "wider" too. Do not "fix" either device to match
// the other.

/** How far one arrow key moves an edge, the same for every grip. */
export const RESIZE_KEY_STEP = 24;

/**
 * How far past a detent the pointer travels before the edge lets go of it.
 * One arrow step, so the two devices feel the same stop: enough to be felt
 * as a stop, too little to be mistaken for the end of the travel.
 */
export const DETENT_PX = RESIZE_KEY_STEP;

/**
 * Where a width lands with a detent in its way. The pointer: a raw width in
 * the band `[detent, detent + DETENT_PX)` sits on the detent, and leaves it
 * once the pointer is through, so the edge jumps back under the pointer
 * rather than trailing it for the rest of the drag. The keyboard: a step
 * that crosses the detent stops on it, once; the next step goes on.
 */
export function withDetent(
  next: number,
  detent: number | null | undefined,
  from?: number,
): number {
  if (detent == null) return next;
  if (from === undefined)
    return next >= detent && next < detent + DETENT_PX ? detent : next;
  const lo = Math.min(from, next);
  const hi = Math.max(from, next);
  return detent > lo && detent < hi ? detent : next;
}

export interface EdgeDragOptions {
  /** The live width, in px. The hook is controlled: the caller renders it. */
  width: number;
  /** Which side of the window the panel is pinned to. Decides the pointer's
   *  sign, and nothing else. */
  side: "left" | "right";
  /** The single gate every drag, keystroke and loaded value passes through. */
  clamp: (width: number) => number;
  /** How far one arrow key moves the edge. */
  keyStep: number;
  /** The floor and the cap `clamp` saturates to, in px. Passed rather than
   *  inferred: `clamp` is a function, and a function cannot be asked where
   *  its ends are, but the writer at the keyboard has to be told. */
  min: number;
  max: number;
  /** A width the edge sticks at on its way through (`withDetent`), or none.
   *  The dock's: where it starts to cover the measure. */
  detent?: number | null;
  /** The `id` of the element this edge sizes. The one attribute that says the
   *  grip belongs to the panel rather than to the window. */
  controls: string;
  /** Every pointer move: the width the caller must render now. */
  onResize: (width: number) => void;
  /** Once, when a drag or a keystroke settles. The persistence seam. */
  onResizeEnd: (width: number) => void;
  /**
   * The drag is over without having settled: the panel unmounted with the
   * pointer still down. Not a width: nothing is persisted, and the caller's
   * job is only to stop believing a drag is in flight.
   *
   * The teardown must not commit and the caller must still be
   * told: a caller whose "resizing" state is entered by
   * `onResize` and left only by `onResizeEnd` would otherwise latch it,
   * freezing the transitions and the text selection the drag suppresses.
   */
  onResizeCancel?: () => void;
}

export function useEdgeDrag({
  width,
  side,
  clamp,
  keyStep,
  min,
  max,
  detent,
  controls,
  onResize,
  onResizeEnd,
  onResizeCancel,
}: EdgeDragOptions) {
  const dragRef = useRef<{
    startX: number;
    startWidth: number;
    /** The live width, tracked as the pointer moves. */
    width: number;
  } | null>(null);

  // The live drag's listeners, held so an unmount can take them off. A panel
  // that unmounts mid-drag (the plane flips, the writer's finger still down)
  // must leave nothing on `window`, and must not commit: a drag that never
  // ended is not a drag that ended somewhere.
  const sessionRef = useRef<DragSession | null>(null);
  // Held in a ref so the teardown can run once, on unmount, without listing a
  // callback that changes every render as a dependency.
  const cancelRef = useRef(onResizeCancel);
  cancelRef.current = onResizeCancel;
  useEffect(
    () => () => {
      if (!sessionRef.current) return;
      sessionRef.current.stop();
      sessionRef.current = null;
      dragRef.current = null;
      cancelRef.current?.();
    },
    [],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: width, width };
      const move = (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const travelled =
          side === "right"
            ? drag.startX - ev.clientX
            : ev.clientX - drag.startX;
        const next = clamp(withDetent(drag.startWidth + travelled, detent));
        drag.width = next;
        onResize(next);
      };
      sessionRef.current = startDragSession(move, () => {
        const drag = dragRef.current;
        // Flipped before the commit, so a late ending finds nothing to
        // commit twice.
        dragRef.current = null;
        sessionRef.current = null;
        if (drag) onResizeEnd(drag.width);
      });
    },
    [width, side, clamp, detent, onResize, onResizeEnd],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const to = (next: number) => {
        e.preventDefault();
        onResizeEnd(clamp(next));
      };
      // Arrows stop on the detent as they cross it; Home and End are the
      // floor and the cap, and go straight there.
      if (e.key === "ArrowLeft") to(withDetent(width - keyStep, detent, width));
      else if (e.key === "ArrowRight")
        to(withDetent(width + keyStep, detent, width));
      else if (e.key === "Home") to(-Infinity);
      else if (e.key === "End") to(Infinity);
    },
    [width, keyStep, clamp, detent, onResizeEnd],
  );

  return {
    onPointerDown,
    onKeyDown,
    /**
     * What makes the grip a grip, for both call sites at once. The label is
     * the caller's: it names which panel.
     *
     * The value is the live width, so it tracks the pointer through a drag
     * and not only the settled result: this hook is controlled, and `width`
     * is whatever the caller is rendering this frame. Rounded because a width
     * arrives from pointer arithmetic and "319.6" is not a number anyone was
     * offered: the writer moves in steps of `keyStep` and reads whole px.
     */
    separatorProps: {
      role: "separator",
      "aria-orientation": "vertical",
      tabIndex: 0,
      "aria-valuenow": Math.round(width),
      "aria-valuemin": min,
      "aria-valuemax": max,
      "aria-controls": controls,
    } as const,
  };
}
