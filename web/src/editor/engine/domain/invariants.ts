// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What a valid document is, as executable checks of the rules `model.ts`
// states. The session's validation interceptor runs them on every command in
// development.
//
// The checks import nothing but the model, independent of the operations, so
// a bug in an operation cannot hide behind the same bug in the checker.
//
// A Doc always holds at least one paragraph. The empty array is legal at the
// codec boundary, where `serialize([])` writes nothing, but the session never
// holds one. A page break carries no runs; every other paragraph carries at
// least one run.

import type {
  Alignment,
  BlockType,
  Doc,
  Format,
  Paragraph,
  Selection,
} from "./model";

export type DocViolation =
  | { kind: "empty-doc" }
  | { kind: "bad-block-type"; para: number; blockType: unknown }
  | { kind: "bad-alignment"; para: number; alignment: unknown }
  | { kind: "pagebreak-with-runs"; para: number }
  | { kind: "empty-runs"; para: number }
  | { kind: "bad-run-text"; para: number; run: number }
  | { kind: "bad-run-format"; para: number; run: number };

export type SelectionViolation =
  | { kind: "para-out-of-range"; para: number }
  | { kind: "offset-out-of-range"; para: number; offset: number };

const BLOCK_TYPES: readonly BlockType[] = [
  "paragraph",
  "h1",
  "h2",
  "pagebreak",
];
const ALIGNMENTS: readonly Alignment[] = ["left", "center", "right", "justify"];

function validBlockType(blockType: unknown): blockType is BlockType {
  return (
    typeof blockType === "string" &&
    (BLOCK_TYPES as readonly string[]).includes(blockType)
  );
}

function validAlignment(alignment: unknown): alignment is Alignment {
  return (
    typeof alignment === "string" &&
    (ALIGNMENTS as readonly string[]).includes(alignment)
  );
}

function validFormat(format: unknown): format is Format {
  if (typeof format !== "object" || format === null) return false;
  const f = format as Record<string, unknown>;
  return (
    typeof f.bold === "boolean" &&
    typeof f.italic === "boolean" &&
    typeof f.monospace === "boolean"
  );
}

/** Every violation of the document rules in document order; empty if valid. */
export function validateDoc(doc: Doc): DocViolation[] {
  const violations: DocViolation[] = [];
  if (doc.length === 0) {
    violations.push({ kind: "empty-doc" });
    return violations;
  }

  doc.forEach((para, i) => {
    if (!validBlockType(para.blockType)) {
      violations.push({
        kind: "bad-block-type",
        para: i,
        blockType: para.blockType,
      });
    }
    if (!validAlignment(para.alignment)) {
      violations.push({
        kind: "bad-alignment",
        para: i,
        alignment: para.alignment,
      });
    }
    if (!Array.isArray(para.runs)) {
      violations.push({ kind: "empty-runs", para: i });
      return;
    }
    para.runs.forEach((run, r) => {
      if (typeof run.text !== "string") {
        violations.push({ kind: "bad-run-text", para: i, run: r });
      }
      if (!validFormat(run.format)) {
        violations.push({ kind: "bad-run-format", para: i, run: r });
      }
    });
    if (para.blockType === "pagebreak") {
      if (para.runs.length > 0)
        violations.push({ kind: "pagebreak-with-runs", para: i });
      return;
    }
    if (para.runs.length === 0) {
      violations.push({ kind: "empty-runs", para: i });
    }
  });

  return violations;
}

export function isValidDoc(doc: Doc): boolean {
  return validateDoc(doc).length === 0;
}

/** Visible text length of one paragraph: the offset domain of a cursor. */
export function paraTextLength(para: Paragraph): number {
  return para.runs.reduce((sum, run) => sum + run.text.length, 0);
}

/** Every violation of the selection rules; empty for a valid selection. */
export function validateSelection(
  doc: Doc,
  selection: Selection,
): SelectionViolation[] {
  const violations: SelectionViolation[] = [];
  for (const cursor of [selection.anchor, selection.focus]) {
    if (cursor.para < 0 || cursor.para >= doc.length) {
      violations.push({ kind: "para-out-of-range", para: cursor.para });
    } else {
      const length = paraTextLength(doc[cursor.para]);
      if (cursor.offset < 0 || cursor.offset > length) {
        violations.push({
          kind: "offset-out-of-range",
          para: cursor.para,
          offset: cursor.offset,
        });
      }
    }
  }
  return violations;
}

export function isValidSelection(doc: Doc, selection: Selection): boolean {
  return validateSelection(doc, selection).length === 0;
}

export function validateSession(doc: Doc, selection: Selection): boolean {
  return isValidDoc(doc) && isValidSelection(doc, selection);
}
