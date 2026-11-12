// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The document model, the one data shape the engine is built on. Code
// outside the engine sees it only through the barrel, `engine/index.ts`.
//
//   Doc = Paragraph[]          one block per element, in document order
//   Paragraph = runs + alignment + blockType
//   Run = text + Format        a contiguous stretch of same-formatted text
//
// A paragraph is either a page break (blockType `pagebreak`, with no runs,
// because the break carries no content) or a text block with at least one
// run. The operations merge adjacent runs with identical formats. A run may
// hold empty text, as a freshly split paragraph does, but a text block never
// holds zero runs.
//
// Every operation returns a new `Doc` that shares its untouched paragraphs
// with its predecessor, and nothing is mutated in place. Every type here is
// read-only because undo states share these objects, so a write from outside
// a command would change history too.
//
// Cursor offsets count visible characters in the paragraph's concatenated run
// text, never raw markdown characters.

export type BlockType = "paragraph" | "h1" | "h2" | "pagebreak";

export type Format = {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly monospace: boolean;
};

export type Run = { readonly text: string; readonly format: Format };

export type Alignment = "left" | "center" | "right" | "justify";

export type Paragraph = {
  readonly runs: readonly Run[];
  readonly alignment: Alignment;
  readonly blockType: BlockType;
};

export type Doc = readonly Paragraph[];

export type Cursor = { readonly para: number; readonly offset: number };

export type Selection = { readonly anchor: Cursor; readonly focus: Cursor };

// A normalized span of the document, in document order, with no direction.
export type Range = { readonly start: Cursor; readonly end: Cursor };

// A search match in visible-character offsets. `endPara` is the same
// paragraph as `para` unless the query held a paragraph break.
export interface Match {
  para: number;
  startOffset: number;
  endPara: number;
  endOffset: number;
}
