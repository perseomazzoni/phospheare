// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { getParagraphElement } from "./dom";

// The editor hides the native caret and draws its own; these helpers measure
// the native selection's geometry.

/** True while a measurement writes to the DOM; selectionchange ignores it. */
export let measuringCaret = false;

export function isEmptyParagraphCaret(range: Range): boolean {
  if (!range.collapsed) return false;

  const p = getParagraphElement(range.startContainer);
  if (!p) return false;

  const visibleText = (p.textContent ?? "").replace(/\u200b/g, "");
  if (visibleText.length > 0) return false;

  const probe = document.createRange();
  probe.selectNodeContents(p);
  probe.setEnd(range.startContainer, range.startOffset);
  return probe.toString().replace(/\u200b/g, "").length === 0;
}

/**
 * Measures caret geometry with a transient zero-width space, for when the
 * browser returns no client rects, or a misleading rect on an empty paragraph
 * (the wrong x without text-indent, the full line-height instead of font
 * metrics).
 */
export function measureCaretRect(range: Range): DOMRect | null {
  const sel = window.getSelection();
  const savedRanges: Range[] = [];
  if (sel) {
    for (let i = 0; i < sel.rangeCount; i++)
      savedRanges.push(sel.getRangeAt(i).cloneRange());
  }

  measuringCaret = true;
  try {
    const p = getParagraphElement(range.startContainer);
    if (!p) return null;

    const loneBr =
      p.childNodes.length === 1 && p.firstChild?.nodeName === "BR"
        ? (p.firstChild as HTMLBRElement)
        : null;

    const marker = document.createTextNode("\u200b");
    if (loneBr) {
      p.replaceChild(marker, loneBr);
    } else {
      const clone = document.createRange();
      clone.setStart(p, 0);
      clone.collapse(true);
      clone.insertNode(marker);
    }

    const measure = document.createRange();
    measure.setStart(marker, 0);
    measure.setEnd(marker, 1);
    const rects = measure.getClientRects();
    const rect =
      rects.length > 0 && rects[0].height > 0
        ? rects[0]
        : measure.getBoundingClientRect();

    if (loneBr) {
      p.replaceChild(loneBr, marker);
    } else {
      marker.remove();
    }

    // The saved selection is restored only if it moved: every selection
    // mutation fires a `selectionchange`, which re-enters the view's handler
    // and measures again, an unbounded loop wherever client rects are
    // unavailable (jsdom).
    if (sel && savedRanges.length > 0) {
      const sameSelection =
        savedRanges.length === sel.rangeCount &&
        savedRanges.every((saved, i) => {
          const cur = sel.getRangeAt(i);
          return (
            cur.startContainer === saved.startContainer &&
            cur.startOffset === saved.startOffset &&
            cur.endContainer === saved.endContainer &&
            cur.endOffset === saved.endOffset
          );
        });
      if (!sameSelection) {
        sel.removeAllRanges();
        for (const r of savedRanges) sel.addRange(r);
      }
    }

    return rect.height > 0 ? rect : null;
  } finally {
    measuringCaret = false;
  }
}

export function getFakeCursorRect(): {
  x: number;
  y: number;
  h: number;
} | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;

  const range = sel.getRangeAt(0);

  // Browsers often return a non-empty but wrong rect at the start of an empty
  // paragraph (`<p><br></p>`), so those are always measured with a probe
  // character.
  if (!isEmptyParagraphCaret(range)) {
    const rects = range.getClientRects();
    if (rects.length > 0 && rects[0].height > 0) {
      const r = rects[0];
      return { x: r.left, y: r.top, h: r.height };
    }
  }

  const measured = measureCaretRect(range);
  if (!measured) return null;

  return { x: measured.left, y: measured.top, h: measured.height };
}
