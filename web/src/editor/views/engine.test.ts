// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { EditorEngine } from "./engine";

// The save contract: `save()` serializes for the disk write and never clears
// the dirty flag itself. `markSaved()` does, called once the write succeeds,
// and only if the buffer still holds exactly what was written.

describe("align", () => {
  it("applies the alignment to every paragraph spanned by the selection", () => {
    const engine = new EditorEngine();
    engine.type("one");
    engine.enter();
    engine.type("two");
    engine.enter();
    engine.type("three");
    engine.updateSelection({
      anchor: { para: 0, offset: 3 },
      focus: { para: 2, offset: 5 },
    });

    engine.align("center");

    expect(engine.doc.map((p) => p.alignment)).toEqual([
      "center",
      "center",
      "center",
    ]);
  });

  it("leaves paragraphs outside the selection untouched", () => {
    const engine = new EditorEngine();
    engine.type("one");
    engine.enter();
    engine.type("two");
    engine.updateSelection({
      anchor: { para: 1, offset: 0 },
      focus: { para: 1, offset: 3 },
    });

    engine.align("right");

    expect(engine.doc.map((p) => p.alignment)).toEqual(["left", "right"]);
  });
});

describe("page break", () => {
  it("insertPageBreak splits the paragraph at the cursor, cursor after the break", () => {
    const engine = new EditorEngine();
    engine.type("hello world");
    engine.updateSelection({
      anchor: { para: 0, offset: 5 },
      focus: { para: 0, offset: 5 },
    });

    engine.insertPageBreak();

    const blocks = engine.doc.map((p) => ({
      text: p.runs.map((r) => r.text).join(""),
      blockType: p.blockType,
    }));
    expect(blocks).toEqual([
      { text: "hello", blockType: "paragraph" },
      { text: "", blockType: "pagebreak" },
      { text: " world", blockType: "paragraph" },
    ]);
    expect(engine.selection.anchor).toEqual({ para: 2, offset: 0 });
  });

  it("undo restores the paragraph in one step", () => {
    const engine = new EditorEngine();
    engine.type("hello world");
    engine.updateSelection({
      anchor: { para: 0, offset: 5 },
      focus: { para: 0, offset: 5 },
    });

    engine.insertPageBreak();
    engine.undo();

    expect(engine.commonmark).toContain("hello world");
    expect(engine.doc).toHaveLength(1);
  });

  it("typing on a break replaces it with a text paragraph", () => {
    const engine = new EditorEngine();
    engine.type("abc");
    engine.updateSelection({
      anchor: { para: 0, offset: 3 },
      focus: { para: 0, offset: 3 },
    });
    engine.insertPageBreak(); // para 1 = break, cursor at para 2

    engine.updateSelection({
      anchor: { para: 1, offset: 0 },
      focus: { para: 1, offset: 0 },
    });
    engine.type("X");

    expect(engine.doc[1].blockType).toBe("paragraph");
    expect(engine.doc[1].runs.map((r) => r.text).join("")).toBe("X");
  });

  it("Enter on a break adds a plain paragraph after it", () => {
    const engine = new EditorEngine();
    engine.type("abc");
    engine.updateSelection({
      anchor: { para: 0, offset: 3 },
      focus: { para: 0, offset: 3 },
    });
    engine.insertPageBreak();

    engine.updateSelection({
      anchor: { para: 1, offset: 0 },
      focus: { para: 1, offset: 0 },
    });
    engine.enter();

    // The new paragraph goes after the break; the original tail paragraph of
    // the split keeps its place further down.
    expect(engine.doc.map((p) => p.blockType)).toEqual([
      "paragraph",
      "pagebreak",
      "paragraph",
      "paragraph",
    ]);
  });

  it("deleting across a break removes the break without merging surrounding text", () => {
    const engine = new EditorEngine();
    engine.type("abc def");
    engine.updateSelection({
      anchor: { para: 0, offset: 3 },
      focus: { para: 0, offset: 3 },
    });
    engine.insertPageBreak(); // [abc][break][ def]

    // Backspace at the start of the paragraph after the break deletes the
    // break.
    engine.updateSelection({
      anchor: { para: 2, offset: 0 },
      focus: { para: 2, offset: 0 },
    });
    engine.backspace();

    expect(engine.doc.map((p) => p.blockType)).toEqual([
      "paragraph",
      "paragraph",
    ]);
    expect(engine.doc.map((p) => p.runs.map((r) => r.text).join(""))).toEqual([
      "abc",
      " def",
    ]);
  });
});

describe("find & replace", () => {
  const text = (engine: EditorEngine) =>
    engine.doc.map((p) => p.runs.map((r) => r.text).join(""));
  const formats = (engine: EditorEngine) =>
    engine.doc.map((p) => p.runs.map((r) => r.format));

  function boldDoc(): EditorEngine {
    // 'cat sat on the mat' with 'sat' bold: plain 'cat ', bold 'sat', plain
    // ' on the mat'.
    const engine = new EditorEngine();
    engine.type("cat sat on the mat");
    engine.updateSelection({
      anchor: { para: 0, offset: 4 },
      focus: { para: 0, offset: 7 },
    });
    engine.toggleBold();
    engine.updateSelection({
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 0 },
    });
    return engine;
  }

  it("replaces the given match and puts the cursor after the replacement", () => {
    const engine = boldDoc();
    engine.replaceCurrent(
      { para: 0, startOffset: 4, endPara: 0, endOffset: 7 },
      "slept",
    );
    expect(text(engine)).toEqual(["cat slept on the mat"]);
    expect(engine.selection.anchor).toEqual({ para: 0, offset: 9 });
    expect(engine.hasChanges).toBe(true);
  });

  it("mirrors the covered formats position by position (bold boundary kept)", () => {
    // 'sat on' covers bold 'sat' and plain ' on', so 'sat upon' keeps bold
    // in the same positions.
    const engine = boldDoc();
    engine.replaceCurrent(
      { para: 0, startOffset: 4, endPara: 0, endOffset: 10 },
      "sat upon",
    );
    expect(text(engine)).toEqual(["cat sat upon the mat"]);
    expect(engine.doc[0].runs.map((r) => r.text)).toEqual([
      "cat ",
      "sat",
      " upon the mat",
    ]);
    expect(formats(engine)[0]).toEqual([
      { bold: false, italic: false, monospace: false },
      { bold: true, italic: false, monospace: false },
      { bold: false, italic: false, monospace: false },
    ]);
  });

  it("a longer replacement continues in the last covered format", () => {
    // The covered text is bold for 3 characters, so all 6 replacement
    // characters are bold.
    const engine = boldDoc();
    engine.replaceCurrent(
      { para: 0, startOffset: 4, endPara: 0, endOffset: 7 },
      "a lot",
    );
    expect(engine.doc[0].runs.map((r) => r.text)).toEqual([
      "cat ",
      "a lot",
      " on the mat",
    ]);
    expect(formats(engine)[0][1]).toEqual({
      bold: true,
      italic: false,
      monospace: false,
    });
  });

  it("plain replacement strips all formatting", () => {
    const engine = boldDoc();
    engine.replaceCurrent(
      { para: 0, startOffset: 4, endPara: 0, endOffset: 7 },
      "dog",
      true,
    );
    expect(text(engine)).toEqual(["cat dog on the mat"]);
    expect(engine.doc[0].runs).toHaveLength(1);
    expect(
      formats(engine)[0].every((f) => !f.bold && !f.italic && !f.monospace),
    ).toBe(true);
  });

  it("a newline in the replacement splits the paragraph", () => {
    const engine = new EditorEngine();
    engine.type("alpha here");
    engine.replaceCurrent(
      { para: 0, startOffset: 0, endPara: 0, endOffset: 5 },
      "beta\nsecond",
    );
    expect(text(engine)).toEqual(["beta", "second here"]);
  });

  it("replaceAll replaces every match in one undo step", () => {
    const engine = new EditorEngine();
    engine.type("The cat sat. The cat purred.");
    engine.replaceAll("cat", "dog", { caseSensitive: false, wholeWord: false });
    expect(text(engine)).toEqual(["The dog sat. The dog purred."]);

    engine.undo();
    expect(text(engine)).toEqual(["The cat sat. The cat purred."]);
  });

  it("replaceAll hits each original match once even when the query is inside the replacement", () => {
    const engine = new EditorEngine();
    engine.type("cat cat");
    engine.replaceAll("cat", "catdog", {
      caseSensitive: false,
      wholeWord: false,
    });
    expect(text(engine)).toEqual(["catdog catdog"]);
  });

  // A match across a paragraph break replaces through it, merging the
  // paragraphs it covered, in one undo step.
  it("replaceAll merges the paragraphs a match runs across", () => {
    const engine = new EditorEngine();
    engine.open("It ended.\n\nThe door shut.\n\nIt ended.\n\nThe gate.\n");
    engine.replaceAll("ended.\nThe", "ended. The", {
      caseSensitive: false,
      wholeWord: false,
    });
    expect(text(engine)).toEqual([
      "It ended. The door shut.",
      "It ended. The gate.",
    ]);
    engine.undo();
    expect(text(engine)).toEqual([
      "It ended.",
      "The door shut.",
      "It ended.",
      "The gate.",
    ]);
  });

  it("replaces matches that share a paragraph, one ending where the next starts", () => {
    const engine = new EditorEngine();
    engine.open("x1\n\ny1 x1\n\ny1\n");
    engine.replaceAll("1\ny", "-", { caseSensitive: false, wholeWord: false });
    expect(text(engine)).toEqual(["x-1 x-1"]);
  });

  it("keeps each block's shape where the replacement keeps the breaks, and the first's where it merges", () => {
    const kept = new EditorEngine();
    kept.open("# Title\n\nBody text.\n");
    kept.replaceCurrent(
      { para: 0, startOffset: 0, endPara: 1, endOffset: 4 },
      "Name\nCopy",
    );
    expect(text(kept)).toEqual(["Name", "Copy text."]);
    expect(kept.doc.map((p) => p.blockType)).toEqual(["h1", "paragraph"]);
    expect(kept.selection.anchor).toEqual({ para: 1, offset: 4 });

    const merged = new EditorEngine();
    merged.open("# Title\n\nBody text.\n");
    merged.replaceCurrent(
      { para: 0, startOffset: 5, endPara: 1, endOffset: 0 },
      " ",
    );
    expect(text(merged)).toEqual(["Title Body text."]);
    expect(merged.doc.map((p) => p.blockType)).toEqual(["h1"]);
    expect(merged.selection.anchor).toEqual({ para: 0, offset: 6 });
  });

  it("replaceAll with no matches is a no-op and leaves no history entry", () => {
    const engine = new EditorEngine();
    engine.replaceAll("zzz", "x", { caseSensitive: false, wholeWord: false });
    expect(text(engine)).toEqual([""]);
    expect(engine.hasChanges).toBe(false);
    expect(engine.canUndo).toBe(false);
  });
});

describe("history", () => {
  // The editor types one character per engine call; that is the burst the
  // coalescing targets.
  const type = (engine: EditorEngine, text: string) =>
    [...text].forEach((c) => engine.type(c));
  const text = (engine: EditorEngine) =>
    engine.doc.map((p) => p.runs.map((r) => r.text).join(""));

  it("collapses a typing burst into a single undo step", () => {
    const engine = new EditorEngine();
    type(engine, "hello");

    expect(engine.canUndo).toBe(true);
    engine.undo();

    expect(text(engine)).toEqual([""]);
    expect(engine.commonmark).toBe("");
    expect(engine.canUndo).toBe(false);
  });

  it("keeps separate steps for burst, enter, burst", () => {
    const engine = new EditorEngine();
    type(engine, "ab");
    engine.enter();
    type(engine, "cd");

    engine.undo();
    expect(text(engine)).toEqual(["ab", ""]);

    engine.undo();
    expect(text(engine)).toEqual(["ab"]);

    engine.undo();
    expect(text(engine)).toEqual([""]);
  });

  it("undo then a new burst kills the redo stack", () => {
    const engine = new EditorEngine();
    type(engine, "ab");
    engine.undo();
    expect(engine.canRedo).toBe(true);

    type(engine, "c");
    expect(engine.canRedo).toBe(false);

    engine.undo();
    expect(text(engine)).toEqual([""]);
  });

  it("redo restores the burst and the redo chain resets for new typing", () => {
    const engine = new EditorEngine();
    type(engine, "ab");
    engine.undo();
    engine.redo();
    expect(text(engine)).toEqual(["ab"]);

    type(engine, "c");
    expect(engine.canRedo).toBe(false);
  });

  it("undo of a merged burst restores the cursor to the burst start", () => {
    const engine = new EditorEngine();
    type(engine, "abc");

    engine.undo();

    expect(engine.selection.anchor).toEqual({ para: 0, offset: 0 });
  });

  it("a format toggle mid-burst starts a new undo step", () => {
    const engine = new EditorEngine();
    type(engine, "ab");
    engine.updateSelection({
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 2 },
    });
    engine.toggleBold();
    engine.updateSelection({
      anchor: { para: 0, offset: 2 },
      focus: { para: 0, offset: 2 },
    });
    type(engine, "c");

    engine.undo();
    expect(text(engine)).toEqual(["ab"]);

    engine.undo();
    expect(text(engine)).toEqual(["ab"]);

    engine.undo();
    expect(text(engine)).toEqual([""]);
  });

  it("no-op setBlockType leaves no history entry", () => {
    const engine = new EditorEngine();
    engine.type("x");
    const before = engine.doc;

    engine.setBlockType("paragraph");

    expect(engine.canUndo).toBe(true); // only the typing entry
    expect(engine.doc).toBe(before);
    engine.undo();
    expect(engine.canUndo).toBe(false);
  });

  it("no-op align leaves no history entry", () => {
    const engine = new EditorEngine();
    engine.type("x");
    const before = engine.doc;

    engine.align("left");

    expect(engine.canUndo).toBe(true);
    expect(engine.doc).toBe(before);
  });

  it("a real align change still records a step", () => {
    const engine = new EditorEngine();
    engine.type("x");

    engine.align("center");

    expect(engine.canUndo).toBe(true);
    expect(engine.doc[0].alignment).toBe("center");
    engine.undo();
    expect(engine.doc[0].alignment).toBe("left");
  });

  it("undo preserves structural sharing for untouched paragraphs", () => {
    const engine = new EditorEngine();
    engine.type("first");
    engine.enter();
    engine.type("second");
    const secondPara = engine.doc[1];

    // Edit paragraph 0 at the end of its burst.
    engine.updateSelection({
      anchor: { para: 0, offset: 5 },
      focus: { para: 0, offset: 5 },
    });
    engine.type("!");

    engine.undo();

    expect(engine.doc[1]).toBe(secondPara);
    expect(engine.doc[1].runs[0].text).toBe("second");
  });

  it("a deletion burst is one undo step, symmetric with typing", () => {
    const engine = new EditorEngine();
    type(engine, "hello");
    const backspaces = [..."ello"];
    backspaces.forEach(() => engine.backspace());

    // Undo 1 restores the whole deleted run…
    engine.undo();
    expect(text(engine)).toEqual(["hello"]);

    // …undo 2 removes the typing burst, not 4 separate delete steps.
    engine.undo();
    expect(text(engine)).toEqual([""]);
    expect(engine.canUndo).toBe(false);
  });

  it("a forward-delete burst is one undo step", () => {
    const engine = new EditorEngine();
    type(engine, "hello");
    engine.updateSelection({
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 0 },
    });
    engine.del();
    engine.del();
    engine.del();

    engine.undo();
    expect(text(engine)).toEqual(["hello"]);

    engine.undo();
    expect(text(engine)).toEqual([""]);
  });

  it("undo of a deletion burst restores the cursor where the deletion began", () => {
    const engine = new EditorEngine();
    type(engine, "hello");
    engine.backspace();
    engine.backspace();

    engine.undo();

    expect(text(engine)).toEqual(["hello"]);
    expect(engine.selection.anchor).toEqual({ para: 0, offset: 5 });
  });

  it("a selection delete starts its own undo step, separate from the char deletes", () => {
    const engine = new EditorEngine();
    type(engine, "hello");
    engine.updateSelection({
      anchor: { para: 0, offset: 1 },
      focus: { para: 0, offset: 4 },
    });
    engine.backspace(); // removes 'ell' → 'ho', cursor at 1
    engine.backspace(); // removes 'h' → 'o'

    engine.undo();
    expect(text(engine)).toEqual(["ho"]);

    engine.undo();
    expect(text(engine)).toEqual(["hello"]);

    engine.undo();
    expect(text(engine)).toEqual([""]);
  });

  it("a no-op backspace at the start of the document leaves no history entry", () => {
    const engine = new EditorEngine();
    type(engine, "a");
    engine.updateSelection({
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 0 },
    });

    engine.backspace();

    expect(engine.canUndo).toBe(true); // only the typing entry
    engine.undo();
    expect(engine.canUndo).toBe(false);
  });

  it("a no-op forward delete at the end of the document leaves no history entry", () => {
    const engine = new EditorEngine();
    type(engine, "a");

    engine.del();

    expect(engine.canUndo).toBe(true);
    expect(text(engine)).toEqual(["a"]);
  });
});

describe("save / markSaved", () => {
  it("save serializes without clearing the dirty flag", () => {
    const engine = new EditorEngine();
    engine.type("hello");
    expect(engine.hasChanges).toBe(true);

    const text = engine.save();

    expect(text).toContain("hello");
    // A failed write leaves the buffer dirty; `save()` alone never commits.
    expect(engine.hasChanges).toBe(true);
  });

  it("markSaved commits when the buffer still matches what was written", () => {
    const engine = new EditorEngine();
    engine.type("hello");
    const text = engine.save();

    engine.markSaved(text);

    expect(engine.hasChanges).toBe(false);
  });

  it("markSaved leaves newer edits dirty if the buffer moved between serialize and commit", () => {
    const engine = new EditorEngine();
    engine.type("hello");
    const text = engine.save();

    // A keystroke lands between the write starting and completing.
    engine.type(" world");
    engine.markSaved(text);

    expect(engine.hasChanges).toBe(true);

    // Undoing back to exactly the saved text counts as committed: the bytes
    // on disk are the bytes in the buffer again.
    engine.undo();
    engine.markSaved(text);

    expect(engine.hasChanges).toBe(false);
  });
});

describe("html", () => {
  it("renders the doc through the default renderer", () => {
    const engine = new EditorEngine();
    engine.type("hello");
    expect(engine.html).toBe("<p>hello</p>");
  });

  it("reflects block types, formats and page breaks", () => {
    const engine = new EditorEngine();
    engine.type("title");
    engine.setBlockType("h1");
    engine.enter();
    engine.toggleBold();
    engine.type("bold");
    engine.setBlockType("paragraph");
    engine.insertPageBreak();
    // The break splits the paragraph, so an empty continuation paragraph
    // follows the rule.
    expect(engine.html).toBe(
      "<h1>title</h1><p><strong>bold</strong></p><hr><p><br></p>",
    );
  });

  it("escapes typed text — text is text, never markup", () => {
    const engine = new EditorEngine();
    engine.type("<b>&");
    expect(engine.html).toBe("<p>&lt;b&gt;&amp;</p>");
  });

  it("uses the injected renderer port when one is given", () => {
    const engine = new EditorEngine({
      renderer: { render: (doc) => `doc:${doc.length}` },
    });
    engine.type("x");
    expect(engine.html).toBe("doc:1");
  });
});
