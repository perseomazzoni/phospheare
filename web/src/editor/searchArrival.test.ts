// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { commonmarkCodec } from "./engine";
import {
  arrivalAfter,
  evidenceOrdinal,
  evidencePassage,
  marksFor,
  selectionFor,
  type FindBarState,
  type SearchArrival,
} from "./searchArrival";
import type { ViewSearchState, ViewSelectionState } from "./views/view/port";

// Pins how an arrival marks the prose: it lands in the middle of the screen,
// and its marks belong to the one file it names.

const closed: FindBarState = {
  open: false,
  query: null,
  currentIndex: 0,
  caseSensitive: false,
  wholeWord: false,
  hyphensJoinWords: false,
};

const open: FindBarState = {
  open: true,
  query: "storm",
  currentIndex: 3,
  caseSensitive: true,
  wholeWord: true,
  hyphensJoinWords: true,
};

const arrival: SearchArrival = {
  kind: "search",
  file: "section--the_storm.EL3.01.md",
  query: "warning",
};

describe("marksFor", () => {
  it("marks nothing when nobody has asked for anything", () => {
    expect(
      marksFor(closed, null, "section--the_storm.EL3.01.md").query,
    ).toBeNull();
  });

  it("marks the words the writer arrived looking for", () => {
    expect(marksFor(closed, arrival, "section--the_storm.EL3.01.md")).toEqual({
      query: "warning",
      currentIndex: 0,
      caseSensitive: false,
      wholeWord: false,
      hyphensJoinWords: false,
      scrollTo: "center",
    });
  });

  it("lands an arrival in the middle of the screen, not at an edge", () => {
    // A writer arriving from the panel has not read this file yet, and words
    // dropped at the bottom edge of the viewport have no context above or
    // below them. The find bar keeps "nearest" because it steps through a
    // document already on screen, where a jump for a match two lines down is
    // the surface moving for nothing.
    expect(marksFor(closed, arrival, arrival.file).scrollTo).toBe("center");
    expect(marksFor(open, arrival, arrival.file).scrollTo).toBe("nearest");
  });

  it("stops marking the moment another file is open", () => {
    // The arrival's whole lifetime, and the reason it carries a file: no
    // effect to clear it, no flag to get wrong, and no way for one file's
    // marks to follow the writer into the next.
    expect(
      marksFor(closed, arrival, "section--opening.EL2.00.md").query,
    ).toBeNull();
  });

  it("is still marking when the writer was already in that file", () => {
    // Clearing on an `activeFile` change would have to know the change was
    // the arrival's own doing, and there is no change at all when the hit is
    // in the open file.
    expect(marksFor(closed, arrival, arrival.file).query).toBe("warning");
  });

  it("yields to the find bar, whole", () => {
    // The bar's ordinal and all three of its toggles come with its query. Two
    // queries marking one document at once leave no way to read off a screen
    // which marks mean what.
    expect(marksFor(open, arrival, arrival.file)).toEqual({
      query: "storm",
      currentIndex: 3,
      caseSensitive: true,
      wholeWord: true,
      hyphensJoinWords: true,
      scrollTo: "nearest",
    });
  });

  it("finds an arrival the way the panel found it, never the way the bar would", () => {
    // The bar's toggles are still set from the writer's last in-document
    // search. Marking with those could mark a different set than the one that
    // put the row on the screen, and the writer clicks a hit and lands on
    // nothing.
    const withStaleToggles: FindBarState = { ...open, open: false };
    const marks = marksFor(withStaleToggles, arrival, arrival.file);
    expect(marks.caseSensitive).toBe(false);
    expect(marks.wholeWord).toBe(false);
    expect(marks.hyphensJoinWords).toBe(false);
  });

  it("takes the ordinal it is given, for the arrival that will scroll to it", () => {
    expect(marksFor(closed, arrival, arrival.file, 2).currentIndex).toBe(2);
  });
});

describe("selectionFor", () => {
  const armed: ViewSelectionState = {
    text: "window",
    exactText: "the window",
    showRepetitions: true,
  };
  const searchWith = (query: string | null): ViewSearchState => ({
    query,
    currentIndex: 0,
    caseSensitive: false,
    wholeWord: false,
    hyphensJoinWords: false,
  });

  it("passes the selection through while no query is up", () => {
    // An open bar with an empty query is the same state, with no search
    // candidates to paint, so the register passes through and a still-live
    // selection's repetitions repaint when the query dies.
    expect(selectionFor(armed, searchWith(null))).toBe(armed);
    expect(selectionFor(armed, searchWith(""))).toBe(armed);
  });

  it("vacuates the selection register while the find bar has a query", () => {
    // Two registers over one word make the highlight pass throw: the second
    // register's candidates map onto nodes the first register's wraps have
    // already split. The vacated shape disarms the paint path
    // entirely, so no half-state survives.
    expect(selectionFor(armed, searchWith("window"))).toEqual({
      text: null,
      exactText: null,
      showRepetitions: false,
    });
  });

  it("vacuates for an arrival's live query too (the bar closed)", () => {
    // The arrival is search marks with the bar shut, the same register, so a
    // live selection yields to it too.
    expect(selectionFor(armed, searchWith("warning"))).toEqual({
      text: null,
      exactText: null,
      showRepetitions: false,
    });
  });
});

// The assistant's evidence arrives as one passage in its own mark.

const evidence: SearchArrival = {
  kind: "evidence",
  file: "section--the_storm.EL3.01.md",
  query: "An elephant mourns its dead.",
};

describe("an evidence arrival", () => {
  it("marks the one passage, exactly as written, in its own mark", () => {
    const marks = marksFor(closed, evidence, "section--the_storm.EL3.01.md");
    expect(marks).toMatchObject({
      query: "An elephant mourns its dead.",
      currentIndex: 0,
      caseSensitive: true,
      mark: "evidence",
      scrollTo: "center",
    });
  });

  // The painter marks only the current occurrence of an evidence passage, so
  // the ordinal is the place the answer lands on.
  it("marks the occurrence its anchor names", () => {
    expect(
      marksFor(closed, evidence, "section--the_storm.EL3.01.md", 2)
        .currentIndex,
    ).toBe(2);
  });

  it("gives way to the find bar while it is open", () => {
    expect(marksFor(open, evidence, "section--the_storm.EL3.01.md").mark).toBe(
      undefined,
    );
  });

  it("ends on an edit, Escape in the page and the find opening", () => {
    for (const event of ["edit", "escape", "find"] as const)
      expect(arrivalAfter(evidence, event)).toBeNull();
  });

  it("leaves a search arrival to its own search", () => {
    for (const event of ["edit", "escape", "find"] as const)
      expect(arrivalAfter(arrival, event)).toBe(arrival);
    expect(arrivalAfter(null, "edit")).toBeNull();
  });
});

describe("evidencePassage", () => {
  const doc = commonmarkCodec.parse(
    "A dog hopes to return home. An elephant *never* forgets its dead.\n\nA whale protects its young.",
  );

  it("reads a quote the way the surface shows it", () => {
    // The assistant quotes raw markdown; the prose shows the parsed text.
    expect(evidencePassage(doc, "An elephant *never* forgets its dead.")).toBe(
      "An elephant never forgets its dead.",
    );
  });

  it("refuses a quote that crosses paragraphs", () => {
    expect(
      evidencePassage(doc, "forgets its dead.\n\nA whale protects"),
    ).toBeNull();
  });

  it("refuses a quote the open document does not contain", () => {
    expect(evidencePassage(doc, "A cat ignores everyone.")).toBeNull();
    expect(evidencePassage(doc, "   ")).toBeNull();
  });
});

// A repeated quote is cited at one of its places, named by the raw-markdown
// context the anchor kept; the surface's text has no markup.
describe("evidenceOrdinal", () => {
  const doc = commonmarkCodec.parse(
    "No.\n\nShe ran to the *door*. No. Then silence.\n\nNo. The end.",
  );

  it("counts nothing when the quote does not repeat or no context is kept", () => {
    expect(evidenceOrdinal(doc, "Then silence.", { prefix: "x" })).toBe(0);
    expect(evidenceOrdinal(doc, "No.", {})).toBe(0);
  });

  it("finds the occurrence the prefix names, through the markup", () => {
    expect(
      evidenceOrdinal(doc, "No.", { prefix: "She ran to the *door*. " }),
    ).toBe(1);
  });

  it("finds the occurrence the suffix names", () => {
    expect(evidenceOrdinal(doc, "No.", { suffix: " The end." })).toBe(2);
  });

  it("reads context across a paragraph boundary", () => {
    // The raw file's blank line and the surface's paragraph break are the
    // same boundary, spelled differently.
    expect(
      evidenceOrdinal(doc, "No.", { prefix: "No. Then silence.\n\n" }),
    ).toBe(2);
  });

  it("goes to the first when the context matches nowhere", () => {
    expect(evidenceOrdinal(doc, "No.", { prefix: "Something else" })).toBe(0);
  });
});
