// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { Session, type SessionDeps, type SessionEvents } from "./session";
import { SnapshotHistory } from "../adapters/snapshot";
import { DeltaTimeline } from "../adapters/delta";
import { regexSearch } from "../adapters/regex";
import { commonmarkCodec } from "../adapters/commonmark";
import { browserClipboardCodec } from "../adapters/browserHtml";
import { Emitter } from "../adapters/emitter";
import type { Codec } from "../ports/codec";
import type { EventBus } from "../ports/events";
import type { SearchProvider } from "../ports/search";
import type { HistoryStore } from "../ports/history";

// Pins the session contract beyond what `engine.test.ts` pins through
// `EditorEngine`: the events port carries notifications, subscriptions are
// exact, no-ops stay silent, and the validation interceptor guards every
// command outcome.
//
// Burst coalescing is a session policy: the history store folds what the
// session says folds. The burst rows therefore run through the session API
// against both history adapters, which must give identical burst semantics.

const histories: { name: string; create: () => HistoryStore }[] = [
  { name: "snapshot", create: () => new SnapshotHistory() },
  { name: "delta", create: () => new DeltaTimeline() },
];

const sessionWith = (history: HistoryStore) => new Session(deps({ history }));

const cursorAt = (para: number, offset: number) => ({
  anchor: { para, offset },
  focus: { para, offset },
});

const deps = (over: Partial<SessionDeps> = {}): SessionDeps => ({
  codec: over.codec ?? commonmarkCodec,
  history: over.history ?? new SnapshotHistory(),
  search: over.search ?? regexSearch,
  events: over.events ?? new Emitter<SessionEvents>(),
  clipboard: over.clipboard ?? browserClipboardCodec,
});

function spyEvents(): { bus: EventBus<SessionEvents>; reasons: string[] } {
  const bus = new Emitter<SessionEvents>();
  const reasons: string[] = [];
  bus.on("doc", () => reasons.push("doc"));
  bus.on("selection", () => reasons.push("selection"));
  bus.on("history", () => reasons.push("history"));
  return { bus, reasons };
}

describe("session notifications", () => {
  it("emits doc on edits and selection on selection updates", () => {
    const { bus, reasons } = spyEvents();
    const session = new Session(deps({ events: bus }));
    session.type("a");
    session.updateSelection({
      anchor: { para: 0, offset: 1 },
      focus: { para: 0, offset: 1 },
    });
    expect(reasons).toEqual(["doc", "selection"]);
  });

  it("subscribe routes both event types to one listener and unsubscribes exactly", () => {
    const session = new Session(deps());
    const seen: string[] = [];
    const unsubscribe = session.subscribe((reason) => seen.push(reason));
    session.type("a");
    session.updateSelection({
      anchor: { para: 0, offset: 1 },
      focus: { para: 0, offset: 1 },
    });
    unsubscribe();
    session.type("b");
    expect(seen).toEqual(["doc", "selection"]);
  });

  it("no-op commands change nothing and notify nothing", () => {
    const { bus, reasons } = spyEvents();
    const session = new Session(deps({ events: bus }));
    session.undo();
    session.redo();
    session.replaceAll("zzz", "x", { caseSensitive: false, wholeWord: false });
    expect(reasons).toEqual([]);
    expect(session.commonmark).toBe("");
  });
});

describe("validation interceptor", () => {
  it("rejects a codec that hands the session an invalid doc", () => {
    const badCodec: Codec = { parse: () => [], serialize: () => "" };
    const session = new Session(deps({ codec: badCodec }));
    expect(() => session.open("anything")).toThrow("invalid session state");
  });

  it("lets valid command outcomes through", () => {
    const session = new Session(deps());
    expect(() => {
      session.type("hello");
      session.toggleBold();
      session.enter();
      session.undo();
    }).not.toThrow();
  });
});

describe("session composition", () => {
  it("depends on the injected ports, not the default adapters", () => {
    const spySearch: SearchProvider = {
      ...regexSearch,
      findMatches: () => [
        { para: 0, startOffset: 0, endPara: 0, endOffset: 3 },
      ],
    };
    const session = new Session(deps({ search: spySearch }));
    session.type("cat");
    session.replaceAll("cat", "dog", {
      caseSensitive: false,
      wholeWord: false,
    });
    expect(session.commonmark).toBe("dog");
  });

  it("injected history participates in undo/redo", () => {
    const history = new SnapshotHistory();
    const session = new Session(deps({ history }));
    session.type("one");
    session.enter();
    session.type("two");
    session.undo();
    expect(session.commonmark).toBe("one\n\n");
    expect(history.canRedo).toBe(true);
    session.redo();
    expect(session.commonmark).toBe("one\n\ntwo");
  });

  it("a session can be built with a fresh emitter each time (no shared state)", () => {
    const a = new Session(deps());
    const b = new Session(deps());
    a.type("x");
    expect(b.commonmark).toBe("");
  });
});

describe("formatting state and hints", () => {
  it("toggling bold at a collapsed cursor changes currentFormat without touching the doc", () => {
    const { bus, reasons } = spyEvents();
    const session = new Session(deps({ events: bus }));
    expect(session.currentFormat.bold).toBe(false);
    session.toggleBold();
    expect(session.currentFormat.bold).toBe(true);
    expect(session.commonmark).toBe("");
    expect(reasons).toEqual(["selection"]);
    session.type("a");
    expect(session.commonmark).toBe("**a**");
  });

  it("isBold, isItalic and isMonospaceInline reflect the pending format at a collapsed cursor", () => {
    const session = new Session(deps());
    expect(session.isBold).toBe(false);
    expect(session.isItalic).toBe(false);
    expect(session.isMonospaceInline).toBe(false);
    session.toggleBold();
    session.toggleItalic();
    session.toggleMonospace();
    expect(session.isBold).toBe(true);
    expect(session.isItalic).toBe(true);
    expect(session.isMonospaceInline).toBe(true);
  });

  it("formatting getters inspect the runs a selection spans", () => {
    const session = new Session(deps());
    session.open("**bold** and `mono`");
    session.updateSelection({
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 4 },
    });
    expect(session.isBold).toBe(true);
    expect(session.isItalic).toBe(false);
    session.updateSelection({
      anchor: { para: 0, offset: 9 },
      focus: { para: 0, offset: 13 },
    });
    expect(session.isMonospaceInline).toBe(true);
    expect(session.isBold).toBe(false);
  });

  it("toggleCase is a no-op at a collapsed cursor and uppercases a selection", () => {
    const session = new Session(deps());
    session.toggleCase();
    expect(session.commonmark).toBe("");
    session.type("hello");
    session.updateSelection({
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 5 },
    });
    session.toggleCase();
    expect(session.commonmark).toBe("HELLO");
  });

  it("toggleItalic and toggleMonospace apply to a selection and undo in one step", () => {
    const session = new Session(deps());
    session.type("xy");
    session.updateSelection({
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 2 },
    });
    session.toggleItalic();
    expect(session.commonmark).toBe("*xy*");
    session.undo();
    expect(session.commonmark).toBe("xy");
    session.updateSelection({
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 2 },
    });
    session.toggleMonospace();
    expect(session.commonmark).toBe("`xy`");
  });

  it("setNormalText strips monospace from a selection and is a no-op without it", () => {
    const session = new Session(deps());
    session.open("`code`");
    session.updateSelection({
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 4 },
    });
    session.setNormalText();
    expect(session.commonmark).toBe("code");
    session.updateSelection({
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 2 },
    });
    session.setNormalText();
    expect(session.commonmark).toBe("code");
  });

  it("setNormalText clears a pending monospace at a collapsed cursor, silently otherwise", () => {
    const { bus, reasons } = spyEvents();
    const session = new Session(deps({ events: bus }));
    session.toggleMonospace();
    session.setNormalText();
    expect(session.isMonospaceInline).toBe(false);
    expect(reasons).toEqual(["selection", "selection"]);
    session.setNormalText();
    expect(reasons).toEqual(["selection", "selection"]);
  });

  it("currentAlignment and currentBlockType follow the cursor", () => {
    const session = new Session(deps());
    expect(session.currentAlignment).toBe("left");
    expect(session.currentBlockType).toBe("paragraph");
    session.type("x");
    session.align("center");
    expect(session.currentAlignment).toBe("center");
    session.enter();
    session.type("y");
    session.setBlockType("h1");
    expect(session.currentBlockType).toBe("h1");
    session.setBlockType("h1");
    session.undo();
    expect(session.currentBlockType).toBe("paragraph");
    session.redo();
    expect(session.currentBlockType).toBe("h1");
  });

  it("consumeAnimationHints reads and clears the typing hints", () => {
    const session = new Session(deps());
    expect(session.lastOp).toBeNull();
    session.type("abc");
    expect(session.lastOp).toBe("type");
    expect(session.typedText).toBe("abc");
    expect(session.cursorBefore).toEqual({ para: 0, offset: 0 });
    session.consumeAnimationHints();
    expect(session.lastOp).toBeNull();
    expect(session.typedText).toBe("");
    expect(session.cursorBefore).toBeNull();
  });

  it("toggleItalic at a collapsed cursor with no pending format reads the format at the cursor", () => {
    const session = new Session(deps());
    session.type("ab");
    session.updateSelection({
      anchor: { para: 0, offset: 1 },
      focus: { para: 0, offset: 1 },
    });
    session.toggleItalic();
    expect(session.isItalic).toBe(true);
    expect(session.commonmark).toBe("ab");
    session.type("x");
    expect(session.commonmark).toBe("a*x*b");
  });

  it("setNormalText at a collapsed cursor with no pending monospace changes nothing", () => {
    const session = new Session(deps());
    session.type("ab");
    session.updateSelection({
      anchor: { para: 0, offset: 1 },
      focus: { para: 0, offset: 1 },
    });
    session.setNormalText();
    expect(session.commonmark).toBe("ab");
    expect(session.isMonospaceInline).toBe(false);
  });

  it("replaceCurrent refuses a match its query no longer finds there", () => {
    const session = new Session(deps());
    session.open("the cat sat");
    const search = {
      query: "cat",
      opts: { caseSensitive: false, wholeWord: false },
    };
    const [match] = regexSearch.findMatches(
      session.doc,
      search.query,
      search.opts,
    );
    session.open("a dog sat on the cat");
    expect(session.replaceCurrent(match, "bird", false, search)).toBe(false);
    expect(session.commonmark).toBe("a dog sat on the cat");
    const [fresh] = regexSearch.findMatches(
      session.doc,
      search.query,
      search.opts,
    );
    expect(session.replaceCurrent(fresh, "bird", false, search)).toBe(true);
    expect(session.commonmark).toBe("a dog sat on the bird");
  });

  it("a composition at the caret takes the pending format, and its later steps keep it", () => {
    const session = new Session(deps());
    session.open("ab");
    session.updateSelection(cursorAt(0, 1));
    session.toggleBold();
    session.replaceRange(cursorAt(0, 1), "x");
    session.replaceRange(
      { anchor: { para: 0, offset: 1 }, focus: { para: 0, offset: 2 } },
      "xy",
      { fold: true },
    );
    expect(session.commonmark).toBe("a**xy**b");
  });

  it("a replaced span takes the format of the text it replaces", () => {
    const session = new Session(deps());
    session.open("**bold**tail");
    session.replaceRange(
      { anchor: { para: 0, offset: 4 }, focus: { para: 0, offset: 8 } },
      "end",
    );
    expect(session.commonmark).toBe("**bold**end");
  });

  it("replaceCurrent ignores a match outside the document", () => {
    const session = new Session(deps());
    session.type("ab");
    session.replaceCurrent(
      { para: 9, startOffset: 0, endPara: 9, endOffset: 2 },
      "x",
    );
    expect(session.commonmark).toBe("ab");
    session.undo();
    expect(session.commonmark).toBe("");
  });
});

describe("session file operations", () => {
  it("open resets state through the command bus", () => {
    const session = new Session(deps());
    session.type("draft");
    session.markSaved(session.save());
    session.open("fresh **bold**");
    expect(session.commonmark).toBe("fresh **bold**");
    expect(session.hasChanges).toBe(false);
    expect(session.canUndo).toBe(false);
  });

  it("open defaults the caret to the very start of the document", () => {
    const session = new Session(deps());
    session.open("one\n\ntwo");
    expect(session.selection).toEqual({
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 0 },
    });
  });

  it('open with caret "end" lands on the end of the last real paragraph', () => {
    const session = new Session(deps());
    session.open("one\n\ntwo", { caret: "end" });
    expect(session.selection).toEqual({
      anchor: { para: 1, offset: 3 },
      focus: { para: 1, offset: 3 },
    });
  });

  it('open with caret "end" skips a trailing heading, page break, and marker-only note', () => {
    const session = new Session(deps());
    session.open(
      "the last real sentence\n\n{pagebreak}\n\n## Chapter Two\n\nTODO fix this",
      {
        caret: "end",
      },
    );
    expect(session.selection).toEqual({
      anchor: { para: 0, offset: "the last real sentence".length },
      focus: { para: 0, offset: "the last real sentence".length },
    });
  });

  // Opening a file is not an edit. A pristine buffer never reads as dirty,
  // even when the file on disk is not in the serializer's canonical form, or
  // the leaving guard would ask about work nobody did. A monospace span
  // holding a backslash re-escapes on serialize and must still open clean.
  it("open of a monospace span with backslashes reads clean, not as unsaved work", () => {
    const session = new Session(deps());
    session.open("{align:center}`root:/ # rm -rf \\some\\path`");
    expect(session.hasChanges).toBe(false);
    expect(session.commonmark).toBe(
      "{align:center}`root:/ # rm -rf \\\\some\\\\path`",
    );
  });

  it("open of a non-canonical file reads clean — formatting is not an edit", () => {
    const session = new Session(deps());
    session.open("a * b ** c"); // unbalanced markers no serializer would emit
    expect(session.hasChanges).toBe(false);
    // The baseline is the normalized form, so the saved bytes are the
    // serializer's own and the open changed nothing.
    expect(session.commonmark).toBe("a * b ** c***");
  });

  it("markSaved refuses to bless a buffer that changed underneath it", () => {
    const session = new Session(deps());
    session.type("old");
    const snapshot = session.save();
    session.type("new");
    session.markSaved(snapshot);
    expect(session.hasChanges).toBe(true);
  });
});

// ── Which paragraphs are not on disk ─────────────────────────────────────────
//
// The save gutter's question, answered by reference equality against the
// document as it last landed. That is exact, not a heuristic, because
// operations share the paragraph objects they do not touch.

describe("dirtyParagraphs", () => {
  const session = () => {
    const s = new Session({
      codec: commonmarkCodec,
      history: new SnapshotHistory(),
      search: regexSearch,
      events: new Emitter<SessionEvents>(),
      clipboard: browserClipboardCodec,
    });
    s.open("one\n\ntwo\n\nthree");
    return s;
  };

  it("is empty for a document straight off disk", () => {
    expect([...session().dirtyParagraphs()]).toEqual([]);
  });

  it("names the paragraph that was typed into, and only that one", () => {
    const s = session();
    s.updateSelection({
      anchor: { para: 1, offset: 0 },
      focus: { para: 1, offset: 0 },
    });
    s.type("x");
    expect([...s.dirtyParagraphs()]).toEqual([1]);
  });

  // Everything after an insert shifts down without being edited, which an
  // index-keyed set would report as dirty.
  it("does not blame paragraphs that only moved", () => {
    const s = session();
    s.updateSelection({
      anchor: { para: 0, offset: 3 },
      focus: { para: 0, offset: 3 },
    });
    s.enter();
    // The split touches the paragraph that was there and adds one; the two
    // below shift by one and are untouched.
    const dirty = s.dirtyParagraphs();
    expect(dirty.has(2)).toBe(false);
    expect(dirty.has(3)).toBe(false);
  });

  it("clears once the write lands", () => {
    const s = session();
    s.updateSelection({
      anchor: { para: 1, offset: 0 },
      focus: { para: 1, offset: 0 },
    });
    s.type("x");
    expect(s.dirtyParagraphs().size).toBe(1);
    s.markSaved(s.save());
    expect([...s.dirtyParagraphs()]).toEqual([]);
  });

  it("stays dirty when the write did not land", () => {
    const s = session();
    s.updateSelection({
      anchor: { para: 1, offset: 0 },
      focus: { para: 1, offset: 0 },
    });
    s.type("x");
    // A stale text: the writer typed on between serialize and commit.
    s.markSaved("something else");
    expect(s.dirtyParagraphs().size).toBe(1);
  });

  it("tells a subscriber that a write landed", () => {
    const s = session();
    const heard: string[] = [];
    s.subscribe((reason) => heard.push(reason));
    s.updateSelection({
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 0 },
    });
    s.type("x");
    s.markSaved(s.save());
    expect(heard).toContain("saved");
  });

  it("says nothing when a write is refused", () => {
    const s = session();
    const heard: string[] = [];
    s.subscribe((reason) => heard.push(reason));
    s.markSaved("not the buffer");
    expect(heard).not.toContain("saved");
  });
});

// ── Burst coalescing ─────────────────────────────────────────────────────────
//
// The session merges an edit into the burst on the same cause, in the same
// paragraph, with the cursor continuing its run; a no-op edit pushes nothing
// and leaves the chain intact. Rows run against both adapters, which must
// give identical burst semantics.

describe.each(histories)("$name session burst coalescing", ({ create }) => {
  it("merges contiguous keystrokes in the same paragraph into one entry", () => {
    const s = sessionWith(create());
    s.type("a");
    s.type("b");
    s.type("c");
    s.undo();
    expect(s.commonmark).toBe("");
    expect(s.canUndo).toBe(false);
  });

  it("keeps the burst-start cursor when undoing the merged entry", () => {
    const s = sessionWith(create());
    s.type("a");
    s.type("b");
    s.undo();
    expect(s.selection).toEqual(cursorAt(0, 0));
  });

  it("does not merge when the cursor moves to a different paragraph", () => {
    const s = sessionWith(create());
    s.type("a");
    s.enter();
    s.type("b");
    s.undo();
    expect(s.commonmark).toBe("a\n\n");
    s.undo();
    expect(s.commonmark).toBe("a");
    s.undo();
    expect(s.commonmark).toBe("");
  });

  it("does not merge across a cursor gap", () => {
    const s = sessionWith(create());
    s.type("a");
    // The cursor jumps back to the paragraph start, so the next keystroke
    // does not continue the run and opens a new entry.
    s.updateSelection(cursorAt(0, 0));
    s.type("b");
    s.undo();
    expect(s.commonmark).toBe("a");
    s.undo();
    expect(s.commonmark).toBe("");
  });

  it("an op push breaks the merge chain", () => {
    const s = sessionWith(create());
    s.type("a");
    s.enter();
    s.type("b");
    s.undo();
    expect(s.commonmark).toBe("a\n\n");
    s.undo();
    expect(s.commonmark).toBe("a");
    s.undo();
    expect(s.commonmark).toBe("");
  });

  it("a merged push still clears the redo stack", () => {
    const s = sessionWith(create());
    s.type("ab");
    s.undo();
    expect(s.canRedo).toBe(true);
    s.type("c");
    expect(s.canRedo).toBe(false);
  });

  it("undo resets the merge chain so the next keystroke starts a new burst", () => {
    const s = sessionWith(create());
    s.type("ab");
    s.undo();
    s.type("c");
    s.undo();
    expect(s.commonmark).toBe("");
    expect(s.canUndo).toBe(false);
  });

  it("redo resets the merge chain", () => {
    const s = sessionWith(create());
    s.type("ab");
    s.undo();
    s.redo();
    s.type("c");
    s.undo();
    expect(s.commonmark).toBe("ab");
    s.undo();
    expect(s.commonmark).toBe("");
  });

  it("keeps the size cap with merged bursts", () => {
    const s = sessionWith(create());
    // Two separate bursts per iteration (the enter breaks the chain); the
    // cap still applies to the walk.
    for (let i = 0; i < 100; i++) {
      s.type("x");
      s.enter();
    }
    s.undo();
    let count = 1;
    while (s.canUndo) {
      s.undo();
      count++;
    }
    // The session's pushes go through the store's cap, so at most the
    // backstop depth survives.
    expect(count).toBeGreaterThan(100);
    expect(count).toBeLessThanOrEqual(2000);
  });

  it("clear resets undo, redo and the merge chain", () => {
    const s = sessionWith(create());
    s.type("a");
    s.undo();
    s.open("fresh");
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
    s.type("b");
    s.undo();
    expect(s.commonmark).toBe("fresh");
  });
});

describe.each(histories)("$name session deletion bursts", ({ create }) => {
  it("merges consecutive backspaces into one entry (cursor walks backward)", () => {
    const s = sessionWith(create());
    s.open("hello");
    s.updateSelection(cursorAt(0, 5));
    s.backspace();
    s.backspace();
    s.backspace();
    s.undo();
    expect(s.commonmark).toBe("hello");
    expect(s.canUndo).toBe(false);
  });

  it("merges consecutive forward deletes (the cursor does not move)", () => {
    const s = sessionWith(create());
    s.open("hello");
    s.del();
    s.del();
    s.del();
    expect(s.commonmark).toBe("lo");
    s.undo();
    expect(s.commonmark).toBe("hello");
    expect(s.canUndo).toBe(false);
  });

  it("merges backspaces over whole emoji, and undo and redo restore text and caret", () => {
    const s = sessionWith(create());
    s.open("a👩‍💻🇮🇹b");
    s.updateSelection(cursorAt(0, 10));
    s.backspace();
    expect(s.commonmark).toBe("a👩‍💻b");
    s.backspace();
    expect(s.commonmark).toBe("ab");
    expect(s.selection.anchor).toEqual({ para: 0, offset: 1 });
    s.undo();
    expect(s.commonmark).toBe("a👩‍💻🇮🇹b");
    expect(s.selection.anchor).toEqual({ para: 0, offset: 10 });
    expect(s.canUndo).toBe(false);
    s.redo();
    expect(s.commonmark).toBe("ab");
    expect(s.selection.anchor).toEqual({ para: 0, offset: 1 });
  });

  it("merges forward deletes over whole emoji", () => {
    const s = sessionWith(create());
    s.open("a👩‍💻🇮🇹b");
    s.updateSelection(cursorAt(0, 1));
    s.del();
    s.del();
    expect(s.commonmark).toBe("ab");
    s.undo();
    expect(s.commonmark).toBe("a👩‍💻🇮🇹b");
    expect(s.canUndo).toBe(false);
  });

  it("keeps a backspace after a selection delete as its own entry", () => {
    const s = sessionWith(create());
    s.open("hello");
    s.updateSelection({
      anchor: { para: 0, offset: 5 },
      focus: { para: 0, offset: 3 },
    });
    s.backspace();
    s.backspace();
    expect(s.commonmark).toBe("he");
    s.undo();
    expect(s.commonmark).toBe("hel");
    s.undo();
    expect(s.commonmark).toBe("hello");
  });

  it("does not merge a backspace into a typing burst (different edit styles)", () => {
    const s = sessionWith(create());
    s.type("ab");
    s.backspace();
    s.undo();
    expect(s.commonmark).toBe("ab");
    s.undo();
    expect(s.commonmark).toBe("");
  });

  it("does not merge a forward delete into a backspace burst", () => {
    const s = sessionWith(create());
    s.open("abc");
    s.updateSelection(cursorAt(0, 2));
    s.backspace();
    s.del();
    s.undo();
    expect(s.commonmark).toBe("ac");
    s.undo();
    expect(s.commonmark).toBe("abc");
  });

  it("keeps a paragraph-join backspace inside the burst but not past it", () => {
    const s = sessionWith(create());
    s.open("ab\n\nc"); // two paragraphs: [ab, c]
    s.updateSelection(cursorAt(1, 1));
    s.backspace(); // "c" to "", cursor at (1,0); the run continues
    s.backspace(); // joins into the paragraph above, still inside the burst
    s.backspace(); // a keystroke back in paragraph 0 starts a new entry
    s.undo();
    expect(s.doc.length).toBe(1); // back to [ab], the join's pre-state
    expect(s.doc[0].runs.map((r) => r.text).join("")).toBe("ab");
    s.undo();
    expect(s.doc.length).toBe(2); // back to [ab, c]
    expect(s.doc[1].runs.map((r) => r.text).join("")).toBe("c");
  });

  it("undo resets the delete merge chain", () => {
    const s = sessionWith(create());
    s.open("abc");
    s.updateSelection(cursorAt(0, 3));
    s.backspace();
    s.undo();
    s.backspace();
    s.undo();
    expect(s.commonmark).toBe("abc");
    expect(s.canUndo).toBe(false);
  });

  it("a merged delete push still clears the redo stack", () => {
    const s = sessionWith(create());
    s.open("abc");
    s.updateSelection(cursorAt(0, 3));
    s.backspace();
    s.undo();
    expect(s.canRedo).toBe(true);
    s.backspace();
    expect(s.canRedo).toBe(false);
  });
});

// ── The session's own history responsibilities ───────────────────────────────

describe("session history policy", () => {
  it("a no-op outcome pushes nothing — the merge chain stays intact", () => {
    const s = sessionWith(new DeltaTimeline());
    s.open("abc");
    s.updateSelection(cursorAt(0, 3));
    s.backspace();
    s.backspace();
    s.backspace(); // cursor at (0,0), doc ""
    s.backspace(); // nothing to delete, so no push
    s.undo(); // the whole merged burst undoes as one
    expect(s.commonmark).toBe("abc");
    expect(s.canUndo).toBe(false);
  });

  it("the merge tracker survives consumeAnimationHints between keystrokes", () => {
    const s = sessionWith(new DeltaTimeline());
    s.type("a");
    s.consumeAnimationHints();
    s.type("b");
    s.undo();
    expect(s.commonmark).toBe("");
    expect(s.canUndo).toBe(false);
  });

  it("undo and redo clear the pending format — a walk must not paint the next keystroke with a stale format", () => {
    const s = sessionWith(new DeltaTimeline());
    s.open("abc");
    s.updateSelection(cursorAt(0, 3));
    s.type("x"); // "abcx"
    s.updateSelection(cursorAt(0, 2));
    s.toggleBold(); // arm a pending bold at the collapsed caret
    expect(s.currentFormat.bold).toBe(true);
    s.undo(); // back to "abc", caret at the end
    expect(s.currentFormat.bold).toBe(false);
    s.type("y"); // "abcy", plain, never bold
    expect(s.commonmark).toBe("abcy");
    s.undo();
    s.redo();
    expect(s.currentFormat.bold).toBe(false);
  });

  it("undo and redo emit the history event; plain edits do not", () => {
    const { bus, reasons } = spyEvents();
    const s = new Session(deps({ events: bus }));
    s.type("a");
    s.undo();
    s.redo();
    s.open("fresh");
    expect(reasons.filter((r) => r === "history")).toEqual([
      "history",
      "history",
      "history",
    ]);
  });

  it("replaceAll carries its label into the walk; typing carries none", () => {
    const s = sessionWith(new DeltaTimeline());
    s.open("cat cat");
    s.replaceAll(
      "cat",
      "dog",
      { caseSensitive: false, wholeWord: false },
      false,
      "Replace all",
    );
    expect(s.nextUndoLabel()).toBe("Replace all");
    s.undo();
    expect(s.nextRedoLabel()).toBe("Replace all");
    expect(s.nextUndoLabel()).toBeNull();
    s.type("x");
    expect(s.nextUndoLabel()).toBeNull();
  });

  it("open() with a journal hydrates the timeline instead of clearing it", () => {
    const timeline = new DeltaTimeline();
    const writer = sessionWith(timeline);
    writer.type("storm");
    const journal = writer.exportJournal();
    expect(journal).not.toBeNull();

    const reader = sessionWith(new DeltaTimeline());
    reader.open("storm", { journal: journal ?? undefined });
    expect(reader.commonmark).toBe("storm");
    expect(reader.canUndo).toBe(true);
    reader.undo();
    expect(reader.commonmark).toBe("");
  });

  it("the open caret option wins over the journal's head cursor", () => {
    const timeline = new DeltaTimeline();
    const writer = sessionWith(timeline);
    writer.open("one\n\ntwo", { caret: "end" });
    writer.type("!");
    const journal = writer.exportJournal();

    const reader = sessionWith(new DeltaTimeline());
    reader.open("one\n\ntwo!", {
      caret: "start",
      journal: journal ?? undefined,
    });
    expect(reader.selection).toEqual(cursorAt(0, 0));
    reader.open("one\n\ntwo!", {
      caret: "end",
      journal: journal ?? undefined,
    });
    expect(reader.selection).toEqual(cursorAt(1, 4));
  });

  it("open() without a journal yields an empty timeline", () => {
    const s = sessionWith(new DeltaTimeline());
    s.type("x");
    s.open("");
    expect(s.canUndo).toBe(false);
    s.undo();
    expect(s.commonmark).toBe("");
  });

  it("open() drops a journal whose head does not match the file, and says so", () => {
    const timeline = new DeltaTimeline();
    const writer = sessionWith(timeline);
    writer.type("storm");
    const journal = writer.exportJournal();

    const reader = sessionWith(new DeltaTimeline());
    reader.open("the sun", { journal: journal ?? undefined });
    expect(reader.lastOpenDroppedJournal).toBe(true);
    expect(reader.canUndo).toBe(false);
    expect(reader.commonmark).toBe("the sun");
  });

  it("typing after undo parks the displaced future and kills redo", () => {
    const s = sessionWith(new DeltaTimeline());
    s.type("The storm");
    s.undo();
    s.type("The sun");
    expect(s.canRedo).toBe(false);
    expect(s.hasParkedSiblings).toBe(true);
    s.undo();
    expect(s.commonmark).toBe("");
    expect(s.canRedo).toBe(true);
  });
});

// ── The diff modes ───────────────────────────────────────────────────────────
//
// The read-only comparison views. In the snapshot comparison typing is frozen,
// and the review's Accept and keyboard undo and redo are live, each accept
// an ordinary undoable step. In the rail's review the wheel walks a preview and
// typing lands at Now. The real document never leaves the session: the view
// renders the merged `displayedDoc` beside it, which keeps the store's
// identity pin and the dirty flag true. Typing never mutates the file while
// a diff is on screen, and the rail's wheel never walks under the snapshot's
// merged view.

describe("the snapshot diff mode", () => {
  it("renders the merged comparison and marks the differences", () => {
    const session = new Session(deps());
    session.open("the old house stood empty");
    session.enterDiff("the house stood empty");
    expect(session.isInDiff).toBe(true);
    expect(session.inSnapshotDiff).toBe(true);
    // `commonmark` is the real buffer's text, never the merged doc's: the
    // comparison lives beside the document, and the buffer reads back
    // exactly what the writer wrote.
    expect(session.commonmark).toBe("the old house stood empty");
    expect(session.diffDecorations).toEqual([
      { para: 0, from: 3, to: 7, kind: "deleted" },
    ]);
  });

  it("a second selection is a NEW comparison — re-entering replaces the pair, never a no-op", () => {
    const session = new Session(deps());
    session.open("the old house stood empty");
    session.enterDiff("the house stood empty");
    // Another snapshot chosen while a diff is up replaces the pair; ignoring
    // it would keep showing the first snapshot's diff.
    session.enterDiff("the house stood empty now");
    expect(session.isInDiff).toBe(true);
    expect(session.inSnapshotDiff).toBe(true);
    // The merged view is the new pair's: "now" spliced in as inserted, "old"
    // struck as adopted-only.
    expect(commonmarkCodec.serialize(session.displayedDoc)).toBe(
      "the old house stood empty now",
    );
    expect(session.diffDecorations).toEqual([
      { para: 0, from: 3, to: 7, kind: "deleted" },
      { para: 0, from: 25, to: 29, kind: "inserted" },
    ]);
    // A re-entered comparison never touches the document.
    expect(session.commonmark).toBe("the old house stood empty");
  });

  it("read-only typing survives the comparison — type, backspace and Enter are refused", () => {
    const session = new Session(deps());
    session.open("one");
    session.type(" x");
    const saved = session.commonmark;
    session.enterDiff("one");
    session.type("!");
    session.backspace();
    session.enter();
    expect(session.commonmark).toBe(saved);
    expect(session.hasChanges).toBe(true);
  });

  it("undo and redo walk the real timeline in the snapshot comparison, and the diff follows", () => {
    // Accepted changes are ordinary undoable steps, so Ctrl+Z works while
    // the diff is up, and the merged view recomputes after every walk.
    const session = new Session(deps());
    session.open("one x", { caret: "end" });
    session.type(" y");
    const saved = session.commonmark;
    session.enterDiff("one x z");
    // The diff shows the " y" deletion and the " z" insertion.
    expect(session.diffDecorations.length).toBe(2);
    session.undo();
    expect(session.commonmark).toBe("one x");
    // The diff followed the walk: only the " z" insertion remains.
    expect(session.diffDecorations).toHaveLength(1);
    session.redo();
    expect(session.commonmark).toBe(saved);
    expect(session.diffDecorations).toHaveLength(2);
  });

  it("keeps hasChanges honest — the real buffer's value, never the merged doc's", () => {
    const session = new Session(deps());
    session.open("one");
    session.enterDiff("two");
    expect(session.hasChanges).toBe(false);
    session.exitDiff();
    session.type(" x");
    session.enterDiff("two");
    expect(session.hasChanges).toBe(true);
  });

  it("exitDiff restores the real document exactly", () => {
    const session = new Session(deps());
    session.open("one");
    session.type(" x");
    const saved = session.commonmark;
    session.enterDiff("two");
    session.exitDiff();
    expect(session.commonmark).toBe(saved);
    expect(session.isInDiff).toBe(false);
    expect(session.diffDecorations).toEqual([]);
  });

  it("open clears any diff mode — a stale merged doc must never render over a new file", () => {
    const session = new Session(deps());
    session.open("one");
    session.enterDiff("two");
    session.open("fresh");
    expect(session.isInDiff).toBe(false);
    expect(session.commonmark).toBe("fresh");
  });

  it("copies the text on screen, in the merged doc's coordinates", () => {
    const session = new Session(deps());
    session.open("the old house stood empty");
    session.enterDiff("the house stood empty now");
    session.updateSelection({
      anchor: { para: 0, offset: 25 },
      focus: { para: 0, offset: 29 },
    });
    expect(session.copy()?.plain).toBe(" now");
    session.updateSelection({
      anchor: { para: 0, offset: 4 },
      focus: { para: 0, offset: 13 },
    });
    expect(session.copy()?.plain).toBe("old house");
  });

  it("save and markSaved keep writing the real buffer", () => {
    const session = new Session(deps());
    session.open("one");
    session.enterDiff("two");
    expect(session.save()).toBe("one");
    session.markSaved("one");
    expect(session.hasChanges).toBe(false);
  });
});

// ── Per-hunk accept ──────────────────────────────────────────────────────────
//
// The accept surface, one hunk at a time. A page break has no text
// decoration, so its accept surface is the block hunk.
// `acceptHunk` takes a hunk from the session's current recompute, with fresh
// coordinates, never a cached position.

describe("the snapshot diff mode — per-hunk accept", () => {
  it("— a replacement hunk whose deleted word is the adopted first word maps to the right adopted range (synthetic-space separator)", () => {
    const s = sessionWith(new DeltaTimeline());
    s.open("The cat sat");
    s.enterDiff("black cat sat");
    s.acceptHunk(s.diffHunks[0]);
    expect(s.commonmark).toBe("black cat sat");
  });

  it("— accepting adjacent deleted words never leaves or steals the separator", () => {
    const s = sessionWith(new DeltaTimeline());
    s.open("the quick brown fox");
    s.enterDiff("brown fox");
    s.acceptHunk(s.diffHunks[0]);
    expect(s.commonmark).toBe("brown fox");
  });

  it("— a page-break paragraph insertion is a block-level change with an Accept of its own", () => {
    const s = sessionWith(new DeltaTimeline());
    s.open("one");
    s.enterDiff("one\n\n{pagebreak}\n\ntwo");
    const blockInserts = s.diffHunks.filter(
      (h) => h.block && h.kind === "insert",
    );
    expect(blockInserts).toHaveLength(2);
  });

  it("— an accepted replacement wears the compared text with the compared paragraph's format", () => {
    const s = sessionWith(new DeltaTimeline());
    s.open("The quick brown");
    s.enterDiff("The **fast** brown");
    s.acceptHunk(s.diffHunks[0]);
    expect(s.commonmark).toBe("The **fast** brown");
  });

  it("— whole-paragraph accepts compose to the compared document with a valid selection throughout", () => {
    const s = sessionWith(new DeltaTimeline());
    s.open("x\ny");
    s.enterDiff("z");
    for (let i = 0; i < 3 && s.diffHunks.length > 0; i++)
      s.acceptHunk(s.diffHunks[0]);
    expect(s.commonmark).toBe("z");
  });

  it("— a stale hunk identity from before a recalc is refused as a no-op", () => {
    const s = sessionWith(new DeltaTimeline());
    s.open("the quick brown fox");
    s.enterDiff("the fast brown cat");
    const stale = s.diffHunks[0];
    s.acceptHunk(stale);
    const before = s.commonmark;
    const depth = s.undoDepth();
    s.acceptHunk(stale);
    expect(s.commonmark).toBe(before);
    expect(s.undoDepth()).toBe(depth);
  });

  it("— the compared side is byte-stable across accepts and identical on re-entry", () => {
    const s = sessionWith(new DeltaTimeline());
    s.open("a b c");
    s.enterDiff("a x c");
    const first = s.diffDecorations;
    s.acceptHunk(s.diffHunks[0]);
    s.exitDiff();
    s.open("a b c");
    s.enterDiff("a x c");
    expect(s.diffDecorations).toEqual(first);
  });

  it("— each accept is one op; undo walks back through accepts and the pre-diff burst, recomputing the diff", () => {
    const s = sessionWith(new DeltaTimeline());
    s.open("a b");
    s.enter();
    s.type(" c");
    s.enterDiff("a b");
    s.acceptHunk(s.diffHunks[0]);
    const afterAccept = s.commonmark;
    s.undo();
    expect(s.commonmark).not.toBe(afterAccept);
    expect(s.diffDecorations.length).toBeGreaterThan(0);
    s.undo();
    expect(s.commonmark).toContain("a b");
  });

  it("— an accept pushed over a live redo future parks it; undo and redo round-trip through the accept", () => {
    const s = sessionWith(new DeltaTimeline());
    s.type("x");
    s.undo();
    s.enterDiff("y");
    s.acceptHunk(s.diffHunks[0]);
    expect(s.canRedo).toBe(false);
    expect(s.hasParkedSiblings).toBe(true);
    s.undo();
    s.redo();
    expect(s.commonmark).toBe("y");
  });

  it("— the snapshot comparison admits the accept, the rail's walk never does", () => {
    const s = sessionWith(new DeltaTimeline());
    s.open("a b c");
    s.enterDiff("a x c");
    s.acceptHunk(s.diffHunks[0]);
    expect(s.commonmark).not.toBe("a b c");

    const rail = sessionWith(new DeltaTimeline());
    rail.open("one", { caret: "end" });
    rail.type(" two");
    rail.markSaved(rail.save());
    rail.enterHistoryDiff();
    rail.walkHistory(-1);
    const walked = JSON.stringify(rail.diffDecorations);
    rail.acceptHunk(rail.diffHunks[0]);
    // The accept belongs to the snapshot comparison; the rail's preview refuses
    // it, so the walk stands and the real buffer never moves.
    expect(JSON.stringify(rail.diffDecorations)).toBe(walked);
    expect(rail.commonmark).toBe("one two");
  });

  it("— save and markSaved serialize only the real buffer; no accept metadata reaches the markdown", () => {
    const s = sessionWith(new DeltaTimeline());
    s.open("a b c");
    s.enterDiff("a x c");
    s.acceptHunk(s.diffHunks[0]);
    const saved = s.save();
    expect(saved).toBe("a x c");
    expect(saved).not.toMatch(/df-|Accept|mark/);
    s.markSaved(saved);
    expect(s.hasChanges).toBe(false);
  });

  it("counts accepts per comparison — a re-entry resets the count", () => {
    // The chip's "all changes accepted" reads the count, so an identical
    // pair at entry (zero accepts, zero hunks) claims no completion.
    const s = sessionWith(new DeltaTimeline());
    s.open("a b c");
    s.enterDiff("a x c");
    expect(s.acceptsThisComparison).toBe(0);
    s.acceptHunk(s.diffHunks[0]);
    expect(s.acceptsThisComparison).toBe(1);
    s.exitDiff();
    s.enterDiff("a x c");
    expect(s.acceptsThisComparison).toBe(0);
  });
});

describe("the history diff mode", () => {
  it("renders the walked state against the captured newest state — the buffer never moves", () => {
    const session = new Session(deps());
    session.open("one", { caret: "end" });
    session.type(" two");
    session.markSaved(session.save());
    session.enterHistoryDiff();
    session.walkHistory(-1);
    expect(session.inHistoryDiff).toBe(true);
    // The walked state ("one") renders against the tip ("one two") while the
    // real buffer stays the tip; the walk is read-only. The merged text
    // always carries both sides, so the walk shows in the decorations.
    expect(session.commonmark).toBe("one two");
    expect(session.diffDecorations.some((d) => d.kind === "deleted")).toBe(
      true,
    );
  });

  it("recomputes the decorations on every step of the preview walk", () => {
    // The `enter` op breaks the typing burst, so the walk has two steps.
    const session = new Session(deps());
    session.open("one", { caret: "end" });
    session.type(" two");
    session.enter();
    session.type(" three");
    session.markSaved(session.save());
    session.enterHistoryDiff();
    session.walkHistory(-1);
    const oneStep = JSON.stringify(session.diffDecorations);
    session.walkHistory(-1);
    const twoSteps = JSON.stringify(session.diffDecorations);
    // Each step re-reads the store and re-diffs, so the decorations describe
    // the depth the wheel shows, never a stale pair.
    expect(oneStep).not.toBe(twoSteps);
    expect(session.historyWalkDepth).toBe(2);
  });

  it("the walk is strictly look-back — a wheel-down at Now does nothing", () => {
    const session = new Session(deps());
    session.open("one", { caret: "end" });
    session.type(" two");
    session.enterHistoryDiff();
    expect(session.historyWalkDepth).toBe(0);
    // Wheel-down at Now is a no-op; there is no redo region to walk to.
    session.walkHistory(1);
    expect(session.historyWalkDepth).toBe(0);
    // The store refuses depth beyond the walkable past, so the session
    // never walks there.
    session.walkHistory(-9);
    expect(session.historyWalkDepth).toBe(1);
    session.walkHistory(-9);
    expect(session.historyWalkDepth).toBe(1);
    // Wheel-down returns toward Now, one step per notch.
    session.walkHistory(1);
    expect(session.historyWalkDepth).toBe(0);
  });

  it("undo and redo are refused while the rail is up — the head-freeze", () => {
    const session = new Session(deps());
    session.open("one", { caret: "end" });
    session.type(" two");
    session.enterHistoryDiff();
    const depth = session.undoDepth();
    session.walkHistory(-1);
    session.undo();
    session.redo();
    expect(session.commonmark).toBe("one two");
    expect(session.undoDepth()).toBe(depth);
    expect(session.historyWalkDepth).toBe(1);
    session.exitHistoryDiff();
    session.undo();
    expect(session.commonmark).toBe("one");
  });

  it("typing lands its keystroke at Now and ends the mode, from any walk depth", () => {
    const session = new Session(deps());
    session.open("one", { caret: "end" });
    session.type(" two");
    session.enter();
    session.type(" three");
    session.markSaved(session.save());
    session.enterHistoryDiff();
    session.walkHistory(-1);
    expect(commonmarkCodec.serialize(session.displayedDoc)).not.toBe(
      "one two three",
    );
    session.type("!");
    // The keystroke lands once in the real buffer at the tip, because the
    // preview never moves the head, and the mode ends.
    expect(session.inHistoryDiff).toBe(false);
    expect(session.commonmark).toBe("one two\n\n three!");
  });

  it("exitHistoryDiff clears the display and leaves the buffer at Now", () => {
    const session = new Session(deps());
    session.open("one", { caret: "end" });
    session.type(" two");
    session.markSaved(session.save());
    session.enterHistoryDiff();
    session.walkHistory(-1);
    session.exitHistoryDiff();
    expect(session.isInDiff).toBe(false);
    expect(session.diffDecorations).toEqual([]);
    expect(session.historyWalkDepth).toBe(0);
    // The preview never touches the buffer, so exit is display-only and
    // typing works at once.
    expect(session.commonmark).toBe("one two");
    session.type("!");
    expect(session.commonmark).toBe("one two!");
  });

  it("revert to here — the walked state becomes ONE undoable step", () => {
    const session = new Session(deps());
    session.open("one", { caret: "end" });
    session.type(" two");
    session.enter();
    session.type(" three");
    session.markSaved(session.save());
    session.enterHistoryDiff();
    session.walkHistory(-1); // one step back, the state before " three"
    session.revertToHistory("Revert to here");
    expect(session.inHistoryDiff).toBe(false);
    expect(session.commonmark).toBe("one two\n\n");
    expect(session.historyWalkDepth).toBe(0);
    // One Ctrl+Z walks the whole restore back to the tip.
    session.undo();
    expect(session.commonmark).toBe("one two\n\n three");
  });

  it("revert at Now is refused — an identical doc gains no step", () => {
    const session = new Session(deps());
    session.open("one", { caret: "end" });
    session.type(" two");
    session.enterHistoryDiff();
    const depth = session.undoDepth();
    session.revertToHistory();
    // The commit gate exits the mode and the content-equal command refuses
    // the push, so there is no new step.
    expect(session.inHistoryDiff).toBe(false);
    expect(session.undoDepth()).toBe(depth);
    session.undo();
    expect(session.commonmark).toBe("one");
  });

  it("— a grain switch is not a re-entry: the accepts counter survives", () => {
    const session = new Session(deps());
    session.open("The quick brown fox");
    session.enterDiff("The fast brown fox");
    session.acceptHunk(session.diffHunks[0]);
    expect(session.acceptsThisComparison).toBe(1);
    // A grain switch recomputes the diff without resetting the completion
    // state, so the chip's "All changes accepted" stays true.
    session.setDiffGranularity("paragraph");
    expect(session.acceptsThisComparison).toBe(1);
    expect(session.diffHunks.length).toBe(0);
    expect(
      session.diffHunks.length === 0 && session.acceptsThisComparison > 0,
    ).toBe(true);
  });

  it("— the rail walks at word grain, never the snapshot comparison's", () => {
    const session = new Session(deps());
    session.open("one x two three", { caret: "end" });
    session.type(" four");
    session.setDiffGranularity("paragraph");
    session.enterDiff("one x two z");
    // At the snapshot comparison's paragraph grain the change is one
    // whole-block replace (the pair shares 3 of 6 words, clearing the paragraph
    // bar).
    expect(session.diffHunks.length).toBe(1);
    expect(session.diffHunks[0].block).toBe(true);
    session.exitDiff();
    session.enterHistoryDiff();
    expect(session.diffHunks.length).toBe(0); // at the tip, nothing changed
    session.walkHistory(-1);
    // The walk diffs against the tip at word grain, so the " four" deletion
    // is an inline hunk, never the snapshot comparison's block.
    expect(session.diffHunks.length).toBeGreaterThan(0);
    for (const h of session.diffHunks) expect(h.block).toBe(false);
  });

  it("historyWalkTimestamp answers the walked state's stamp — older steps never newer", () => {
    const session = new Session(deps());
    session.open("one", { caret: "end" });
    session.type(" two");
    session.enter(); // an op breaks the burst, so the walk has two steps
    session.type(" three");
    session.enterHistoryDiff();
    const atNow = session.historyWalkTimestamp;
    expect(atNow).not.toBeNull();
    session.walkHistory(-1);
    const oneBack = session.historyWalkTimestamp;
    expect(oneBack).not.toBeNull();
    // `<=`, never `<`: two steps in the same millisecond are equal stamps.
    expect(oneBack as number).toBeLessThanOrEqual(atNow as number);
    session.walkHistory(-1);
    expect(session.historyWalkTimestamp).not.toBeNull();
  });

  it("historyWalkTimestamp is null outside the walk, and resets on exit", () => {
    const session = new Session(deps());
    session.open("one", { caret: "end" });
    session.type(" two");
    expect(session.historyWalkTimestamp).toBeNull();
    session.enterHistoryDiff();
    expect(session.historyWalkTimestamp).not.toBeNull();
    session.exitHistoryDiff();
    expect(session.historyWalkTimestamp).toBeNull();
  });

  it("a pre-timestamp journal shows no stamp and never breaks the walk", () => {
    const timeline = new DeltaTimeline();
    const writer = sessionWith(timeline);
    writer.open("one", { caret: "end" });
    writer.type(" two");
    const raw = JSON.parse(timeline.exportJournal() as string) as {
      nodes: Record<string, { ts?: unknown }>;
    };
    for (const n of Object.values(raw.nodes)) delete n.ts;
    const reader = sessionWith(new DeltaTimeline());
    reader.open("one two", { journal: JSON.stringify(raw) });
    reader.enterHistoryDiff();
    reader.walkHistory(-1);
    // The walk works; only the label is absent.
    expect(reader.historyWalkDepth).toBe(1);
    expect(reader.historyWalkTimestamp).toBeNull();
  });
});

// ── The direction lens ───────────────────────────────────────────────────────
//
// The comparison can be read with the selected snapshot as the left side:
// the chronological reading, where the adopted manuscript is the spine and
// the snapshot's removed passages are struck. In either arrangement the
// accept aims at the live buffer `_doc` and never writes the selected
// snapshot. The direction is a per-pass lens: a switch recomputes in
// place without resetting the accepts counter, and the rail's walk never
// takes it.

describe("the snapshot diff mode — the direction lens", () => {
  it("D2 — accepting a struck passage restores it into the adopted; the compared side never changes", () => {
    // Accepting the struck "old" puts it back into the adopted as one
    // ordinary undoable op.
    const s = new Session(deps());
    s.open("the house stood empty");
    s.setDiffDirection("selectedWithAdopted");
    s.enterDiff("the old house stood empty");
    expect(s.diffDecorations).toEqual([
      { para: 0, from: 3, to: 7, kind: "deleted" },
    ]);
    s.acceptHunk(s.diffHunks[0]);
    expect(s.commonmark).toBe("the old house stood empty");
    // Undo and redo walk the real timeline; the restore is one step.
    s.undo();
    expect(s.commonmark).toBe("the house stood empty");
    s.redo();
    expect(s.commonmark).toBe("the old house stood empty");
    // `save` and `markSaved` write the real buffer, as in D1.
    expect(s.save()).toBe("the old house stood empty");
    s.markSaved(s.save());
    expect(s.hasChanges).toBe(false);
  });

  it("D2 — accepting a green addition removes it from the adopted", () => {
    const s = new Session(deps());
    s.open("the new house stood empty");
    s.setDiffDirection("selectedWithAdopted");
    s.enterDiff("the house stood empty");
    // The adopted "new" is right-only in this arrangement, a D2 insert hunk,
    // so accepting it deletes it from the adopted.
    s.acceptHunk(s.diffHunks[0]);
    expect(s.commonmark).toBe("the house stood empty");
  });

  it("a direction switch recomputes in place and keeps the accepts counter — a pre-switch hunk is refused", () => {
    const s = new Session(deps());
    s.open("a b c d e");
    s.enterDiff("a x c y");
    s.acceptHunk(s.diffHunks[0]);
    expect(s.acceptsThisComparison).toBe(1);
    const before = s.commonmark;
    const depth = s.undoDepth();
    const preSwitch = s.diffHunks[0];
    // The diff recomputes at the new arrangement (struck and green swap
    // sides) and the counter survives, because a direction switch is not a
    // re-entry.
    s.setDiffDirection("selectedWithAdopted");
    expect(s.acceptsThisComparison).toBe(1);
    expect(s.diffDecorations.length).toBeGreaterThan(0);
    // The pre-switch hunk describes the old arrangement and is refused as
    // stale.
    s.acceptHunk(preSwitch);
    expect(s.commonmark).toBe(before);
    expect(s.undoDepth()).toBe(depth);
  });

  it("undo after a direction switch still walks the real ops", () => {
    // A restore accepted under D2, then a flip back to D1 mid-pass: undo
    // still walks the real steps in order.
    const s = new Session(deps());
    s.open("the house stood empty");
    s.setDiffDirection("selectedWithAdopted");
    s.enterDiff("the old house stood empty");
    s.acceptHunk(s.diffHunks[0]);
    expect(s.commonmark).toBe("the old house stood empty");
    // Back at the default arrangement the pair has converged: no hunks.
    s.setDiffDirection("adoptedWithSelected");
    expect(s.diffHunks.length).toBe(0);
    s.undo();
    expect(s.commonmark).toBe("the house stood empty");
  });

  it("the two lenses are independent within a pass — direction and grain switches do not touch each other", () => {
    const s = new Session(deps());
    s.open("one x two y three");
    s.setDiffGranularity("sentence");
    s.setDiffDirection("selectedWithAdopted");
    s.enterDiff("one a two b three");
    expect(s.diffGranularity).toBe("sentence");
    expect(s.diffDirection).toBe("selectedWithAdopted");
    // A grain switch preserves the direction…
    s.setDiffGranularity("paragraph");
    expect(s.diffDirection).toBe("selectedWithAdopted");
    // …and a direction switch preserves the grain.
    s.setDiffDirection("adoptedWithSelected");
    expect(s.diffGranularity).toBe("paragraph");
  });

  it("the direction is a silent store outside the snapshot comparison", () => {
    const s = new Session(deps());
    s.open("one");
    s.setDiffDirection("selectedWithAdopted");
    expect(s.inSnapshotDiff).toBe(false);
    expect(s.diffDirection).toBe("selectedWithAdopted");
  });

  it("the rail never takes the direction or the aim — its fixed mapping and word grain are untouched", () => {
    const s = new Session(deps());
    s.open("one x two", { caret: "end" });
    s.type(" three");
    s.markSaved(s.save());
    // The lenses set for the snapshot comparison never reach the walk.
    s.setDiffGranularity("paragraph");
    s.setDiffDirection("selectedWithAdopted");
    s.enterHistoryDiff();
    s.walkHistory(-1);
    expect(s.diffDecorations.length).toBeGreaterThan(0);
    // The one-word deletion is an inline hunk: the walk recomputes at word
    // grain against its fixed mapping, never the comparison's lens.
    for (const h of s.diffHunks) expect(h.block).toBe(false);
  });
});

describe("diff mode exclusivity", () => {
  it("entering one review resolves the other", () => {
    const session = new Session(deps());
    session.open("one");
    session.type(" two");
    session.markSaved(session.save());

    session.enterDiff("one");
    expect(session.inSnapshotDiff).toBe(true);
    session.enterHistoryDiff();
    expect(session.inHistoryDiff).toBe(true);
    expect(session.inSnapshotDiff).toBe(false);

    session.enterDiff("one");
    expect(session.inSnapshotDiff).toBe(true);
    expect(session.inHistoryDiff).toBe(false);
  });
});

// ── Deletion, dirty state and surrogates ─────────────────────────────────────

describe("audit findings", () => {
  it("— backspace splits a surrogate pair, leaving a lone surrogate in the document", () => {
    // 🙂 (U+1F642) is a surrogate pair. One backspace after it removes the
    // whole character; removing one UTF-16 unit would leave a lone surrogate
    // that serializes to disk broken.
    const session = new Session(deps());
    session.open("a🙂b");
    session.updateSelection({
      anchor: { para: 0, offset: 3 },
      focus: { para: 0, offset: 3 },
    });
    session.backspace();
    expect(session.commonmark.trim()).toBe("ab");
  });

  it("— hasChanges re-serializes the whole document on every keystroke", () => {
    // Dirty state is answered by reference against `savedDoc`, as
    // `dirtyParagraphs()` answers it, so a committed edit serializes nothing.
    let calls = 0;
    const countingCodec: Codec = {
      parse: (s) => commonmarkCodec.parse(s),
      serialize: (d) => {
        calls++;
        return commonmarkCodec.serialize(d);
      },
    };
    const session = new Session(deps({ codec: countingCodec }));
    session.open("hello");
    calls = 0; // only count what a single keystroke costs, not the open
    session.type("!");
    expect(calls).toBe(0);
  });

  it("builds the saved paragraph set once per save, not per keystroke", () => {
    // `hasChanges` and `dirtyParagraphs()` both ask "is this paragraph
    // saved"; the saved set changes only on open and save, so a keystroke
    // allocates none of it.
    const paragraphs = 40;
    const session = new Session(deps());
    session.open(
      Array.from({ length: paragraphs }, (_, n) => `Line ${n}.`).join("\n\n"),
    );
    let built = 0;
    const NativeSet = Set;
    class CountingSet<T> extends NativeSet<T> {
      constructor(items?: Iterable<T> | null) {
        super(items);
        if (Array.isArray(items) && items.length === paragraphs) built++;
      }
    }
    vi.stubGlobal("Set", CountingSet);
    try {
      session.updateSelection(cursorAt(0, 0));
      for (let i = 0; i < 5; i++) {
        session.type("x");
        session.dirtyParagraphs();
      }
    } finally {
      vi.unstubAllGlobals();
    }
    expect(built).toBe(0);
    expect([...session.dirtyParagraphs()]).toEqual([0]);
    expect(session.hasChanges).toBe(true);
  });

  it("— type, save, undo, redo is an identity for hasChanges (the engine half)", () => {
    // The engine half of the save chip's dirty state. `redo` restores the
    // same `Paragraph` array `markSaved` baselined, because the delta store's
    // `stateOf` memoizes each node's state after its first replay, and
    // `docHasChanges()` is reference-set membership against that array.
    const session = new Session(deps());
    session.open("");
    session.type("A");
    expect(session.hasChanges).toBe(true);
    session.markSaved(session.save());
    expect(session.hasChanges).toBe(false);
    session.undo();
    expect(session.hasChanges).toBe(true);
    session.redo();
    expect(session.hasChanges).toBe(false);
    expect(session.commonmark.trim()).toBe("A");
  });

  describe("— word and soft-line deletion", () => {
    function at(session: Session, para: number, offset: number): void {
      session.updateSelection({
        anchor: { para, offset },
        focus: { para, offset },
      });
    }

    it("deleteWordBackward removes the word and its trailing separator up to the cursor", () => {
      const session = new Session(deps());
      session.open("abc def");
      at(session, 0, 7); // end of "def"
      session.deleteWordBackward();
      expect(session.commonmark.trim()).toBe("abc");
    });

    it("deleteWordBackward from mid-word deletes only up to the cursor", () => {
      const session = new Session(deps());
      session.open("hello");
      at(session, 0, 3); // "hel|lo"
      session.deleteWordBackward();
      expect(session.commonmark.trim()).toBe("lo");
    });

    it("deleteWordBackward at a paragraph's start joins with the previous paragraph, like plain backspace", () => {
      const session = new Session(deps());
      session.open("one\n\ntwo");
      at(session, 1, 0);
      session.deleteWordBackward();
      expect(session.commonmark.trim()).toBe("onetwo");
    });

    it("deleteWordBackward is one undo step, not one per character", () => {
      const session = new Session(deps());
      session.open("abc def");
      at(session, 0, 7);
      session.deleteWordBackward();
      expect(session.commonmark.trim()).toBe("abc");
      session.undo();
      expect(session.commonmark.trim()).toBe("abc def");
    });

    it("deleteWordForward removes the word ahead of the cursor and its leading separator", () => {
      const session = new Session(deps());
      session.open("abc def");
      at(session, 0, 3); // "abc| def"
      session.deleteWordForward();
      expect(session.commonmark.trim()).toBe("abc");
    });

    it("deleteWordForward at a paragraph's end joins with the next paragraph, like plain delete", () => {
      const session = new Session(deps());
      session.open("one\n\ntwo");
      at(session, 0, 3);
      session.deleteWordForward();
      expect(session.commonmark.trim()).toBe("onetwo");
    });

    it("deleteSoftLineBackward deletes back to the paragraph's start", () => {
      const session = new Session(deps());
      session.open("abc def ghi");
      at(session, 0, 8); // "abc def |ghi"
      session.deleteSoftLineBackward();
      expect(session.commonmark.trim()).toBe("ghi");
    });

    it("deleteSoftLineBackward at offset 0 joins with the previous paragraph, like plain backspace", () => {
      const session = new Session(deps());
      session.open("one\n\ntwo");
      at(session, 1, 0);
      session.deleteSoftLineBackward();
      expect(session.commonmark.trim()).toBe("onetwo");
    });
  });
});
