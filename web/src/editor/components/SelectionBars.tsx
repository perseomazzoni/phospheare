// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useLayoutEffect, useState } from "react";

// The selection bars: two vertical marks in the accent colour at a
// selection's leading and trailing edges, so a live selection reads as a
// thing with edges. Purely visual: the bars have `pointer-events: none`, so
// the browser's own selection is the only way a selection is made or moved.
//
// Unlike the selection bubble, these track any selection, a multi-paragraph
// one included, and update without the bubble's debounce, because they have
// to feel glued to the selection while it is being dragged. They re-measure
// whenever anything moves the browser-painted tint, which they must never
// disagree with about where or how tall the selection is.

export interface BarRect {
  left: number;
  top: number;
  height: number;
}

export interface Bars {
  start: BarRect;
  end: BarRect;
}

/**
 * The line-box geometry a bar must span: the `::selection` tint paints the
 * full line box (leading included), while Chromium's `getClientRects()`
 * reports only the font box: 21px for Georgia 19px against a 36.48px line
 * box (`--leading: 1.92`). The tint is the thing a bar brackets, so each
 * rect is expanded to the computed line-height box, centred on the font box
 * (CSS splits the leading evenly, half above the glyphs and half below). A
 * line-height that resolves to `normal` has no px value, so it falls back to
 * 1.2em, and a rect that already spans its line box passes through
 * untouched.
 */
export function lineBoxFor(
  rect: { top: number; height: number },
  style: { fontSize: number; lineHeight: number },
): { top: number; height: number } {
  const lineBox =
    style.lineHeight > 0 ? style.lineHeight : style.fontSize * 1.2;
  if (lineBox <= rect.height) return rect;
  const halfLeading = (lineBox - rect.height) / 2;
  return { top: rect.top - halfLeading, height: lineBox };
}

function computedStyleOf(node: Node): { fontSize: number; lineHeight: number } {
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  if (!el) return { fontSize: 0, lineHeight: 0 };
  const cs = window.getComputedStyle(el);
  const fontSize = parseFloat(cs.fontSize);
  const lineHeight = parseFloat(cs.lineHeight);
  return {
    fontSize: Number.isFinite(fontSize) ? fontSize : 0,
    // Chromium resolves `line-height: normal` to its used px value, so this is
    // only ever 0 in a test environment that cannot lay out.
    lineHeight: Number.isFinite(lineHeight) ? lineHeight : 0,
  };
}

/**
 * The two bars that bracket a selection: one at the leading edge of the line
 * where the selection starts, one at the trailing edge of the line where it
 * ends, each as tall as the line box it sits beside. A multi-line selection
 * still draws only two one-line bars (left at the top line's start, right at
 * the bottom line's end).
 */
export function barsFor(range: Range): Bars | null {
  const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0);
  if (rects.length === 0) return null;

  const first = rects[0];
  const last = rects[rects.length - 1];
  const start = lineBoxFor(first, computedStyleOf(range.startContainer));
  const end = lineBoxFor(last, computedStyleOf(range.endContainer));

  return {
    start: { left: first.left, top: start.top, height: start.height },
    end: { left: last.right, top: end.top, height: end.height },
  };
}

export default function SelectionBars({
  getSurface,
}: {
  getSurface: () => HTMLElement | null;
}) {
  const [bars, setBars] = useState<Bars | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const surface = getSurface();
      const sel = window.getSelection();
      if (!surface || !sel || !sel.rangeCount || sel.isCollapsed) {
        setBars(null);
        return;
      }
      const range = sel.getRangeAt(0);
      // A selection outside the prose (the tree, the bar, a dialog) is not the
      // writing surface's to mark.
      if (!surface.contains(range.startContainer)) {
        setBars(null);
        return;
      }
      setBars(barsFor(range));
    };

    // The listeners re-measure the tint wherever it can move:
    // - `selectionchange`: the selection itself.
    // - `scroll` (capture): the surface scrolls inside the window, and scroll
    //   events do not bubble, so only capture on the window hears it.
    // - `resize`: the window itself. On its own this is not enough, because
    //   of ordering: a `resize` event is delivered before the
    //   editor's own React response to it, so this pass reads a column that
    //   has not been re-laid-out yet, and the bar lands at a wrong `left` and
    //   a stale `top` with nothing to correct it. It stays because it is the
    //   only signal when the surface's own box does not change; the observer
    //   below is what makes it land.
    // - ResizeObserver on the surface: the dock opening, a panel resizing,
    //   anything that reflows the writing column without resizing the window,
    //   and the settled half of a window resize, because an observer fires
    //   after layout rather than before it.
    // - MutationObserver on the surface: the prose-size control writes
    //   `--prose-size` as an inline style on the surface itself.
    // - MutationObserver on the root: a theme change writes `--leading` (and
    //   the other tokens) as inline styles on documentElement.
    // - `document.fonts.ready`: a web font finishing its load changes every
    //   glyph box on the page.
    document.addEventListener("selectionchange", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);

    const surface = getSurface();
    let surfaceResize: ResizeObserver | null = null;
    if (surface && typeof ResizeObserver !== "undefined") {
      // Guarded because jsdom has none, and an unguarded `new ResizeObserver`
      // takes every component test in this file down with it.
      surfaceResize = new ResizeObserver(update);
      surfaceResize.observe(surface);
    }
    let surfaceObserver: MutationObserver | null = null;
    if (surface && typeof MutationObserver !== "undefined") {
      surfaceObserver = new MutationObserver(update);
      surfaceObserver.observe(surface, { attributes: true });
    }
    let rootObserver: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined") {
      rootObserver = new MutationObserver(update);
      rootObserver.observe(document.documentElement, { attributes: true });
    }

    let disposed = false;
    void document.fonts?.ready.then(() => {
      if (!disposed) update();
    });

    update();
    return () => {
      disposed = true;
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      surfaceResize?.disconnect();
      surfaceObserver?.disconnect();
      rootObserver?.disconnect();
    };
  }, [getSurface]);

  if (!bars) return null;

  return (
    <>
      <span
        aria-hidden="true"
        className="selection-bar"
        style={{
          left: bars.start.left,
          top: bars.start.top,
          height: bars.start.height,
        }}
      />
      <span
        aria-hidden="true"
        className="selection-bar selection-bar-end"
        style={{
          left: bars.end.left,
          top: bars.end.top,
          height: bars.end.height,
        }}
      />
    </>
  );
}
