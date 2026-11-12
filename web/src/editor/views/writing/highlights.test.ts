// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  collectTextNodes,
  findInConcatenated,
  applyHighlights,
  applyDiffMarks,
  filterRepetitionMarksOutsideViewport,
  paintHighlights,
} from "./highlights";

const para = (html: string) => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
};

describe("findInConcatenated", () => {
  it("returns nothing for an empty query", () => {
    expect(findInConcatenated("text", "", false, false)).toEqual([]);
  });

  it("finds all non-overlapping occurrences case-insensitively", () => {
    expect(findInConcatenated("aa baa caaa", "aa", false, false)).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 6 },
      { start: 8, end: 10 },
    ]);
  });

  it("respects case sensitivity", () => {
    expect(findInConcatenated("Aa aA", "aa", true, false)).toEqual([]);
    expect(findInConcatenated("Aa", "Aa", true, false)).toEqual([
      { start: 0, end: 2 },
    ]);
  });

  it("whole-word matches need separators on both sides", () => {
    const text = "cat concat cat";
    expect(findInConcatenated(text, "cat", false, true)).toEqual([
      { start: 0, end: 3 },
      { start: 11, end: 14 },
    ]);
  });

  it("whole-word respects paragraph edges", () => {
    expect(findInConcatenated("cat", "cat", false, true)).toEqual([
      { start: 0, end: 3 },
    ]);
  });

  it("hyphensJoinWords makes a hyphenated span one word", () => {
    const text = "e-mail email";
    // Without the flag, the hyphen is a separator, so "mail" in "e-mail" is a
    // whole word of its own.
    expect(findInConcatenated(text, "mail", false, true)).toEqual([
      { start: 2, end: 6 },
    ]);
    expect(findInConcatenated(text, "mail", false, true, true)).toEqual([]);
    expect(findInConcatenated(text, "e-mail", false, true, true)).toEqual([
      { start: 0, end: 6 },
    ]);
  });
});

describe("collectTextNodes", () => {
  it("maps every text node with concatenated offsets", () => {
    const root = para("<p>ab<b>cd</b>e</p><p>f</p>");
    const nodes = collectTextNodes(root);
    expect(nodes.map((n) => n.node.textContent)).toEqual([
      "ab",
      "cd",
      "e",
      "f",
    ]);
    expect(nodes.map((n) => [n.start, n.end])).toEqual([
      [0, 2],
      [2, 4],
      [4, 5],
      [5, 6],
    ]);
  });
});

describe("applyHighlights", () => {
  it("wraps every match and marks the current one", () => {
    const root = para("<p>one two one</p>");
    applyHighlights(root, [], {
      text: "one",
      index: 1,
      caseSensitive: false,
      wholeWord: false,
      hyphensJoinWords: false,
    });
    expect(root.querySelectorAll("mark.hl-search").length).toBe(1);
    expect(root.querySelectorAll("mark.hl-search-current").length).toBe(1);
    expect(root.textContent).toBe("one two one");
  });

  // The surface is read as find reads the document, its blocks joined
  // by a break, so the marks agree with the count across paragraphs.
  const across = (html: string, text: string) => {
    const root = para(html);
    applyHighlights(root, [], {
      text,
      index: 0,
      caseSensitive: false,
      wholeWord: false,
      hyphensJoinWords: false,
    });
    return Array.from(root.querySelectorAll("mark")).map((m) => [
      m.parentElement?.tagName,
      m.textContent,
    ]);
  };

  it("marks a match across a paragraph break on both sides of it", () => {
    expect(across("<p>one two</p><p>three</p>", "two\nthree")).toEqual([
      ["P", "two"],
      ["P", "three"],
    ]);
  });

  it("marks a match that starts or ends on a break on the text beside it", () => {
    expect(across("<p>one</p><p>two</p>", "\ntwo")).toEqual([["P", "two"]]);
    expect(across("<p>one</p><p>two</p>", "one\n")).toEqual([["P", "one"]]);
  });

  it("reads blocks as broken, never run together", () => {
    // Blocks are joined by a break, so "onetwo" never matches.
    expect(across("<p>one</p><p>two</p>", "onetwo")).toEqual([]);
  });

  it("never marks through a page break", () => {
    expect(across("<p>one</p><hr><p>two</p>", "one\ntwo")).toEqual([]);
    expect(across("<p>one</p><hr><p>two</p>", "one\n")).toEqual([]);
  });

  it("adds tooltips to repetition marks only", () => {
    const root = para("<p>cat cat</p>");
    applyHighlights(
      root,
      [{ text: "cat", className: "hl-selection" }],
      undefined,
      0,
      3,
      "tooltip",
    );
    const marks = root.querySelectorAll("mark.hl-repetition");
    expect(marks.length).toBe(1);
    expect(marks[0].getAttribute("data-tooltip")).toBe("tooltip");
  });

  it("skips the occurrence the user has selected", () => {
    const root = para("<p>cat cat</p>");
    // The selection starts at flat position 4 (the second "cat").
    applyHighlights(
      root,
      [{ text: "cat", className: "hl-selection" }],
      undefined,
      4,
      3,
    );
    const marks = root.querySelectorAll("mark.hl-repetition");
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe("cat");
    expect(marks[0].getBoundingClientRect()).toBeTruthy();
  });

  it("unwraps previous marks before applying new ones", () => {
    const root = para("<p>aa aa</p>");
    applyHighlights(root, [], {
      text: "aa",
      index: 0,
      caseSensitive: false,
      wholeWord: false,
      hyphensJoinWords: false,
    });
    expect(root.querySelectorAll("mark").length).toBe(2);
    applyHighlights(root, [], {
      text: "bb",
      index: 0,
      caseSensitive: false,
      wholeWord: false,
      hyphensJoinWords: false,
    });
    expect(root.querySelectorAll("mark").length).toBe(0);
    expect(root.textContent).toBe("aa aa");
  });

  it("wraps a match spanning a formatting boundary, one mark per text node", () => {
    // The match crosses from plain text into a `<b>` element, which
    // `surroundContents` rejects, so each text node of the range is wrapped
    // on its own.
    const root = para("<p>foo<b>bar</b>baz</p>");
    applyHighlights(root, [], {
      text: "barbaz",
      index: 0,
      caseSensitive: false,
      wholeWord: false,
      hyphensJoinWords: false,
    });
    const marks = root.querySelectorAll("mark.hl-search-current");
    expect(marks.length).toBe(2);
    expect(marks[0].textContent).toBe("bar");
    expect(marks[1].textContent).toBe("baz");
    expect(root.textContent).toBe("foobarbaz");
    applyHighlights(root, [], {
      text: "baz",
      index: 0,
      caseSensitive: false,
      wholeWord: false,
      hyphensJoinWords: false,
    });
    expect(root.querySelectorAll("mark.hl-search-current").length).toBe(1);
  });

  it("is a no-op on an empty root", () => {
    const root = para("");
    expect(() =>
      applyHighlights(root, [{ text: "x", className: "hl-search" }]),
    ).not.toThrow();
  });
});

describe("filterRepetitionMarksOutsideViewport", () => {
  it("removes marks fully outside the viewport and keeps the rest", () => {
    const root = para("<p>cat cat cat</p>");
    applyHighlights(
      root,
      [{ text: "cat", className: "hl-selection" }],
      undefined,
      0,
      3,
    );
    const marks = [...root.querySelectorAll("mark.hl-repetition")];
    expect(marks.length).toBe(2);

    // jsdom rects are always 0, so layout is simulated with per-mark rects.
    (marks[0] as HTMLElement).getBoundingClientRect = () =>
      ({
        top: -100,
        bottom: -90,
        left: 0,
        right: 0,
        width: 0,
        height: 10,
      }) as DOMRect;
    (marks[1] as HTMLElement).getBoundingClientRect = () =>
      ({
        top: 100,
        bottom: 110,
        left: 0,
        right: 0,
        width: 0,
        height: 10,
      }) as DOMRect;

    filterRepetitionMarksOutsideViewport(root);
    const remaining = [...root.querySelectorAll("mark.hl-repetition")];
    expect(remaining.length).toBe(1);
    expect(remaining[0].textContent).toBe("cat");
    expect(root.textContent).toBe("cat cat cat");
  });

  // A rect read after an unwrap forces a synchronous layout per mark, so all
  // rects are read before the first mark is removed.
  it("reads every mark's rect before it unwraps any", () => {
    const root = para("<p>cat cat cat cat</p>");
    applyHighlights(
      root,
      [{ text: "cat", className: "hl-selection" }],
      undefined,
      0,
      3,
    );
    const marks = [...root.querySelectorAll("mark.hl-repetition")];
    expect(marks.length).toBe(3);
    const log: string[] = [];
    for (const mark of marks) {
      (mark as HTMLElement).getBoundingClientRect = () => {
        log.push("read");
        return { top: -100, bottom: -90 } as DOMRect;
      };
    }
    const parent = marks[0].parentNode as Node;
    const remove = parent.removeChild.bind(parent);
    parent.removeChild = <T extends Node>(child: T): T => {
      log.push("write");
      return remove(child);
    };

    filterRepetitionMarksOutsideViewport(root);
    expect(root.querySelectorAll("mark.hl-repetition")).toHaveLength(0);
    expect(log).toEqual(["read", "read", "read", "write", "write", "write"]);
  });
});

// ── The comparing mode's marks ───────────────────────────────────────────────

describe("applyDiffMarks", () => {
  it("wraps the decorated spans in their mark classes", () => {
    const el = para("<p>the old house</p>");
    applyDiffMarks(el, [{ para: 0, from: 4, to: 8, kind: "deleted" }]);
    const mark = el.querySelector("mark.df-deleted");
    // The span runs 4..8, "old ", because the engine hands the separator
    // over, so the merged text keeps its spacing.
    expect(mark?.textContent).toBe("old ");
    expect(el.textContent).toBe("the old house");
  });

  it("marks insertions with the compared class", () => {
    const el = para("<p>the old house</p>");
    applyDiffMarks(el, [{ para: 0, from: 4, to: 8, kind: "inserted" }]);
    expect(el.querySelector("mark.df-inserted")?.textContent).toBe("old ");
    expect(el.querySelector("mark.df-deleted")).toBeNull();
  });

  it("handles spans that cross formatting boundaries", () => {
    const el = para("<p>the <strong>old</strong> house</p>");
    applyDiffMarks(el, [{ para: 0, from: 4, to: 7, kind: "deleted" }]);
    // The span covers part of the strong run; the mark wraps each text node
    // the range touches, so the bold run's content stays inside the mark.
    const marks = el.querySelectorAll("mark.df-deleted");
    expect(marks.length).toBeGreaterThan(0);
    expect([...marks].map((m) => m.textContent).join("")).toBe("old");
  });

  it("is idempotent — a second pass with the same items does not nest", () => {
    const el = para("<p>the old house</p>");
    applyDiffMarks(el, [{ para: 0, from: 4, to: 7, kind: "deleted" }]);
    applyDiffMarks(el, [{ para: 0, from: 4, to: 7, kind: "deleted" }]);
    expect(el.querySelectorAll("mark.df-deleted")).toHaveLength(1);
  });

  it("unwraps its own marks when the items are gone", () => {
    const el = para("<p>the old house</p>");
    applyDiffMarks(el, [{ para: 0, from: 4, to: 7, kind: "deleted" }]);
    applyDiffMarks(el, []);
    expect(el.querySelector("mark.df-deleted")).toBeNull();
    expect(el.textContent).toBe("the old house");
  });

  it("addresses paragraphs by their document index", () => {
    const el = para("<p>one</p><p>two</p>");
    applyDiffMarks(el, [{ para: 1, from: 0, to: 2, kind: "inserted" }]);
    expect(el.querySelector("mark.df-inserted")?.textContent).toBe("tw");
  });

  it("— a mark after a page break lands on its own paragraph, not the break's seat", () => {
    // The renderer draws the break as `<hr>`, and the paragraph index is the
    // model's, which counts the break, so the mark on para 2 paints para 2.
    // An index that skipped the `<hr>` would slide every mark below a break
    // one line early.
    const el = para("<p>one</p><hr><p>two</p>");
    applyDiffMarks(el, [{ para: 2, from: 0, to: 2, kind: "inserted" }]);
    const mark = el.querySelector("mark.df-inserted");
    expect(mark?.textContent).toBe("tw");
    expect(el.children[2].contains(mark)).toBe(true);
  });

  it("wraps each hunk's merged span in a .df-hunk element with its id and kind", () => {
    // A replacement (quick to fast) is one hunk over two touching
    // decorations; the wrapper covers the whole merged span and carries the
    // hunk's id and kind for the Accept layer's hit regions.
    const el = para("<p>the fast quick brown fox</p>");
    applyDiffMarks(
      el,
      [
        { para: 0, from: 4, to: 9, kind: "inserted" },
        { para: 0, from: 9, to: 15, kind: "deleted" },
      ],
      [
        {
          id: 0,
          kind: "replace",
          block: false,
          para: 0,
          merged: { from: 4, to: 15 },
          left: { para: 0, from: 3, to: 10 },
          right: { para: 0, from: 3, to: 9 },
        },
      ],
    );
    const wrap = el.querySelector("span.df-hunk");
    expect(wrap?.getAttribute("data-hunk-id")).toBe("0");
    expect(wrap?.getAttribute("data-kind")).toBe("replace");
    // The merged span is [4,15): the deleted segment carries its trailing
    // separator, so the wrapper holds "fast quick ".
    expect(wrap?.textContent).toBe("fast quick ");
    // Both marks sit inside the wrapper.
    expect(
      wrap?.querySelectorAll("mark.df-deleted, mark.df-inserted"),
    ).toHaveLength(2);
    expect(el.textContent).toBe("the fast quick brown fox");
  });

  it("keeps the wrapper OUTSIDE the marks — a single-deletion hunk is span > mark, never mark > span", () => {
    // One deletion run whose merged range equals the decoration exactly. The
    // wrapper is placed before the marks; marks first, then the range
    // extraction, would empty the edge mark and drop the span inside it, so
    // no `.df-hunk mark` rule (the hover light, the data-armed mirror) could
    // match.
    const el = para("<p>the old house</p>");
    applyDiffMarks(
      el,
      [{ para: 0, from: 4, to: 7, kind: "deleted" }],
      [
        {
          id: 3,
          kind: "delete",
          block: false,
          para: 0,
          merged: { from: 4, to: 7 },
          left: { para: 0, from: 4, to: 7 },
          right: { para: 0, from: 0, to: 0 },
        },
      ],
    );
    const span = el.querySelector("span.df-hunk");
    expect(span).not.toBeNull();
    // The wrapper sits directly in the paragraph, never inside a mark.
    expect(span?.parentElement?.tagName).toBe("P");
    // The mark is the wrapper's descendant, so every `.df-hunk mark` rule
    // (the hover wash light, the data-armed keep-lit mirror) matches.
    expect(span?.querySelector("mark.df-deleted")).not.toBeNull();
    expect(el.textContent).toBe("the old house");
  });

  it("repaints a changed hunk set after an accept — old wrappers unwrapped, new placed, no nesting", () => {
    // An accept shifts the hunks; the pass must unwrap its own wrappers and
    // marks first so the fresh set never nests inside the stale one.
    const el = para("<p>the fast quick brown fox</p>");
    applyDiffMarks(
      el,
      [{ para: 0, from: 4, to: 9, kind: "inserted" }],
      [
        {
          id: 0,
          kind: "insert",
          block: false,
          para: 0,
          merged: { from: 4, to: 9 },
          left: { para: 0, from: 9, to: 10 },
          right: { para: 0, from: 9, to: 15 },
        },
      ],
    );
    applyDiffMarks(
      el,
      [{ para: 0, from: 9, to: 15, kind: "deleted" }],
      [
        {
          id: 0,
          kind: "delete",
          block: false,
          para: 0,
          merged: { from: 9, to: 15 },
          left: { para: 0, from: 9, to: 10 },
          right: { para: 0, from: 0, to: 0 },
        },
      ],
    );
    expect(el.querySelectorAll("span.df-hunk")).toHaveLength(1);
    expect(el.querySelectorAll("mark")).toHaveLength(1);
    expect(el.querySelector("mark.df-deleted")).toBeTruthy();
    expect(el.querySelector("mark.df-inserted")).toBeNull();
    expect(el.textContent).toBe("the fast quick brown fox");
  });

  it("skips the SPAN wrapper for a textless block hunk, but marks the paragraph itself", () => {
    // A page break has no text to wrap, since an empty range extracts
    // nothing, so the pass adds no span wrapper; the Accept layer anchors to
    // the paragraph for its hit region. The paragraph still carries a
    // visible sign of the hunk, or a one-sided empty block (often a blank
    // line the history rail's walk inserts or removes) renders as an
    // unmarked blank line. `data-block-hunk` is that sign, painted by the
    // `[data-block-hunk]` rules in `editor.css` in the marks' insert and
    // delete colours.
    const el = para("<p>one</p><hr><p>two</p>");
    applyDiffMarks(
      el,
      [],
      [
        {
          id: 0,
          kind: "insert",
          block: true,
          para: 1,
          merged: { from: 0, to: 0 },
          left: { para: 1, from: 0, to: 0 },
          right: { para: 1, from: 0, to: 0 },
        },
      ],
    );
    expect(el.querySelector("span.df-hunk")).toBeNull();
    expect(el.textContent).toBe("onetwo");
    const hr = el.children[1];
    expect(hr.tagName).toBe("HR");
    expect(hr.getAttribute("data-block-hunk")).toBe("insert");
    expect(hr.getAttribute("data-hunk-id")).toBe("0");
  });

  it("clears a stale data-block-hunk mark when the hunk doesn't recur", () => {
    // Unlike `mark` and `.df-hunk`, the attribute lives on the paragraph and
    // survives `patchDocument`'s reconciliation, so each pass clears the
    // previous pass's mark, or a paragraph whose hunk resolved keeps its
    // wash.
    const el = para("<p>one</p><hr><p>two</p>");
    applyDiffMarks(
      el,
      [],
      [
        {
          id: 0,
          kind: "delete",
          block: true,
          para: 1,
          merged: { from: 0, to: 0 },
          left: { para: 1, from: 0, to: 0 },
          right: { para: 1, from: 0, to: 0 },
        },
      ],
    );
    expect(el.children[1].getAttribute("data-block-hunk")).toBe("delete");
    applyDiffMarks(el, [], []);
    expect(el.children[1].hasAttribute("data-block-hunk")).toBe(false);
    expect(el.children[1].hasAttribute("data-hunk-id")).toBe(false);
  });
});

describe("the exclusive registers", () => {
  it("applyHighlights never unwraps the diff's marks", () => {
    const el = para("<p>the old house</p>");
    applyDiffMarks(el, [{ para: 0, from: 4, to: 7, kind: "deleted" }]);
    applyHighlights(el, [{ text: "house", className: "hl-search" }]);
    expect(el.querySelector("mark.df-deleted")).toBeTruthy();
    expect(el.querySelector("mark.hl-search")).toBeTruthy();
  });
});

// Two registers over one word (the repetition register and a seeded search
// with the same text) produce overlapping candidates. The second would map
// onto a node the first wrap had split, and `range.setEnd` would overrun it
// with an `IndexSizeError` that takes the editor down. The overlap floor in
// `applyHighlights` skips an already painted span, and the `selectionFor`
// gate keeps the app's registers exclusive. The rows after the
// first pin the floor's corners.
describe("overlapping highlight registers", () => {
  it("two registers over one word never throw and never double-wrap", () => {
    // "cat cat" with the first cat selected (position 0): the repetition
    // register paints the second occurrence [4,7), splitting the node, and
    // the search register's duplicate [4,7) must not overrun `setEnd`.
    const root = para("<p>cat cat</p>");
    applyHighlights(
      root,
      [{ text: "cat", className: "hl-selection" }],
      {
        text: "cat",
        index: 0,
        caseSensitive: false,
        wholeWord: true,
        hyphensJoinWords: false,
      },
      0,
      3,
    );
    // One mark per distinct span: [4,7) painted by whichever register won,
    // [0,3) by the other. Two marks, no nesting, no throw.
    expect(root.querySelectorAll("mark").length).toBe(2);
    expect(root.textContent).toBe("cat cat");
  });

  it("the from=0 corner nests nothing", () => {
    // The second cat selected (position 4): the repetition register paints
    // [0,3) with from=0, and `wrapTextRange` leaves the node intact, so the
    // search duplicate maps in bounds and would nest a mark inside a mark.
    // The floor refuses the overlap before the wrap.
    const root = para("<p>cat cat</p>");
    applyHighlights(
      root,
      [{ text: "cat", className: "hl-selection" }],
      {
        text: "cat",
        index: 0,
        caseSensitive: false,
        wholeWord: true,
        hyphensJoinWords: false,
      },
      4,
      3,
    );
    expect(root.querySelectorAll("mark").length).toBe(2);
    expect(root.querySelector("mark mark")).toBeNull();
  });

  it("a partial overlap between two queries skips the painted span", () => {
    // The selection register paints the second "house" [18,23); the first
    // is the selection, [4,9). The query "the house" matches [0,9) and
    // [14,23), and the second match partly overlaps the painted [18,23), so
    // the floor refuses the whole [14,23) candidate: one span painted once,
    // no nesting. The disjoint [0,9) match still paints.
    const root = para("<p>the house is the house</p>");
    applyHighlights(
      root,
      [{ text: "house", className: "hl-selection" }],
      {
        text: "the house",
        index: 0,
        caseSensitive: false,
        wholeWord: false,
        hyphensJoinWords: false,
      },
      4,
      5,
    );
    const texts = [...root.querySelectorAll("mark")]
      .map((m) => m.textContent)
      .sort();
    expect(texts).toEqual(["house", "the house"]);
    expect(root.querySelector("mark mark")).toBeNull();
  });

  it("disjoint candidates from two registers all paint", () => {
    // Different words, no overlap: both registers paint their own spans. The
    // repetition register needs a second occurrence of the selected word, so
    // in "cat cat dog" the second "cat" is its candidate and "dog" is the
    // search's.
    const root = para("<p>cat cat dog</p>");
    applyHighlights(
      root,
      [{ text: "cat", className: "hl-selection" }],
      {
        text: "dog",
        index: 0,
        caseSensitive: false,
        wholeWord: true,
        hyphensJoinWords: false,
      },
      0,
      3,
    );
    expect(root.querySelectorAll("mark").length).toBe(2);
  });
});

// `DiffAcceptLayer` resolves `hunk.para` through `getParagraphs`, pinned in
// `views/view/DiffAcceptLayer.test.tsx` on the production path.
// A raw-against-filtered comparison here would be a tautology.

// The one paint both of the surface's paths call, so a register added to it
// reaches both; these rows pin what it paints from the two states.
describe("paintHighlights", () => {
  const noSelection = { text: null, exactText: null, showRepetitions: false };
  const noSearch = {
    query: null,
    currentIndex: 0,
    caseSensitive: false,
    wholeWord: false,
    hyphensJoinWords: false,
  };

  it("paints the search register and its current match", () => {
    const root = para("<p>the gate, then the gate again</p>");
    paintHighlights(
      root,
      noSelection,
      { ...noSearch, query: "gate", currentIndex: 1 },
      () => 0,
      "",
    );
    const marks = root.querySelectorAll("mark");
    expect([...marks].map((m) => m.className)).toEqual([
      "hl-search",
      "hl-search-current",
    ]);
  });

  // The assistant's passage is one mark in its own look, never a
  // search hit with siblings.
  it("paints an evidence arrival as the one passage it names", () => {
    const root = para("<p>the gate, then the gate again</p>");
    paintHighlights(
      root,
      noSelection,
      { ...noSearch, query: "the gate", caseSensitive: true, mark: "evidence" },
      () => 0,
      "",
    );
    const marks = root.querySelectorAll("mark");
    expect([...marks].map((m) => [m.className, m.textContent])).toEqual([
      ["hl-evidence", "the gate"],
    ]);
  });

  it("asks for the caret's position only when repetitions are shown", () => {
    const root = para("<p>word and word</p>");
    let asked = 0;
    const at = () => {
      asked += 1;
      return 0;
    };
    paintHighlights(root, noSelection, noSearch, at, "");
    expect(asked).toBe(0);
    expect(root.querySelector("mark")).toBeNull();
    paintHighlights(
      root,
      { text: "word", exactText: "word", showRepetitions: true },
      noSearch,
      at,
      "",
    );
    expect(asked).toBe(1);
    expect(root.querySelector("mark")).not.toBeNull();
  });
});
