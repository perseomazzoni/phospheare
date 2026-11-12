// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Read-only queries over the document: what the engine and the UI ask of it
// without changing it. Every query is pure and total. It never throws, and a
// cursor outside the document answers a default (no format, `left`,
// `paragraph`).

import type {
  Alignment,
  BlockType,
  Cursor,
  Doc,
  Format,
  Range,
  Selection,
} from "../model";

export function normalizeSelection(sel: Selection): Range {
  const { anchor, focus } = sel;
  const anchorFirst =
    anchor.para < focus.para ||
    (anchor.para === focus.para && anchor.offset <= focus.offset);
  return anchorFirst
    ? { start: anchor, end: focus }
    : { start: focus, end: anchor };
}

export function isCollapsed(sel: Selection): boolean {
  return (
    sel.anchor.para === sel.focus.para && sel.anchor.offset === sel.focus.offset
  );
}

export function getFormatAtCursor(doc: Doc, cursor: Cursor): Format {
  const para = doc[cursor.para];
  if (!para) return { bold: false, italic: false, monospace: false };
  let acc = 0;
  for (const run of para.runs) {
    acc += run.text.length;
    if (cursor.offset <= acc) return { ...run.format };
  }
  const last = para.runs[para.runs.length - 1];
  return last
    ? { ...last.format }
    : { bold: false, italic: false, monospace: false };
}

export function getAlignmentAtCursor(doc: Doc, cursor: Cursor): Alignment {
  return doc[cursor.para]?.alignment ?? "left";
}

export function getBlockTypeAtCursor(doc: Doc, cursor: Cursor): BlockType {
  return doc[cursor.para]?.blockType ?? "paragraph";
}
