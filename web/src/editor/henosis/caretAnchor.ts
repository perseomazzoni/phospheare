// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Holds the caret's line on screen while the Henosis column changes width.
// When Henosis reaches full the prose widens, and when it ends it narrows.
// Either way every line above the caret re-wraps, so the line being written
// slides by however many lines the reflow gained or lost, on a long Section a
// whole screen, at the moment the mode exists to protect.
//
// While the width moves, the scroll position follows the reflow: the caret's
// line is measured before the change and, every frame after it, the surface
// scrolls by however far that line has moved. One read then one write per
// frame, only while the change lasts.
//
// The typewriter view holds the writing line at its station and re-docks on
// any reflow, so the hook calls this only in the scroll view.

/** The caret line's top on screen, or null with no caret in `surface`. */
function caretTop(surface: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const node = selection.focusNode;
  if (!node || !surface.contains(node)) return null;
  const range = document.createRange();
  range.setStart(node, selection.focusOffset);
  range.collapse(true);
  // A collapsed range at the start of an empty paragraph has no client rect,
  // so the block it sits in stands for the line.
  const rect = range.getClientRects()[0];
  if (rect) return rect.top;
  const block = node instanceof Element ? node : node.parentElement;
  return block ? block.getBoundingClientRect().top : null;
}

/**
 * Keep the caret's line where it is on screen for the next `forMs`, while the
 * column's width changes under it. Returns a function that stops early.
 */
export function holdCaretLine(surface: HTMLElement, forMs: number): () => void {
  const top = caretTop(surface);
  if (top === null) return () => {};
  const until = performance.now() + forMs;
  let frame = 0;
  const follow = () => {
    const now = caretTop(surface);
    if (now !== null && now !== top) surface.scrollTop += now - top;
    frame = performance.now() < until ? requestAnimationFrame(follow) : 0;
  };
  frame = requestAnimationFrame(follow);
  return () => cancelAnimationFrame(frame);
}
