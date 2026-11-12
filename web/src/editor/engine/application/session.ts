// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The session, the application layer's composition root: one object owns the
// editor's state and its ports, and every mutation runs through the command
// bus, so every mutation is validated against the session invariants before
// it lands.
//
// A mutation captures the pre-mutation state, executes its command, records
// the history step and applies the outcome; a no-op command (null outcome)
// changes nothing. Editing commands collapse the selection onto the cursor;
// formatting commands preserve it. `open` resets the doc, cursor, pending
// format, dirty flag, history and saved-state baseline.

import type {
  Doc,
  Format,
  Alignment,
  BlockType,
  Cursor,
  Paragraph,
  Selection,
  Match,
} from "../domain/model";
import type { Codec } from "../ports/codec";
import type { EventBus } from "../ports/events";
import type { HistoryStore, HistoryCause, EditorState } from "../ports/history";
import type { SearchProvider, SearchOptions } from "../ports/search";
import {
  buildMergedDoc,
  sameHunk,
  type DiffDecoration,
  type DiffGranularity,
  type DiffAim,
  type Hunk,
} from "./diff";
import type { ClipboardCodec, ClipboardPayload } from "../ports/clipboard";
import {
  getFormatAtCursor,
  getAlignmentAtCursor,
  getBlockTypeAtCursor,
  selectionHasFormat,
  isCollapsed,
  normalizeSelection,
  selectAllSelection,
} from "../domain/operations";
import { isValidSelection } from "../domain/invariants";
import {
  MAX_PASTE_CHARS,
  MAX_PASTE_HTML_CHARS,
  MAX_PASTE_PARAGRAPHS,
} from "../domain/limits";
import {
  createCommandBus,
  validationInterceptor,
  type Command,
  type CommandBus,
  type CommandOutcome,
} from "./commands";
import {
  insertTextCommand,
  deleteBackwardCommand,
  deleteForwardCommand,
  deleteWordBackwardCommand,
  deleteWordForwardCommand,
  deleteSoftLineBackwardCommand,
  insertParagraphCommand,
  insertPageBreakCommand,
  cutCommand,
  pasteCommand,
  toggleFormatCommand,
  toggleCaseCommand,
  clearFormatCommand,
  setAlignmentCommand,
  setBlockTypeCommand,
  replaceMatchesCommand,
  replaceAllCommand,
  undoCommand,
  redoCommand,
  openCommand,
  acceptHunkCommand,
  restoreCommand,
} from "./editorCommands";

export type SessionNotification = "doc" | "selection" | "saved" | "history";

/** Why the session declined an input, for the surface to say. */
export type SessionRefusal = "pasteTooLong";

/** Which side of the snapshot comparison reads as the spine; `diffSides()`
 * maps the roles onto the engine's left and right. */
export type DiffDirection =
  | /** Compare Adopted with Selected Snapshot, the default: the selected
     * snapshot's text is the spine, and adopted-only text is struck. */
    "adoptedWithSelected" /** Compare Selected Snapshot with Adopted, the chronological reading:
     * the adopted manuscript is the spine, the snapshot's removed passages
     * are struck and the adopted's additions marked. */
  | "selectedWithAdopted";

/** What the session emits on its events bus. */
export type SessionEvents = {
  doc: [];
  selection: [];
  /**
   * The undo timeline changed: an undo or redo moved the head, or an open
   * hydrated or cleared a timeline. Separate from `doc` because the rail
   * re-reads `canUndo`, `canRedo` and the labels, and every other edit is a
   * `doc` event, which closes the rail anyway.
   */
  history: [];
  /**
   * A write landed. Separate from `doc` because the document did not change,
   * only which parts of it are on disk, and a view that marks the unsaved
   * parts has no other moment to hear it. `hasChanges` goes false at the
   * same time, so polling it on `doc` would arrive too late to show a
   * confirmation.
   */
  saved: [];
  /**
   * An input the session declined, and why. Nothing else is emitted for it,
   * so a view that only redraws would show nothing.
   */
  refused: [SessionRefusal];
};

/** The session's dependencies: ports, never adapters. */
export interface SessionDeps {
  codec: Codec;
  history: HistoryStore;
  search: SearchProvider;
  events: EventBus<SessionEvents>;
  clipboard: ClipboardCodec;
}

export class Session {
  private _doc: Doc;
  private sel: Selection;
  private readonly codec: Codec;
  private readonly history: HistoryStore;
  private readonly search: SearchProvider;
  private readonly events: EventBus<SessionEvents>;
  private readonly clipboard: ClipboardCodec;
  private readonly bus: CommandBus;

  /**
   * The document as it last landed on disk.
   *
   * `hasChanges` and `dirtyParagraphs()` compare it with the current doc by
   * paragraph reference, never by serializing either side: operations share
   * untouched paragraphs, so one pass over the paragraph list answers on
   * every keystroke.
   */
  private savedDoc: Doc;
  /** `savedDoc`'s paragraphs as a set, built only where `savedDoc` moves. */
  private savedSet: ReadonlySet<Paragraph>;

  // The format for the next typed character at a collapsed cursor, set by a
  // format toggle on a collapsed selection and cleared when the cursor moves
  // or after typing.
  private pendingFormat: Format | null = null;

  // ── Diff mode state ────────────────────────────────────────────────────────
  //
  // The read-only comparison views. The real document stays in `_doc`; what
  // the view renders while comparing is `_displayedDoc`, a parallel doc the
  // history store knows nothing about. Nothing is pushed from the display
  // doc, so the store's identity check never fires, and `hasChanges` stays
  // the real buffer's value.
  //
  // Whatever the direction, an accept changes only the adopted, and the
  // selected snapshot is never written: the accept aims at `_doc` through
  // `diffSides()`, and the compared doc stays a fixed reference.
  //
  // Two modes, one surface:
  //
  //   snapshot  the dock's comparison of a selected snapshot against the
  //             adopted one. Every recompute runs the current `_doc`
  //             against the unmodified `_comparedDoc`. Writer edits are
  //             refused by the commit gate; Accept is the one edit allowed,
  //             and undo and redo keep walking the real timeline.
  //   history   the rail's walk, a preview and not a mutation: the merged
  //             view re-reads the walked depth from the store (`peekBack`).
  //             The head, `_doc` and the depths never move. Typing exits the
  //             mode and lands its keystroke; undo and redo are refused while
  //             the rail is up. "Revert to here" makes the walked state one
  //             ordinary undoable step, never a fork.
  //
  // The two are mutually exclusive. Every mutation that lands while a mode is
  // up recomputes the merged view before the notify, so the view never paints
  // a stale comparison. The lenses (grain, direction) are the snapshot
  // mode's, per comparison and never persisted; the rail's walk recomputes at
  // word grain, left the captured tip and right the walked state.
  private _displayedDoc: Doc | null = null;
  private _diffDecorations: DiffDecoration[] = [];
  private _diffHunks: Hunk[] = [];
  private diffKind: "snapshot" | "history" | null = null;
  /** The newest state captured when the rail's walk began. */
  private historyTip: Doc | null = null;
  /** The preview walk's depth; 0 is Now. Reset on every entry and exit, so a
   * depth never leaks between rail visits. */
  private _historyWalkDepth = 0;
  /** The parsed compared snapshot. Cleared on every exit path, because a
   * stale reference would recompute the next comparison against the wrong
   * pair. */
  private _comparedDoc: Doc | null = null;
  /** How many hunks were accepted during this comparison. The chip's "all
   * changes accepted" reads it, so an identical pair at entry (no accepts,
   * no hunks) claims nothing. Reset on every re-entry, never on a lens
   * switch, so a finished pair stays finished. */
  private _acceptsThisComparison = 0;
  /** The snapshot mode's review grain. It defaults to the engine's native
   * word resolution; the shell applies the product default at each
   * comparison start. */
  private _diffGrain: DiffGranularity = "word";
  /** The snapshot mode's direction lens: which side reads as the spine. */
  private _diffDirection: DiffDirection = "adoptedWithSelected";

  hasChanges = false;

  // What the last mutation typed, for the view's character animation.
  lastOp: "type" | null = null;
  typedText: string = "";
  cursorBefore: Cursor | null = null;

  /** Resets the animation hints; the subscriber calls it after reading them. */
  consumeAnimationHints(): void {
    this.lastOp = null;
    this.typedText = "";
    this.cursorBefore = null;
  }

  constructor(deps: SessionDeps) {
    this.codec = deps.codec;
    this.search = deps.search;
    this.history = deps.history;
    this.events = deps.events;
    this.clipboard = deps.clipboard;
    this._doc = this.codec.parse("");
    this.sel = collapsed(0, 0);
    this.savedDoc = this._doc;
    this.savedSet = new Set(this._doc);
    this.bus = createCommandBus(() => ({
      doc: this._doc,
      selection: this.sel,
      codec: this.codec,
      history: this.history,
      search: this.search,
      clipboard: this.clipboard,
    }));
    this.bus.addInterceptor(validationInterceptor());
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  subscribe(listener: (reason: SessionNotification) => void): () => void {
    const offDoc = this.events.on("doc", () => listener("doc"));
    const offSelection = this.events.on("selection", () =>
      listener("selection"),
    );
    const offSaved = this.events.on("saved", () => listener("saved"));
    const offHistory = this.events.on("history", () => listener("history"));
    return () => {
      offDoc();
      offSelection();
      offSaved();
      offHistory();
    };
  }

  /** Hears every input the session declines, apart from the redraw events. */
  onRefused(listener: (why: SessionRefusal) => void): () => void {
    return this.events.on("refused", listener);
  }

  private notify(reason: SessionNotification): void {
    this.events.emit(reason);
  }

  // ── State getters ──────────────────────────────────────────────────────────

  get doc(): Doc {
    return this._doc;
  }
  get commonmark(): string {
    return this.codec.serialize(this._doc);
  }
  get selection(): Selection {
    return this.sel;
  }
  get canUndo(): boolean {
    return this.history.canUndo;
  }
  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** The next undo step's label for a tooltip; null for plain typing. */
  nextUndoLabel(): string | null {
    return this.history.nextUndoLabel();
  }

  /** The next redo step's label, or null at the newest moment. */
  nextRedoLabel(): string | null {
    return this.history.nextRedoLabel();
  }

  /** How many steps the head can walk back: the rail's marker position. */
  undoDepth(): number {
    return this.history.undoDepth();
  }

  /** How many steps the head can walk forward: the rail's marker position. */
  redoDepth(): number {
    return this.history.redoDepth();
  }

  /** A parked future exists; the fork tick reads only this. */
  get hasParkedSiblings(): boolean {
    return this.history.hasParkedSiblings;
  }

  /** The open timeline as an opaque journal string, or null when empty. */
  exportJournal(): string | null {
    return this.history.exportJournal();
  }

  /** Whether the most recent `open` dropped the provided journal as stale or
   * corrupt, the shell's signal for its "history cleared" toast. */
  get lastOpenDroppedJournal(): boolean {
    return this.droppedJournal;
  }

  // The pending format wins over the format at the cursor.
  get currentFormat(): Format {
    return this.pendingFormat ?? getFormatAtCursor(this._doc, this.sel.anchor);
  }

  get currentAlignment(): Alignment {
    return getAlignmentAtCursor(this._doc, this.sel.anchor);
  }

  get isBold(): boolean {
    if (!isCollapsed(this.sel))
      return selectionHasFormat(this._doc, this.sel, "bold");
    return this.currentFormat.bold;
  }

  get isItalic(): boolean {
    if (!isCollapsed(this.sel))
      return selectionHasFormat(this._doc, this.sel, "italic");
    return this.currentFormat.italic;
  }

  get isMonospaceInline(): boolean {
    if (!isCollapsed(this.sel))
      return selectionHasFormat(this._doc, this.sel, "monospace");
    return this.currentFormat.monospace;
  }

  get currentBlockType(): BlockType {
    return getBlockTypeAtCursor(this._doc, this.sel.anchor);
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  // The view calls this on every `selectionchange`. The DOM already shows
  // the selection, so it notifies `selection`, never `doc`.
  updateSelection(sel: Selection): void {
    // The pending format clears only when the cursor moves, so it survives
    // the `selectionchange` events typing fires after a format toggle on a
    // collapsed cursor.
    const prev = this.sel.anchor;
    const next = sel.anchor;
    if (prev.para !== next.para || prev.offset !== next.offset) {
      this.pendingFormat = null;
    }
    this.sel = sel;
    this.notify("selection");
  }

  // ── Diff modes ─────────────────────────────────────────────────────────────

  get isInDiff(): boolean {
    return this.diffKind !== null;
  }

  /** The dock's snapshot comparison, where only an accept edits. */
  get inSnapshotDiff(): boolean {
    return this.diffKind === "snapshot";
  }

  /** The rail's walk, a preview and not a mutation: the head never moves. */
  get inHistoryDiff(): boolean {
    return this.diffKind === "history";
  }

  get historyWalkDepth(): number {
    return this._historyWalkDepth;
  }

  /** The walked state's wall-clock stamp in ms since epoch, for the rail's
   * datetime label. Display metadata, never state: null when the walk is not
   * up or the store has no stamp, and then the label does not paint. A
   * corrupt history also answers null rather than crash. */
  get historyWalkTimestamp(): number | null {
    if (this.diffKind !== "history") return null;
    try {
      return this.history.peekTimestamp(this._historyWalkDepth) ?? null;
    } catch {
      return null;
    }
  }

  /** The decorations the view paints over `displayedDoc`. */
  get diffDecorations(): readonly DiffDecoration[] {
    return this._diffDecorations;
  }

  /** The Accept targets of the current comparison, one per changed region,
   * fresh after every recompute. */
  get diffHunks(): readonly Hunk[] {
    return this._diffHunks;
  }

  /** The snapshot mode's review grain, which the selector renders. */
  get diffGranularity(): DiffGranularity {
    return this._diffGrain;
  }

  /**
   * Set the snapshot mode's review grain; the diff recomputes in place. A
   * lens switch is not a re-entry, so the accepts counter survives it.
   * Outside the snapshot mode the value is only stored.
   */
  setDiffGranularity(grain: DiffGranularity): void {
    this._diffGrain = grain;
    this.recomputeIfSnapshotDiff();
  }

  /** The snapshot mode's direction lens, which the selector renders. */
  get diffDirection(): DiffDirection {
    return this._diffDirection;
  }

  /** Set the snapshot mode's direction, as `setDiffGranularity` sets the grain. */
  setDiffDirection(direction: DiffDirection): void {
    this._diffDirection = direction;
    this.recomputeIfSnapshotDiff();
  }

  private recomputeIfSnapshotDiff(): void {
    if (this.diffKind !== "snapshot") return;
    this.recomputeDiff();
    this.notify("doc");
  }

  /**
   * The two sides of the snapshot mode, arranged by the direction, and the
   * aim. The accept always aims at the live buffer, the adopted, and never
   * at the selected snapshot. The only place the adopted and selected roles
   * meet the engine's left and right. Null when no comparison is retained,
   * which never happens while a snapshot diff is up.
   */
  private diffSides(): { leftSide: Doc; rightSide: Doc; aim: DiffAim } | null {
    const adopted = this._doc;
    const snapshot = this._comparedDoc;
    if (!snapshot) return null;
    return this._diffDirection === "adoptedWithSelected"
      ? { leftSide: adopted, rightSide: snapshot, aim: "left" }
      : { leftSide: snapshot, rightSide: adopted, aim: "right" };
  }

  get acceptsThisComparison(): number {
    return this._acceptsThisComparison;
  }

  /** The doc the view renders: the merged comparison while in a diff mode,
   * the real document otherwise. */
  get displayedDoc(): Doc {
    return this._displayedDoc ?? this._doc;
  }

  /**
   * Enter the snapshot comparison; exits any history walk first. The lenses
   * are not touched here: the shell's `handleCompare` applies them to the
   * fresh pair.
   *
   * A second call while a snapshot diff is up is a new comparison, so it
   * recomputes rather than returning early.
   */
  enterDiff(comparedMd: string): void {
    if (this.diffKind === "history") this.exitHistoryDiff();
    this._comparedDoc = this.codec.parse(comparedMd);
    this._acceptsThisComparison = 0;
    this.diffKind = "snapshot";
    this.recomputeDiff();
    this.notify("doc");
  }

  /** Leave the snapshot comparison; the real buffer renders again. */
  exitDiff(): void {
    if (this.diffKind !== "snapshot") return;
    this._displayedDoc = null;
    this._diffDecorations = [];
    this._diffHunks = [];
    this._comparedDoc = null;
    this.diffKind = null;
    this.notify("doc");
  }

  /**
   * Enter the rail's walk: capture the newest state as the comparison's
   * left side and render the walk's current depth against it.
   */
  enterHistoryDiff(): void {
    if (this.diffKind === "snapshot") this.exitDiff();
    if (this.diffKind === "history") return;
    this.historyTip = this._doc;
    this._historyWalkDepth = 0;
    this.diffKind = "history";
    this.recomputeDiff();
    this.notify("doc");
  }

  /** Leave the walk; Now renders again, unmarked. */
  exitHistoryDiff(): void {
    if (this.diffKind !== "history") return;
    this._displayedDoc = null;
    this._diffDecorations = [];
    this._diffHunks = [];
    this.historyTip = null;
    this._historyWalkDepth = 0;
    this.diffKind = null;
    this.notify("doc");
  }

  /**
   * Step the preview walk by the wheel's delta. A negative delta walks older,
   * up to `undoDepth`, and a positive one walks newer, down to 0.
   * `wheelSteps` answers negative for wheel-up, and the view passes the
   * steps through unchanged.
   *
   * The walk never notifies `history`, because the head and the depths do
   * not change.
   */
  walkHistory(delta: number): void {
    if (this.diffKind !== "history") return;
    const next =
      delta < 0
        ? Math.min(this._historyWalkDepth - delta, this.history.undoDepth())
        : Math.max(0, this._historyWalkDepth - delta);
    if (next === this._historyWalkDepth) return;
    this._historyWalkDepth = next;
    this.recomputeDiff();
    this.notify("doc");
  }

  /**
   * The rail's one edit: the walked state becomes one ordinary undoable step
   * through `commit`, with cause `op`, never coalesced, so Ctrl+Z undoes the
   * whole restore. The target is re-read from the store at click time, as
   * `comparisonSides` reads it. A null or throwing peek is a no-op.
   */
  revertToHistory(label?: string): void {
    if (this.diffKind !== "history") return;
    let target: EditorState;
    try {
      const peeked = this.history.peekBack(this._historyWalkDepth);
      if (!peeked) return;
      target = peeked;
    } catch {
      return;
    }
    // The commit gate exits the mode first, tearing down the preview's merged
    // doc, then the restore lands on the live buffer as one step. The exit's
    // notify and the commit's paint in the same tick, as one render.
    const outcome = this.commit(restoreCommand(target), "op", label);
    if (!outcome) return;
    this.setOutcome(outcome);
    this.notify("doc");
  }

  /**
   * The one recompute: every mutation while a mode is up lands here, so the
   * decorations and hunks describe the current pair. It runs synchronously,
   * before the caller's notify, so the view never paints a stale merged doc.
   */
  private recomputeDiff(): void {
    if (this.diffKind === null) return;
    const grain = this.diffKind === "snapshot" ? this._diffGrain : "word";
    const sides = this.comparisonSides();
    if (!sides) return;
    try {
      const merged = buildMergedDoc(sides.leftSide, sides.rightSide, grain);
      this._displayedDoc = merged.doc;
      this._diffDecorations = merged.decorations;
      this._diffHunks = merged.hunks;
      return;
    } catch {
      // Fall through to the paragraph-grain retry below.
    }
    // Retry once at paragraph grain, which has no token-level LCS. Without
    // the retry, a throw at a finer grain would empty the hunks, which the
    // shell reads as a comparison with no changes.
    if (grain !== "paragraph") {
      try {
        const merged = buildMergedDoc(
          sides.leftSide,
          sides.rightSide,
          "paragraph",
        );
        this._displayedDoc = merged.doc;
        this._diffDecorations = merged.decorations;
        this._diffHunks = merged.hunks;
        return;
      } catch {
        // Falls through to the empty comparison below.
      }
    }
    // A comparison that cannot render at any grain never crashes the session:
    // `displayedDoc` falls back to `_doc`.
    this._displayedDoc = null;
    this._diffDecorations = [];
    this._diffHunks = [];
  }

  /** The current comparison's doc pair, or null when none exists. On a null
   * the callers refuse rather than substitute another mode's pairing, which
   * would diff two unrelated documents. */
  private comparisonSides(): { leftSide: Doc; rightSide: Doc } | null {
    if (this.diffKind === "snapshot") return this.diffSides();
    if (this.diffKind === "history") {
      const tip = this.historyTip;
      if (!tip) return null;
      // The walked state is re-read at every recompute, never cached. A
      // corrupt or refused peek renders the live doc rather than crash.
      let walked: Doc;
      try {
        walked =
          this.history.peekBack(this._historyWalkDepth)?.doc ?? this._doc;
      } catch {
        walked = this._doc;
      }
      return { leftSide: tip, rightSide: walked };
    }
    return null;
  }

  /**
   * Accept one hunk of the snapshot comparison: apply that hunk's change to
   * the adopted buffer as one ordinary undoable step through `commit`, with
   * cause `op`, never coalesced. Only the snapshot mode accepts; in the
   * rail's walk an accept would fork history.
   *
   * A hunk that differs from the one the current recompute holds is a stale
   * click, the hunks having moved between render and click, and is refused,
   * never applied to a shifted range.
   */
  acceptHunk(hunk: Hunk, label?: string): void {
    if (this.diffKind !== "snapshot") return;
    const current = this._diffHunks.find((h) => h.id === hunk.id);
    if (!current || !sameHunk(current, hunk)) return;
    // The sides are captured synchronously, before the commit, so the accept
    // describes the pair the click happened against.
    const sides = this.diffSides();
    if (!sides) return;
    const outcome = this.commit(
      acceptHunkCommand(hunk, sides.leftSide, sides.rightSide, sides.aim),
      "op",
      label,
      { admitWhileSnapshotDiff: true },
    );
    if (!outcome) return;
    this._acceptsThisComparison++;
    this.setOutcome(outcome);
    this.recomputeDiff();
    this.notify("doc");
  }

  // ── History and commit helpers ─────────────────────────────────────────────

  private droppedJournal = false;

  // The burst tracker: the cause and pre-edit cursor of the previous commit.
  // Comparing pre-edit cursors, not post-edit ones, keeps a selection delete
  // separate from the character deletes after it: a selection delete's
  // cursor is its anchor, which is not one less than the previous one, so
  // the chain breaks there. Undo and redo reset the tracker, so a keystroke
  // on the other side of a walk never merges with a step it did not
  // continue. It shares no state with the animation hints.
  // A backspace removes one grapheme cluster, one to several code units, so
  // the offset a continuing backspace starts from is recorded (`back`): where
  // a single-character backspace left the cursor. A selection delete records
  // its anchor less one, which the next backspace's cursor does not reach.
  private mergeKey: {
    cause: HistoryCause;
    para: number;
    offset: number;
    back: number;
  } | null = null;

  private shouldMerge(cause: HistoryCause, beforeCursor: Cursor): boolean {
    if (cause === "op") return false;
    const key = this.mergeKey;
    if (key === null || key.cause !== cause || key.para !== beforeCursor.para) {
      return false;
    }
    return cause === "type"
      ? beforeCursor.offset === key.offset + 1
      : cause === "backspace"
        ? beforeCursor.offset === key.back
        : beforeCursor.offset === key.offset;
  }

  /**
   * The one commit path: capture the pre-mutation state, execute the command,
   * push the transition, hand the outcome back. A no-op outcome (null) pushes
   * nothing and leaves the merge chain intact, so a backspace at the document
   * start is not a step. The coalescing decision lives here, not in the
   * store: the store folds what the session says folds.
   */
  private commit<T>(
    command: Command<T>,
    cause: HistoryCause,
    label?: string,
    opts: { admitWhileSnapshotDiff?: boolean; fold?: boolean } = {},
  ): CommandOutcome<T> | null {
    // The read-only gates. The snapshot comparison refuses every edit except
    // the review's own Accept, admitted by a per-call option only
    // `acceptHunk` passes, never by a flag that allows edits while comparing.
    // The rail's walk exits on the first edit, which lands once, at any walk
    // position.
    if (this.diffKind === "snapshot" && !opts.admitWhileSnapshotDiff)
      return null;
    if (this.diffKind === "history") this.exitHistoryDiff();
    const beforeCursor = this.sel.anchor;
    const collapsedBefore = isCollapsed(this.sel);
    const before: EditorState = { doc: this._doc, cursor: beforeCursor };
    const outcome = this.bus.execute(command);
    if (!outcome) return null;
    const afterCursor = outcome.selection.anchor;
    // `fold` overrides the merge arithmetic rather than extending it:
    // `shouldMerge` recognises only a single-character forward run, and
    // widening it would change every burst's grain.
    this.history.push(
      before,
      { doc: outcome.doc, cursor: afterCursor },
      cause,
      opts.fold ?? this.shouldMerge(cause, beforeCursor),
      label,
    );
    this.mergeKey = {
      cause,
      para: beforeCursor.para,
      offset: beforeCursor.offset,
      back: collapsedBefore ? afterCursor.offset : beforeCursor.offset - 1,
    };
    return outcome;
  }

  /** Whether `_doc` differs from `savedDoc`, by reference-set membership and
   * a length check. The length check catches a deletion, which leaves every
   * surviving paragraph in the saved set. */
  private docHasChanges(): boolean {
    if (this._doc.length !== this.savedDoc.length) return true;
    return this._doc.some((para) => !this.savedSet.has(para));
  }

  /** Set the session state from a committed outcome without notifying, so a
   * caller in a diff mode can recompute the merged view before its one
   * notify. */
  private setOutcome(outcome: CommandOutcome<unknown>): void {
    this._doc = outcome.doc;
    this.sel = outcome.selection;
    this.pendingFormat = null;
    this.hasChanges = this.docHasChanges();
  }

  /** Apply an editing outcome and notify `doc`. */
  private applyOutcome(outcome: CommandOutcome<unknown>): void {
    this.setOutcome(outcome);
    this.notify("doc");
  }

  /** Commit a formatting outcome: new doc, selection preserved. */
  private applyDoc(doc: Doc): void {
    this._doc = doc;
    this.hasChanges = this.docHasChanges();
    this.notify("doc");
  }

  // ── Editing operations ─────────────────────────────────────────────────────

  type(text: string): void {
    const format =
      this.pendingFormat ?? getFormatAtCursor(this._doc, this.sel.anchor);
    this.cursorBefore = { ...this.sel.anchor };
    this.typedText = text;
    this.lastOp = "type";
    const outcome = this.commit(insertTextCommand(text, format), "type");
    if (!outcome) return;
    this.applyOutcome(outcome);
  }

  /**
   * Replace an explicit range with text, in one step.
   *
   * The same edit as `type` with the range handed in, for callers told which
   * span was replaced: a spellcheck correction, an IME composition.
   *
   * `fold` continues the caller's burst instead of opening a new history
   * step, so a composition of any length undoes as one act and does not
   * spend the journal's 2000 steps on states the writer never wrote.
   *
   * The text takes the format of the first character it replaces. An empty
   * span at the caret takes the pending format, so a composition started
   * after Ctrl+B is bold, and every later step, which replaces the
   * composition's own text, keeps it.
   *
   * Returns false for an out-of-range span, which is refused, never clamped:
   * `insertText` would `slice` it into bounds and land the text where the
   * caller did not mean, and the caller could not tell it went wrong.
   */
  replaceRange(
    range: Selection,
    text: string,
    opts: { fold?: boolean } = {},
  ): boolean {
    if (!isValidSelection(this._doc, range)) return false;
    const { start } = normalizeSelection(range);
    const caret = this.sel.anchor;
    const format = !isCollapsed(range)
      ? getFormatAtCursor(this._doc, {
          para: start.para,
          offset: start.offset + 1,
        })
      : this.pendingFormat &&
          caret.para === start.para &&
          caret.offset === start.offset
        ? this.pendingFormat
        : getFormatAtCursor(this._doc, start);
    this.sel = range;
    const outcome = this.commit(insertTextCommand(text, format), "op", "type", {
      fold: opts.fold,
    });
    if (!outcome) return false;
    // No animation hints: the browser or the correction already painted the
    // text, so a fade-in would animate glyphs the writer is looking at.
    this.applyOutcome(outcome);
    return true;
  }

  backspace(): void {
    const outcome = this.commit(deleteBackwardCommand(), "backspace");
    if (!outcome) return;
    this.applyOutcome(outcome);
  }

  del(): void {
    const outcome = this.commit(deleteForwardCommand(), "del");
    if (!outcome) return;
    this.applyOutcome(outcome);
  }

  /** Ctrl+Backspace: delete the word behind the cursor in one step, never
   * coalesced with an adjacent plain backspace, which would put an unrelated
   * single-character delete in the same undo step. */
  deleteWordBackward(): void {
    const outcome = this.commit(deleteWordBackwardCommand(), "op");
    if (!outcome) return;
    this.applyOutcome(outcome);
  }

  /** Ctrl+Delete: the forward mirror of `deleteWordBackward`. */
  deleteWordForward(): void {
    const outcome = this.commit(deleteWordForwardCommand(), "op");
    if (!outcome) return;
    this.applyOutcome(outcome);
  }

  /** Cmd+Backspace on the Mac: delete back to the paragraph's start, which
   * stands for the soft line the engine cannot see. */
  deleteSoftLineBackward(): void {
    const outcome = this.commit(deleteSoftLineBackwardCommand(), "op");
    if (!outcome) return;
    this.applyOutcome(outcome);
  }

  enter(): void {
    const outcome = this.commit(insertParagraphCommand(), "op");
    if (!outcome) return;
    this.applyOutcome(outcome);
  }

  insertPageBreak(): void {
    const outcome = this.commit(insertPageBreakCommand(), "op");
    if (!outcome) return;
    this.applyOutcome(outcome);
  }

  // ── Clipboard and select all ───────────────────────────────────────────────
  //
  // Cut builds the clipboard payload before deleting, so the payload is the
  // removed content. Paste checks the budgets in `domain/limits.ts`: the
  // flavor's length before the parse, where a character becomes an object,
  // and the paragraph count after it. A paste over either is refused whole,
  // with a `refused` event and no other change.

  /** The clipboard payload for the selection, or null when it is collapsed.
   * It reads the doc on screen: in a diff mode the selection is in the
   * merged doc's coordinates, so the merged doc is what the writer copies. */
  copy(): ClipboardPayload | null {
    if (isCollapsed(this.sel)) return null;
    const doc = this.displayedDoc;
    if (!isValidSelection(doc, this.sel)) return null;
    const range = normalizeSelection(this.sel);
    return {
      plain: this.clipboard.buildPlain(doc, range),
      html: this.clipboard.buildHtml(doc, range),
    };
  }

  /** Remove the selection and hand back its payload, in one undoable step. */
  cut(): ClipboardPayload | null {
    const outcome = this.commit(cutCommand(), "op");
    if (!outcome) return null;
    this.applyOutcome(outcome);
    return outcome.value ?? null;
  }

  /**
   * Paste with formatting: prefer the rich flavor, fall back to plain text.
   * False when nothing landed, including a paste refused for its size.
   */
  paste(html: string, plain: string): boolean {
    if (html !== "")
      return this.pasteFragment(html, MAX_PASTE_HTML_CHARS, (input) =>
        this.clipboard.parseHtml(input),
      );
    if (plain !== "")
      return this.pasteFragment(plain, MAX_PASTE_CHARS, (input) =>
        this.clipboard.parsePlain(input),
      );
    return false;
  }

  /** Paste without formatting: plain text only, one paragraph per line. */
  pastePlain(text: string): boolean {
    if (text === "") return false;
    return this.pasteFragment(text, MAX_PASTE_CHARS, (input) =>
      this.clipboard.parsePlain(input),
    );
  }

  private pasteFragment(
    input: string,
    maxChars: number,
    parse: (input: string) => Doc,
  ): boolean {
    if (input.length > maxChars) return this.refuse("pasteTooLong");
    const fragment = parse(input);
    if (fragment.length > MAX_PASTE_PARAGRAPHS)
      return this.refuse("pasteTooLong");
    const outcome = this.commit(pasteCommand(fragment), "op");
    if (!outcome) return false;
    this.applyOutcome(outcome);
    return true;
  }

  private refuse(why: SessionRefusal): false {
    this.events.emit("refused", why);
    return false;
  }

  /** Select the whole document. A selection change, not an edit. */
  selectAll(): void {
    this.sel = selectAllSelection(this._doc);
    this.pendingFormat = null;
    this.notify("selection");
  }

  toggleBold(): void {
    if (isCollapsed(this.sel)) {
      // A collapsed cursor toggles the pending format; the doc is unchanged.
      const base =
        this.pendingFormat ?? getFormatAtCursor(this._doc, this.sel.anchor);
      this.pendingFormat = { ...base, bold: !base.bold };
      this.notify("selection");
      return;
    }
    const outcome = this.commit(toggleFormatCommand("bold"), "op");
    if (!outcome) return;
    this.applyDoc(outcome.doc);
  }

  toggleItalic(): void {
    if (isCollapsed(this.sel)) {
      const base =
        this.pendingFormat ?? getFormatAtCursor(this._doc, this.sel.anchor);
      this.pendingFormat = { ...base, italic: !base.italic };
      this.notify("selection");
      return;
    }
    const outcome = this.commit(toggleFormatCommand("italic"), "op");
    if (!outcome) return;
    this.applyDoc(outcome.doc);
  }

  align(alignment: Alignment): void {
    const outcome = this.commit(setAlignmentCommand(alignment), "op");
    if (!outcome) return;
    this.applyDoc(outcome.doc);
  }

  toggleMonospace(): void {
    if (isCollapsed(this.sel)) {
      const base =
        this.pendingFormat ?? getFormatAtCursor(this._doc, this.sel.anchor);
      this.pendingFormat = { ...base, monospace: !base.monospace };
      this.notify("selection");
      return;
    }
    const outcome = this.commit(toggleFormatCommand("monospace"), "op");
    if (!outcome) return;
    this.applyDoc(outcome.doc);
  }

  toggleCase(): void {
    if (isCollapsed(this.sel)) return;
    const outcome = this.commit(toggleCaseCommand(), "op");
    if (!outcome) return;
    this.applyDoc(outcome.doc);
  }

  setNormalText(): void {
    if (isCollapsed(this.sel)) {
      const base =
        this.pendingFormat ?? getFormatAtCursor(this._doc, this.sel.anchor);
      if (!base.monospace) return;
      this.pendingFormat = { ...base, monospace: false };
      this.notify("selection");
      return;
    }
    if (!selectionHasFormat(this._doc, this.sel, "monospace")) return;
    const outcome = this.commit(clearFormatCommand("monospace"), "op");
    if (!outcome) return;
    this.applyDoc(outcome.doc);
  }

  setBlockType(type: BlockType): void {
    const outcome = this.commit(setBlockTypeCommand(type), "op");
    if (!outcome) return;
    this.applyDoc(outcome.doc);
  }

  // ── Find and replace ───────────────────────────────────────────────────────

  /**
   * Replace a single match; the cursor lands after the replacement text.
   *
   * A match is offsets into the doc it was found in. With `search`, the
   * query that found it, the match must still be one of that query's matches
   * in the current doc; after an edit or another file's open it may cover
   * other text, and it is refused. Returns whether the replace landed.
   */
  replaceCurrent(
    match: Match,
    replacement: string,
    plain = false,
    search?: { query: string; opts: SearchOptions },
  ): boolean {
    if (match.para < 0 || match.para >= this._doc.length) return false;
    if (
      search &&
      !this.search
        .findMatches(this._doc, search.query, search.opts)
        .some(
          (m) =>
            m.para === match.para &&
            m.startOffset === match.startOffset &&
            m.endPara === match.endPara &&
            m.endOffset === match.endOffset,
        )
    )
      return false;
    const outcome = this.commit(
      replaceMatchesCommand([match], replacement, plain),
      "op",
    );
    if (!outcome) return false;
    this.applyOutcome(outcome);
    return true;
  }

  /**
   * Replace every match of `query` in one undo step; a no-op when nothing
   * matches. `label` is the tooltip's words, owned by the view.
   */
  replaceAll(
    query: string,
    replacement: string,
    opts: SearchOptions,
    plain = false,
    label?: string,
  ): void {
    const outcome = this.commit(
      replaceAllCommand(query, replacement, opts, plain),
      "op",
      label,
    );
    if (!outcome) return;
    this.applyOutcome(outcome);
  }

  undo(): void {
    // Refused under the rail, so the peeked states and the live buffer never
    // drift apart. The snapshot mode keeps undo and redo live: accepts are
    // ordinary steps.
    if (this.diffKind === "history") return;
    const outcome = this.bus.execute(undoCommand());
    if (!outcome) return;
    this.applyWalk(outcome);
  }

  redo(): void {
    if (this.diffKind === "history") return;
    const outcome = this.bus.execute(redoCommand());
    if (!outcome) return;
    this.applyWalk(outcome);
  }

  /** Apply an undo or redo step. The walk also clears any pending format: a
   * format armed at a collapsed caret belongs to the position it was armed
   * at, and must not paint the next keystroke after the walk lands
   * elsewhere. */
  private applyWalk(outcome: CommandOutcome<unknown>): void {
    this.mergeKey = null;
    this._doc = outcome.doc;
    this.sel = outcome.selection;
    this.pendingFormat = null;
    this.recomputeDiff();
    this.hasChanges = this.docHasChanges();
    this.notify("history");
    this.notify("doc");
  }

  // ── File operations ────────────────────────────────────────────────────────

  /** Bumped by every `open`, so a view can tell an opened file from an
   * edited document; both notify as `doc`. */
  openCount = 0;

  open(md: string, opts?: { caret?: "start" | "end"; journal?: string }): void {
    this.openCount++;
    // Any open exits the diff modes: a stale merged doc must never render
    // over a newly opened file, and a retained compared reference would
    // recompute the next comparison against the wrong pair.
    this._displayedDoc = null;
    this._diffDecorations = [];
    this._diffHunks = [];
    this._comparedDoc = null;
    this.diffKind = null;
    this.historyTip = null;
    const outcome = this.bus.execute(openCommand(md, opts));
    if (!outcome) return;
    this.pendingFormat = null;
    this.mergeKey = null;
    // The baseline is the re-serialized document, not the raw bytes: a file
    // not in the serializer's canonical form must not read as dirty on open,
    // or the leaving guard would ask about work nobody did.
    const canonical = this.codec.serialize(outcome.doc);
    let doc = outcome.doc;
    const selection = outcome.selection;
    this.droppedJournal = false;
    if (opts?.journal !== undefined) {
      // The head state must equal the file just read under the codec;
      // otherwise the journal is stale (edited elsewhere), corrupt, or left
      // over from a reused name, and the whole journal is dropped.
      const head = this.history.importJournal(opts.journal);
      if (head !== null && this.codec.serialize(head.doc) === canonical) {
        // The buffer is the object the store holds, so undo stays O(1). The
        // head's cursor is not restored: the opener's `caret` decides where
        // the caret lands.
        doc = head.doc;
      } else {
        this.droppedJournal = true;
        this.history.clear();
      }
    } else {
      this.history.clear();
    }
    this.savedDoc = doc;
    this.savedSet = new Set(doc);
    this._doc = doc;
    this.sel = selection;
    this.hasChanges = false;
    this.notify("history");
    this.notify("doc");
  }

  /**
   * The text a save would write. Never touches saved state: the caller
   * writes this to disk, then calls `markSaved` only once the write has
   * succeeded, so a failed write leaves the buffer dirty.
   */
  save(): string {
    return this.commonmark;
  }

  /**
   * Commit the buffer as saved, only if it still matches `text`. The writer
   * may have typed between `save` and this call, and those newer edits stay
   * dirty, because the bytes on disk are older.
   */
  markSaved(text: string): void {
    if (this.commonmark !== text) return;
    this.savedDoc = this._doc;
    this.savedSet = new Set(this._doc);
    this.hasChanges = false;
    this.notify("saved");
  }

  /**
   * Which paragraphs differ from the last write, by index into the current
   * doc, by reference against the saved baseline. A paragraph that moved
   * without being edited is not dirty: its object is unchanged, and where it
   * sits is the structure's concern, not the file's.
   */
  dirtyParagraphs(): Set<number> {
    const dirty = new Set<number>();
    this._doc.forEach((para, index) => {
      if (!this.savedSet.has(para)) dirty.add(index);
    });
    return dirty;
  }
}

function collapsed(para: number, offset: number): Selection {
  const c: Cursor = { para, offset };
  return { anchor: c, focus: c };
}
