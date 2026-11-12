// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  flattenRows,
  isNoOp,
  pickSlot,
  slotsForGap,
  type Slot,
} from "./dropTarget";
import { FOLDED } from "./useTreegrid";
import { findNode } from "../../project/structure";
import type { DocNode, DocumentStructure, NodeKind } from "../../project/types";

// The drag gesture. Pointer events rather than HTML5 drag-and-drop: dragover
// fires unreliably over the panel's height-animated rows, and the browser's
// drag image cannot be made to match the glass. A drag starts only from a
// mouse.
//
// Where the line goes is decided in `dropTarget.ts`, which has no DOM; this
// file turns pointer movement into that module's inputs.
//
// Two sources share the gesture. A tree drag moves a node within the
// document, and may end on the bin, which arms it as a delete target. A bin
// drag is a restore: the dragged node is not in the structure, so legality is
// `canRestore`, and dropping on the tree puts it back at that slot.
//
// A tree drag may carry a group: the writer's selection, when the grabbed row
// is one of the ticked ones. The panel decides that and hands the ids in.
// They change three things: every slot must take the whole group
// (`canDropAll`), the panel names them on the ghost (`draggingIds`), and the
// bin does not arm, because this gesture does not remove several nodes at
// once.

/** Movement before a press becomes a drag, in px. */
const THRESHOLD = 4;
/** How long a collapsed Part must be hovered before it springs open. */
const SPRING_MS = 600;
/** Distance from an edge of the scroll area at which auto-scrolling starts. */
const EDGE = 28;
const SCROLL_STEP = 8;
/** Long enough for the expand animation in editor.css to settle. */
const EXPAND_MS = 340;

export interface DragGhost {
  title: string;
  kind: NodeKind;
  x: number;
  y: number;
}

export interface DragIndicator {
  /** Offset from the top of the scrolling content, in px. */
  top: number;
  /** Nesting level of the destination — becomes the line's left inset. */
  depth: number;
}

interface RowRect {
  nodeId: string;
  top: number;
  bottom: number;
}

interface Gesture {
  /** The row the pointer went down on. */
  nodeId: string;
  /** Everything that moves: `[nodeId]`, or the selection it belongs to. */
  nodeIds: string[];
  title: string;
  kind: NodeKind;
  source: "tree" | "bin";
  /** The removed subtree, for a bin-origin drag. */
  external?: DocNode;
  /** The tree-drag pointer is over the bin: a drop here deletes. */
  binArmed: boolean;
  startX: number;
  startY: number;
  began: boolean;
  rects: RowRect[];
  slot: Slot | null;
  springTarget: string | null;
  springTimer: number | null;
  autoExpanded: Set<string>;
  scrollFrame: number | null;
  scrollBy: number;
}

interface Options {
  structure: DocumentStructure | null;
  expanded: Set<string>;
  /** The element that scrolls. */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** The element rows are laid out in — the indicator's coordinate space. */
  contentRef: React.RefObject<HTMLElement | null>;
  /** The bin section, which a tree drag can end on. */
  binRef?: React.RefObject<HTMLElement | null>;
  onExpand: (nodeId: string) => void;
  onCollapse: (nodeId: string) => void;
  /** A tree drag dropped on a slot — a move of every id it carries. */
  onDrop: (nodeIds: string[], slot: Slot) => void;
  /** A tree drag dropped on the bin — a removal. */
  onBinDrop?: (nodeId: string) => void;
  /** A bin drag dropped on a slot — a restore. */
  onRestore?: (nodeId: string, slot: Slot) => void;
}

export function useTreeDrag(options: Options) {
  const { scrollRef, contentRef } = options;

  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Every row in the air, so the panel can quiet the whole group and not only
  // the one under the pointer. Empty when nothing is being dragged.
  const [draggingIds, setDraggingIds] = useState<readonly string[]>(NONE);
  const [ghost, setGhost] = useState<DragGhost | null>(null);
  const [indicator, setIndicator] = useState<DragIndicator | null>(null);
  const [binArmed, setBinArmed] = useState(false);

  // Everything the move handler needs, kept out of state so a drag does not
  // re-subscribe its listeners on every pixel.
  const gesture = useRef<Gesture | null>(null);

  // The document and the callbacks are read through a ref rather than closed
  // over, so every function below stays stable for the whole drag.
  const latest = useRef(options);
  latest.current = options;

  /**
   * Row geometry in content coordinates, which scrolling does not disturb.
   * Only the rows on screen: a folded Part's children are still laid out, over
   * the rows below, and `flattenRows` leaves them out, so a gap index counted
   * with them names a different gap.
   */
  const measure = useCallback((): RowRect[] => {
    const content = contentRef.current;
    if (!content) return [];
    const origin = content.getBoundingClientRect().top;
    return [...content.querySelectorAll<HTMLElement>("[data-row]")]
      .filter((el) => !el.closest(FOLDED))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          nodeId: el.dataset.row as string,
          top: rect.top - origin,
          bottom: rect.bottom - origin,
        };
      });
  }, [contentRef]);

  const overBin = useCallback((clientX: number, clientY: number): boolean => {
    const el = latest.current.binRef?.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }, []);

  const stopSpring = (g: Gesture) => {
    if (g.springTimer !== null) window.clearTimeout(g.springTimer);
    g.springTimer = null;
    g.springTarget = null;
  };

  const stopScroll = (g: Gesture) => {
    if (g.scrollFrame !== null) cancelAnimationFrame(g.scrollFrame);
    g.scrollFrame = null;
    g.scrollBy = 0;
  };

  /**
   * A collapsed Part held under the pointer opens itself, so it can be
   * dropped into.
   */
  const springLoad = useCallback(
    (g: Gesture, y: number) => {
      const { structure, expanded } = latest.current;
      const over = g.rects.find((r) => y >= r.top && y < r.bottom);
      const target =
        over && !g.nodeIds.includes(over.nodeId) && !expanded.has(over.nodeId)
          ? over.nodeId
          : null;

      if (target === g.springTarget) return;
      stopSpring(g);
      if (!target || !structure) return;

      // Only a Part can open. Springing a Section would do nothing visible but
      // would wrongly mark it for re-collapsing when the drag is cancelled.
      if (findNode(structure, target)?.kind !== "part") return;

      g.springTarget = target;
      g.springTimer = window.setTimeout(() => {
        g.autoExpanded.add(target);
        latest.current.onExpand(target);
        // The rows below have just moved; the cached geometry is stale.
        window.setTimeout(() => {
          if (gesture.current === g) g.rects = measure();
        }, EXPAND_MS);
      }, SPRING_MS);
    },
    [measure],
  );

  const autoScroll = useCallback(
    (g: Gesture, clientY: number) => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      const box = scroller.getBoundingClientRect();

      const by =
        clientY < box.top + EDGE
          ? -SCROLL_STEP
          : clientY > box.bottom - EDGE
            ? SCROLL_STEP
            : 0;

      g.scrollBy = by;
      if (by === 0) {
        stopScroll(g);
        return;
      }
      if (g.scrollFrame !== null) return;

      const step = () => {
        if (gesture.current !== g || g.scrollBy === 0) {
          g.scrollFrame = null;
          return;
        }
        scroller.scrollTop += g.scrollBy;
        g.scrollFrame = requestAnimationFrame(step);
      };
      g.scrollFrame = requestAnimationFrame(step);
    },
    [scrollRef],
  );

  /** Recompute the indicator from a pointer position, in client coordinates. */
  const track = useCallback(
    (clientX: number, clientY: number) => {
      const g = gesture.current;
      const content = contentRef.current;
      const { structure } = latest.current;
      if (!g || !content || !structure) return;

      // Over the bin the two sources mean two different things, and neither is
      // a slot line: a tree drag is about to delete, and a bin drag must not
      // put its item straight back where it came from.
      if (overBin(clientX, clientY)) {
        g.binArmed = g.source === "tree" && g.nodeIds.length === 1;
        g.slot = null;
        setIndicator(null);
        setBinArmed(g.binArmed);
        springLoad(g, clientY - content.getBoundingClientRect().top);
        autoScroll(g, clientY);
        return;
      }

      g.binArmed = false;
      setBinArmed(false);

      const box = content.getBoundingClientRect();
      const y = clientY - box.top;
      const gapIndex = gapAt(g.rects, y);

      const rows = flattenRows(structure, latest.current.expanded);
      const dragged =
        g.source === "bin" && g.external
          ? g.external
          : findNode(structure, g.nodeId);
      const slot = dragged
        ? pickSlot(
            structure,
            dragged,
            slotsForGap(rows, gapIndex),
            clientX - box.left,
            g.source === "bin",
            g.nodeIds,
          )
        : null;

      if (!slot) {
        g.slot = null;
        setIndicator(null);
      } else {
        // A drop that would change nothing still shows its line — the writer is
        // being told where the node already is — but it is not worth a write.
        // A bin drag has no resting place, so it is never a no-op.
        g.slot =
          g.source === "tree" && isNoOp(structure, g.nodeId, slot, g.nodeIds)
            ? null
            : slot;
        const top =
          gapIndex === 0
            ? (g.rects[0]?.top ?? 0)
            : g.rects[gapIndex - 1].bottom;
        setIndicator({ top, depth: slot.depth });
      }

      springLoad(g, y);
      autoScroll(g, clientY);
    },
    [contentRef, springLoad, autoScroll, overBin],
  );

  const finish = useCallback((commit: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    setDraggingId(null);
    setDraggingIds(NONE);
    setGhost(null);
    setIndicator(null);
    setBinArmed(false);
    if (!g) return;
    stopSpring(g);
    stopScroll(g);

    if (commit && g.slot) {
      if (g.source === "tree") latest.current.onDrop(g.nodeIds, g.slot);
      else latest.current.onRestore?.(g.nodeId, g.slot);
    } else if (commit && g.source === "tree" && g.binArmed) {
      // Dropped on the bin: an unlink, not a move. The Parts that sprang open
      // stay open, as on any committed drop.
      latest.current.onBinDrop?.(g.nodeId);
    } else {
      for (const name of g.autoExpanded) latest.current.onCollapse(name);
    }
  }, []);

  const startDrag = useCallback(
    (
      event: React.PointerEvent,
      nodeId: string,
      title: string,
      kind: NodeKind,
      source: "tree" | "bin" = "tree",
      external?: DocNode,
      group?: readonly string[],
    ) => {
      if (event.button !== 0) return;

      // A finger or a pen never drags this tree. The gesture arms at 4px of
      // travel and commits on `pointerup`; on a touch screen the panel scrolls
      // under that motion, so a scroll could reorder a chapter, or drop it on
      // the bin, without the writer intending a drag.
      //
      // `pointerType`, not a media query: a laptop with a touch screen still
      // drags with its mouse. The finger's route is the row's `Move…`.
      if (event.pointerType === "touch" || event.pointerType === "pen") return;
      gesture.current = {
        nodeId,
        // A group always contains the row it was grabbed by; anything else is
        // the panel's mistake, and the safe reading of it is "this row alone".
        nodeIds: group && group.includes(nodeId) ? [...group] : [nodeId],
        title,
        kind,
        source,
        external,
        binArmed: false,
        startX: event.clientX,
        startY: event.clientY,
        began: false,
        rects: [],
        slot: null,
        springTarget: null,
        springTimer: null,
        autoExpanded: new Set(),
        scrollFrame: null,
        scrollBy: 0,
      };
    },
    [],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;

      if (!g.began) {
        const moved = Math.hypot(
          event.clientX - g.startX,
          event.clientY - g.startY,
        );
        if (moved < THRESHOLD) return;
        g.began = true;
        g.rects = measure();
        setDraggingId(g.nodeId);
        setDraggingIds(g.nodeIds);
      }

      event.preventDefault();
      setGhost({
        title: g.title,
        kind: g.kind,
        x: event.clientX,
        y: event.clientY,
      });
      track(event.clientX, event.clientY);
    };

    const onUp = () => {
      const g = gesture.current;
      if (!g) return;
      // A press that never passed the threshold was a click, not a drag, and
      // the row's own onClick has already handled it.
      finish(g.began);
    };

    // A cancelled pointer is not a release, and it must not commit:
    // `pointercancel` is the browser taking the gesture away (a touch that
    // became a pan, a palm rejected, an app switch). The drag arms at
    // `THRESHOLD` px, below the browser's own slop before it claims a touch
    // for scrolling, so a gesture can be armed by the time the cancel arrives.
    const onCancel = () => {
      if (gesture.current) finish(false);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current) finish(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
  }, [measure, track, finish]);

  return { draggingId, draggingIds, ghost, indicator, binArmed, startDrag };
}

/** The idle value of `draggingIds`: one constant, so its identity is stable. */
const NONE: readonly string[] = [];

/**
 * Which gap the pointer is in. A gap belongs to the nearer half of the row it
 * touches; falling between two rows, such as over the "empty" note inside an
 * open Part, counts as the gap above the lower one.
 */
function gapAt(rects: RowRect[], y: number): number {
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (y < rect.top) return i;
    if (y < (rect.top + rect.bottom) / 2) return i;
    if (y < rect.bottom) return i + 1;
  }
  return rects.length;
}
