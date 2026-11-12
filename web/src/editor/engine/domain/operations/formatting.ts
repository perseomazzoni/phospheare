// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Formatting mutations and queries. Toggling a format over a selection
// enables it unless every covered character has it, and then disables it;
// the toolbar's active-state queries rely on that rule. A selection across a
// page break leaves the break as it is.

import type { Alignment, BlockType, Cursor, Doc, Selection } from "../model";
import { normalizeSelection, isCollapsed, getFormatAtCursor } from "./queries";
import { runsToChars, charsToRuns } from "./editing";

export type FormatProp = "bold" | "italic" | "monospace";

// An empty span answers false, so a collapsed toggle enables.
function allCharsHave(
  doc: Doc,
  start: Cursor,
  end: Cursor,
  prop: FormatProp,
): boolean {
  if (start.para === end.para && start.offset === end.offset) return false;
  for (let p = start.para; p <= end.para; p++) {
    const chars = runsToChars(doc[p].runs);
    const from = p === start.para ? start.offset : 0;
    const to = p === end.para ? end.offset : chars.length;
    for (let i = from; i < to; i++) {
      if (!chars[i]?.format[prop]) return false;
    }
  }
  return true;
}

export function selectionHasFormat(
  doc: Doc,
  sel: Selection,
  prop: FormatProp,
): boolean {
  if (isCollapsed(sel)) return getFormatAtCursor(doc, sel.anchor)[prop];
  const { start, end } = normalizeSelection(sel);
  return allCharsHave(doc, start, end, prop);
}

export function toggleFormat(doc: Doc, sel: Selection, prop: FormatProp): Doc {
  const { start, end } = normalizeSelection(sel);
  const enable = !allCharsHave(doc, start, end, prop);

  return doc.map((para, p) => {
    if (p < start.para || p > end.para) return para;
    if (para.blockType === "pagebreak") return para;
    const chars = runsToChars(para.runs);
    const from = p === start.para ? start.offset : 0;
    const to = p === end.para ? end.offset : chars.length;
    for (let i = from; i < to; i++) {
      chars[i] = {
        ...chars[i],
        format: { ...chars[i].format, [prop]: enable },
      };
    }
    return { ...para, runs: charsToRuns(chars) };
  });
}

export function setAlignment(
  doc: Doc,
  paraIdx: number,
  alignment: Alignment,
): Doc {
  if (doc[paraIdx].alignment === alignment) return doc;
  return doc.map((p, i) => (i === paraIdx ? { ...p, alignment } : p));
}

export function setBlockType(
  doc: Doc,
  paraIdx: number,
  blockType: BlockType,
): Doc {
  if (doc[paraIdx].blockType === blockType) return doc;
  return doc.map((p, i) => (i === paraIdx ? { ...p, blockType } : p));
}

export function toggleCase(doc: Doc, sel: Selection): Doc {
  const { start, end } = normalizeSelection(sel);

  // All lowercase goes upper; anything else goes lower.
  let allLower = true;
  for (let p = start.para; p <= end.para; p++) {
    const chars = runsToChars(doc[p].runs);
    const from = p === start.para ? start.offset : 0;
    const to = p === end.para ? end.offset : chars.length;
    for (let i = from; i < to; i++) {
      const ch = chars[i].char;
      if (ch !== ch.toLowerCase()) {
        allLower = false;
        break;
      }
    }
    if (!allLower) break;
  }
  const transform = allLower
    ? (c: string) => c.toUpperCase()
    : (c: string) => c.toLowerCase();

  return doc.map((para, p) => {
    if (p < start.para || p > end.para) return para;
    if (para.blockType === "pagebreak") return para;
    const chars = runsToChars(para.runs);
    const from = p === start.para ? start.offset : 0;
    const to = p === end.para ? end.offset : chars.length;
    for (let i = from; i < to; i++) {
      chars[i] = { ...chars[i], char: transform(chars[i].char) };
    }
    return { ...para, runs: charsToRuns(chars) };
  });
}

export function clearFormatOnSelection(
  doc: Doc,
  sel: Selection,
  prop: FormatProp,
): Doc {
  const { start, end } = normalizeSelection(sel);
  return doc.map((para, p) => {
    if (p < start.para || p > end.para) return para;
    if (para.blockType === "pagebreak") return para;
    const chars = runsToChars(para.runs);
    const from = p === start.para ? start.offset : 0;
    const to = p === end.para ? end.offset : chars.length;
    for (let i = from; i < to; i++) {
      chars[i] = { ...chars[i], format: { ...chars[i].format, [prop]: false } };
    }
    return { ...para, runs: charsToRuns(chars) };
  });
}
