// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  joinBlocks,
  wordCharRegex,
  type DiffDecoration,
  type Hunk,
} from "../../engine";
import type { ViewSearchState, ViewSelectionState } from "../view/port";
import { getParagraphs } from "./dom";

// ── The DOM highlight pipeline ───────────────────────────────────────────────
//
// The search bar counts matches on the engine's text; the editor highlights
// them on the DOM. The word-character definition comes from the search
// adapter (`wordCharRegex`), so the two never disagree about what a word is.

export interface TextNodeInfo {
  node: Text;
  start: number; // start offset in concatenated string
  end: number; // end offset in concatenated string
}

export function collectTextNodes(root: HTMLElement): TextNodeInfo[] {
  const nodes: TextNodeInfo[] = [];
  let offset = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Text | null;
  while ((n = walker.nextNode() as Text | null)) {
    const len = n.textContent?.length ?? 0;
    nodes.push({ node: n, start: offset, end: offset + len });
    offset += len;
  }
  return nodes;
}

/**
 * The surface's text as find reads the document: its blocks joined
 * by `joinBlocks`, the engine's own join, so a query's paragraph break
 * meets the break between two blocks here as it does in the count, and a
 * page break is a block no query reaches. Each text node is placed at
 * its offset in that text; the joins belong to no node, and a mark never
 * wraps one. A root with no blocks in it is read as one.
 */
export function joinedSurface(root: HTMLElement): {
  text: string;
  nodes: TextNodeInfo[];
} {
  const found = getParagraphs(root);
  const blocks = found.length > 0 ? found : [root];
  const joined = joinBlocks(
    blocks.map((block) => ({
      text: block.textContent ?? "",
      pagebreak: block.tagName === "HR",
    })),
  );
  const nodes = blocks.flatMap((block, index) =>
    block.tagName === "HR"
      ? []
      : collectTextNodes(block as HTMLElement).map((info) => ({
          ...info,
          start: info.start + joined.starts[index],
          end: info.end + joined.starts[index],
        })),
  );
  return { text: joined.text, nodes };
}

export function findInConcatenated(
  fullText: string,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  hyphensJoinWords = false,
): { start: number; end: number }[] {
  if (!query) return [];
  const results: { start: number; end: number }[] = [];
  const haystack = caseSensitive ? fullText : fullText.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const isWordChar = wordCharRegex(hyphensJoinWords);
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    if (wholeWord) {
      const before = idx > 0 ? fullText[idx - 1] : " ";
      const after =
        idx + needle.length < fullText.length
          ? fullText[idx + needle.length]
          : " ";
      if (isWordChar.test(before) || isWordChar.test(after)) {
        idx += needle.length || 1;
        continue;
      }
    }
    results.push({ start: idx, end: idx + query.length });
    idx += query.length || 1;
  }
  return results;
}

export interface HighlightItem {
  text: string;
  className: string;
  exactText?: string;
}

export interface CurrentHighlight {
  text: string;
  index: number;
  caseSensitive: boolean;
  wholeWord: boolean;
  hyphensJoinWords: boolean;
  /** `evidence` paints only the current occurrence, as `hl-evidence`. */
  mark?: "search" | "evidence";
}

export function applyHighlights(
  root: HTMLElement,
  items: HighlightItem[],
  currentHighlight?: CurrentHighlight,
  selectedPosition?: number, // flat position in concatenated text where selection starts
  selectedLength?: number, // length of the exact selection
  tooltipText?: string, // localized tooltip for repetition highlights
): void {
  // Existing highlights are unwrapped first, never the diff's own marks
  // (`clearMarks`). Adjacent text nodes the removal split are merged only
  // when something was removed, because a walk of the whole editor on every
  // keystroke with no mark merges nothing.
  if (clearMarks(root) > 0) root.normalize();

  if (items.length === 0 && !currentHighlight) return;

  const { text: fullText, nodes: textNodes } = joinedSurface(root);
  if (textNodes.length === 0) return;

  interface RangeCandidate {
    start: number;
    end: number;
    className: string;
  }
  const candidates: RangeCandidate[] = [];

  for (const item of items) {
    const isSelectionHighlight = item.className === "hl-selection";

    if (isSelectionHighlight && selectedPosition !== undefined) {
      // A selection highlight marks the other whole-word occurrences of the
      // word, never the selected one, which the native selection shows.
      const wordMatches = findInConcatenated(fullText, item.text, false, true);
      const selEnd = selectedPosition + (selectedLength ?? item.text.length);
      for (const wm of wordMatches) {
        if (wm.start < selEnd && wm.end > selectedPosition) continue;
        candidates.push({
          start: wm.start,
          end: wm.end,
          className: "hl-repetition",
        });
      }
    } else {
      // Any other item, or a selection without a position, matches as is.
      const matches = findInConcatenated(fullText, item.text, false, false);
      for (let i = 0; i < matches.length; i++) {
        candidates.push({
          start: matches[i].start,
          end: matches[i].end,
          className: item.className,
        });
      }
    }
  }

  if (currentHighlight && currentHighlight.text) {
    const cs = currentHighlight.caseSensitive;
    const ww = currentHighlight.wholeWord;
    const matches = findInConcatenated(
      fullText,
      currentHighlight.text,
      cs,
      ww,
      currentHighlight.hyphensJoinWords,
    );
    const evidence = currentHighlight.mark === "evidence";
    for (let i = 0; i < matches.length; i++) {
      // An evidence arrival is one passage the assistant pointed at, not a
      // query with siblings: its other occurrences are not what was cited.
      if (evidence && i !== currentHighlight.index) continue;
      const className = evidence
        ? "hl-evidence"
        : i === currentHighlight.index
          ? "hl-search-current"
          : "hl-search";
      candidates.push({
        start: matches[i].start,
        end: matches[i].end,
        className,
      });
    }
  }

  // Applied from end to start, so earlier positions stay valid.
  candidates.sort((a, b) => b.start - a.start);

  // The overlap floor: a candidate overlaps the painted set when its end
  // passes the lowest painted start. Two registers can feed one word (the
  // repetition register and a seeded search), and without the floor the
  // second maps onto a node the first wrap already split, so `setEnd`
  // overruns it with a stale offset and crashes the editor.
  let appliedFloor = Infinity;
  for (const cand of candidates) {
    if (cand.end > appliedFloor) continue;
    // Advanced before the wrap: a wrap can throw after changing the DOM, and
    // the span must still count as applied.
    appliedFloor = cand.start;

    // A match may begin or end on a paragraph's join (a query that starts
    // or ends with a break), which belongs to no node: it is painted
    // from the first text after its start to the last text before its end.
    let startNode: TextNodeInfo | null = null;
    let startAt = 0;
    let endNode: TextNodeInfo | null = null;
    let endAt = 0;
    // The nodes are in document order and do not overlap, so their ends do
    // not decrease and the bisection is valid.
    for (
      let i = firstEndingAfter(textNodes, cand.start);
      i < textNodes.length && textNodes[i].start < cand.end;
      i++
    ) {
      const tn = textNodes[i];
      if (!startNode && cand.start < tn.end && tn.start < cand.end) {
        startNode = tn;
        startAt = Math.max(0, cand.start - tn.start);
      }
      if (tn.start < cand.end && cand.start < tn.end) {
        endNode = tn;
        endAt = Math.min(tn.end, cand.end) - tn.start;
      }
    }
    if (!startNode || !endNode) continue;

    const range = document.createRange();
    range.setStart(startNode.node, startAt);
    range.setEnd(endNode.node, endAt);

    const tooltip =
      cand.className === "hl-repetition" && tooltipText
        ? tooltipText
        : undefined;
    try {
      // `surroundContents` rejects a range that crosses an element boundary
      // (it would have to move a whole element), a match the search bar shows
      // often, so each text node of the range is wrapped separately.
      for (const piece of textNodesInRange(range)) {
        if (piece.from >= piece.to) continue;
        wrapTextRange(
          piece.node,
          piece.from,
          piece.to,
          cand.className,
          tooltip,
        );
      }
    } catch {
      // An unwrappable node mix is skipped rather than corrupting the tree.
    }
  }
}

/** The index of the first node whose end passes `offset`, by bisection. */
function firstEndingAfter(nodes: readonly TextNodeInfo[], offset: number) {
  let low = 0;
  let high = nodes.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (nodes[mid].end > offset) high = mid;
    else low = mid + 1;
  }
  return low;
}

/**
 * Unwrap every `<mark>` except the diff's own (`.df-deleted`,
 * `.df-inserted`), which the diff pass alone cleans up. Returns the count
 * removed.
 */
export function clearMarks(root: HTMLElement): number {
  let removed = 0;
  root.querySelectorAll("mark").forEach((mark) => {
    if (
      mark.classList.contains("df-deleted") ||
      mark.classList.contains("df-inserted")
    )
      return;
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    removed++;
  });
  return removed;
}

/** Wrap `[from, to)` of a text node in a `<mark>`, splitting the node. */
export function wrapTextRange(
  node: Text,
  from: number,
  to: number,
  className: string,
  tooltip: string | undefined,
): void {
  let piece: Text = node;
  if (from > 0) piece = node.splitText(from) as Text;
  const length = piece.textContent?.length ?? 0;
  if (to - from < length) piece.splitText(to - from);
  const mark = document.createElement("mark");
  mark.className = className;
  if (tooltip) mark.setAttribute("data-tooltip", tooltip);
  piece.parentNode?.insertBefore(mark, piece);
  piece.parentNode?.removeChild(piece);
  mark.appendChild(piece);
}

// ── Diff marks ───────────────────────────────────────────────────────────────
//
// The comparing mode's decorations arrive in visible-character offsets per
// paragraph and are painted with the same text-node walk as the search marks.

/**
 * Idempotent: unwraps its own marks and hunk wrappers first, then re-applies
 * from the given decorations and hunks. Offsets are paragraph-relative.
 *
 * The hunk wrappers go first, over plain text, and the decorations then wrap
 * the text inside them, so the shape is always `span.df-hunk > mark.df-*`.
 * The other order can invert the DOM to `mark > span`, which no `.df-hunk
 * mark` rule matches. A textless block hunk (a page break) has no wrapper;
 * the layer anchors to the paragraph instead.
 */
export function applyDiffMarks(
  root: HTMLElement,
  items: readonly DiffDecoration[],
  hunks: readonly Hunk[] = [],
): void {
  let removed = 0;
  root
    .querySelectorAll("mark.df-deleted, mark.df-inserted, span.df-hunk")
    .forEach((deco) => {
      const parent = deco.parentNode;
      if (!parent) return;
      while (deco.firstChild) parent.insertBefore(deco.firstChild, deco);
      parent.removeChild(deco);
      removed++;
    });
  // A textless block hunk marks the paragraph itself, so its attributes are
  // cleared here too. A leftover one keeps a stale tint, and
  // `patchDocument`'s `sameParagraph` would read it as a content change on
  // every later patch.
  root.querySelectorAll("[data-block-hunk]").forEach((el) => {
    el.removeAttribute("data-block-hunk");
    el.removeAttribute("data-hunk-id");
  });
  // Only when a wrapper came off: there is nothing to merge otherwise.
  if (removed > 0) root.normalize();
  if (items.length === 0 && hunks.length === 0) return;

  const paragraphs = getParagraphs(root);

  // Hunks first, over plain text.
  for (const hunk of hunks) {
    const paraEl = paragraphs[hunk.para];
    if (hunk.merged.from >= hunk.merged.to) {
      // A textless block hunk: an inserted or deleted blank paragraph, or a
      // page break. An empty range extracts nothing, so the paragraph itself
      // carries the mark, or the change would read as an ordinary blank
      // line. `editor.css`'s `[data-block-hunk]` rules paint it.
      if (paraEl instanceof HTMLElement) {
        paraEl.dataset.blockHunk = hunk.kind;
        paraEl.dataset.hunkId = String(hunk.id);
      }
      continue;
    }
    if (!(paraEl instanceof HTMLElement)) continue;
    const textNodes = collectTextNodes(paraEl);
    if (textNodes.length === 0) continue;
    const startNode = textNodes.find(
      (tn) => tn.start <= hunk.merged.from && hunk.merged.from < tn.end,
    );
    const endNode = textNodes.find(
      (tn) => tn.start < hunk.merged.to && hunk.merged.to <= tn.end,
    );
    if (!startNode || !endNode) continue;
    const range = document.createRange();
    range.setStart(startNode.node, hunk.merged.from - startNode.start);
    range.setEnd(endNode.node, hunk.merged.to - endNode.start);
    const span = document.createElement("span");
    span.className = "df-hunk";
    span.dataset.hunkId = String(hunk.id);
    span.dataset.kind = hunk.kind;
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
    } catch {
      // An unwrappable range keeps no wrapper; the layer anchors to the
      // paragraph.
    }
  }

  // The decorations second, inside the wrappers.
  for (const item of items) {
    const paraEl = paragraphs[item.para];
    if (!(paraEl instanceof HTMLElement)) continue;
    const textNodes = collectTextNodes(paraEl);
    if (textNodes.length === 0) continue;

    const range = document.createRange();
    const startNode = textNodes.find(
      (tn) => tn.start <= item.from && item.from < tn.end,
    );
    const endNode = textNodes.find(
      (tn) => tn.start < item.to && item.to <= tn.end,
    );
    if (!startNode || !endNode) continue;
    range.setStart(startNode.node, item.from - startNode.start);
    range.setEnd(endNode.node, item.to - endNode.start);
    const className = item.kind === "deleted" ? "df-deleted" : "df-inserted";
    for (const piece of textNodesInRange(range)) {
      if (piece.from >= piece.to) continue;
      wrapTextRange(piece.node, piece.from, piece.to, className, undefined);
    }
  }
}

/** Every text node a range covers, with the offsets of the piece to wrap. */
function textNodesInRange(
  range: Range,
): { node: Text; from: number; to: number }[] {
  const { startContainer, startOffset, endContainer, endOffset } = range;
  if (
    startContainer.nodeType !== Node.TEXT_NODE ||
    endContainer.nodeType !== Node.TEXT_NODE
  )
    return [];

  // A TreeWalker never visits its own root, so a range inside one text node
  // has to be taken directly.
  if (startContainer === endContainer) {
    return [{ node: startContainer as Text, from: startOffset, to: endOffset }];
  }

  const out: { node: Text; from: number; to: number }[] = [];
  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
  );
  let inside = false;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    if (text === startContainer) {
      inside = true;
      out.push({
        node: text,
        from: startOffset,
        to: text.textContent?.length ?? startOffset,
      });
      continue;
    }
    if (!inside) continue;
    if (text === endContainer) {
      out.push({ node: text, from: 0, to: endOffset });
      break;
    }
    out.push({ node: text, from: 0, to: text.textContent?.length ?? 0 });
  }
  return out;
}

// ── One paint of the writing surface ─────────────────────────────────────────
//
// The surface paints after a document patch and after a search or selection
// change. Both go through here, so a register added elsewhere would vanish at
// the next keystroke.

/**
 * Paint the repetition and search registers from the view's two states.
 * `anchorPosition` is a thunk because computing it walks the document's text.
 */
export function paintHighlights(
  root: HTMLElement,
  selection: ViewSelectionState,
  search: ViewSearchState,
  anchorPosition: () => number,
  tooltipText: string,
): void {
  const items: HighlightItem[] = [];
  let selectedPosition: number | undefined;
  let selectedLength: number | undefined;
  if (selection.text && selection.showRepetitions) {
    items.push({ text: selection.text, className: "hl-selection" });
    selectedPosition = anchorPosition();
    selectedLength = (selection.exactText ?? selection.text).length;
  }
  const current: CurrentHighlight | undefined = search.query
    ? {
        text: search.query,
        index: search.currentIndex,
        caseSensitive: search.caseSensitive,
        wholeWord: search.wholeWord,
        hyphensJoinWords: search.hyphensJoinWords,
        mark: search.mark,
      }
    : undefined;
  applyHighlights(
    root,
    items,
    current,
    selectedPosition,
    selectedLength,
    tooltipText,
  );
  filterRepetitionMarksOutsideViewport(root);
}

// ── Viewport filtering ───────────────────────────────────────────────────────
//
// Every rect is read before the first unwrap: a read after a DOM write forces
// a synchronous layout, one per mark.

export function filterRepetitionMarksOutsideViewport(root: HTMLElement): void {
  const marks = [...root.querySelectorAll("mark.hl-repetition")];
  const viewportHeight = window.innerHeight;

  const outside = marks.filter((mark) => {
    const rect = mark.getBoundingClientRect();
    return rect.bottom < -10 || rect.top > viewportHeight + 10;
  });
  for (const mark of outside) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  }
}
