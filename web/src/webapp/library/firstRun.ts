// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What the Library shows below its head.
//
// A shelf with no cards is the welcome: where the projects live, and the first
// project. Once drawn, the welcome stays open until the writer leaves it, for
// the reason `useWelcomeLatch` gives. A shelf whose cards are all filtered
// away is a different page, because the projects exist and a filter or a
// place explains their absence.

export type ShelfFace =
  /** No cards, or the welcome is still open: the places and a first project. */
  | "welcome"
  /** Cards exist and none is visible: a filter or a place explains it. */
  | "emptyShelf"
  | "cards"
  /** A listing is under way and nothing has been drawn yet. */
  | "nothing";

export interface ShelfFacts {
  cards: number;
  visible: number;
  listing: boolean;
  /**
   * The welcome was drawn and the writer has not left it (`useWelcomeLatch`).
   * Every rescan sets `listing`, so without it choosing a folder would blank
   * the page and remount it, dropping the place that just ticked.
   */
  welcomeOpen: boolean;
}

export function shelfFace(facts: ShelfFacts): ShelfFace {
  if (facts.welcomeOpen) return "welcome";
  if (facts.cards === 0) return facts.listing ? "nothing" : "welcome";
  if (facts.visible === 0 && !facts.listing) return "emptyShelf";
  return "cards";
}
