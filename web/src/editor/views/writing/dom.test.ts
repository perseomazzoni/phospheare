// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import {
  getParagraphs,
  getParagraphElement,
  domPointToLogical,
  logicalToDomPoint,
  saveDomSelection,
  restoreDomSelection,
  calculateFlatPosition,
  inSameParagraph,
} from "./dom";

// Pins the mapping between DOM points and cursors: a DOM point and a logical
// cursor are the same position in two coordinate systems, and the round trip
// in either direction lands where it started.

function surface(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

function textNodeOf(el: HTMLElement, paraIdx: number, partial: string): Text {
  const p = getParagraphs(el)[paraIdx];
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let n: Text | null;
  while ((n = walker.nextNode() as Text | null)) {
    if (n.textContent?.includes(partial)) return n;
  }
  throw new Error(
    `no text node containing "${partial}" in paragraph ${paraIdx}`,
  );
}

function setDomSelection(
  startNode: Node,
  startOffset: number,
  endNode?: Node,
  endOffset?: number,
): void {
  const sel = window.getSelection();
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode ?? startNode, endOffset ?? startOffset);
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function selection(): Selection {
  const sel = window.getSelection();
  if (sel === null) throw new Error("jsdom has no selection");
  return sel;
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

describe("getParagraphs", () => {
  it("returns the direct block paragraphs in document order", () => {
    const el = surface(
      "<p>a</p><h1>b</h1><h2>c</h2><div><p>nested</p></div><p>d</p>",
    );
    const paras = getParagraphs(el);
    expect(paras.map((p) => p.tagName)).toEqual(["P", "H1", "H2", "P"]);
    expect(paras[3].textContent).toBe("d");
  });

  it("— counts a page break's <hr> as the paragraph the model counts", () => {
    // The model counts `blockType: "pagebreak"` as a paragraph and the
    // renderer draws it as `<hr>`. The helper counts it too, or every index
    // consumer (the diff marks, the cursor mapping) slides one off below a
    // break.
    const el = surface("<p>one</p><hr><p>two</p>");
    const paras = getParagraphs(el);
    expect(paras.map((p) => p.tagName)).toEqual(["P", "HR", "P"]);
    expect(paras[2].textContent).toBe("two");
  });
});

describe("getParagraphElement", () => {
  it("finds the paragraph of a nested text node", () => {
    const el = surface("<p>hello <strong>world</strong></p>");
    const p = getParagraphElement(textNodeOf(el, 0, "world"));
    expect(p?.tagName).toBe("P");
    expect(p).toBe(getParagraphs(el)[0]);
  });

  it("— the break's <hr> is a paragraph", () => {
    const el = surface("<p>one</p><hr><p>two</p>");
    const hr = getParagraphs(el)[1];
    expect(getParagraphElement(hr)).toBe(hr);
  });

  it("returns null for a node outside any paragraph", () => {
    const el = surface("<p>a</p>");
    expect(getParagraphElement(el)).toBeNull();
    expect(getParagraphElement(document.body)).toBeNull();
  });
});

describe("domPointToLogical", () => {
  it("maps a point inside a paragraph to its paragraph and text offset", () => {
    const el = surface("<p>hello <strong>world</strong></p><p>second</p>");
    const world = textNodeOf(el, 0, "world");
    expect(domPointToLogical(el, world, 2)).toEqual({ para: 0, offset: 8 });
    const second = textNodeOf(el, 1, "second");
    expect(domPointToLogical(el, second, 3)).toEqual({ para: 1, offset: 3 });
  });

  it("counts offsets in visible text, not markup", () => {
    const el = surface("<p>a<em>b</em>c</p>");
    const b = textNodeOf(el, 0, "b");
    const c = textNodeOf(el, 0, "c");
    expect(domPointToLogical(el, b, 1)).toEqual({ para: 0, offset: 2 });
    expect(domPointToLogical(el, c, 1)).toEqual({ para: 0, offset: 3 });
  });

  it("returns null for a point outside the paragraphs", () => {
    const el = surface("<p>a</p>");
    expect(domPointToLogical(el, el, 0)).toBeNull();
    expect(domPointToLogical(el, document.body, 0)).toBeNull();
  });
});

describe("logicalToDomPoint", () => {
  it("maps a cursor into the text node containing it", () => {
    const el = surface("<p>abc<em>def</em>gh</p>");
    const pt = logicalToDomPoint(el, { para: 0, offset: 5 });
    expect(pt?.node.textContent).toBe("def");
    expect(pt?.offset).toBe(2);
  });

  it("maps the end of a paragraph onto its last text node", () => {
    const el = surface("<p>abc</p>");
    const pt = logicalToDomPoint(el, { para: 0, offset: 3 });
    expect(pt?.node.textContent).toBe("abc");
    expect(pt?.offset).toBe(3);
    // Offsets beyond the text clamp to the end.
    expect(logicalToDomPoint(el, { para: 0, offset: 99 })?.offset).toBe(3);
  });

  it("maps an empty paragraph onto the paragraph element itself", () => {
    const el = surface("<p><br></p>");
    const pt = logicalToDomPoint(el, { para: 0, offset: 0 });
    expect(pt?.node).toBe(getParagraphs(el)[0]);
    expect(pt?.offset).toBe(0);
  });

  it("returns null for a paragraph index the surface does not have", () => {
    const el = surface("<p>a</p>");
    expect(logicalToDomPoint(el, { para: 5, offset: 0 })).toBeNull();
  });
});

describe("dom ↔ logical round trip", () => {
  it("a cursor round-trips through the DOM unchanged", () => {
    const el = surface("<p>abc<em>def</em>gh</p><p><strong>ijk</strong></p>");
    for (const cursor of [
      { para: 0, offset: 0 },
      { para: 0, offset: 3 },
      { para: 0, offset: 5 },
      { para: 0, offset: 8 },
      { para: 1, offset: 3 },
    ]) {
      const pt = logicalToDomPoint(el, cursor);
      if (pt === null)
        throw new Error(`no DOM point for cursor ${JSON.stringify(cursor)}`);
      expect(domPointToLogical(el, pt.node, pt.offset)).toEqual(cursor);
    }
  });

  it("— a cursor after a page break round-trips across the <hr>", () => {
    const el = surface("<p>one</p><hr><p>two</p>");
    // The break holds the model's paragraph index, so the paragraph after it
    // is para 2, and the round trip never collapses onto para 1.
    const pt = logicalToDomPoint(el, { para: 2, offset: 1 });
    if (pt === null) throw new Error("no DOM point for para 2");
    expect(domPointToLogical(el, pt.node, pt.offset)).toEqual({
      para: 2,
      offset: 1,
    });
    // A cursor on the break itself lands on the `<hr>`; the model allows the
    // caret there, and typing replaces the break.
    const breakPt = logicalToDomPoint(el, { para: 1, offset: 0 });
    if (breakPt === null) throw new Error("no DOM point for the break");
    expect(breakPt.node).toBe(getParagraphs(el)[1]);
    expect(domPointToLogical(el, breakPt.node, 0)).toEqual({
      para: 1,
      offset: 0,
    });
  });
});

describe("saveDomSelection / restoreDomSelection", () => {
  it("saves a selection inside the surface as a logical selection", () => {
    const el = surface("<p>hello <strong>world</strong></p>");
    const world = textNodeOf(el, 0, "world");
    setDomSelection(world, 1, world, 4);
    expect(saveDomSelection(el)).toEqual({
      anchor: { para: 0, offset: 7 },
      focus: { para: 0, offset: 10 },
    });
  });

  it("returns null without a selection or for a selection outside the surface", () => {
    const el = surface("<p>a</p>");
    expect(saveDomSelection(el)).toBeNull();
    const outside = document.createElement("div");
    outside.textContent = "other";
    document.body.appendChild(outside);
    const outsideText = outside.firstChild;
    if (outsideText === null) throw new Error("outside node has no text child");
    setDomSelection(outsideText, 0, outsideText, 3);
    expect(saveDomSelection(el)).toBeNull();
  });

  it("restores a collapsed selection at the mapped node and offset", () => {
    const el = surface("<p>abc<em>def</em></p>");
    restoreDomSelection(el, {
      anchor: { para: 0, offset: 4 },
      focus: { para: 0, offset: 4 },
    });
    const sel = selection();
    expect(sel.anchorNode?.textContent).toBe("def");
    expect(sel.anchorOffset).toBe(1);
    expect(sel.isCollapsed).toBe(true);
  });

  it("restores a two-point selection by extending to the focus", () => {
    const el = surface("<p>abc<em>def</em>gh</p>");
    restoreDomSelection(el, {
      anchor: { para: 0, offset: 1 },
      focus: { para: 0, offset: 6 },
    });
    const sel = selection();
    expect(sel.anchorOffset).toBe(1);
    expect(sel.focusNode?.textContent).toBe("def");
    expect(sel.focusOffset).toBe(3);
  });

  it("leaves the selection untouched when the selection cannot be mapped", () => {
    const el = surface("<p>a</p>");
    const before = selection();
    before.removeAllRanges();
    restoreDomSelection(el, {
      anchor: { para: 9, offset: 0 },
      focus: { para: 9, offset: 0 },
    });
    expect(window.getSelection()?.rangeCount).toBe(0);
  });

  it("round-trips a caret on an empty paragraph's break", () => {
    // The editor's blank paragraph is `<p><br></p>`, the contentEditable
    // idiom, so a caret in the paragraph sits in the break element. The break
    // has no text, so the logical point is the paragraph start, and the
    // restore returns there, before the break, never past the paragraph's end.
    const el = surface("<p>abc</p><p><br></p>");
    const br = el.querySelector("p:last-child br");
    if (br === null) throw new Error("blank paragraph has no br");
    setDomSelection(br, 0);
    expect(saveDomSelection(el)).toEqual({
      anchor: { para: 1, offset: 0 },
      focus: { para: 1, offset: 0 },
    });

    restoreDomSelection(el, {
      anchor: { para: 1, offset: 0 },
      focus: { para: 1, offset: 0 },
    });
    const sel = selection();
    expect(sel.anchorNode).toBe(el.querySelector("p:last-child"));
    expect(sel.anchorOffset).toBe(0);
    expect(sel.isCollapsed).toBe(true);
  });
});

describe("calculateFlatPosition", () => {
  // The painter joins blocks as find does, one break between two.
  it("adds the full text of preceding paragraphs, and a break after each, to the cursor offset", () => {
    const el = surface("<p>abc</p><p>def</p><p>ghi</p>");
    expect(calculateFlatPosition(el, { para: 0, offset: 0 })).toBe(0);
    expect(calculateFlatPosition(el, { para: 1, offset: 2 })).toBe(6);
    expect(calculateFlatPosition(el, { para: 2, offset: 1 })).toBe(9);
  });

  it("clamps a paragraph index past the end to the total length", () => {
    const el = surface("<p>abc</p><p>def</p>");
    expect(calculateFlatPosition(el, { para: 9, offset: 2 })).toBe(9);
  });

  it("reads a surface with no blocks as its own offset", () => {
    expect(calculateFlatPosition(surface(""), { para: 0, offset: 3 })).toBe(3);
  });
});

describe("inSameParagraph", () => {
  it("is true for two points in one paragraph, false across paragraphs", () => {
    const el = surface("<p>one</p><p>two</p>");
    const one = textNodeOf(el, 0, "one");
    const two = textNodeOf(el, 1, "two");
    expect(inSameParagraph(one, one)).toBe(true);
    expect(inSameParagraph(one, two)).toBe(false);
  });

  it("is false when either point has no paragraph", () => {
    const el = surface("<p>one</p>");
    const one = textNodeOf(el, 0, "one");
    expect(inSameParagraph(null, one)).toBe(false);
    expect(inSameParagraph(one, document.body)).toBe(false);
  });
});
