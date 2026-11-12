// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The `HistoryStore` port: undo and redo behind an interface. The engine
// pushes the state pair around an edit and asks the store for the previous or
// next state; it knows nothing of snapshots, deltas or inverse operations.
//
// Contract, for every store:
//
//   1. Undo and redo move through the states pushed: `undo` returns the same
//      `before` object pushed before the current state (reference identity),
//      and `redo` returns the state undone from.
//   2. Coalescing is the session's policy, passed in as `merge`. A
//      `merge: true` push folds into the current node: `before` stays the
//      burst start, `after` advances, and the folded step undoes as one. Undo
//      and redo reset the merge chain.
//   3. Any push, merged or not, makes `redo()` null, so a keyboard walk never
//      resurrects the future. A push after an undo parks the displaced future
//      as retained siblings, reachable through `hasParkedSiblings`, for a
//      browsing surface and never for Ctrl+Z.
//   4. `undo` on an empty store and `redo` at the newest node return null
//      and change nothing. The answer is "at the newest moment", never loss.
//   5. `peekBack(d)` is read-only: it returns the state `d` undos would land
//      on, reference-identical to the walked state, without moving the head
//      or touching the depths. Null beyond the walkable past and on any
//      malformed depth; 0 is the head's own state.
//   6. The store is capped by a memory and journal guard, never a UX cap,
//      and `clear` empties the whole graph.
//   7. `exportJournal` and `importJournal` are the persistence seam: opaque
//      JSON strings of the timeline (head, steps, branches, checkpoints). An
//      adapter that cannot persist exports null and throws on import, which
//      is how the differential test's oracle refuses.
//   8. `peekTimestamp(d)` answers the wall-clock moment (ms since epoch) the
//      state `d` steps back was recorded: display metadata, never state. It
//      refuses as `peekBack` does, and answers null for a node with no
//      timestamp, so a missing stamp never breaks the UI.
//
// `HistoryCause` names the edit styles the session distinguishes for merge
// decisions: typing, backspace, forward delete, and the op bucket (paste,
// format, replace, enter), which never merges.

import type { Cursor, Doc } from "../domain/model";

/** The engine's state around an edit: the document and where the cursor sat. */
export interface EditorState {
  doc: Doc;
  cursor: Cursor;
}

export type HistoryCause = "type" | "backspace" | "del" | "op";

// The caps guard against a runaway session; a writer is not meant to reach
// them. Checkpoints keep hydration to at most 200 delta replays, and the byte
// cap bounds the on-disk journal. Truncation drops the oldest steps first,
// parked subtrees before the main line, so recent undo depth goes last. The
// writer loses depth only, never content.
export const HISTORY_MAX_STEPS = 2000;
export const HISTORY_MAX_BYTES = 5 * 1024 * 1024;
export const HISTORY_CHECKPOINT_INTERVAL = 200;

export interface HistoryStore {
  /**
   * Record an edit. `before` must be the store's current state (the session
   * always pushes the state it holds); `merge: true` folds into the current
   * node instead of opening a new one.
   */
  push(
    before: EditorState,
    after: EditorState,
    cause: HistoryCause,
    merge: boolean,
    label?: string,
  ): void;
  /** Walk the head back one step. Null at the timeline's root. */
  undo(): EditorState | null;
  /** Walk the head forward one step. Null at the newest node. */
  redo(): EditorState | null;
  /** The next step's label for a tooltip ("Undo: Replace all"), or null. */
  nextUndoLabel(): string | null;
  nextRedoLabel(): string | null;
  /**
   * The state `depth` steps back from the head, read-only. The store refuses
   * a depth it cannot walk and the session clamps. A peeked state is
   * reference-stable, because materialization is memoized.
   */
  peekBack(depth: number): EditorState | null;
  /**
   * The wall-clock moment the state `depth` steps back was recorded, for the
   * rail's datetime label; null where the label does not paint.
   */
  peekTimestamp(depth: number): number | null;
  undoDepth(): number;
  redoDepth(): number;
  /** A parked future exists at the head. */
  hasParkedSiblings: boolean;
  canUndo: boolean;
  canRedo: boolean;
  clear(): void;
  /**
   * The timeline as an opaque JSON string (null when empty or unsupported).
   * The store never writes files; the shell decides where this lands.
   */
  exportJournal(): string | null;
  /**
   * Rebuild the timeline from a journal produced by `exportJournal`.
   * Returns the hydrated head state, or null when the journal fails any
   * shape check, in which case the whole journal is dropped and never applied
   * in part. An adapter without persistence throws instead of answering empty.
   */
  importJournal(json: string): EditorState | null;
}
