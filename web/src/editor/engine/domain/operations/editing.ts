// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The editing operations ───────────────────────────────────────────────────
//
// Every mutation of the document, as pure functions: a `Doc` and a selection
// in, a new `Doc` out that shares every untouched paragraph with the input.
//
// An edit splits a paragraph into per-code-unit units (`runsToChars`), edits
// the range, and re-merges the result into runs (`charsToRuns`). Offsets stay
// in UTF-16 code units end to end, as the DOM's do. A single-character
// delete removes one grapheme cluster (`graphemes.ts`), so it never leaves
// half of what the writer sees as one character.
//
// The operations preserve:
//   - the document never shrinks below one paragraph
//   - a page break never gains runs; merging across a break drops the break
//   - the cursor always lands on a position `validateSelection` accepts

import type { Doc, Paragraph, Run, Format, Cursor, Selection } from "../model";
import { normalizeSelection, isCollapsed } from "./queries";
import { splitWords } from "../words";
import { graphemeAfter, graphemeBefore } from "../graphemes";

export type Char = { char: string; format: Format };

export function runsToChars(runs: readonly Run[]): Char[] {
  return runs.flatMap((run) =>
    run.text.split("").map((char) => ({ char, format: { ...run.format } })),
  );
}

export function charsToRuns(chars: Char[]): Run[] {
  if (chars.length === 0)
    return [
      { text: "", format: { bold: false, italic: false, monospace: false } },
    ];
  const runs: Run[] = [];
  for (const c of chars) {
    const prev = runs[runs.length - 1];
    if (
      prev &&
      prev.format.bold === c.format.bold &&
      prev.format.italic === c.format.italic &&
      prev.format.monospace === c.format.monospace
    ) {
      runs[runs.length - 1] = { ...prev, text: prev.text + c.char };
    } else {
      runs.push({ text: c.char, format: { ...c.format } });
    }
  }
  return runs;
}

export function paraLength(para: Paragraph): number {
  return para.runs.reduce((sum, r) => sum + r.text.length, 0);
}

function paraPlainText(para: Paragraph): string {
  return para.runs.map((r) => r.text).join("");
}

// Delete the range [start, end), within one paragraph or across several.
export function deleteRange(
  doc: Doc,
  start: Cursor,
  end: Cursor,
): { doc: Doc; cursor: Cursor } {
  if (start.para === end.para) {
    const para = doc[start.para];
    const chars = runsToChars(para.runs);
    const newChars = [
      ...chars.slice(0, start.offset),
      ...chars.slice(end.offset),
    ];
    const newDoc = doc.map((p, i) =>
      i === start.para ? { ...p, runs: charsToRuns(newChars) } : p,
    );
    return { doc: newDoc, cursor: start };
  }

  const startPara = doc[start.para];
  const endPara = doc[end.para];
  const before = runsToChars(startPara.runs).slice(0, start.offset);
  const after = runsToChars(endPara.runs).slice(end.offset);
  // Merging across a page break deletes the break: the merged block is a
  // text paragraph, never a break with text in it.
  const merged: Paragraph = {
    ...startPara,
    runs: charsToRuns([...before, ...after]),
    blockType:
      startPara.blockType === "pagebreak" ? "paragraph" : startPara.blockType,
  };

  const newDoc = [
    ...doc.slice(0, start.para),
    merged,
    ...doc.slice(end.para + 1),
  ];
  return { doc: newDoc, cursor: start };
}

export function insertText(
  doc: Doc,
  sel: Selection,
  text: string,
  format: Format,
): { doc: Doc; cursor: Cursor } {
  let d = doc;
  let cursor: Cursor;

  if (!isCollapsed(sel)) {
    const { start, end } = normalizeSelection(sel);
    const r = deleteRange(d, start, end);
    d = r.doc;
    cursor = r.cursor;
  } else {
    cursor = sel.anchor;
  }

  // Typing on a page break replaces the break with a plain text paragraph.
  if (d[cursor.para]?.blockType === "pagebreak") {
    d = d.map((p, i) =>
      i === cursor.para ? { ...p, blockType: "paragraph" as const } : p,
    );
  }

  const para = d[cursor.para];
  const chars = runsToChars(para.runs);
  const inserted: Char[] = text.split("").map((char) => ({ char, format }));
  const newChars = [
    ...chars.slice(0, cursor.offset),
    ...inserted,
    ...chars.slice(cursor.offset),
  ];
  const newDoc = d.map((p, i) =>
    i === cursor.para ? { ...p, runs: charsToRuns(newChars) } : p,
  );
  return {
    doc: newDoc,
    cursor: { para: cursor.para, offset: cursor.offset + text.length },
  };
}

export function deleteBackward(
  doc: Doc,
  sel: Selection,
): { doc: Doc; cursor: Cursor } {
  if (!isCollapsed(sel)) {
    const { start, end } = normalizeSelection(sel);
    return deleteRange(doc, start, end);
  }

  const cursor = sel.anchor;

  if (cursor.offset > 0) {
    const text = paraPlainText(doc[cursor.para]);
    return deleteRange(
      doc,
      { ...cursor, offset: graphemeBefore(text, cursor.offset) },
      cursor,
    );
  }

  if (cursor.para > 0) {
    const prevLen = paraLength(doc[cursor.para - 1]);
    return deleteRange(
      doc,
      { para: cursor.para - 1, offset: prevLen },
      { para: cursor.para, offset: 0 },
    );
  }

  return { doc, cursor };
}

export function deleteForward(
  doc: Doc,
  sel: Selection,
): { doc: Doc; cursor: Cursor } {
  if (!isCollapsed(sel)) {
    const { start, end } = normalizeSelection(sel);
    return deleteRange(doc, start, end);
  }

  const cursor = sel.anchor;
  const len = paraLength(doc[cursor.para]);

  if (cursor.offset < len) {
    const text = paraPlainText(doc[cursor.para]);
    return deleteRange(doc, cursor, {
      ...cursor,
      offset: graphemeAfter(text, cursor.offset),
    });
  }

  if (cursor.para < doc.length - 1) {
    return deleteRange(doc, cursor, { para: cursor.para + 1, offset: 0 });
  }

  return { doc, cursor };
}

// ── Word and line deletion ───────────────────────────────────────────────────
//
// Ctrl+Backspace, Ctrl+Delete and the Mac's Cmd+Backspace. The browser's
// default is prevented, so without these the keystrokes do nothing. They use
// the shared `splitWords` tokenizer, so features agree on what a word is.

/** Delete one word backward from the cursor (Ctrl+Backspace). The nearest
 * word token that starts before the cursor is where the delete begins, so
 * any separator between that word and the cursor goes too, as in browsers.
 * With no such token, it deletes back to the paragraph's start. It never
 * crosses a paragraph boundary itself: at offset 0 it is the plain
 * backspace's paragraph join. */
export function deleteWordBackward(
  doc: Doc,
  sel: Selection,
): { doc: Doc; cursor: Cursor } {
  if (!isCollapsed(sel)) {
    const { start, end } = normalizeSelection(sel);
    return deleteRange(doc, start, end);
  }
  const cursor = sel.anchor;
  if (cursor.offset === 0) return deleteBackward(doc, sel);
  const text = paraPlainText(doc[cursor.para]);
  let from = 0;
  for (const token of splitWords(text)) {
    if (token.start >= cursor.offset) break;
    from = token.start;
  }
  return deleteRange(doc, { ...cursor, offset: from }, cursor);
}

/** Delete one word forward from the cursor (Ctrl+Delete), the mirror of
 * `deleteWordBackward`. */
export function deleteWordForward(
  doc: Doc,
  sel: Selection,
): { doc: Doc; cursor: Cursor } {
  if (!isCollapsed(sel)) {
    const { start, end } = normalizeSelection(sel);
    return deleteRange(doc, start, end);
  }
  const cursor = sel.anchor;
  const text = paraPlainText(doc[cursor.para]);
  if (cursor.offset >= text.length) return deleteForward(doc, sel);
  const tokens = splitWords(text);
  let to = text.length;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].end <= cursor.offset) break;
    to = tokens[i].end;
  }
  return deleteRange(doc, cursor, { ...cursor, offset: to });
}

/** Delete from the cursor back to the start of its paragraph (Cmd+Backspace
 * on the Mac). A soft line is a layout fact the domain model cannot see, so
 * the paragraph stands for the line. At offset 0 this is the plain
 * backspace's paragraph join. */
export function deleteSoftLineBackward(
  doc: Doc,
  sel: Selection,
): { doc: Doc; cursor: Cursor } {
  if (!isCollapsed(sel)) {
    const { start, end } = normalizeSelection(sel);
    return deleteRange(doc, start, end);
  }
  const cursor = sel.anchor;
  if (cursor.offset === 0) return deleteBackward(doc, sel);
  return deleteRange(doc, { ...cursor, offset: 0 }, cursor);
}

export function insertParagraph(
  doc: Doc,
  sel: Selection,
): { doc: Doc; cursor: Cursor } {
  let d = doc;
  let cursor: Cursor;

  if (!isCollapsed(sel)) {
    const { start, end } = normalizeSelection(sel);
    const r = deleteRange(d, start, end);
    d = r.doc;
    cursor = r.cursor;
  } else {
    cursor = sel.anchor;
  }

  // A page break has no text to split, so Enter on one adds an empty
  // paragraph after it.
  if (d[cursor.para]?.blockType === "pagebreak") {
    const newDoc = [
      ...d.slice(0, cursor.para + 1),
      emptyParagraph(),
      ...d.slice(cursor.para + 1),
    ];
    return { doc: newDoc, cursor: { para: cursor.para + 1, offset: 0 } };
  }

  const para = d[cursor.para];
  const chars = runsToChars(para.runs);
  const before = chars.slice(0, cursor.offset);
  const after = chars.slice(cursor.offset);

  const para1: Paragraph = { ...para, runs: charsToRuns(before) };
  // At the end of a paragraph the new one takes the format of the last
  // character before the cursor, so typing continues in that format.
  const afterRuns =
    after.length > 0
      ? charsToRuns(after)
      : [
          {
            text: "",
            format:
              before.length > 0
                ? { ...before[before.length - 1].format }
                : { bold: false, italic: false, monospace: false },
          },
        ];
  const para2: Paragraph = { ...para, runs: afterRuns };

  const newDoc = [
    ...d.slice(0, cursor.para),
    para1,
    para2,
    ...d.slice(cursor.para + 1),
  ];
  return { doc: newDoc, cursor: { para: cursor.para + 1, offset: 0 } };
}

function emptyParagraph(): Paragraph {
  return {
    runs: [
      { text: "", format: { bold: false, italic: false, monospace: false } },
    ],
    alignment: "left",
    blockType: "paragraph",
  };
}

function isEmptyTextParagraph(para: Paragraph): boolean {
  return (
    para.blockType === "paragraph" &&
    para.runs.reduce((sum, r) => sum + r.text.length, 0) === 0
  );
}

// ── Whole-block operations ───────────────────────────────────────────────────
//
// Range edits cannot express these: `deleteRange` on a full paragraph merges
// it with its neighbour rather than removing the block, and `insertFragment`
// splices inline into the paragraph under the cursor.

export function insertBlocks(doc: Doc, index: number, blocks: Doc): Doc {
  const at = Math.min(index, doc.length);
  // An empty text paragraph at the landing position is a placeholder, either
  // a block-delete sweep's leftover or the writer's own blank line, and the
  // inserted blocks take its place, so a sweep followed by an insert
  // converges in any accept order. A paragraph with text is never replaced.
  if (doc[at] && isEmptyTextParagraph(doc[at])) {
    return [...doc.slice(0, at), ...blocks, ...doc.slice(at + 1)];
  }
  return [...doc.slice(0, at), ...blocks, ...doc.slice(at)];
}

export function deleteBlocks(doc: Doc, from: number, to: number): Doc {
  const remaining = [...doc.slice(0, from), ...doc.slice(to)];
  if (remaining.length > 0) return remaining;
  // Never below one paragraph: the sweep leaves an empty placeholder, which
  // the next `insertBlocks` at that index replaces.
  return [emptyParagraph()];
}

// Split the paragraph at the cursor around a page break: [before] / break /
// [after], with the cursor left after the break. On a break itself, another
// break goes after it.
export function insertPageBreak(
  doc: Doc,
  sel: Selection,
): { doc: Doc; cursor: Cursor } {
  const cursor = sel.anchor;
  const para = doc[cursor.para];

  if (para.blockType === "pagebreak") {
    const newDoc = [
      ...doc.slice(0, cursor.para + 1),
      { ...para },
      ...doc.slice(cursor.para + 1),
    ];
    return { doc: newDoc, cursor: { para: cursor.para + 1, offset: 0 } };
  }

  const chars = runsToChars(para.runs);
  const before = chars.slice(0, cursor.offset);
  const after = chars.slice(cursor.offset);
  const breakPara: Paragraph = {
    runs: [],
    alignment: "left",
    blockType: "pagebreak",
  };

  const para1: Paragraph = { ...para, runs: charsToRuns(before) };
  const para3: Paragraph = { ...para, runs: charsToRuns(after) };

  const newDoc = [
    ...doc.slice(0, cursor.para),
    para1,
    breakPara,
    para3,
    ...doc.slice(cursor.para + 1),
  ];
  return { doc: newDoc, cursor: { para: cursor.para + 2, offset: 0 } };
}
