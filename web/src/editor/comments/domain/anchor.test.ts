// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  anchorForQuote,
  anchorFrom,
  place,
  refreshed,
  type Placement,
} from "./anchor";

/** The text a placement covers, failing the test when there is none. */
function covered(paragraphs: string[], at: Placement | null): string {
  if (!at) throw new Error("not placed");
  const startOf = (para: number) =>
    paragraphs.slice(0, para).reduce((sum, one) => sum + one.length + 1, 0);
  return paragraphs
    .join("\n")
    .slice(startOf(at.para) + at.start, startOf(at.endPara) + at.end);
}

/** An anchor that must exist, failing the test when it does not. */
function anchorOf(paragraphs: string[], at: Placement) {
  const anchor = anchorFrom(paragraphs, at);
  if (!anchor) throw new Error("no anchor");
  return anchor;
}

const chapter = [
  "The storm came at dawn over the harbour.",
  "Anna watched it from the window, and the harbour went grey.",
  "Nobody spoke.",
];

describe("anchorFrom", () => {
  it("keeps the passage and the text either side, across a paragraph boundary", () => {
    const anchor = anchorOf(chapter, { para: 1, start: 0, endPara: 1, end: 4 });
    expect(anchor.quote).toBe("Anna");
    // The prefix runs into the paragraph before, through its "\n".
    expect(anchor.prefix.endsWith("over the harbour.\n")).toBe(true);
    expect(anchor.suffix.startsWith(" watched it")).toBe(true);
    expect(anchor.prefix.length).toBeLessThanOrEqual(32);
  });

  it("leaves out the space a double-click takes with the word", () => {
    // "storm " — the word and the space after it, as Chrome selects it.
    const anchor = anchorOf(chapter, {
      para: 0,
      start: 4,
      endPara: 0,
      end: 10,
    });
    expect(anchor.quote).toBe("storm");
    expect(anchor.suffix.startsWith(" came")).toBe(true);
    expect(covered(chapter, place(anchor, chapter))).toBe("storm");
  });

  it("gives no anchor for a passage of only whitespace", () => {
    // "at dawn" has one space in the middle; an empty quote makes the whole
    // file unreadable on the next load.
    expect(
      anchorFrom(chapter, { para: 0, start: 17, endPara: 0, end: 18 }),
    ).toBeNull();
    expect(
      anchorFrom(chapter, { para: 0, start: 4, endPara: 0, end: 4 }),
    ).toBeNull();
  });
});

describe("place", () => {
  const storm = anchorOf(chapter, { para: 0, start: 4, endPara: 0, end: 9 });

  it("finds an unchanged passage where it was", () => {
    expect(place(storm, chapter)).toEqual({
      para: 0,
      start: 4,
      endPara: 0,
      end: 9,
    });
  });

  it("follows the passage when text is added before it", () => {
    const edited = [
      "Then, suddenly, the storm came at dawn over the harbour.",
      ...chapter.slice(1),
    ];
    const at = place(storm, edited);
    expect(at).toEqual({ para: 0, start: 20, endPara: 0, end: 25 });
    expect(covered(edited, at)).toBe("storm");
  });

  it("follows the passage into another paragraph when one is inserted above", () => {
    const edited = ["A new opening.", ...chapter];
    expect(place(storm, edited)).toEqual({
      para: 1,
      start: 4,
      endPara: 1,
      end: 9,
    });
  });

  it("tells a repeated passage apart by the text around it", () => {
    const harbour = anchorOf(chapter, {
      para: 1,
      start: 41,
      endPara: 1,
      end: 48,
    });
    expect(chapter[1].slice(41, 48)).toBe("harbour");
    // "harbour" is in paragraphs 0 and 1: the context picks the second.
    expect(place(harbour, chapter)).toEqual({
      para: 1,
      start: 41,
      endPara: 1,
      end: 48,
    });
  });

  it("finds a passage the writer edited inside, between its old surroundings", () => {
    const passage = anchorOf(chapter, {
      para: 0,
      start: 10,
      endPara: 0,
      end: 22,
    });
    expect(passage.quote).toBe("came at dawn");
    const edited = [
      "The storm arrived just before dawn over the harbour.",
      ...chapter.slice(1),
    ];
    const at = place(passage, edited);
    expect(at).not.toBeNull();
    expect(covered(edited, at)).toBe("arrived just before dawn");
  });

  it("is an orphan when the passage was rewritten whole", () => {
    const passage = anchorOf(chapter, {
      para: 1,
      start: 0,
      endPara: 1,
      end: 30,
    });
    const edited = [
      chapter[0],
      "Someone else entirely stood there.",
      chapter[2],
    ];
    expect(place(passage, edited)).toBeNull();
  });

  it("is an orphan when the passage was deleted", () => {
    const nobody = anchorOf(chapter, {
      para: 2,
      start: 0,
      endPara: 2,
      end: 13,
    });
    expect(place(nobody, chapter.slice(0, 2))).toBeNull();
  });

  // A passage may run across paragraphs and is found whole, and one inside
  // a paragraph never grows into the next.
  it("places a passage that runs across a paragraph boundary", () => {
    const anchor = { quote: "harbour.\nAnna", prefix: "", suffix: "" };
    const at = place(anchor, chapter);
    expect(at).toMatchObject({ para: 0, endPara: 1, end: 4 });
    expect(covered(chapter, at)).toBe("harbour.\nAnna");
  });

  it("finds an edited passage across paragraphs, but never grows one into the next", () => {
    const spanning = anchorOf(chapter, {
      para: 0,
      start: 28,
      endPara: 1,
      end: 12,
    });
    expect(spanning.quote).toBe("the harbour.\nAnna watched");
    const edited = [
      "The storm came at dawn over the old harbour.",
      "Anna watched it from the window, and the harbour went grey.",
      "Nobody spoke.",
    ];
    expect(covered(edited, place(spanning, edited))).toBe(
      "the old harbour.\nAnna watched",
    );
    // "dawn" inside the first paragraph; the text between its context runs
    // across a break, so it is not the same passage.
    const dawn = anchorOf(chapter, { para: 0, start: 18, endPara: 0, end: 22 });
    const swallowed = [
      "The storm came at noon",
      "over the harbour.",
      ...chapter.slice(1),
    ];
    expect(place(dawn, swallowed)).toBeNull();
  });
});

describe("anchorForQuote", () => {
  it("rebuilds a quote found here from the text as it is here", () => {
    // The source's context was shorter and ended differently; the anchor
    // takes this chapter's.
    const anchor = anchorForQuote(chapter, {
      quote: "harbour",
      prefix: "and the ",
      suffix: " went",
    });
    expect(anchor?.quote).toBe("harbour");
    expect(anchor?.prefix).toBe("hed it from the window, and the ");
    expect(covered(chapter, anchor && place(anchor, chapter))).toBe("harbour");
  });

  // A quote across paragraphs is kept whole, not cut at the first
  // paragraph's end.
  it("keeps a passage that ran across paragraphs whole", () => {
    const anchor = anchorForQuote(chapter, {
      quote: "the harbour.\nAnna watched",
      prefix: "dawn over ",
      suffix: " it",
    });
    expect(anchor?.quote).toBe("the harbour.\nAnna watched");
    expect(anchor?.suffix.startsWith(" it from")).toBe(true);
    expect(covered(chapter, anchor && place(anchor, chapter))).toBe(
      "the harbour.\nAnna watched",
    );
  });

  it("keeps a quote it cannot find as quoted — an orphan, never dropped", () => {
    const quoted = { quote: " the lighthouse ", prefix: "by", suffix: "." };
    expect(anchorForQuote(chapter, quoted)).toEqual({
      quote: "the lighthouse",
      prefix: "by ",
      suffix: " .",
    });
  });

  it("gives nothing for a quote of only whitespace", () => {
    expect(
      anchorForQuote(chapter, { quote: " \n  ", prefix: "", suffix: "" }),
    ).toBeNull();
  });
});

describe("refreshed", () => {
  it("is the same anchor when nothing moved, and a new one when the context did", () => {
    const storm = anchorOf(chapter, { para: 0, start: 4, endPara: 0, end: 9 });
    expect(
      refreshed(storm, chapter, { para: 0, start: 4, endPara: 0, end: 9 }),
    ).toBe(storm);
    const edited = [
      "Then the storm came at dawn over the harbour.",
      ...chapter.slice(1),
    ];
    const at = place(storm, edited);
    if (!at) throw new Error("not placed");
    const next = refreshed(storm, edited, at);
    expect(next).not.toBe(storm);
    expect(next.quote).toBe("storm");
    expect(next.prefix).toBe("Then the ");
  });
});
