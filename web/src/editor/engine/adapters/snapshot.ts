// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A dual-stack undo behind the `HistoryStore` port, and the oracle the delta
// timeline is checked against: both adapters walk identical scripts and the
// walks compare under canonical serialization.
//
// A snapshot is the document model itself, not its serialization: the
// editing operations are persistent, so a snapshot costs one reference per
// document.
//
// The oracle retains nothing: an edit after undo destroys the displaced
// future. `exportJournal` and `importJournal` refuse with null and a throw,
// so a differential run cannot mistake the oracle for a persistent store.

import type { EditorState, HistoryCause, HistoryStore } from "../ports/history";
import { HISTORY_MAX_STEPS } from "../ports/history";

export class SnapshotHistory implements HistoryStore {
  private undoStack: EditorState[] = [];
  private redoStack: EditorState[] = [];
  private current: EditorState | null = null;
  // The stamps mirror the two stacks, so `peekTimestamp` answers as the delta
  // adapter does: the same refusals, and a merged burst is one step.
  private undoTs: number[] = [];
  private redoTs: number[] = [];
  private currentTs: number | null = null;

  push(
    before: EditorState,
    after: EditorState,
    _cause: HistoryCause,
    merge: boolean,
    _label?: string,
  ): void {
    void _label;
    const now = Date.now();
    if (merge && this.undoStack.length > 0) {
      // The burst's first entry already holds the pre-burst state, so a
      // merged push adds no entry.
      this.redoStack = [];
      this.redoTs = [];
      this.current = after;
      this.currentTs = now;
      return;
    }
    this.undoStack.push(before);
    this.undoTs.push(now);
    if (this.undoStack.length > HISTORY_MAX_STEPS) this.undoStack.shift();
    if (this.undoTs.length > HISTORY_MAX_STEPS) this.undoTs.shift();
    this.redoStack = [];
    this.redoTs = [];
    this.current = after;
    this.currentTs = now;
  }

  undo(): EditorState | null {
    if (this.undoStack.length === 0) return null;
    const entry = this.undoStack.pop();
    if (entry === undefined) return null;
    const ts = this.undoTs.pop() ?? null;
    if (this.current !== null) this.redoStack.push(this.current);
    if (this.currentTs !== null) this.redoTs.push(this.currentTs);
    this.current = entry;
    this.currentTs = ts;
    return entry;
  }

  redo(): EditorState | null {
    if (this.redoStack.length === 0) return null;
    const entry = this.redoStack.pop();
    if (entry === undefined) return null;
    const ts = this.redoTs.pop() ?? null;
    this.undoStack.push(this.current as EditorState);
    this.undoTs.push(this.currentTs as number);
    this.current = entry;
    this.currentTs = ts;
    return entry;
  }

  nextUndoLabel(): string | null {
    return null;
  }

  nextRedoLabel(): string | null {
    return null;
  }

  /** The stack slot `depth` steps back from the head, or null when the depth
   * is not walkable. -1 is the head's own slot (depth 0); deeper is an index
   * into the oldest-first undo stack. */
  private undoIndexAt(depth: number): number | null {
    if (!Number.isInteger(depth) || depth < 0) return null;
    if (depth === 0) return -1;
    if (depth > this.undoStack.length) return null;
    return this.undoStack.length - depth;
  }

  peekBack(depth: number): EditorState | null {
    const i = this.undoIndexAt(depth);
    if (i === null) return null;
    return i === -1 ? this.current : (this.undoStack[i] ?? null);
  }

  peekTimestamp(depth: number): number | null {
    const i = this.undoIndexAt(depth);
    if (i === null) return null;
    return i === -1 ? this.currentTs : (this.undoTs[i] ?? null);
  }

  undoDepth(): number {
    return this.undoStack.length;
  }

  redoDepth(): number {
    return this.redoStack.length;
  }

  get hasParkedSiblings(): boolean {
    return false;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.current = null;
    this.undoTs = [];
    this.redoTs = [];
    this.currentTs = null;
  }

  exportJournal(): string | null {
    return null;
  }

  importJournal(): EditorState | null {
    throw new Error("SnapshotHistory does not persist a timeline");
  }
}
