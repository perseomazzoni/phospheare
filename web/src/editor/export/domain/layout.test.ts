// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  LAYOUTS,
  LAYOUT_IDS,
  PAGE_SIZES,
  PAGE_SIZE_IDS,
  alignFor,
  chapterDrop,
  defaultPageSize,
  geometryOf,
  headingStyle,
  manuscriptVariant,
  roundWordCount,
  runningHeaderFor,
  titleDrop,
  titleScale,
} from "./layout";

const INCH = 72;

describe("the manuscript's shape", () => {
  // The declared type decides, never a word count.
  it("is a story for short stories, flash fiction and novellas", () => {
    for (const type of ["Short Story", "Flash Fiction", "Novella"])
      expect(manuscriptVariant(type)).toBe("story");
  });

  it("is a novel for novels, epics and any type of the writer's own", () => {
    for (const type of ["Novel", "Epic Novel", "Other", "A cycle of letters"])
      expect(manuscriptVariant(type)).toBe("novel");
  });
});

describe("the approximate word count (Shunn)", () => {
  it("rounds a story to the nearest hundred", () => {
    expect(roundWordCount(4_349, "Short Story")).toBe(4_300);
    expect(roundWordCount(4_350, "Short Story")).toBe(4_400);
  });

  it("rounds a novella to the nearest five hundred", () => {
    expect(roundWordCount(23_260, "Novella")).toBe(23_500);
  });

  it("rounds a novel to the nearest thousand", () => {
    expect(roundWordCount(91_499, "Novel")).toBe(91_000);
    expect(roundWordCount(91_500, "Epic Novel")).toBe(92_000);
  });

  it("does not announce a forty-word piece as about a hundred", () => {
    // Under a hundred words nothing is rounded: "about 10 words" for a
    // three-word page is nobody's number.
    expect(roundWordCount(43, "Flash Fiction")).toBe(43);
    expect(roundWordCount(3, "Flash Fiction")).toBe(3);
    expect(roundWordCount(0, "Novel")).toBe(0);
    // Under its step, a count rounds to the nearest ten.
    expect(roundWordCount(434, "Novel")).toBe(430);
  });
});

describe("the layouts", () => {
  it("are rows every writer reads, one per id", () => {
    // Keyed by id and nothing else: a row carries no copy of its own key.
    expect(Object.keys(LAYOUTS).sort()).toEqual([...LAYOUT_IDS].sort());
  });

  it("set both manuscripts by Shunn's rule and differ only in their face", () => {
    const { font: modernFont, ...modern } = LAYOUTS.manuscriptModern;
    const { font: classicFont, ...classic } = LAYOUTS.manuscriptClassic;
    expect(modernFont).toBe("tinos");
    expect(classicFont).toBe("courierPrime");
    expect({ ...modern, margins: null }).toEqual({ ...classic, margins: null });
    expect(modern).toMatchObject({
      manuscript: true,
      size: 12,
      lineHeight: 2,
      indent: 0.5 * INCH,
      indentOpeners: true,
      sceneGlyph: "#",
      runningHead: true,
    });
    for (const page of PAGE_SIZE_IDS)
      expect(modern.margins(PAGE_SIZES[page])).toEqual({
        top: INCH,
        bottom: INCH,
        inner: INCH,
        outer: INCH,
        mirrored: false,
      });
  });

  it("mirror a book's margins on a trim, wider at the spine", () => {
    const trade = LAYOUTS.book.margins(PAGE_SIZES.trade);
    expect(trade.mirrored).toBe(true);
    expect(trade.inner).toBeGreaterThan(trade.outer);
    expect(LAYOUTS.book.margins(PAGE_SIZES.a4).mirrored).toBe(false);
  });

  it("give the review copy a wide outer margin to write in, and line numbers", () => {
    const margins = LAYOUTS.review.margins(PAGE_SIZES.letter);
    expect(margins.outer).toBeGreaterThan(2 * INCH);
    expect(LAYOUTS.review.lineNumbers).toBe(true);
    expect(LAYOUTS.review.footer).toBe("draft");
  });
});

describe("the running head (Shunn)", () => {
  it("is the author's surname, then the title", () => {
    expect(runningHeaderFor("Ada  King Lovelace ", " Salt Roads")).toBe(
      "Lovelace / Salt Roads",
    );
  });

  it("is the title alone when there is no author", () => {
    expect(runningHeaderFor("  ", "Salt Roads")).toBe("Salt Roads");
  });
});

describe("headings under a layout", () => {
  it("grow with their rank in a book, and stay text-sized in a manuscript", () => {
    const book = [1, 2, 3, 4].map(
      (level) => headingStyle(LAYOUTS.book, level).scale,
    );
    expect(book).toEqual([...book].sort((a, b) => b - a));
    expect(book[0]).toBeGreaterThan(1);
    expect(book[3]).toBe(1);
    for (const level of [1, 2, 3, 4, 5, 6])
      expect(headingStyle(LAYOUTS.manuscriptModern, level).scale).toBe(1);
  });

  it("centre the chapter titles and set the text-sized levels italic", () => {
    expect(headingStyle(LAYOUTS.book, 2)).toMatchObject({
      centred: true,
      italic: false,
    });
    expect(headingStyle(LAYOUTS.book, 3)).toMatchObject({
      centred: false,
      italic: false,
    });
    // In a manuscript every level is text-sized, so italic is what tells
    // level 4 from a paragraph there too.
    expect(headingStyle(LAYOUTS.manuscriptClassic, 4)).toMatchObject({
      centred: false,
      italic: true,
    });
  });

  it("size a title page's title by the same rule", () => {
    expect(titleScale(LAYOUTS.book)).toBeGreaterThan(1);
    expect(titleScale(LAYOUTS.manuscriptModern)).toBe(1);
  });
});

describe("alignment under a layout", () => {
  it("keeps the writer's centre and right everywhere", () => {
    for (const id of LAYOUT_IDS) {
      expect(alignFor("center", LAYOUTS[id])).toBe("center");
      expect(alignFor("right", LAYOUTS[id])).toBe("right");
    }
  });

  it("sets a justified paragraph ragged right where the layout is ragged by rule", () => {
    expect(alignFor("justify", LAYOUTS.book)).toBe("justify");
    expect(alignFor("justify", LAYOUTS.manuscriptModern)).toBe("left");
    expect(alignFor("justify", LAYOUTS.review)).toBe("left");
  });
});

describe("the page's geometry", () => {
  it("is the paper less its margins, and one body line", () => {
    const geometry = geometryOf("manuscriptModern", "letter");
    expect(geometry.width).toBe(612 - 2 * INCH);
    expect(geometry.height).toBe(792 - 2 * INCH);
    expect(geometry.line).toBe(24);
  });

  it("drops a novel's title halfway down and a story's a third, less the contact block", () => {
    const geometry = geometryOf("manuscriptModern", "letter");
    const novel = titleDrop(geometry, 4, true);
    const story = titleDrop(geometry, 4, false);
    expect(novel).toBeGreaterThan(story);
    expect(novel).toBe(Math.round(geometry.height / 2 - 4 * 12 * 1.2));
    // A contact block taller than the drop never pushes the title up.
    expect(titleDrop(geometry, 400, false)).toBe(geometry.line);
  });

  it("drops a chapter heading by the layout's fraction", () => {
    const geometry = geometryOf("manuscriptClassic", "a4");
    expect(chapterDrop(geometry)).toBe(Math.round(geometry.height / 3));
  });
});

describe("the default paper", () => {
  it("is Letter where Letter is the paper, A4 elsewhere", () => {
    expect(defaultPageSize("en-US")).toBe("letter");
    expect(defaultPageSize("fr-CA")).toBe("letter");
    expect(defaultPageSize("en-GB")).toBe("a4");
    expect(defaultPageSize("it")).toBe("a4");
  });
});
