// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The document as one text, for find: the paragraphs joined by a line break,
// which is what a query's break means.
//
// A page break joined as "" would let a query of two breaks match across it,
// and a replace would delete a page break the writer never searched for. So a
// page break and the joins either side of it stand as a character no query
// can hold (`PAGE_BREAK_MARK`).
//
// The DOM painter in `views/writing/highlights.ts` must join the surface's
// blocks by this same function, so the find panel's count and the marks on
// the page agree.

import type { Cursor, Doc } from "./model";

export const PARAGRAPH_BREAK = "\n";

export const PAGE_BREAK_MARK = "\u0000";

export interface JoinBlock {
  text: string;
  pagebreak: boolean;
}

export interface JoinedText {
  text: string;
  /** Where each block starts in `text`. */
  starts: readonly number[];
}

/** Blocks joined by `PARAGRAPH_BREAK`, a page break and its joins marked. */
export function joinBlocks(blocks: readonly JoinBlock[]): JoinedText {
  const starts: number[] = [];
  let text = "";
  blocks.forEach((block, index) => {
    if (index > 0)
      text +=
        block.pagebreak || blocks[index - 1].pagebreak
          ? PAGE_BREAK_MARK
          : PARAGRAPH_BREAK;
    starts.push(text.length);
    text += block.pagebreak ? PAGE_BREAK_MARK : block.text;
  });
  return { text, starts };
}

export function joinedText(doc: Doc): JoinedText {
  return joinBlocks(
    doc.map((paragraph) => ({
      text: paragraph.runs.map((run) => run.text).join(""),
      pagebreak: paragraph.blockType === "pagebreak",
    })),
  );
}

/**
 * The block and offset of a position in the joined text. A position on a
 * join belongs to the end of the block before it, where a match that ends
 * just before a break ends.
 */
export function cursorAt(joined: JoinedText, index: number): Cursor {
  const { starts } = joined;
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= index) low = mid;
    else high = mid - 1;
  }
  return { para: low, offset: index - starts[low] };
}
