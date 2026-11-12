// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The one mapping between DOM points (node, offset) and logical cursors
// (paragraph index, text offset). Every helper is total: a query never throws
// for a node or cursor the surface cannot hold.

import { joinBlocks, type Cursor, type Selection } from "../../engine";

/**
 * The block-level paragraphs of the editor surface. A page break is a
 * paragraph in the model and an `<hr>` in the DOM, so the hr is counted too,
 * or every index below a break shifts by one.
 */
const BLOCK_TAGS = new Set(["P", "H1", "H2", "HR"]);

export function getParagraphs(el: HTMLElement): Element[] {
  return Array.from(
    el.querySelectorAll(":scope > p, :scope > h1, :scope > h2, :scope > hr"),
  );
}

/** The block paragraph that contains `node`, or null when none does. */
export function getParagraphElement(node: Node): HTMLElement | null {
  let el: Node | null = node;
  while (el) {
    if (BLOCK_TAGS.has((el as Element).tagName)) return el as HTMLElement;
    el = el.parentElement;
  }
  return null;
}

/** A DOM point as a logical cursor, or null outside a paragraph. */
export function domPointToLogical(
  el: HTMLElement,
  node: Node,
  offset: number,
): Cursor | null {
  let cur: Node | null = node;
  let p: Element | null = null;
  while (cur && cur !== el) {
    if (BLOCK_TAGS.has((cur as Element).tagName)) {
      p = cur as Element;
      break;
    }
    cur = cur.parentElement;
  }
  if (!p) return null;

  const paraIdx = getParagraphs(el).indexOf(p as HTMLParagraphElement);
  if (paraIdx === -1) return null;

  const range = document.createRange();
  range.selectNodeContents(p);
  range.setEnd(node, offset);
  return { para: paraIdx, offset: range.toString().length };
}

/** A logical cursor as a DOM point, or null when the paragraph is missing. */
export function logicalToDomPoint(
  el: HTMLElement,
  cursor: Cursor,
): { node: Node; offset: number } | null {
  const p = getParagraphs(el)[cursor.para] as HTMLElement | undefined;
  if (!p) return null;

  const textNodes: Text[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) textNodes.push(n as Text);
    else n.childNodes.forEach(walk);
  };
  walk(p);

  if (textNodes.length === 0) return { node: p, offset: 0 };

  let acc = 0;
  for (const tn of textNodes) {
    const len = tn.textContent?.length ?? 0;
    if (cursor.offset <= acc + len)
      return { node: tn, offset: cursor.offset - acc };
    acc += len;
  }

  const last = textNodes[textNodes.length - 1];
  return { node: last, offset: last.textContent?.length ?? 0 };
}

/**
 * The window selection, as a logical selection. Null when the selection is
 * empty, outside the surface, or cannot be mapped to paragraphs.
 */
export function saveDomSelection(el: HTMLElement): Selection | null {
  const domSel = window.getSelection();
  if (!domSel || !domSel.rangeCount) return null;
  if (!el.contains(domSel.anchorNode)) return null;

  const anchorNode = domSel.anchorNode;
  const focusNode = domSel.focusNode;
  if (!anchorNode || !focusNode) return null;

  const anchor = domPointToLogical(el, anchorNode, domSel.anchorOffset);
  const focus = domPointToLogical(el, focusNode, domSel.focusOffset);
  if (!anchor || !focus) return null;

  return { anchor, focus };
}

/** Set the window selection to a logical one; a no-op when it cannot map. */
export function restoreDomSelection(el: HTMLElement, sel: Selection): void {
  const anchorPt = logicalToDomPoint(el, sel.anchor);
  const focusPt = logicalToDomPoint(el, sel.focus);
  if (!anchorPt || !focusPt) return;

  const domSel = window.getSelection();
  if (!domSel) return;

  domSel.removeAllRanges();
  const range = document.createRange();
  range.setStart(anchorPt.node, anchorPt.offset);
  range.collapse(true);
  domSel.addRange(range);

  const samePoint =
    anchorPt.node === focusPt.node && anchorPt.offset === focusPt.offset;
  if (!samePoint) domSel.extend(focusPt.node, focusPt.offset);
}

/**
 * Flat text position of a logical cursor in the surface's text as the
 * highlighter reads it: its blocks joined as find joins them, so a
 * position here is one in the painter's text.
 */
export function calculateFlatPosition(el: HTMLElement, cursor: Cursor): number {
  const paragraphs = getParagraphs(el);
  if (paragraphs.length === 0) return cursor.offset;
  const joined = joinBlocks(
    paragraphs.map((block) => ({
      text: block.textContent ?? "",
      pagebreak: block.tagName === "HR",
    })),
  );
  // A cursor past the last block counts as after all of it.
  const start = joined.starts[cursor.para] ?? joined.text.length;
  return start + cursor.offset;
}

/** True when both DOM points sit inside the same block paragraph. */
export function inSameParagraph(a: Node | null, b: Node | null): boolean {
  const pa = getParagraphElement(a ?? document.body);
  return pa !== null && pa === getParagraphElement(b ?? document.body);
}

/**
 * Whether two points lie in paragraphs of the same document, different or
 * not: both in a block, and the blocks siblings under one editable element.
 * A selection from the prose into the chrome around it is not a passage.
 */
export function inSameDocument(a: Node | null, b: Node | null): boolean {
  const pa = getParagraphElement(a ?? document.body);
  const pb = getParagraphElement(b ?? document.body);
  return (
    pa !== null &&
    pb !== null &&
    pa.parentElement !== null &&
    pa.parentElement === pb.parentElement
  );
}
