// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef, useState } from "react";
import type { EditorEngine } from "../views/engine";

// The save gutter: a thin rule beside each paragraph that is not yet on
// disk. Autosave runs on a debounce, and until it fires one word in the bar
// for the whole file answers "is there work outstanding" but never "which
// work".
//
// A sibling layer, not marks in the prose. `patchDocument` compares each
// paragraph's `outerHTML` against the rendered one and strips only `mark`
// and `.char-fade-in` before doing it. An attribute or a child added to a
// `<p>` makes every paragraph mismatch, blows past the mismatch ceiling, and
// forces a full `innerHTML` rebuild on every keystroke. So the marks live
// outside the editable element and are positioned from it.
//
// Colour is `--attention` for unsaved work and `--danger` for a write that
// did not land, the failure ink the save chip shares.
//
// Green is a confirmation that passes. A gutter that stays green down a
// saved chapter is noise, and noise teaches the eye to stop reading the
// gutter, which is what it must not have learned on the day a write fails.

interface Mark {
  top: number;
  left: number;
  height: number;
  state: "dirty" | "saved";
}

/** Whether two sets of rules would draw the same thing. */
function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (m, i) =>
        m.top === b[i].top &&
        m.left === b[i].left &&
        m.height === b[i].height &&
        m.state === b[i].state,
    )
  );
}

/** How far left of the prose column's own edge the rule sits. */
const GUTTER_INSET = 27;

export default function SaveGutter({
  engine,
  editor,
  surface,
  /** A write was attempted and did not land: the marks stop resolving. */
  failed,
}: {
  engine: EditorEngine;
  /** The `.editor` element, whose children the marks are measured from. */
  editor: HTMLElement | null;
  /** The scroller, so the marks travel with the prose. */
  surface: HTMLElement | null;
  failed: boolean;
}) {
  const [marks, setMarks] = useState<Mark[]>([]);
  // Paragraphs that were dirty when the last write landed. They are drawn as a
  // confirmation for one beat and then let go.
  const justSaved = useRef<Set<number>>(new Set());
  // `marks` is read by the resize/scroll remeasure inside the subscription
  // effect below. Mirrored into a ref so the effect stays subscribed once —
  // listing `marks` as a dependency would tear the engine listener down and
  // re-arm it on every keystroke.
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const gutterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // An equal set keeps the rules already drawn, so a keystroke that
    // changes nothing in the gutter does not re-render it.
    const show = (next: Mark[]) =>
      setMarks((now) => (sameMarks(now, next) ? now : next));
    const measure = (state: "dirty" | "saved") => {
      if (!editor || !surface) return show([]);

      const source =
        state === "saved" ? justSaved.current : engine.dirtyParagraphs();
      if (source.size === 0) return show([]);

      // `editor.children`, not the paragraph helper: the marks ride the
      // rendered DOM and children is that list verbatim. A page break is a
      // paragraph in the model and an `<hr>` among the children; the DOM
      // helper (`getParagraphs`) counts the break too, so the
      // two agree and nothing below a break can slide onto the wrong line.
      const surfaceRect = surface.getBoundingClientRect();
      const top = surfaceRect.top - surface.scrollTop;
      // The prose column is flex-centred inside the surface, behind the panel's
      // own padding, so its left edge is not the surface's left edge: it moves
      // with the panel's width and the rail state. `.save-gutter` positions
      // against the surface, so the offset is measured, never assumed zero.
      // The origin is the gutter's own left, not the surface's border box:
      // the gutter is `left: 0` in the scroller's padding box, which starts
      // past the left scrollbar gutter (`scrollbar-gutter: stable
      // both-edges`), so measuring from the border box would draw
      // every mark that gutter's width right of its paragraph.
      const origin =
        gutterRef.current?.getBoundingClientRect().left ?? surfaceRect.left;
      const left = editor.getBoundingClientRect().left - origin - GUTTER_INSET;
      // A third of a line off each end, so the mark sits inside the text's own
      // box rather than bracketing it. Measured from the paragraph rather than
      // fixed, because the writer sets the prose size and a heading is bigger
      // than a paragraph — this is `0.34em` written where the `em` is known.
      const next: Mark[] = [];
      for (const index of source) {
        const node = editor.children[index];
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        const inset = 0.34 * parseFloat(getComputedStyle(node).fontSize || "0");
        next.push({
          top: rect.top - top + inset,
          left,
          height: Math.max(0, rect.height - inset * 2),
          state,
        });
      }
      show(next);
    };

    // Measured once per frame, never inside the keystroke: reading the
    // paragraphs' boxes straight after the prose is patched forces the
    // browser to lay the page out inside the input handler, and a scroll
    // would send a measure per event rather than per frame. The last
    // state asked for wins the frame.
    let frame = 0;
    let wanted: "dirty" | "saved" = "dirty";
    const schedule = (state: "dirty" | "saved") => {
      wanted = state;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure(wanted);
      });
    };

    let clearing: ReturnType<typeof setTimeout> | null = null;

    const off = engine.subscribe((reason) => {
      if (reason === "selection") return;

      if (reason === "saved") {
        // Everything that was outstanding a moment ago is now on disk. Hold the
        // confirmation, then let it go — unless the write failed, in which case
        // nothing resolves and the ember stays.
        if (clearing) clearTimeout(clearing);
        schedule("saved");
        clearing = setTimeout(() => {
          clearing = null;
          justSaved.current = new Set();
          setMarks([]);
        }, CONFIRM_MS);
        return;
      }

      justSaved.current = engine.dirtyParagraphs();
      schedule("dirty");
    });

    // The prose reflows under the marks on a resize, and travels under them on
    // a scroll. Both are cheap re-measures of a set that is almost always tiny.
    const remeasure = () =>
      schedule(
        marksRef.current.some((m) => m.state === "saved") ? "saved" : "dirty",
      );
    surface?.addEventListener("scroll", remeasure, { passive: true });
    window.addEventListener("resize", remeasure);
    // And the column itself moves: the dock's shift and Henosis's widening
    // and return travel the prose under the marks with no scroll and no
    // resize, so a mark drawn before the move would stay where the column
    // was. Only the column's own transitions count: a caret or a mark
    // inside it ending one is not the column moving.
    const moved = (e: TransitionEvent) => {
      if (e.target === editor) remeasure();
    };
    editor?.addEventListener("transitionend", moved);
    // And the surface itself resizes: a theme whose surface is a frame between
    // the panel and the dock narrows or widens it on a fold or a drag, with
    // no window resize, and the centred column moves inside it.
    const resized =
      surface && typeof ResizeObserver === "function"
        ? new ResizeObserver(remeasure)
        : null;
    if (surface) resized?.observe(surface);

    return () => {
      off();
      resized?.disconnect();
      cancelAnimationFrame(frame);
      if (clearing) clearTimeout(clearing);
      surface?.removeEventListener("scroll", remeasure);
      window.removeEventListener("resize", remeasure);
      editor?.removeEventListener("transitionend", moved);
    };
  }, [engine, editor, surface]);

  // Drawn even with no marks: it is the origin they are measured from.
  // Without the layer, the first mark of a clean buffer is measured from the
  // surface's border box, a scrollbar's width left of the layer, and draws
  // that far right until the second keystroke. An empty layer is
  // zero-height and paints nothing.
  return (
    <div ref={gutterRef} className="save-gutter" aria-hidden>
      {marks.map((mark, i) => (
        <i
          key={i}
          data-state={failed ? "failed" : mark.state}
          style={{
            top: `${mark.top}px`,
            left: `${mark.left}px`,
            height: `${mark.height}px`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * How long the confirmation holds before it passes.
 *
 * It has to outlast the fade that brings it in — `--d-settle` plus `--t-slow`,
 * about 680ms — or the mark would be cleared while it was still arriving and
 * the writer would see a green flicker instead of an answer. The rest is time
 * to look at it.
 */
const CONFIRM_MS = 1500;
