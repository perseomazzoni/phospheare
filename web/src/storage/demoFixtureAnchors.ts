// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What the demo fixture promises to the checks that drive it. The demo book
// (`memoryProvider.ts`) is both a curated story and the only project an
// automated check can open without a native folder picker. A rewrite of the
// story that renames or removes a node a check selects on stops that check
// from checking anything, and the failure reads as a pile of regressions.
//
// Every piece of the fixture a check selects on lives here, the fixture is
// built from it, and `demoFixtureAnchors.test.ts` asserts the seeded files
// still satisfy it, so a rewrite that breaks an anchor fails a vitest file
// naming it instead of a Playwright locator that never resolves.
//
// Rewriting the story is expected. When an anchor stops fitting the book,
// change it here.

/**
 * The node the demo opens on (`lastOpened`), and the one every snapshot check
 * uses. It carries two snapshots whose adopted file is the `.01`, so the
 * snapshot table has a second row with something to compare against.
 *
 * Its diff against the earlier draft is three hunks: one word replaced inside
 * the opening paragraph, and the two paragraphs that exist only in the
 * adopted draft standing as block deletes.
 */
export const DEMO_COMPARISON = {
  /** The Section's title, as the tree renders it. */
  section: "The First Light",
  /** The snapshot rows, newest first. The adopted one is the `.01`. */
  adoptedRow: "The First Light 2",
  earlierRow: "The First Light 1",
  /** What `[+]` offers as the next default title. */
  nextRow: "The First Light 3",
  /** The adopted file's name, for the on-disk assertion. */
  adoptedFile: "section--the_first_light.EL6.01.md",
  /**
   * The one word the drafts disagree on: the hunk the accept checks apply.
   * `earlierWord` is in the older snapshot and is what an accept restores;
   * `adoptedWord` is in the manuscript.
   */
  earlierWord: "witnessed",
  adoptedWord: "noticed",
  /**
   * A phrase from the two adopted-only paragraphs. It must survive an accept
   * of the word hunk, which proves the accept applied that hunk alone.
   */
  adoptedOnlyPhrase: "This awareness spread",
} as const;

/**
 * A second node, under a Part the demo starts collapsed, whose earlier draft
 * differs from the adopted one by two words on a single line, a kept word
 * apart.
 *
 * That gives two hunks at word grain and one at paragraph grain, which pins
 * the granularity lens and keeps adjacent same-line tags independently
 * reachable.
 */
export const DEMO_SAME_LINE = {
  /** The Part it sits under: collapsed at boot, so a chevron opens it. */
  part: "Ketsu — Earthlings",
  section: "Equal in Existence",
  adoptedRow: "Equal in Existence 2",
  earlierRow: "Equal in Existence 1",
  /**
   * The two lines, which must differ by two words with at least one kept word
   * between them. `demoFixtureAnchors.test.ts` enforces both, because a copy
   * edit that changed a third word would silently turn a two-hunk pin into a
   * three-hunk one.
   */
  adoptedLine: "Only then can we truly call ourselves Earthlings.",
  earlierLine: "Only then might we rightly call ourselves Earthlings.",
  /**
   * The two differing words, named one by one because the checks assert on
   * them one at a time: accepting the first hunk must apply its own word and
   * leave the other alone. Each is distinct enough not to match
   * elsewhere on the page. The adopted line is curated prose and is not
   * changed to suit a test; only the earlier draft, seen only in the snapshot
   * table, is written for this shape.
   */
  firstWord: { adopted: "can", earlier: "might" },
  secondWord: { adopted: "truly", earlier: "rightly" },
} as const;

/** The first Part in the book; the typewriter checks add a Section to it. */
export const DEMO_FIRST_PART = "Ki — Void" as const;
