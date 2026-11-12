// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { startDragSession, type DragSession } from "./dragSession";

// The vertical split divider: the one contract behind every dock face that
// splits top and bottom. A pointer drag tracks the live fraction as the
// pointer moves, and the keyboard steps it (ArrowUp and ArrowDown) or sends
// it to a bound (Home and End). The pointer and the keyboard share the
// clamp, so the divider never leaves the bounds.
//
// `onCommit` is the persistence seam; a face with nothing to persist omits
// it. `external` drives the split from outside when a persisted preference
// arrives after mount.

export interface SplitDragOptions {
  /** The split when nothing else has set it. */
  default: number;
  min: number;
  max: number;
  /** How far one arrow key moves the divider. */
  keyStep: number;
  /** Called with the settled fraction when a drag or a keyboard step ends. */
  onCommit?: (split: number) => void;
  /**
   * An external value that drives the split when it changes (a persisted
   * preference loaded after mount).
   */
  external?: number | null;
}

/**
 * The two content faces' shared bounds: reference and notes split the same
 * way, so a bounds change lands in one place. The snapshot face keeps its
 * own, because its resting third differs.
 */
export const FACE_SPLIT_OPTIONS = {
  default: 0.38,
  min: 0.2,
  max: 0.6,
  keyStep: 0.04,
} as const;

function clampSplit(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The split as the top half's height, in whole percents. */
export function splitHeight(split: number): string {
  return `${Math.round(split * 100)}%`;
}

export function useSplitDrag({
  default: defaultSplit,
  min,
  max,
  keyStep,
  onCommit,
  external = null,
}: SplitDragOptions) {
  const [split, setSplit] = useState(() =>
    clampSplit(external ?? defaultSplit, min, max),
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startY: number;
    startSplit: number;
    /** The live fraction, tracked as the pointer moves. */
    latest: number;
  } | null>(null);

  // The live drag's listeners, held so an unmount can take them off. A divider
  // that unmounts mid-drag (the face closes, the plane flips) must leave
  // nothing on `window`, and must not commit: a drag that never ended is not a
  // drag that ended somewhere.
  const sessionRef = useRef<DragSession | null>(null);
  useEffect(() => () => sessionRef.current?.stop(), []);

  useEffect(() => {
    if (external !== null) setSplit(clampSplit(external, min, max));
  }, [external, min, max]);

  const beginSplitDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const box = panelRef.current?.getBoundingClientRect();
      if (!box || box.height === 0) return;
      dragRef.current = {
        startY: e.clientY,
        startSplit: split,
        latest: split,
      };
      const move = (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        // The divider follows the pointer: dragging up moves it up (the top
        // shrinks). The sign is `clientY - startY` so a downward drag grows
        // the split, the same direction the keyboard's ArrowDown steps.
        const next = clampSplit(
          drag.startSplit + (ev.clientY - drag.startY) / box.height,
          min,
          max,
        );
        drag.latest = next;
        setSplit(next);
      };
      sessionRef.current = startDragSession(move, () => {
        const drag = dragRef.current;
        // Flipped before the commit, so a late ending finds nothing to
        // commit twice.
        dragRef.current = null;
        sessionRef.current = null;
        if (drag) onCommit?.(clampSplit(drag.latest, min, max));
      });
    },
    [split, min, max, onCommit],
  );

  const stepSplit = useCallback(
    (delta: number) => {
      const next = clampSplit(split + delta, min, max);
      setSplit(next);
      onCommit?.(next);
    },
    [split, min, max, onCommit],
  );

  const setSplitTo = useCallback(
    (value: number) => {
      const next = clampSplit(value, min, max);
      setSplit(next);
      onCommit?.(next);
    },
    [min, max, onCommit],
  );

  const onSplitKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        stepSplit(-keyStep);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        stepSplit(keyStep);
      } else if (e.key === "Home") {
        e.preventDefault();
        setSplitTo(min);
      } else if (e.key === "End") {
        e.preventDefault();
        setSplitTo(max);
      }
    },
    [keyStep, stepSplit, setSplitTo, min, max],
  );

  return {
    /** The fraction 0..1: the top pane's share of the face's height. */
    split,
    /** The face element the drag measures. */
    panelRef,
    beginSplitDrag,
    stepSplit,
    onSplitKeyDown,
  };
}
