// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The editor's commands ────────────────────────────────────────────────────
//
// Every session mutation as a named command. Each `run` is pure: it reads the
// current state and the injected ports from the context, and hands back the
// next `{ doc, selection }` pair, or null when nothing changes, which leaves
// no history entry and no notification. The session decides history push
// kinds and notifications; the commands decide state.
//
// Editing commands collapse the selection onto the cursor, and formatting
// commands leave it untouched.

import type {
  Doc,
  Format,
  Alignment,
  BlockType,
  Cursor,
  Selection,
  Match,
} from "../domain/model";
import type { FormatProp } from "../domain/operations";
import { MARKERS } from "../domain/markers";
import {
  insertText,
  deleteBackward,
  deleteForward,
  deleteWordBackward,
  deleteWordForward,
  deleteSoftLineBackward,
  insertParagraph,
  insertPageBreak,
  insertFragment,
  deleteRange,
  normalizeSelection,
  isCollapsed,
  replaceMatches,
  toggleFormat,
  toggleCase,
  setAlignment,
  setBlockType,
  clearFormatOnSelection,
} from "../domain/operations";
import type { SearchOptions } from "../ports/search";
import type { ClipboardPayload } from "../ports/clipboard";
import type { EditorState } from "../ports/history";
import type { Command } from "./commands";
import { applyHunk, type DiffAim, type Hunk } from "./diff";

function collapsed(cursor: Cursor): Selection {
  return { anchor: cursor, focus: { ...cursor } };
}

// ── Editing ──────────────────────────────────────────────────────────────────

export function insertTextCommand(text: string, format: Format): Command {
  return {
    type: "insertText",
    run: (ctx) => {
      const r = insertText(ctx.doc, ctx.selection, text, format);
      return { doc: r.doc, selection: collapsed(r.cursor) };
    },
  };
}

export function deleteBackwardCommand(): Command {
  return {
    type: "deleteBackward",
    run: (ctx) => {
      const r = deleteBackward(ctx.doc, ctx.selection);
      if (r.doc === ctx.doc) return null;
      return { doc: r.doc, selection: collapsed(r.cursor) };
    },
  };
}

export function deleteForwardCommand(): Command {
  return {
    type: "deleteForward",
    run: (ctx) => {
      const r = deleteForward(ctx.doc, ctx.selection);
      if (r.doc === ctx.doc) return null;
      return { doc: r.doc, selection: collapsed(r.cursor) };
    },
  };
}

export function deleteWordBackwardCommand(): Command {
  return {
    type: "deleteWordBackward",
    run: (ctx) => {
      const r = deleteWordBackward(ctx.doc, ctx.selection);
      if (r.doc === ctx.doc) return null;
      return { doc: r.doc, selection: collapsed(r.cursor) };
    },
  };
}

export function deleteWordForwardCommand(): Command {
  return {
    type: "deleteWordForward",
    run: (ctx) => {
      const r = deleteWordForward(ctx.doc, ctx.selection);
      if (r.doc === ctx.doc) return null;
      return { doc: r.doc, selection: collapsed(r.cursor) };
    },
  };
}

export function deleteSoftLineBackwardCommand(): Command {
  return {
    type: "deleteSoftLineBackward",
    run: (ctx) => {
      const r = deleteSoftLineBackward(ctx.doc, ctx.selection);
      if (r.doc === ctx.doc) return null;
      return { doc: r.doc, selection: collapsed(r.cursor) };
    },
  };
}

export function insertParagraphCommand(): Command {
  return {
    type: "insertParagraph",
    run: (ctx) => {
      const r = insertParagraph(ctx.doc, ctx.selection);
      return { doc: r.doc, selection: collapsed(r.cursor) };
    },
  };
}

export function insertPageBreakCommand(): Command {
  return {
    type: "insertPageBreak",
    run: (ctx) => {
      const r = insertPageBreak(ctx.doc, ctx.selection);
      return { doc: r.doc, selection: collapsed(r.cursor) };
    },
  };
}

// ── Cut and paste ────────────────────────────────────────────────────────────
//
// Cut builds the clipboard payload before deleting, so the payload is what
// was selected. Paste inserts a fragment the codec already parsed.

export function cutCommand(): Command<ClipboardPayload> {
  return {
    type: "cut",
    run: (ctx) => {
      if (isCollapsed(ctx.selection)) return null;
      const range = normalizeSelection(ctx.selection);
      const plain = ctx.clipboard.buildPlain(ctx.doc, range);
      const html = ctx.clipboard.buildHtml(ctx.doc, range);
      const r = deleteRange(ctx.doc, range.start, range.end);
      return {
        doc: r.doc,
        selection: collapsed(r.cursor),
        value: { plain, html },
      };
    },
  };
}

export function pasteCommand(fragment: Doc): Command {
  return {
    type: "paste",
    run: (ctx) => {
      if (
        fragment.length === 1 &&
        fragment[0].runs.every((r) => r.text.length === 0)
      ) {
        return null;
      }
      const range = normalizeSelection(ctx.selection);
      const r = insertFragment(ctx.doc, range, fragment);
      return { doc: r.doc, selection: collapsed(r.cursor) };
    },
  };
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function toggleFormatCommand(prop: FormatProp): Command {
  return {
    type: "toggleFormat",
    run: (ctx) => ({
      doc: toggleFormat(ctx.doc, ctx.selection, prop),
      selection: ctx.selection,
    }),
  };
}

export function toggleCaseCommand(): Command {
  return {
    type: "toggleCase",
    run: (ctx) => ({
      doc: toggleCase(ctx.doc, ctx.selection),
      selection: ctx.selection,
    }),
  };
}

export function clearFormatCommand(prop: FormatProp): Command {
  return {
    type: "clearFormat",
    run: (ctx) => ({
      doc: clearFormatOnSelection(ctx.doc, ctx.selection, prop),
      selection: ctx.selection,
    }),
  };
}

export function setAlignmentCommand(alignment: Alignment): Command {
  return {
    type: "setAlignment",
    run: (ctx) => {
      const start = Math.min(
        ctx.selection.anchor.para,
        ctx.selection.focus.para,
      );
      const end = Math.max(ctx.selection.anchor.para, ctx.selection.focus.para);
      let doc = ctx.doc;
      for (let i = start; i <= end; i++) doc = setAlignment(doc, i, alignment);
      if (doc === ctx.doc) return null;
      return { doc, selection: ctx.selection };
    },
  };
}

export function setBlockTypeCommand(type: BlockType): Command {
  return {
    type: "setBlockType",
    run: (ctx) => {
      const doc = setBlockType(ctx.doc, ctx.selection.anchor.para, type);
      if (doc === ctx.doc) return null;
      return { doc, selection: ctx.selection };
    },
  };
}

// ── Find & replace ───────────────────────────────────────────────────────────

export function replaceMatchesCommand(
  matches: Match[],
  replacement: string,
  plain: boolean,
): Command {
  return {
    type: "replaceMatches",
    run: (ctx) => {
      const r = replaceMatches(ctx.doc, matches, replacement, plain);
      return { doc: r.doc, selection: collapsed(r.cursor) };
    },
  };
}

export function replaceAllCommand(
  query: string,
  replacement: string,
  opts: SearchOptions,
  plain: boolean,
): Command {
  return {
    type: "replaceAll",
    run: (ctx) => {
      const matches = ctx.search.findMatches(ctx.doc, query, opts);
      if (matches.length === 0) return null;
      const r = replaceMatches(ctx.doc, matches, replacement, plain);
      const para = Math.min(ctx.selection.anchor.para, r.doc.length - 1);
      const length = r.doc[para].runs.reduce(
        (sum, run) => sum + run.text.length,
        0,
      );
      const cursor: Cursor = {
        para,
        offset: Math.min(ctx.selection.anchor.offset, length),
      };
      return { doc: r.doc, selection: collapsed(cursor) };
    },
  };
}

// ── The diff accept ──────────────────────────────────────────────────────────

export function acceptHunkCommand(
  hunk: Hunk,
  leftSide: Doc,
  rightSide: Doc,
  aim: DiffAim,
): Command {
  return {
    type: "acceptHunk",
    run: (ctx) => {
      // Every other command derives its target from `ctx.doc`; this one
      // closes over the captured pair, so it refuses when the pair moved
      // between capture and run: rewriting a pair the click never saw would
      // corrupt the buffer.
      const aimed = aim === "left" ? leftSide : rightSide;
      if (aimed !== ctx.doc) return null;
      const r = applyHunk(leftSide, rightSide, hunk, aim);
      if (!r) return null;
      return { doc: r.doc, selection: collapsed(r.cursor) };
    },
  };
}

// ── History ──────────────────────────────────────────────────────────────────

export function undoCommand(): Command {
  return {
    type: "undo",
    run: (ctx) => {
      const entry = ctx.history.undo();
      if (!entry) return null;
      return { doc: entry.doc, selection: collapsed(entry.cursor) };
    },
  };
}

export function redoCommand(): Command {
  return {
    type: "redo",
    run: (ctx) => {
      const entry = ctx.history.redo();
      if (!entry) return null;
      return { doc: entry.doc, selection: collapsed(entry.cursor) };
    },
  };
}

// ── Restore ──────────────────────────────────────────────────────────────────
//
// The rail's "Revert to here": the whole document becomes a walked state, as
// one ordinary undoable edit. It refuses when the live doc is textually
// identical to the target (typed, then typed back): the store's push throws
// on a no-change edge.

export function restoreCommand(target: EditorState): Command {
  return {
    type: "restore",
    run: (ctx) => {
      if (ctx.codec.serialize(ctx.doc) === ctx.codec.serialize(target.doc)) {
        return null;
      }
      return { doc: target.doc, selection: collapsed(target.cursor) };
    },
  };
}

// ── File ─────────────────────────────────────────────────────────────────────

// Where the writer stopped: page breaks, empty paragraphs and marker-only
// notes do not count, and neither do headings, because a caret belongs in
// prose, not in a title. `lastParagraph` in `desk.ts` shares the first rules
// but not the heading rule.

function endOfLastRealParagraph(doc: Doc): Cursor | null {
  for (let i = doc.length - 1; i >= 0; i--) {
    const para = doc[i];
    if (para.blockType !== "paragraph") continue;
    const text = para.runs.map((r) => r.text).join("");
    if (text.length === 0) continue;
    const marked = MARKERS.some((m) => {
      const found = m.exec(text);
      return found !== null && found[0].trim().length === text.trim().length;
    });
    if (marked) continue;
    return { para: i, offset: text.length };
  }
  return null;
}

export function openCommand(
  md: string,
  opts?: { caret?: "start" | "end" },
): Command {
  return {
    type: "open",
    run: (ctx) => {
      const doc = ctx.codec.parse(md);
      const at =
        opts?.caret === "end"
          ? (endOfLastRealParagraph(doc) ?? {
              para: Math.max(doc.length - 1, 0),
              offset: 0,
            })
          : { para: 0, offset: 0 };
      return { doc, selection: collapsed(at) };
    },
  };
}
