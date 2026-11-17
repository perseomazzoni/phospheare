// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import Button from "../../../ui/Button";
import { Icon, motionIsStill } from "../../../ui";
import { appIcons } from "../../../ui/appIcons";
import { FRAME_GEOMETRY, useFrameOptions } from "../../../theme/editor";
import { paragraphText } from "../../engine/application/diff/blocks";
import type { EditorEngine } from "../../views/engine";
import { logicalToDomPoint } from "../../views/writing/dom";
import { CommentsRefused, type CommentsService } from "../application/comments";
import { anchorFrom, place, refreshed, type Placement } from "../domain/anchor";
import { MARGIN_MIN_W } from "../domain/limits";
import {
  ownerOf,
  personaOf,
  type CommentAnchor,
  type Entry,
  type Thread,
} from "../domain/model";
import { useCommentsService, useNodeComments } from "../host/comments";
import CommentComposer from "./CommentComposer";
import { faceOf, type PersonaFace, type WriterFace } from "./faces";
import ThreadCard, { Face, type ReplyState } from "./ThreadCard";
import { appLog, describeError } from "../../../log";

// ── The margin ───────────────────────────────────────────────────────────────
//
// The comments of the open node, beside the prose. The layer is a sibling of
// the editable element, never inside it, because `patchDocument` rebuilds
// every paragraph the moment anything is added to a `<p>`. It is positioned
// from the paragraphs it is about, and paints the passages through the CSS
// Custom Highlight API rather than with marks in the text.
//
// Two forms, chosen by the room right of the prose (the dock shifts the prose
// left when it opens, so the room is measured, never assumed):
//
//   cards    at least `MARGIN_MIN_W` of room: each thread a card beside its
//            passage, stacked downward so none covers another;
//   markers  less: a small mark at the paragraph's edge, opening the thread
//            in a panel beside it, or in a sheet from the bottom on a phone.
//
// A theme that sets the comments as notes (`FrameOptions.comments`) stands
// them the frame's margin column (`ShellGeometry.notes`), ruled down the
// page's height: the cards stand in it as notes, stacked as cards are, and
// a ‸ marks each passage's end. Without the column's room the notes hide
// and each ‸ opens its thread as a marker does.
//
// At the top sits what belongs to the chapter rather than a passage: threads
// placed on the chapter, threads whose passage is gone (orphans, never
// deleted, shown with the words they were about), the resolved ones folded
// away, and a way to comment on the chapter itself.

const GAP = 8;
/** A card's inset from the prose and from the margin's far edge. */
export const INSET = 24;
/** The widest a card is drawn. */
export const CARD_MAX = 300;
const SCROLLBAR = 16;
/** How far in from the scroller's right edge a marker sits at the least. */
const MARKER_EDGE = 20;
/** A marker in the text's left margin, this far left of the text. */
const MARKER_LEFT = 18;
/** The floating thread's highest seat, under the bar's band. */
const FLOAT_TOP = 96;
const COLUMN = FRAME_GEOMETRY.notes;

export interface CommentDraft {
  /** The passage the new comment is about, or null for the chapter. */
  placement: Placement | null;
}

export interface MarginProps {
  engine: EditorEngine;
  editor: HTMLElement | null;
  surface: HTMLElement | null;
  /** The node open in the editor. */
  nodeId: string | null;
  personas: readonly PersonaFace[];
  /** The signed-in writer's face, for their own entries; null without one. */
  writer?: WriterFace | null;
  /**
   * How much of the window's right edge something lies over the prose's
   * surface (the open dock, on the wide plane), in px. The surface runs on
   * under it, so measured alone it promises room the writer cannot see, and
   * the cards would be drawn under the dock.
   */
  covered?: number;
  /** A comment the writer has asked to start, from the selection bubble. */
  draft: CommentDraft | null;
  onDraftDone: () => void;
  /** The writer wrote in a thread: the editor decides who answers. */
  onWriterEntry?: (nodeId: string, thread: Thread, entry: Entry) => void;
  /** A thread's reply in flight, or failed. */
  replyState?: (threadId: string) => ReplyState | undefined;
  /** The bar's Previous and Next comment, reaching in (`MarginWalk`). */
  walk?: Ref<MarginWalk>;
}

/**
 * A step through the open node's comments, in reading order: the next one
 * after where the writer is (+1) or the one before it (-1). It brings the
 * thread forward, opens it where the margin is only dots, and scrolls its
 * passage into view.
 */
export interface MarginWalk {
  step(direction: 1 | -1): void;
}

interface Geometry {
  mode: "cards" | "markers" | "notes";
  left: number;
  width: number;
  markerLeft: number;
  chapterTop: number;
  tops: Map<string, number>;
  draftTop: number | null;
  /** Where each passage ends, for its ‸, when the comments are notes. */
  ends: Map<string, { left: number; top: number; height: number }> | null;
  /** The margin column's rule, in the notes form. */
  rule: { left: number; top: number; height: number } | null;
}

type HighlightLike = {
  add(range: AbstractRange): void;
  clear(): void;
};
type HighlightRegistry = { set(name: string, highlight: HighlightLike): void };

const supportsHighlight =
  typeof Highlight !== "undefined" &&
  typeof CSS !== "undefined" &&
  "highlights" in CSS;

function makeHighlight(name: string): HighlightLike | null {
  if (!supportsHighlight) return null;
  const highlight = new Highlight() as unknown as HighlightLike;
  (CSS.highlights as unknown as HighlightRegistry).set(name, highlight);
  return highlight;
}

function rangeOf(editor: HTMLElement, at: Placement): Range | null {
  const start = logicalToDomPoint(editor, { para: at.para, offset: at.start });
  const end = logicalToDomPoint(editor, { para: at.endPara, offset: at.end });
  if (!start || !end) return null;
  const range = document.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return null;
  }
  return range;
}

/**
 * The passage the engine's selection covers, in reading order whichever way
 * it was dragged, inside one paragraph or across several; null for a caret.
 */
export function selectedPlacement(engine: EditorEngine): Placement | null {
  const { anchor, focus } = engine.selection;
  if (anchor.para === focus.para && anchor.offset === focus.offset) return null;
  const forward =
    anchor.para < focus.para ||
    (anchor.para === focus.para && anchor.offset < focus.offset);
  const [from, to] = forward ? [anchor, focus] : [focus, anchor];
  return {
    para: from.para,
    start: from.offset,
    endPara: to.para,
    end: to.offset,
  };
}

function samePlacement(a: Placement | null, b: Placement | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.para === b.para &&
    a.start === b.start &&
    a.endPara === b.endPara &&
    a.end === b.end
  );
}

/** Whether a caret at (para, offset) lies inside a placement. */
function holds(at: Placement, para: number, offset: number): boolean {
  if (para < at.para || para > at.endPara) return false;
  if (para === at.para && offset < at.start) return false;
  if (para === at.endPara && offset > at.end) return false;
  return true;
}

/**
 * Where a step lands among the threads in reading order (`order`, never
 * empty-checked by the caller). From the thread brought forward when there
 * is one; otherwise from the caret, so the first press goes to the comment
 * after (or before) the place the writer is reading. Either way the walk
 * goes round at the ends rather than stopping: the buttons never go dead
 * while there is a comment to reach.
 */
export function stepTo(
  order: readonly { id: string; at: Placement }[],
  from: string | null,
  caret: { para: number; offset: number },
  direction: 1 | -1,
): string | null {
  if (order.length === 0) return null;
  const at = order.findIndex((item) => item.id === from);
  if (at >= 0) return order[(at + direction + order.length) % order.length].id;
  const after = (p: Placement) =>
    p.para > caret.para || (p.para === caret.para && p.start > caret.offset);
  if (direction === 1)
    return (order.find((item) => after(item.at)) ?? order[0]).id;
  const before = order.filter((item) => !after(item.at));
  return (before[before.length - 1] ?? order[order.length - 1]).id;
}

/** The text a placement covers, its paragraphs joined as an anchor's are. */
export function textOf(paragraphs: readonly string[], at: Placement): string {
  if (at.para === at.endPara)
    return paragraphs[at.para]?.slice(at.start, at.end) ?? "";
  return [
    paragraphs[at.para]?.slice(at.start) ?? "",
    ...paragraphs.slice(at.para + 1, at.endPara),
    paragraphs[at.endPara]?.slice(0, at.end) ?? "",
  ].join("\n");
}

export default function Margin(props: MarginProps) {
  const service = useCommentsService();
  if (!service || !props.nodeId) return null;
  // One margin per node: everything it holds (the text it placed threads
  // against, an open composer, the card brought forward) belongs to the node
  // it was drawn for, and is read again for the next.
  return (
    <MarginOf
      key={props.nodeId}
      {...props}
      nodeId={props.nodeId}
      service={service}
    />
  );
}

function MarginOf({
  engine,
  editor,
  surface,
  nodeId,
  personas,
  writer,
  covered = 0,
  draft,
  onDraftDone,
  onWriterEntry,
  replyState,
  walk,
  service,
}: MarginProps & { nodeId: string; service: CommentsService }) {
  const { t } = useTranslation();
  const notes = useFrameOptions().comments === "notes";
  const state = useNodeComments(nodeId);
  const file = state?.status === "ready" ? state.file : null;
  const layer = useRef<HTMLDivElement>(null);
  const [paragraphs, setParagraphs] = useState<string[]>(() =>
    engine.doc.map(paragraphText),
  );
  const [inDiff, setInDiff] = useState(engine.isInDiff);
  const [layoutTick, setLayoutTick] = useState(0);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [heights, setHeights] = useState<Map<string, number>>(new Map());
  const [active, setActive] = useState<string | null>(null);
  // The thread under the hand (its note, its ‸ or its marker), whose passage
  // the notes form tints while it is there.
  const [hovered, setHovered] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [floating, setFloating] = useState<string | null>(null);
  const [selection, setSelection] = useState<Placement | null>(null);
  const [addingChapter, setAddingChapter] = useState(false);
  const cards = useRef(new Map<string, HTMLElement>());
  // Set below, once the threads are placed; called on every caret move.
  const bringForward = useRef<() => void>(() => undefined);

  // The text, read again a moment after the writer stops typing: placing
  // every thread on every keystroke is work nobody would see.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = engine.subscribe((reason) => {
      // Typing moves the caret too, and reports only "doc": the selection is
      // read on every change, or a passage replaced by typing would still be
      // offered to re-attach to.
      const next = selectedPlacement(engine);
      setSelection((was) => (samePlacement(was, next) ? was : next));
      if (reason === "selection") return bringForward.current();
      setInDiff(engine.isInDiff);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setParagraphs(engine.doc.map(paragraphText));
      }, 200);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [engine]);

  // The prose reflows on a resize, travels on a scroll, and moves when the
  // dock slides in or a panel is dragged: each is a fresh measure, at most
  // once a frame. A drag moves the prose without a resize or, under still
  // motion, a transition, so the shell's own restyling is watched too: the
  // panels' widths and the dock's state are written on the surface's
  // ancestors.
  useEffect(() => {
    let frame = 0;
    const again = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setLayoutTick((n) => n + 1);
      });
    };
    // Any transition that ends may have moved the prose (the dock, the panel,
    // the column's shift), except the caret's own. With Smooth caret on, its
    // spring is a transition that ends on every keystroke, and each would
    // re-measure every thread on the page.
    const moved = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(".fake-cursor"))
        return;
      again();
    };
    surface?.addEventListener("scroll", again, { passive: true });
    window.addEventListener("resize", again);
    document.addEventListener("transitionend", moved);
    const restyled =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(again);
    for (let at = surface?.parentElement; at && restyled; at = at.parentElement)
      restyled.observe(at, { attributes: true });
    return () => {
      restyled?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      surface?.removeEventListener("scroll", again);
      window.removeEventListener("resize", again);
      document.removeEventListener("transitionend", moved);
    };
  }, [surface]);

  const threads = useMemo(() => file?.threads ?? [], [file]);
  const placements = useMemo(() => {
    const out = new Map<string, Placement | null>();
    for (const thread of threads)
      if (thread.anchor) out.set(thread.id, place(thread.anchor, paragraphs));
    return out;
  }, [threads, paragraphs]);

  // A thread found somewhere new is noted, and written with the file's next
  // change rather than on its own.
  useEffect(() => {
    for (const thread of threads) {
      const at = placements.get(thread.id);
      if (!thread.anchor || !at) continue;
      const next = refreshed(thread.anchor, paragraphs, at);
      if (next !== thread.anchor) service.noteMoved(nodeId, thread.id, next);
    }
  }, [threads, placements, paragraphs, service, nodeId]);

  const anchored = useMemo(
    () =>
      threads
        .filter((th) => th.state !== "resolved" && placements.get(th.id))
        .sort((a, b) => {
          const x = placements.get(a.id) as Placement;
          const y = placements.get(b.id) as Placement;
          return x.para - y.para || x.start - y.start;
        }),
    [threads, placements],
  );
  const chapterLevel = threads.filter(
    (th) => th.state !== "resolved" && !placements.get(th.id),
  );
  const resolved = threads.filter((th) => th.state === "resolved");

  // Clicking inside a commented passage brings its card forward: on each move
  // of the caret, and again when the threads are placed anew. A caret's move
  // leaves `selection` null as it was, so it is heard from the engine.
  const caretForward = useCallback(() => {
    if (selectedPlacement(engine)) return;
    const caret = engine.selection.focus;
    const hit = anchored.find((th) => {
      const at = placements.get(th.id);
      return at && holds(at, caret.para, caret.offset);
    });
    if (hit) setActive(hit.id);
  }, [anchored, placements, engine]);
  useEffect(() => {
    bringForward.current = caretForward;
    caretForward();
  }, [caretForward, selection]);

  // The walk the bar's Previous and Next comment take. The passage is
  // scrolled to the middle of the page by its first paragraph, because a
  // Range has no `scrollIntoView`. The scroll glides, as the find bar's steps
  // do: the writer pressed a button and is watching the page move.
  useImperativeHandle(
    walk,
    () => ({
      step(direction) {
        const order = anchored.map((thread) => ({
          id: thread.id,
          at: placements.get(thread.id) as Placement,
        }));
        const id = stepTo(order, active, engine.selection.focus, direction);
        const at = id ? placements.get(id) : null;
        if (!id || !at) return;
        setActive(id);
        if (geometry?.mode === "markers") setFloating(id);
        editor?.children[at.para]?.scrollIntoView({
          block: "center",
          behavior: motionIsStill() ? "auto" : "smooth",
        });
      },
    }),
    [anchored, placements, active, engine, geometry, editor],
  );

  // ── Measuring ──────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const own = layer.current;
    if (!editor || !surface || !own) return setGeometry(null);
    const origin = own.getBoundingClientRect();
    const prose = editor.getBoundingClientRect();
    // The margin ends where the surface does, or where the dock begins.
    const edge = Math.min(
      surface.getBoundingClientRect().right,
      window.innerWidth - covered,
    );
    // Notes stand on the theme's page, so their column must also leave the
    // page's paper beyond it: the surface's own padding on that side.
    const room = notes
      ? edge -
        prose.right -
        (parseFloat(getComputedStyle(surface).paddingRight) || 0)
      : edge - prose.right - SCROLLBAR;
    const mode =
      notes && room >= COLUMN.gap + COLUMN.column
        ? "notes"
        : !notes && room >= MARGIN_MIN_W
          ? "cards"
          : "markers";
    const topOf = (at: Placement): number => {
      const range = rangeOf(editor, at);
      const rect = range?.getClientRects()[0];
      if (rect) return rect.top - origin.top;
      const para = editor.children[at.para];
      return para ? para.getBoundingClientRect().top - origin.top : 0;
    };
    const tops = new Map<string, number>();
    for (const thread of anchored) {
      const at = placements.get(thread.id);
      if (at) tops.set(thread.id, topOf(at));
    }
    const endOf = (at: Placement) => {
      const rects = rangeOf(editor, at)?.getClientRects();
      const rect = rects?.[rects.length - 1];
      return rect
        ? {
            left: rect.right - origin.left,
            top: rect.top - origin.top,
            height: rect.height,
          }
        : null;
    };
    let ends: Geometry["ends"] = null;
    if (notes) {
      ends = new Map();
      for (const thread of anchored) {
        const at = placements.get(thread.id);
        const end = at && endOf(at);
        if (end) ends.set(thread.id, end);
      }
    }
    const first = editor.children[0];
    const ruleLeft = prose.right - origin.left + COLUMN.gap;
    setGeometry({
      mode,
      left:
        mode === "notes"
          ? ruleLeft + 1 + COLUMN.inset
          : prose.right - origin.left + INSET,
      width:
        mode === "notes"
          ? COLUMN.column - 1 - COLUMN.inset
          : Math.max(160, Math.min(CARD_MAX, room - INSET * 2)),
      // Beside the prose; where the dock covers that side, in the text's
      // left margin, so a marker never stands on the words; on a phone,
      // where the prose runs to both edges, just inside the scroller.
      markerLeft:
        prose.right + 6 <= edge - MARKER_EDGE
          ? prose.right - origin.left + 6
          : prose.left - origin.left >= MARKER_LEFT + 6
            ? prose.left - origin.left - MARKER_LEFT
            : edge - origin.left - MARKER_EDGE,
      chapterTop: first ? first.getBoundingClientRect().top - origin.top : 0,
      tops,
      draftTop: draft?.placement ? topOf(draft.placement) : null,
      ends,
      rule:
        mode === "notes"
          ? {
              left: ruleLeft,
              top: prose.top - origin.top,
              height: prose.height,
            }
          : null,
    });
  }, [
    editor,
    surface,
    anchored,
    placements,
    draft,
    layoutTick,
    paragraphs,
    covered,
    notes,
  ]);

  // Each card's height as it is drawn and whenever it changes (a card opened,
  // a reply arriving), for the stacking below. One observer for every slot;
  // a slot is watched from the moment it mounts.
  const sizes = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      setHeights((before) => {
        let next: Map<string, number> | null = null;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.slot;
          const h = (entry.target as HTMLElement).offsetHeight;
          if (!id || before.get(id) === h) continue;
          next ??= new Map(before);
          next.set(id, h);
        }
        return next ?? before;
      });
    });
    sizes.current = observer;
    for (const el of cards.current.values()) observer.observe(el);
    return () => {
      observer.disconnect();
      sizes.current = null;
    };
  }, []);

  // How far the notes run past the prose's end, as `--cm-overhang` on the
  // surface: the page lengthens its rule and keeps what follows the text
  // (its folio) under the last note. Measured after every render, as the
  // notes' stacking changes with any card's height.
  const overhang = useRef<number | null>(null);
  useLayoutEffect(() => {
    const noted = geometry?.mode === "notes";
    let past = 0;
    if (noted && editor && layer.current) {
      const end = editor.getBoundingClientRect().bottom;
      for (const slot of layer.current.querySelectorAll(".cm-slot"))
        past = Math.max(past, slot.getBoundingClientRect().bottom - end);
    }
    const next = noted ? Math.ceil(past) : null;
    if (next === overhang.current || !surface) return;
    overhang.current = next;
    if (next === null) surface.style.removeProperty("--cm-overhang");
    else surface.style.setProperty("--cm-overhang", `${next}px`);
  });
  useEffect(
    () => () => {
      surface?.style.removeProperty("--cm-overhang");
      overhang.current = null;
    },
    [surface],
  );

  // ── Painting the passages ──────────────────────────────────────────────────
  const paint = useRef<{
    open: HighlightLike | null;
    ghost: HighlightLike | null;
    active: HighlightLike | null;
    hover: HighlightLike | null;
  } | null>(null);
  useEffect(() => {
    paint.current = {
      open: makeHighlight("comment"),
      ghost: makeHighlight("comment-ghost"),
      active: makeHighlight("comment-active"),
      hover: makeHighlight("comment-hover"),
    };
    return () => {
      paint.current?.open?.clear();
      paint.current?.ghost?.clear();
      paint.current?.active?.clear();
      paint.current?.hover?.clear();
    };
  }, []);
  useEffect(() => {
    const p = paint.current;
    if (!p || !editor) return;
    p.open?.clear();
    p.ghost?.clear();
    p.active?.clear();
    p.hover?.clear();
    if (inDiff) return;
    for (const thread of anchored) {
      const at = placements.get(thread.id);
      const range = at && rangeOf(editor, at);
      if (!range) continue;
      if (thread.id === active) {
        p.active?.add(range);
        continue;
      }
      if (thread.id === hovered) p.hover?.add(range);
      if (thread.state === "proposed") p.ghost?.add(range);
      else p.open?.add(range);
    }
  }, [anchored, placements, active, hovered, editor, inDiff, geometry]);

  // The hand on a thread, and off it. Off only if it is still the one under
  // the hand, since the next one's enter can land before this one's leave.
  const hoverOn = (id: string) => () => setHovered(id);
  const hoverOff = (id: string) => () =>
    setHovered((h) => (h === id ? null : h));

  // ── Acting ─────────────────────────────────────────────────────────────────
  // A change whose write failed, shown until the next one is saved. A
  // refused change (a damaged or unreachable file) is shown by the node's
  // state instead.
  const [unsaved, setUnsaved] = useState(false);
  const settle = useCallback((work: Promise<unknown>) => {
    work.then(
      () => setUnsaved(false),
      (err: unknown) => {
        appLog.warn("comments", "A comment change was not saved.", {
          ...describeError(err),
        });
        if (!(err instanceof CommentsRefused)) setUnsaved(true);
      },
    );
  }, []);

  const writerEntry = useCallback(
    (threadId: string) => {
      const thread = service
        .fileOf(nodeId)
        ?.threads.find((th) => th.id === threadId);
      const entry = thread?.entries[thread.entries.length - 1];
      if (thread && entry) onWriterEntry?.(nodeId, thread, entry);
    },
    [service, nodeId, onWriterEntry],
  );

  // The new thread, settled when the file has taken it and refused when it
  // could not: the composer holding its words closes only on the first.
  const startThread = useCallback(
    (anchor: CommentAnchor | null, body: string): Promise<void> => {
      const work = service
        .open(nodeId, { anchor, author: { kind: "writer" }, body })
        .then((id) => {
          setActive(id);
          writerEntry(id);
        });
      settle(work);
      return work;
    },
    [service, nodeId, settle, writerEntry],
  );
  // The draft's passage, read from the text the moment the draft opens, not
  // from the debounced copy above: its placement is in the engine's offsets
  // of that moment. Null for a passage of nothing but whitespace.
  const drafted = useMemo(
    () =>
      draft?.placement
        ? anchorFrom(engine.doc.map(paragraphText), draft.placement)
        : null,
    [draft, engine],
  );
  // The text may have moved while the comment was being written, so the
  // passage is found again in the text as it is when it is sent.
  const submitDraft = (body: string): Promise<void> | undefined => {
    // A passage of nothing but whitespace is no passage; the comment is not
    // opened rather than quietly landing on the chapter.
    if (draft?.placement && !drafted) {
      onDraftDone();
      return undefined;
    }
    let anchor = drafted;
    if (anchor) {
      const now = engine.doc.map(paragraphText);
      const at = place(anchor, now);
      if (at) anchor = refreshed(anchor, now, at);
    }
    return startThread(anchor, body).then(onDraftDone);
  };
  const reattachTo = useMemo(
    () =>
      selection ? anchorFrom(engine.doc.map(paragraphText), selection) : null,
    [engine, selection],
  );

  const actionsFor = (thread: Thread) => ({
    keep: () => settle(service.keep(nodeId, thread.id)),
    remove: () => {
      setFloating(null);
      settle(service.remove(nodeId, thread.id));
    },
    resolve: () => settle(service.resolve(nodeId, thread.id)),
    reopen: () => settle(service.reopen(nodeId, thread.id)),
    reply: (body: string) => {
      const work = service
        .reply(nodeId, thread.id, { kind: "writer" }, body)
        .then(() => writerEntry(thread.id));
      settle(work);
      return work;
    },
    reattach: reattachTo
      ? () => settle(service.reanchor(nodeId, thread.id, reattachTo))
      : undefined,
  });

  const card = (thread: Thread) => (
    <ThreadCard
      thread={thread}
      personas={personas}
      writer={writer}
      orphan={thread.anchor !== null && !placements.get(thread.id)}
      active={active === thread.id || floating === thread.id}
      onActivate={() => setActive(thread.id)}
      actions={actionsFor(thread)}
      reply={replyState?.(thread.id)}
    />
  );

  const draftComposer = draft && (
    <div className="cm-card cm-draft" data-active="1">
      {draft.placement && (
        <q className="cm-quote">{textOf(paragraphs, draft.placement)}</q>
      )}
      <CommentComposer
        personas={personas}
        placeholder={t("comments.placeholder")}
        submitLabel={t("comments.add")}
        onSubmit={submitDraft}
        onCancel={onDraftDone}
      />
    </div>
  );

  const chapterGroup = (
    <div className="cm-chapter">
      {state?.status === "damaged" && (
        <p className="cm-trouble" role="alert">
          {t("comments.damaged")}
        </p>
      )}
      {state?.status === "unavailable" && (
        <p className="cm-trouble" role="alert">
          {t("comments.unavailable")}
        </p>
      )}
      {unsaved && (
        <p className="cm-trouble" role="alert">
          {t("comments.notSaved")}
        </p>
      )}
      {chapterLevel.map((thread) => (
        <div key={thread.id}>{card(thread)}</div>
      ))}
      {addingChapter ? (
        <div className="cm-card cm-draft" data-active="1">
          <CommentComposer
            personas={personas}
            placeholder={t("comments.chapterPlaceholder")}
            submitLabel={t("comments.add")}
            onSubmit={(body) =>
              startThread(null, body).then(() => setAddingChapter(false))
            }
            onCancel={() => setAddingChapter(false)}
          />
        </div>
      ) : (
        file && (
          <Button
            variant="link"
            className="cm-add-chapter"
            onClick={() => setAddingChapter(true)}
          >
            <Icon name={appIcons.comment} size={14} />
            {t("comments.onChapter")}
          </Button>
        )
      )}
      {resolved.length > 0 && (
        <div className="cm-resolved">
          <Button
            variant="link"
            aria-expanded={showResolved}
            onClick={() => setShowResolved((v) => !v)}
          >
            {t("comments.resolvedCount", { count: resolved.length })}
          </Button>
          {showResolved &&
            resolved.map((thread) => <div key={thread.id}>{card(thread)}</div>)}
        </div>
      )}
    </div>
  );

  // The floating thread opens level with its passage, as a card in the
  // margin would stand, never higher than the bar's band. Read after the
  // layer is laid out, and again with each measure a scroll brings.
  const [floatTop, setFloatTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const own = layer.current?.getBoundingClientRect().top;
    const at =
      geometry?.mode !== "markers"
        ? undefined
        : draft
          ? (geometry.draftTop ?? geometry.chapterTop)
          : floating === "chapter"
            ? geometry.chapterTop
            : floating
              ? geometry.tops.get(floating)
              : undefined;
    setFloatTop(
      own === undefined || at === undefined
        ? null
        : Math.max(FLOAT_TOP, own + at),
    );
  }, [geometry, draft, floating]);

  if (inDiff || !geometry) return <div ref={layer} className="cm-layer" />;

  // ── Cards ──────────────────────────────────────────────────────────────────
  if (geometry.mode === "cards" || geometry.mode === "notes") {
    const items: { id: string; top: number; node: React.ReactNode }[] = [
      { id: "chapter", top: geometry.chapterTop, node: chapterGroup },
    ];
    for (const thread of anchored)
      items.push({
        id: thread.id,
        top: geometry.tops.get(thread.id) ?? 0,
        node: card(thread),
      });
    if (draft?.placement && geometry.draftTop !== null)
      items.push({ id: "draft", top: geometry.draftTop, node: draftComposer });
    items.sort((a, b) => a.top - b.top);
    // The active card keeps its own place; the rest give way around it.
    let floor = -Infinity;
    const placed = items.map((item) => {
      const top = Math.max(item.top, floor);
      floor = top + (heights.get(item.id) ?? 0) + GAP;
      return { ...item, top };
    });
    return (
      <div ref={layer} className="cm-layer" data-mode={geometry.mode}>
        {geometry.rule && (
          <div
            className="cm-rule"
            aria-hidden="true"
            style={{
              left: `${geometry.rule.left}px`,
              top: `${geometry.rule.top}px`,
              height: `calc(${geometry.rule.height}px + var(--cm-overhang, 0px))`,
            }}
          />
        )}
        {[...(geometry.ends ?? [])].map(([id, end]) => (
          <span
            key={`mark-${id}`}
            className="cm-pmark"
            aria-hidden="true"
            style={{
              left: `${end.left}px`,
              top: `${end.top}px`,
              lineHeight: `${end.height}px`,
            }}
            onPointerEnter={hoverOn(id)}
            onPointerLeave={hoverOff(id)}
            // Hidden from the reader, as its note is the way to the thread:
            // the press is the pointer's shortcut to the same note.
            onClick={() => setActive(id)}
          >
            ‸
          </span>
        ))}
        {placed.map((item) => (
          <div
            key={item.id}
            className="cm-slot"
            data-slot={item.id}
            onPointerEnter={hoverOn(item.id)}
            onPointerLeave={hoverOff(item.id)}
            onFocus={hoverOn(item.id)}
            onBlur={hoverOff(item.id)}
            ref={(el) => {
              const before = cards.current.get(item.id);
              if (before && before !== el) sizes.current?.unobserve(before);
              if (el) {
                cards.current.set(item.id, el);
                sizes.current?.observe(el);
              } else cards.current.delete(item.id);
            }}
            style={
              {
                top: `${item.top}px`,
                left: `${geometry.left}px`,
                width: `${geometry.width}px`,
              } as CSSProperties
            }
          >
            {item.node}
          </div>
        ))}
        {!draft?.placement && draft && (
          <div
            className="cm-slot"
            style={{
              top: `${geometry.chapterTop}px`,
              left: `${geometry.left}px`,
              width: `${geometry.width}px`,
            }}
          >
            {draftComposer}
          </div>
        )}
      </div>
    );
  }

  // ── Markers ────────────────────────────────────────────────────────────────
  const floatingThread = threads.find((th) => th.id === floating);
  const panelOpen =
    floating === "chapter" || Boolean(floatingThread) || Boolean(draft);
  return (
    <div ref={layer} className="cm-layer" data-mode="markers">
      <button
        type="button"
        className="cm-marker cm-marker-chapter"
        style={{
          top: `${geometry.chapterTop}px`,
          left: `${geometry.markerLeft}px`,
        }}
        aria-label={t("comments.chapterMarker", {
          count: chapterLevel.length + resolved.length,
        })}
        onClick={() => setFloating((f) => (f === "chapter" ? null : "chapter"))}
      >
        <Icon name={appIcons.comment} size={14} />
      </button>
      {anchored.map((thread) => {
        const persona = personaOf(thread);
        const face = persona
          ? personas.find((p) => p.id === persona)
          : undefined;
        const end = geometry.ends?.get(thread.id);
        return (
          <button
            key={thread.id}
            type="button"
            className="cm-marker"
            data-at={end ? "end" : undefined}
            data-state={thread.state}
            // A persona's thread is marked with the persona's own face, as
            // its card's byline is, because a coloured circle says only
            // "someone"; the writer's and an editor's keep the plain dot.
            data-face={face ? "1" : undefined}
            style={
              {
                top: `${end?.top ?? geometry.tops.get(thread.id) ?? 0}px`,
                left: `${end?.left ?? geometry.markerLeft}px`,
                lineHeight: end ? `${end.height}px` : undefined,
              } as CSSProperties
            }
            // Named as the card's byline names its owner: the writer, an
            // editor by their name, a persona by its own.
            aria-label={t("comments.markerLabel", {
              name: faceOf(ownerOf(thread), personas, {
                you: t("comments.you"),
                unknown: t("comments.unknownAuthor"),
              }).name,
            })}
            onPointerEnter={hoverOn(thread.id)}
            onPointerLeave={hoverOff(thread.id)}
            onFocus={hoverOn(thread.id)}
            onBlur={hoverOff(thread.id)}
            onClick={() => {
              setActive(thread.id);
              setFloating((f) => (f === thread.id ? null : thread.id));
            }}
          >
            {face && (
              <Face
                face={{
                  name: face.name,
                  color: face.color,
                  avatar: face.avatar,
                  persona: true,
                }}
              />
            )}
          </button>
        );
      })}
      {/* Out of the layer, whose own stacking order would hold the panel
          under the editor's bars; it is placed by its own fixed position. */}
      {panelOpen &&
        createPortal(
          <div
            className="cm-float"
            // Beside the dock rather than under it: the panel stands at the
            // window's right edge, where the dock is.
            style={
              {
                right: covered > 0 ? covered + 16 : undefined,
                "--float-top": floatTop === null ? undefined : `${floatTop}px`,
              } as CSSProperties
            }
            role="dialog"
            aria-label={t("comments.panelLabel")}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setFloating(null);
                if (draft) onDraftDone();
              }
            }}
          >
            <div className="cm-float-head">
              <Button
                variant="icon"
                aria-label={t("comments.close")}
                onClick={() => {
                  setFloating(null);
                  if (draft) onDraftDone();
                }}
              >
                <Icon name={appIcons.close} size={14} />
              </Button>
            </div>
            {draft
              ? draftComposer
              : floating === "chapter"
                ? chapterGroup
                : floatingThread && card(floatingThread)}
          </div>,
          document.body,
        )}
    </div>
  );
}
