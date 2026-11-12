// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { DeltaTimeline } from "../adapters/delta";
import { SnapshotHistory } from "../adapters/snapshot";
import {
  HISTORY_MAX_STEPS,
  type EditorState,
  type HistoryStore,
} from "./history";
import type { Cursor, Doc, Paragraph } from "../domain/model";

// The history contract: the semantics every `HistoryStore` honors, run
// against every implementation. The delta timeline and the snapshot oracle
// are interchangeable, which is what lets the delta hold the writer's undo.
//
// Tier 1 is exact-state identity: undo returns the `before` object that was
// pushed, by reference, not an equal value. The persistent model makes
// states references and the timeline's nodes hold them, so a walk is O(1)
// pointer moves and undoing a million-character paste is instant.
//
// Coalescing is not tested here: the session owns the merge policy and the
// store folds what the session says folds, so the burst rows are in
// `session.test.ts`. Retention of parked siblings is not tested here either,
// because the snapshot oracle cannot park; those rows are in
// `delta.test.ts`.

const PLAIN = { bold: false, italic: false, monospace: false };
const para = (text = ""): Paragraph => ({
  runs: text ? [{ text, format: PLAIN }] : [],
  alignment: "left",
  blockType: "paragraph",
});

const st = (doc: Doc, cursor: Cursor): EditorState => ({ doc, cursor });

const stores: { name: string; create: () => HistoryStore }[] = [
  { name: "snapshot", create: () => new SnapshotHistory() },
  { name: "delta", create: () => new DeltaTimeline() },
];

// The editing model is persistent: every state below is a fresh array, so
// the tests can assert identity (structural sharing) as well as content.

describe.each(stores)("$name history contract", ({ create }) => {
  describe("exact-state identity", () => {
    it("undo returns the very before object pushed", () => {
      const history = create();
      const s0: Doc = [];
      const s1: Doc = [para("a")];
      const c0: Cursor = { para: 0, offset: 0 };
      const c1: Cursor = { para: 0, offset: 1 };

      history.push(st(s0, c0), st(s1, c1), "type", false);

      const entry = history.undo();
      expect(entry?.doc).toBe(s0);
      expect(entry?.cursor).toBe(c0);
    });

    it("redo returns the very state undone from", () => {
      const history = create();
      const s0: Doc = [];
      const s1: Doc = [para("a")];
      history.push(
        st(s0, { para: 0, offset: 0 }),
        st(s1, { para: 0, offset: 1 }),
        "type",
        false,
      );

      const undone = history.undo();
      expect(undone?.doc).toBe(s0);
      const redone = history.redo();
      expect(redone?.doc).toBe(s1);
      expect(redone?.cursor).toEqual({ para: 0, offset: 1 });
    });

    it("undo then redo returns the exact state undone from", () => {
      const history = create();
      const s0: Doc = [];
      const s1: Doc = [para("a")];
      const s2: Doc = [para("ab")];
      const c0: Cursor = { para: 0, offset: 0 };
      const c1: Cursor = { para: 0, offset: 1 };
      const c2: Cursor = { para: 0, offset: 2 };
      history.push(st(s0, c0), st(s1, c1), "type", false);
      history.push(st(s1, c1), st(s2, c2), "type", false);

      const undone = history.undo(); // → s1
      expect(undone?.doc).toBe(s1);
      const redone = history.redo();
      expect(redone?.doc).toBe(s2);
      const undoneAgain = history.undo();
      expect(undoneAgain?.doc).toBe(s1);
    });

    it("undo on an empty store returns null and changes nothing", () => {
      const history = create();
      expect(history.undo()).toBeNull();
      expect(history.canUndo).toBe(false);
      expect(history.canRedo).toBe(false);
    });

    it("redo on an empty store returns null", () => {
      const history = create();
      expect(history.redo()).toBeNull();
    });

    it("redo at the newest node returns null — the tip is a promise, not a tombstone", () => {
      const history = create();
      history.push(
        st([], { para: 0, offset: 0 }),
        st([para("a")], { para: 0, offset: 1 }),
        "type",
        false,
      );
      expect(history.canRedo).toBe(false);
      expect(history.redo()).toBeNull();
    });
  });

  describe("merge folding", () => {
    it("undo walks back through a merged burst to the burst-start before", () => {
      const history = create();
      const s0: Doc = [];
      const s1: Doc = [para("a")];
      const s2: Doc = [para("ab")];
      const c0: Cursor = { para: 0, offset: 0 };
      const c1: Cursor = { para: 0, offset: 1 };
      const c2: Cursor = { para: 0, offset: 2 };
      history.push(st(s0, c0), st(s1, c1), "type", false);
      history.push(st(s1, c1), st(s2, c2), "type", true);

      const entry = history.undo();
      expect(entry?.doc).toBe(s0);
      expect(entry?.cursor).toBe(c0);
      expect(history.canUndo).toBe(false);
    });

    it("a merged burst redos to the burst's final after", () => {
      const history = create();
      const s0: Doc = [];
      const s1: Doc = [para("a")];
      const s2: Doc = [para("ab")];
      history.push(
        st(s0, { para: 0, offset: 0 }),
        st(s1, { para: 0, offset: 1 }),
        "type",
        false,
      );
      history.push(
        st(s1, { para: 0, offset: 1 }),
        st(s2, { para: 0, offset: 2 }),
        "type",
        true,
      );
      history.undo();
      const redone = history.redo();
      expect(redone?.doc).toBe(s2);
    });

    it("a merge:false push opens a new node — both pushes undo individually", () => {
      const history = create();
      const s0: Doc = [];
      const s1: Doc = [para("a")];
      const s2: Doc = [para("ab")];
      history.push(
        st(s0, { para: 0, offset: 0 }),
        st(s1, { para: 0, offset: 1 }),
        "type",
        false,
      );
      history.push(
        st(s1, { para: 0, offset: 1 }),
        st(s2, { para: 0, offset: 2 }),
        "type",
        false,
      );

      expect(history.undo()?.doc).toBe(s1);
      expect(history.undo()?.doc).toBe(s0);
      expect(history.canUndo).toBe(false);
    });

    it("a merged push still clears the redo stack", () => {
      const history = create();
      const s0: Doc = [];
      const s1: Doc = [para("a")];
      const s2: Doc = [para("ab")];
      history.push(
        st(s0, { para: 0, offset: 0 }),
        st(s1, { para: 0, offset: 1 }),
        "type",
        false,
      );
      history.undo();
      expect(history.canRedo).toBe(true);

      history.push(
        st(s0, { para: 0, offset: 0 }),
        st(s2, { para: 0, offset: 2 }),
        "type",
        true,
      );
      expect(history.canRedo).toBe(false);
    });

    it("a merge:true push after undo creates a new node — nothing resurrects on the other side", () => {
      const history = create();
      const s0: Doc = [];
      const s1: Doc = [para("a")];
      const s2: Doc = [para("a")];
      history.push(
        st(s0, { para: 0, offset: 0 }),
        st(s1, { para: 0, offset: 1 }),
        "type",
        false,
      );
      history.undo();

      // Same cursor position as the popped entry; it does not merge with it.
      history.push(
        st(s0, { para: 0, offset: 0 }),
        st(s2, { para: 0, offset: 1 }),
        "type",
        true,
      );

      // The push creates one new entry; the popped s0 is on the redo side,
      // never resurrected by a stale merge.
      expect(history.undo()?.doc).toBe(s0);
      expect(history.canUndo).toBe(false);
      expect(history.canRedo).toBe(true);
      expect(history.redo()?.doc).toBe(s2);
    });

    it("a merge:true push after redo folds into the redone node", () => {
      const history = create();
      const s0: Doc = [];
      const s1: Doc = [para("a")];
      const s2: Doc = [para("ab")];
      history.push(
        st(s0, { para: 0, offset: 0 }),
        st(s1, { para: 0, offset: 1 }),
        "type",
        false,
      );
      history.undo();
      history.redo();

      // The store folds whatever the caller marks mergeable; the session is
      // what refuses to mark a keystroke after a walk as mergeable.
      history.push(
        st(s1, { para: 0, offset: 1 }),
        st(s2, { para: 0, offset: 2 }),
        "type",
        true,
      );

      expect(history.undo()?.doc).toBe(s0);
      expect(history.redo()?.doc).toBe(s2);
    });
  });

  describe("peekBack — the preview walk's read-only seam", () => {
    it("peekBack(0) is the head's own state, by reference", () => {
      const history = create();
      const s0: Doc = [];
      const s1: Doc = [para("a")];
      const c0: Cursor = { para: 0, offset: 0 };
      const c1: Cursor = { para: 0, offset: 1 };
      history.push(st(s0, c0), st(s1, c1), "type", false);
      expect(history.peekBack(0)?.doc).toBe(s1);
      expect(history.peekBack(0)?.cursor).toBe(c1);
    });

    it("peekBack(d) is the very state d undos would land on", () => {
      const history = create();
      const s0: Doc = [];
      const s1: Doc = [para("a")];
      const s2: Doc = [para("ab")];
      const c0: Cursor = { para: 0, offset: 0 };
      const c1: Cursor = { para: 0, offset: 1 };
      const c2: Cursor = { para: 0, offset: 2 };
      history.push(st(s0, c0), st(s1, c1), "type", false);
      history.push(st(s1, c1), st(s2, c2), "type", false);

      // Undo d times, redo d times: the peek answers with the states that
      // walk lands on.
      const peeked1 = history.peekBack(1);
      const peeked2 = history.peekBack(2);
      expect(history.undo()?.doc).toBe(s1);
      expect(history.undo()?.doc).toBe(s0);
      history.redo();
      history.redo();
      expect(peeked1?.doc).toBe(s1);
      expect(peeked2?.doc).toBe(s0);
    });

    it("peek is read-only — the head and the depths never move", () => {
      const history = create();
      const s0: Doc = [];
      const s1: Doc = [para("a")];
      const s2: Doc = [para("ab")];
      history.push(
        st(s0, { para: 0, offset: 0 }),
        st(s1, { para: 0, offset: 1 }),
        "type",
        false,
      );
      history.push(
        st(s1, { para: 0, offset: 1 }),
        st(s2, { para: 0, offset: 2 }),
        "type",
        false,
      );
      const before = history.undoDepth();
      history.peekBack(1);
      history.peekBack(0);
      history.peekBack(2);
      expect(history.undoDepth()).toBe(before);
      expect(history.redoDepth()).toBe(0);
      expect(history.canUndo).toBe(true);
      expect(history.canRedo).toBe(false);
      expect(history.undo()?.doc).toBe(s1);
    });

    it("a merged burst is one step — peekBack(1) is the burst start", () => {
      const history = create();
      const s0: Doc = [];
      const s1: Doc = [para("a")];
      const s2: Doc = [para("ab")];
      history.push(
        st(s0, { para: 0, offset: 0 }),
        st(s1, { para: 0, offset: 1 }),
        "type",
        false,
      );
      history.push(
        st(s1, { para: 0, offset: 1 }),
        st(s2, { para: 0, offset: 2 }),
        "type",
        true,
      );
      expect(history.peekBack(1)?.doc).toBe(s0);
      expect(history.peekBack(2)).toBeNull();
    });

    it("peek refuses — null on an empty store, past the walk, negative or NaN", () => {
      const history = create();
      expect(history.peekBack(0)).toBeNull();
      expect(history.peekBack(1)).toBeNull();
      history.push(
        st([], { para: 0, offset: 0 }),
        st([para("a")], { para: 0, offset: 1 }),
        "type",
        false,
      );
      expect(history.peekBack(2)).toBeNull();
      expect(history.peekBack(-1)).toBeNull();
      expect(history.peekBack(Number.NaN)).toBeNull();
      expect(history.peekBack(1.5)).toBeNull();
    });
  });

  describe("peekTimestamp — the walked step's stamp", () => {
    it("peekTimestamp(0) is the head's own stamp after a push", () => {
      const history = create();
      expect(history.peekTimestamp(0)).toBeNull();
      history.push(
        st([], { para: 0, offset: 0 }),
        st([para("a")], { para: 0, offset: 1 }),
        "type",
        false,
      );
      expect(history.peekTimestamp(0)).not.toBeNull();
    });

    it("stamps each step with the time it was taken, older steps earlier", () => {
      // The clock is controlled, so a store that stamps nothing, or the same
      // moment everywhere, cannot pass.
      const T0 = Date.UTC(2026, 10, 7, 9, 0, 0);
      const T1 = T0 + 5_000;
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(T0);
        const history = create();
        const s0: Doc = [];
        const s1: Doc = [para("a")];
        const s2: Doc = [para("ab")];
        history.push(
          st(s0, { para: 0, offset: 0 }),
          st(s1, { para: 0, offset: 1 }),
          "type",
          false,
        );
        vi.setSystemTime(T1);
        history.push(
          st(s1, { para: 0, offset: 1 }),
          st(s2, { para: 0, offset: 2 }),
          "type",
          false,
        );
        // The step between was reached at the first push and left at the
        // second; a store may stamp it with either moment, never outside them.
        const middle = history.peekTimestamp(1) as number;
        expect(history.peekTimestamp(0)).toBe(T1);
        expect(middle).toBeGreaterThanOrEqual(T0);
        expect(middle).toBeLessThanOrEqual(T1);
        expect(history.peekTimestamp(2)).toBe(T0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("refuses — null on an empty store, past the walk, negative or NaN", () => {
      const history = create();
      expect(history.peekTimestamp(0)).toBeNull();
      expect(history.peekTimestamp(1)).toBeNull();
      history.push(
        st([], { para: 0, offset: 0 }),
        st([para("a")], { para: 0, offset: 1 }),
        "type",
        false,
      );
      expect(history.peekTimestamp(2)).toBeNull();
      expect(history.peekTimestamp(-1)).toBeNull();
      expect(history.peekTimestamp(Number.NaN)).toBeNull();
      expect(history.peekTimestamp(1.5)).toBeNull();
    });

    it("peek is read-only — the head and the depths never move", () => {
      const history = create();
      const s0: Doc = [];
      const s1: Doc = [para("a")];
      const s2: Doc = [para("ab")];
      history.push(
        st(s0, { para: 0, offset: 0 }),
        st(s1, { para: 0, offset: 1 }),
        "type",
        false,
      );
      history.push(
        st(s1, { para: 0, offset: 1 }),
        st(s2, { para: 0, offset: 2 }),
        "type",
        false,
      );
      const before = history.undoDepth();
      history.peekTimestamp(0);
      history.peekTimestamp(1);
      history.peekTimestamp(2);
      expect(history.undoDepth()).toBe(before);
      expect(history.redoDepth()).toBe(0);
      expect(history.canUndo).toBe(true);
      expect(history.undo()?.doc).toBe(s1);
    });

    it("a merged burst is one step — peekTimestamp(1) is the burst start's stamp", () => {
      const history = create();
      const s0: Doc = [];
      const s1: Doc = [para("a")];
      const s2: Doc = [para("ab")];
      history.push(
        st(s0, { para: 0, offset: 0 }),
        st(s1, { para: 0, offset: 1 }),
        "type",
        false,
      );
      history.push(
        st(s1, { para: 0, offset: 1 }),
        st(s2, { para: 0, offset: 2 }),
        "type",
        true,
      );
      // One walkable step back: the burst start's own stamp, no deeper.
      expect(history.peekTimestamp(2)).toBeNull();
      const start = history.peekTimestamp(1);
      const head = history.peekTimestamp(0);
      expect(start).not.toBeNull();
      expect(head).not.toBeNull();
      expect(start as number).toBeLessThanOrEqual(head as number);
    });
  });

  describe("cap and clear", () => {
    it("keeps the size cap — the store never grows past it, dropped oldest-first", () => {
      const history = create();
      // 2 * `HISTORY_MAX_STEPS` chained non-merge pushes; the cap applies.
      let doc: Doc = [];
      for (let i = 0; i < HISTORY_MAX_STEPS * 2; i++) {
        const next: Doc = [para(`${i}b`)];
        history.push(
          st(doc, { para: 0, offset: i }),
          st(next, { para: 0, offset: i + 1 }),
          "type",
          false,
        );
        doc = next;
      }
      let count = 0;
      while (history.undo()) count++;
      expect(count).toBe(HISTORY_MAX_STEPS);
    });

    it("clear resets undo, redo, and the labels", () => {
      const history = create();
      history.push(
        st([], { para: 0, offset: 0 }),
        st([para("a")], { para: 0, offset: 1 }),
        "type",
        false,
      );
      history.undo();
      history.clear();

      expect(history.canUndo).toBe(false);
      expect(history.canRedo).toBe(false);
      expect(history.nextUndoLabel()).toBeNull();
      expect(history.nextRedoLabel()).toBeNull();

      const fresh: Doc = [];
      history.push(
        st(fresh, { para: 0, offset: 0 }),
        st([para("b")], { para: 0, offset: 1 }),
        "type",
        false,
      );
      expect(history.undo()?.doc).toBe(fresh);
    });
  });

  describe("labels", () => {
    it("nextUndoLabel and nextRedoLabel are null on an empty store", () => {
      const history = create();
      expect(history.nextUndoLabel()).toBeNull();
      expect(history.nextRedoLabel()).toBeNull();
    });
  });

  describe("the snapshot oracle's refusal", () => {
    it("exportJournal returns null on the snapshot oracle", () => {
      const history = create();
      if (history instanceof SnapshotHistory) {
        history.push(
          st([], { para: 0, offset: 0 }),
          st([para("a")], { para: 0, offset: 1 }),
          "type",
          false,
        );
        expect(history.exportJournal()).toBeNull();
      }
    });

    it("importJournal throws on the snapshot oracle", () => {
      const history = create();
      if (history instanceof SnapshotHistory) {
        expect(() => history.importJournal()).toThrow(/does not persist/);
      }
    });
  });
});
