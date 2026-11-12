// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The document-level half of cut, copy and paste, as pure functions with no
// browser API.
//
// A copied page break becomes an empty paragraph: a `<hr>` in a foreign
// editor is a rule, not a page break.

import type { Cursor, Doc, Paragraph, Range, Selection } from "../model";
import { runsToChars, charsToRuns, deleteRange } from "./editing";

function emptyParagraph(): Paragraph {
  return {
    runs: [
      { text: "", format: { bold: false, italic: false, monospace: false } },
    ],
    alignment: "left",
    blockType: "paragraph",
  };
}

function isCollapsedRange(range: Range): boolean {
  return (
    range.start.para === range.end.para &&
    range.start.offset === range.end.offset
  );
}

function paragraphText(para: Paragraph): string {
  return para.runs.map((r) => r.text).join("");
}

/**
 * The selection as a clipboard fragment. A page break inside the range becomes
 * an empty paragraph (a blank line); every other paragraph keeps its blockType
 * and alignment. A collapsed range yields a single empty paragraph.
 */
export function extractRange(doc: Doc, range: Range): Doc {
  if (isCollapsedRange(range)) return [emptyParagraph()];

  const { start, end } = range;
  const result: Paragraph[] = [];
  for (let p = start.para; p <= end.para; p++) {
    const para = doc[p];
    if (para.blockType === "pagebreak") {
      result.push(emptyParagraph());
      continue;
    }
    const chars = runsToChars(para.runs);
    const from = p === start.para ? start.offset : 0;
    const to = p === end.para ? end.offset : chars.length;
    result.push({
      runs: charsToRuns(chars.slice(from, to)),
      blockType: para.blockType,
      alignment: para.alignment,
    });
  }
  return result;
}

/** The selection as plain text, paragraphs joined with a newline. */
export function sliceText(doc: Doc, range: Range): string {
  if (isCollapsedRange(range)) return "";

  const { start, end } = range;
  if (start.para === end.para) {
    const para = doc[start.para];
    if (para.blockType === "pagebreak") return "";
    return paragraphText(para).slice(start.offset, end.offset);
  }

  const parts: string[] = [];
  for (let p = start.para; p <= end.para; p++) {
    const para = doc[p];
    if (para.blockType === "pagebreak") {
      parts.push("");
      continue;
    }
    const text = paragraphText(para);
    const from = p === start.para ? start.offset : 0;
    const to = p === end.para ? end.offset : text.length;
    parts.push(text.slice(from, to));
  }
  return parts.join("\n");
}

/**
 * Splice a clipboard fragment into the document at `range`, replacing the
 * selection. The cursor lands at the end of the pasted content.
 *
 * A single-paragraph fragment is inserted inline. The target paragraph keeps
 * its block type and alignment unless it had no text either side, where the
 * fragment's own win, so pasting a heading into an empty paragraph makes a
 * heading. A multi-paragraph fragment splits the target: the head and tail
 * paragraphs keep the target's block type where they merge with existing
 * text, and the fragment's own where they stand alone, so a heading pasted at
 * the start or end of a line survives.
 */
export function insertFragment(
  doc: Doc,
  range: Range,
  fragment: Doc,
): { doc: Doc; cursor: Cursor } {
  let d = doc;
  let cursor: Cursor;
  if (!isCollapsedRange(range)) {
    const r = deleteRange(d, range.start, range.end);
    d = r.doc;
    cursor = r.cursor;
  } else {
    cursor = range.start;
  }

  if (fragment.length === 0) return { doc: d, cursor };

  const target = d[cursor.para];
  // Pasting on a page break replaces it with a plain paragraph.
  const chars =
    target.blockType === "pagebreak" ? [] : runsToChars(target.runs);
  const before = chars.slice(0, cursor.offset);
  const after = chars.slice(cursor.offset);

  if (fragment.length === 1) {
    const only = fragment[0];
    const incoming = runsToChars(only.runs);
    const merged = charsToRuns([...before, ...incoming, ...after]);
    const fromTarget = before.length > 0 || after.length > 0;
    const para: Paragraph = {
      runs: merged,
      blockType: fromTarget ? target.blockType : only.blockType,
      alignment: fromTarget ? target.alignment : only.alignment,
    };
    const newDoc = [
      ...d.slice(0, cursor.para),
      para,
      ...d.slice(cursor.para + 1),
    ];
    return {
      doc: newDoc,
      cursor: { para: cursor.para, offset: cursor.offset + incoming.length },
    };
  }

  const built: Paragraph[] = fragment.map((f, i) => {
    const incoming = runsToChars(f.runs);
    if (i === 0 && before.length > 0) {
      return {
        runs: charsToRuns([...before, ...incoming]),
        blockType: target.blockType,
        alignment: target.alignment,
      };
    }
    if (i === fragment.length - 1 && after.length > 0) {
      return {
        runs: charsToRuns([...incoming, ...after]),
        blockType: target.blockType,
        alignment: target.alignment,
      };
    }
    return {
      runs: charsToRuns(incoming),
      blockType: f.blockType,
      alignment: f.alignment,
    };
  });

  const newDoc = [
    ...d.slice(0, cursor.para),
    ...built,
    ...d.slice(cursor.para + 1),
  ];
  const last = fragment[fragment.length - 1];
  const lastLen = paragraphText(last).length;
  return {
    doc: newDoc,
    cursor: { para: cursor.para + fragment.length - 1, offset: lastLen },
  };
}

/**
 * Plain text as a document: one paragraph per line, all default format. A
 * trailing newline is a line terminator, not a blank line, and is dropped;
 * interior blank lines become empty paragraphs. Empty input yields the one
 * empty paragraph the engine invariant requires.
 */
export function parsePlainText(text: string): Doc {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line): Paragraph => ({
    runs: [
      { text: line, format: { bold: false, italic: false, monospace: false } },
    ],
    alignment: "left",
    blockType: "paragraph",
  }));
}

/** The whole document as a selection, from its start to its last offset. */
export function selectAllSelection(doc: Doc): Selection {
  const last = doc.length - 1;
  const offset =
    doc[last].blockType === "pagebreak" ? 0 : paragraphText(doc[last]).length;
  return {
    anchor: { para: 0, offset: 0 },
    focus: { para: last, offset },
  };
}
