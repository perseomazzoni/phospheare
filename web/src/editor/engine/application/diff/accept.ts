// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The accept operation ─────────────────────────────────────────────────────
//
// The pure half of Accept: one hunk, one undoable edit. `applyHunk` rewrites
// the aimed side with the hunk's change, deleting the aimed range and
// inserting the other side's; the session commits it as an ordinary undoable
// step. The session always aims at the live buffer, never the compared doc.
//
// The operation derives from the ranges, the aim and `block`, never from
// `kind`, which is a display hint, with one exception. A textless block (a
// page break, an emptied paragraph) has zero-length ranges on both sides, so
// only `kind` can say whether the accept deletes it from the target or
// restores it into the target.
//
// `applyHunk` bounds-checks both ranges against the current docs and returns
// null for anything stale or out of range; it never clamps and never applies
// a shifted hunk.

import type { Cursor, Doc, Paragraph } from "../../domain/model";
import {
  deleteRange,
  insertFragment,
  insertBlocks,
  deleteBlocks,
  runsToChars,
  charsToRuns,
  paraLength,
} from "../../domain/operations";
import type { DiffAim, Hunk } from "./merge";

/** The cursor a block accept lands on: the changed paragraph's head, or the
 * last paragraph's head after a deletion that shrank the doc. */
function cursorAt(para: number, docLength: number): Cursor {
  return { para: Math.min(para, docLength - 1), offset: 0 };
}

/**
 * Apply one hunk's change to the aimed side, reading the other side as the
 * source. Returns the modified target and a cursor, or null for a stale or
 * out-of-range hunk.
 *
 * - An empty range's paragraph is dereferenced only when it lands a restore;
 *   a pure deletion's source contributes nothing, and its paragraph index is
 *   the landing, which may sit at the doc's end.
 * - A block hunk picks its operation on the target by which ranges are
 *   empty: an empty source deletes the target paragraph, an empty target
 *   inserts the source paragraph, and two non-empty ranges put the source
 *   paragraph in the target's place. Two empty ranges are a textless block, where `kind`
 *   names the owning side.
 * - An inline hunk deletes the target range and inserts text sliced from the
 *   source's own runs, so the accepted text keeps the source's formatting.
 */
export function applyHunk(
  leftSide: Doc,
  rightSide: Doc,
  hunk: Hunk,
  aim: DiffAim,
): { doc: Doc; cursor: Cursor } | null {
  const target = aim === "left" ? leftSide : rightSide;
  const source = aim === "left" ? rightSide : leftSide;
  const targetRange = aim === "left" ? hunk.left : hunk.right;
  const sourceRange = aim === "left" ? hunk.right : hunk.left;

  if (hunk.block) {
    const sourceEmpty = sourceRange.from === sourceRange.to;
    const targetEmpty = targetRange.from === targetRange.to;
    if (sourceEmpty && targetEmpty) {
      // A textless block lives on one side only, because an empty block never
      // pairs by similarity, and `kind` names that side relative to the
      // merged doc: `delete` is left-only, `insert` right-only. Aimed at the
      // owning side, the accept removes the block from the target; aimed at
      // the other side, it restores the block at the empty range's landing.
      const blockLivesOnTarget = (hunk.kind === "delete") === (aim === "left");
      if (blockLivesOnTarget) {
        if (targetRange.para < 0 || targetRange.para >= target.length) {
          return null;
        }
        const doc = deleteBlocks(
          target,
          targetRange.para,
          targetRange.para + 1,
        );
        return {
          doc,
          cursor: cursorAt(targetRange.para, doc.length),
        };
      }
      if (targetRange.para < 0 || targetRange.para > target.length) {
        return null;
      }
      const sourcePara = source[sourceRange.para];
      if (!sourcePara) return null;
      const doc = insertBlocks(target, targetRange.para, [sourcePara]);
      return {
        doc,
        cursor: cursorAt(targetRange.para, doc.length),
      };
    }
    if (sourceEmpty && !targetEmpty) {
      if (targetRange.para < 0 || targetRange.para >= target.length) {
        return null;
      }
      const doc = deleteBlocks(target, targetRange.para, targetRange.para + 1);
      return {
        doc,
        cursor: cursorAt(targetRange.para, doc.length),
      };
    }
    if (targetEmpty) {
      // The landing may be the append position (`target.length`).
      if (targetRange.para < 0 || targetRange.para > target.length) {
        return null;
      }
      const sourcePara = source[sourceRange.para];
      if (!sourcePara) return null;
      const doc = insertBlocks(target, targetRange.para, [sourcePara]);
      return {
        doc,
        cursor: cursorAt(targetRange.para, doc.length),
      };
    }
    // A whole-paragraph replace is one splice, not a delete then an insert,
    // because `insertBlocks` takes an empty paragraph at its landing, and
    // after the delete that landing is the writer's own blank line when one
    // follows. An inline splice would flatten a heading to body text.
    if (targetRange.para < 0 || targetRange.para >= target.length) {
      return null;
    }
    const sourcePara = source[sourceRange.para];
    if (!sourcePara) return null;
    const doc = [
      ...target.slice(0, targetRange.para),
      sourcePara,
      ...target.slice(targetRange.para + 1),
    ];
    return {
      doc,
      cursor: cursorAt(targetRange.para, doc.length),
    };
  }

  const targetPara = target[targetRange.para];
  if (!targetPara) return null;
  const targetLen = paraLength(targetPara);
  if (
    targetRange.from < 0 ||
    targetRange.to > targetLen ||
    targetRange.from > targetRange.to
  ) {
    return null;
  }
  const sourceHasText = sourceRange.from < sourceRange.to;
  if (sourceHasText) {
    const sourcePara = source[sourceRange.para];
    if (!sourcePara) return null;
    const sourceLen = paraLength(sourcePara);
    if (
      sourceRange.from < 0 ||
      sourceRange.to > sourceLen ||
      sourceRange.from > sourceRange.to
    ) {
      return null;
    }
  }

  let d = target;
  let cursor: Cursor = { para: targetRange.para, offset: targetRange.from };
  if (targetRange.from < targetRange.to) {
    const r = deleteRange(d, cursor, {
      para: targetRange.para,
      offset: targetRange.to,
    });
    d = r.doc;
    cursor = r.cursor;
  }

  // The slice comes from the source paragraph's own runs so its formatting
  // survives.
  if (sourceHasText) {
    const chars = runsToChars(source[sourceRange.para].runs);
    const fragment: Paragraph = {
      runs: charsToRuns(chars.slice(sourceRange.from, sourceRange.to)),
      alignment: "left",
      blockType: "paragraph",
    };
    if (!fragment.runs.some((r) => r.text.length > 0))
      return { doc: d, cursor };
    const r = insertFragment(d, { start: cursor, end: cursor }, [fragment]);
    return { doc: r.doc, cursor: r.cursor };
  }
  return { doc: d, cursor };
}

/** Full-coordinate identity of two hunks. The session refuses an accept
 * whose hunk differs from the one its current set holds, since a click can
 * outlive the recompute that moved the hunks. */
export function sameHunk(a: Hunk, b: Hunk): boolean {
  return (
    a.kind === b.kind &&
    a.block === b.block &&
    a.para === b.para &&
    a.merged.from === b.merged.from &&
    a.merged.to === b.merged.to &&
    a.left.para === b.left.para &&
    a.left.from === b.left.from &&
    a.left.to === b.left.to &&
    a.right.para === b.right.para &&
    a.right.from === b.right.from &&
    a.right.to === b.right.to
  );
}
