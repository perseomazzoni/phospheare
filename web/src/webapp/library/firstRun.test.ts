// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { shelfFace, type ShelfFacts } from "./firstRun";

const shelf = (over: Partial<ShelfFacts>): ShelfFacts => ({
  cards: 0,
  visible: 0,
  listing: false,
  welcomeOpen: false,
  ...over,
});

describe("shelfFace", () => {
  it("welcomes a writer with no cards", () => {
    expect(shelfFace(shelf({}))).toBe("welcome");
  });

  it("draws nothing while the first listing runs", () => {
    expect(shelfFace(shelf({ listing: true }))).toBe("nothing");
  });

  it("keeps an open welcome through a later listing, so a rescan never blanks it", () => {
    expect(shelfFace(shelf({ listing: true, welcomeOpen: true }))).toBe(
      "welcome",
    );
  });

  // A folder with projects in it must not take the other place away.
  it("keeps an open welcome when a place fills the shelf", () => {
    expect(shelfFace(shelf({ cards: 3, visible: 3, welcomeOpen: true }))).toBe(
      "welcome",
    );
  });

  it("explains a shelf whose cards are all filtered away", () => {
    expect(shelfFace(shelf({ cards: 3, visible: 0 }))).toBe("emptyShelf");
  });

  it("draws the cards, also while a listing runs", () => {
    expect(shelfFace(shelf({ cards: 3, visible: 2 }))).toBe("cards");
    expect(shelfFace(shelf({ cards: 3, visible: 0, listing: true }))).toBe(
      "cards",
    );
  });
});
