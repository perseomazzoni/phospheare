// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  extractRange,
  sliceText,
  insertFragment,
  parsePlainText,
  selectAllSelection,
  normalizeSelection,
} from "./index";
import type { Doc, Paragraph, Run, Range } from "../model";
import { isValidDoc, isValidSelection } from "../invariants";

// Table-style tests over the pure clipboard operations. Every operation is
// checked for the invariants it must preserve: the resulting document always
// validates, and an insert never leaves a selection outside the document.

function run(
  text: string,
  bold = false,
  italic = false,
  monospace = false,
): Run {
  return { text, format: { bold, italic, monospace } };
}

function para(
  runs: Run[],
  blockType: Paragraph["blockType"] = "paragraph",
  alignment: Paragraph["alignment"] = "left",
): Paragraph {
  return { runs, blockType, alignment };
}

const pagebreak = (): Paragraph => ({
  runs: [],
  alignment: "left",
  blockType: "pagebreak",
});

function range(
  startPara: number,
  startOffset: number,
  endPara: number,
  endOffset: number,
): Range {
  return {
    start: { para: startPara, offset: startOffset },
    end: { para: endPara, offset: endOffset },
  };
}

describe("extractRange", () => {
  it("extracts a single-paragraph run", () => {
    const doc: Doc = [para([run("hello world")])];
    expect(extractRange(doc, range(0, 0, 0, 5))).toEqual([
      para([run("hello")]),
    ]);
  });

  it("preserves formats across a partial selection", () => {
    const doc: Doc = [para([run("ab", true), run("cd", false, true)])];
    expect(extractRange(doc, range(0, 1, 0, 4))).toEqual([
      para([run("b", true), run("cd", false, true)]),
    ]);
  });

  it("extracts a cross-paragraph selection, keeping block types", () => {
    const doc: Doc = [
      para([run("one")]),
      para([run("two")], "h1"),
      para([run("three")]),
    ];
    expect(extractRange(doc, range(0, 1, 2, 3))).toEqual([
      para([run("ne")]),
      para([run("two")], "h1"),
      para([run("thr")]),
    ]);
  });

  it("a collapsed range yields a single empty paragraph", () => {
    const doc: Doc = [para([run("abc")])];
    expect(extractRange(doc, range(0, 1, 0, 1))).toEqual([para([run("")])]);
  });

  it("a selected page break becomes a blank paragraph", () => {
    const doc: Doc = [para([run("before")]), pagebreak(), para([run("after")])];
    expect(extractRange(doc, range(0, 3, 2, 0))).toEqual([
      para([run("ore")]),
      para([run("")]),
      para([run("")]),
    ]);
  });

  it("keeps the source alignment", () => {
    const doc: Doc = [para([run("centred")], "paragraph", "center")];
    expect(extractRange(doc, range(0, 0, 0, 7))).toEqual([
      para([run("centred")], "paragraph", "center"),
    ]);
  });
});

describe("sliceText", () => {
  it("joins cross-paragraph text with newlines", () => {
    const doc: Doc = [
      para([run("one")]),
      para([run("two")]),
      para([run("three")]),
    ];
    expect(sliceText(doc, range(0, 1, 2, 3))).toBe("ne\ntwo\nthr");
  });

  it("a collapsed range is empty text", () => {
    const doc: Doc = [para([run("abc")])];
    expect(sliceText(doc, range(0, 1, 0, 1))).toBe("");
  });

  it("a page break contributes an empty line", () => {
    const doc: Doc = [para([run("a")]), pagebreak(), para([run("b")])];
    expect(sliceText(doc, range(0, 0, 2, 1))).toBe("a\n\nb");
  });
});

describe("insertFragment", () => {
  it("inserts a single-paragraph fragment inline at a collapsed cursor", () => {
    const doc: Doc = [para([run("hello world")])];
    const result = insertFragment(doc, range(0, 6, 0, 6), [
      para([run("beautiful ")]),
    ]);
    expect(result.doc).toEqual([para([run("hello beautiful world")])]);
    expect(result.cursor).toEqual({ para: 0, offset: 16 });
  });

  it("preserves per-run formats on inline insert", () => {
    const doc: Doc = [para([run("ab")])];
    const result = insertFragment(doc, range(0, 1, 0, 1), [
      para([run("X", true), run("Y", false, false, true)]),
    ]);
    expect(result.doc).toEqual([
      para([run("a"), run("X", true), run("Y", false, false, true), run("b")]),
    ]);
  });

  it("replaces a non-collapsed selection", () => {
    const doc: Doc = [para([run("one two three")])];
    const result = insertFragment(doc, range(0, 4, 0, 7), [para([run("X")])]);
    expect(result.doc).toEqual([para([run("one X three")])]);
    expect(result.cursor).toEqual({ para: 0, offset: 5 });
  });

  it("splits the target for a multi-paragraph fragment", () => {
    const doc: Doc = [para([run("hello world")])];
    const result = insertFragment(doc, range(0, 5, 0, 5), [
      para([run("AAA")]),
      para([run("BBB")]),
    ]);
    expect(result.doc).toEqual([
      para([run("helloAAA")]),
      para([run("BBB world")]),
    ]);
    expect(result.cursor).toEqual({ para: 1, offset: 3 });
  });

  it("a heading pasted at the start of a line keeps its block type", () => {
    const doc: Doc = [para([run("world")])];
    const result = insertFragment(doc, range(0, 0, 0, 0), [
      para([run("AAA")], "h1"),
      para([run("BBB")]),
    ]);
    expect(result.doc).toEqual([
      para([run("AAA")], "h1"),
      para([run("BBBworld")]),
    ]);
  });

  it("a heading pasted into an empty paragraph becomes a heading", () => {
    const doc: Doc = [para([run("")])];
    const result = insertFragment(doc, range(0, 0, 0, 0), [
      para([run("Title")], "h1"),
    ]);
    expect(result.doc).toEqual([para([run("Title")], "h1")]);
  });

  it("pasting on a page break replaces it with plain text", () => {
    const doc: Doc = [pagebreak()];
    const result = insertFragment(doc, range(0, 0, 0, 0), [
      para([run("prose")]),
    ]);
    expect(result.doc).toEqual([para([run("prose")])]);
  });

  it("an empty single-line fragment is a no-op", () => {
    const doc: Doc = [para([run("abc")])];
    const result = insertFragment(doc, range(0, 1, 0, 1), [para([run("")])]);
    expect(result.doc).toEqual([para([run("abc")])]);
    expect(result.cursor).toEqual({ para: 0, offset: 1 });
  });

  it("every outcome validates", () => {
    const doc: Doc = [para([run("one two three")])];
    for (const r of [
      insertFragment(doc, range(0, 0, 0, 3), [para([run("X", true)])]),
      insertFragment(doc, range(0, 0, 0, 0), [
        para([run("A")], "h2"),
        para([run("")]),
        para([run("B")]),
      ]),
      insertFragment(doc, range(0, 4, 0, 7), [
        para([run("A")], "h1", "center"),
        para([run("B", true, true, true)]),
      ]),
    ]) {
      expect(isValidDoc(r.doc)).toBe(true);
      expect(
        isValidSelection(r.doc, { anchor: r.cursor, focus: r.cursor }),
      ).toBe(true);
    }
  });
});

describe("parsePlainText", () => {
  it("splits on newlines, one paragraph per line", () => {
    expect(parsePlainText("a\nb\nc")).toEqual([
      para([run("a")]),
      para([run("b")]),
      para([run("c")]),
    ]);
  });

  it("drops a single trailing newline", () => {
    expect(parsePlainText("a\n")).toEqual([para([run("a")])]);
  });

  it("preserves interior blank lines", () => {
    expect(parsePlainText("a\n\nb")).toEqual([
      para([run("a")]),
      para([run("")]),
      para([run("b")]),
    ]);
  });

  it("normalizes CRLF", () => {
    expect(parsePlainText("a\r\nb")).toEqual([
      para([run("a")]),
      para([run("b")]),
    ]);
  });

  it("empty input yields one empty paragraph", () => {
    expect(parsePlainText("")).toEqual([para([run("")])]);
  });
});

describe("selectAllSelection", () => {
  it("spans the whole document", () => {
    const doc: Doc = [para([run("one")]), para([run("two")])];
    expect(selectAllSelection(doc)).toEqual({
      anchor: { para: 0, offset: 0 },
      focus: { para: 1, offset: 3 },
    });
  });

  it("a single paragraph selects all of it", () => {
    const doc: Doc = [para([run("abc")])];
    expect(selectAllSelection(doc)).toEqual({
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 3 },
    });
  });

  it("a trailing page break contributes offset zero", () => {
    const doc: Doc = [para([run("abc")]), pagebreak()];
    const sel = selectAllSelection(doc);
    expect(sel.focus).toEqual({ para: 1, offset: 0 });
    expect(isValidSelection(doc, sel)).toBe(true);
  });
});

describe("normalizeSelection", () => {
  it("orders a reversed selection", () => {
    expect(
      normalizeSelection({
        anchor: { para: 1, offset: 2 },
        focus: { para: 0, offset: 3 },
      }),
    ).toEqual(range(0, 3, 1, 2));
  });
});
