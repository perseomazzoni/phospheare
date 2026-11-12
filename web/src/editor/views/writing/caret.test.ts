// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  isEmptyParagraphCaret,
  measureCaretRect,
  getFakeCursorRect,
} from "./caret";

// jsdom has no layout and every rect is empty, so the helpers degrade to
// null, never crashing or producing garbage, and the paths that need no rect
// (empty-paragraph probing, marker hygiene) behave correctly.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () =>
  ({
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect;

const para = (html: string) => {
  const p = document.createElement("p");
  p.innerHTML = html;
  document.body.appendChild(p);
  return p;
};

const collapsedAt = (el: Node, offset: number) => {
  const range = document.createRange();
  range.setStart(el, offset);
  range.collapse(true);
  return range;
};

const firstChildOf = (el: Node): ChildNode => {
  const child = el.firstChild;
  if (child === null) throw new Error("caret fixture: no first child");
  return child;
};

const selection = (): Selection => {
  const sel = window.getSelection();
  if (sel === null) throw new Error("caret fixture: jsdom has no selection");
  return sel;
};

afterEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

describe("isEmptyParagraphCaret", () => {
  it("is true for a caret in an empty paragraph", () => {
    const p = para("<br>");
    expect(isEmptyParagraphCaret(collapsedAt(p, 0))).toBe(true);
  });

  it("is false for a non-collapsed range", () => {
    const p = para("text");
    const range = document.createRange();
    range.setStart(firstChildOf(p), 0);
    range.setEnd(firstChildOf(p), 2);
    expect(isEmptyParagraphCaret(range)).toBe(false);
  });

  it("is false in a paragraph with visible text", () => {
    const p = para("text");
    expect(isEmptyParagraphCaret(collapsedAt(firstChildOf(p), 1))).toBe(false);
  });

  it("is false outside any paragraph", () => {
    const div = document.createElement("div");
    expect(isEmptyParagraphCaret(collapsedAt(div, 0))).toBe(false);
  });
});

describe("measureCaretRect", () => {
  it("restores a lone <br> after probing an empty paragraph", () => {
    const p = para("<br>");
    measureCaretRect(collapsedAt(p, 0));
    expect(p.innerHTML).toBe("<br>");
    expect(p.textContent).toBe("");
  });

  it("removes the probe marker from a non-empty paragraph", () => {
    const p = para("text");
    measureCaretRect(collapsedAt(firstChildOf(p), 1));
    expect(p.textContent).toBe("text");
  });

  it("returns null when the browser reports no geometry", () => {
    const p = para("text");
    expect(measureCaretRect(collapsedAt(firstChildOf(p), 1))).toBeNull();
  });

  it("returns a rect when the browser reports one", () => {
    const p = para("text");
    const orig = Range.prototype.getClientRects;
    Range.prototype.getClientRects = () =>
      [
        {
          left: 4,
          top: 8,
          right: 5,
          bottom: 24,
          width: 1,
          height: 16,
          x: 4,
          y: 8,
          toJSON: () => ({}),
        },
      ] as unknown as DOMRectList;
    try {
      const rect = measureCaretRect(collapsedAt(firstChildOf(p), 1));
      expect(rect).not.toBeNull();
      if (rect === null)
        throw new Error("caret fixture: stubbed geometry must yield a rect");
      expect(rect.height).toBe(16);
    } finally {
      Range.prototype.getClientRects = orig;
    }
  });
});

describe("getFakeCursorRect", () => {
  it("returns null without a collapsed selection", () => {
    expect(getFakeCursorRect()).toBeNull();
    const p = para("text");
    const sel = selection();
    const range = document.createRange();
    range.setStart(firstChildOf(p), 0);
    range.setEnd(firstChildOf(p), 2);
    sel.addRange(range);
    expect(getFakeCursorRect()).toBeNull();
  });

  it("returns null when measurement yields no geometry", () => {
    const p = para("text");
    const sel = selection();
    sel.removeAllRanges();
    const range = document.createRange();
    range.setStart(firstChildOf(p), 1);
    range.collapse(true);
    sel.addRange(range);
    expect(getFakeCursorRect()).toBeNull();
  });

  it("reports the measured rect for a visible caret", () => {
    const p = para("text");
    const sel = selection();
    sel.removeAllRanges();
    const range = document.createRange();
    range.setStart(firstChildOf(p), 1);
    range.collapse(true);
    sel.addRange(range);
    const orig = Range.prototype.getClientRects;
    Range.prototype.getClientRects = () =>
      [
        {
          left: 4,
          top: 8,
          right: 5,
          bottom: 24,
          width: 1,
          height: 16,
          x: 4,
          y: 8,
          toJSON: () => ({}),
        },
      ] as unknown as DOMRectList;
    try {
      expect(getFakeCursorRect()).toEqual({ x: 4, y: 8, h: 16 });
    } finally {
      Range.prototype.getClientRects = orig;
    }
  });
});
