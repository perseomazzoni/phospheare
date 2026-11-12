// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { MatterKind } from "./source";

// The plan: where the book splits, as detection proposes it and the writer
// confirms it. It is flat: a list of entries, each a contiguous range of
// paragraphs with a level, either starting its own Section (or Part) or
// joining the one above, so no choice the writer makes can produce a tree
// that breaks the Golden Rule. The tree is built once, from the finished
// plan, in `application/draft.ts`, and only there does the rule apply.
//
// Invariants, which detection keeps and the property tests check: entries
// are in order, contiguous (each starts where the last ended), and the last
// ends at the end of the book. Paragraphs before the first entry are empty
// ones the detection threw away.

/**
 * Where an entry stands in the book: a Part of the book, a chapter, or a
 * scene of the chapter above it. What each becomes, a Part or a Section and
 * how deep, is decided once, from the whole plan, by `layout`: a chapter is
 * a Section, unless its siblings must be Parts (the Golden Rule) or it holds
 * scenes.
 */
export type Level = "part" | "chapter" | "scene";

/** Where an entry's title came from, so the preview can say how. */
export type TitleSource =
  | "heading"
  | "pattern"
  | "typography"
  | "file"
  | "nav"
  | "separator"
  | "matter"
  | "generated"
  /** "{{row}} split {{n}}", named again when the row it was cut from is. */
  | "split"
  /** "{{chapter}}, scene {{n}}", named again when the chapter is. */
  | "scene"
  /** Typed by the writer in the list. */
  | "writer";

export interface PlanEntry {
  /** Stable while the entry exists: the preview's React key. */
  key: string;
  level: Level;
  /** The first paragraph, inclusive: the title line when there is one. */
  start: number;
  /** The end, exclusive. */
  end: number;
  /**
   * How many paragraphs at `start` are the title (the marker and a
   * subtitle), consumed.
   */
  titleSpan: number;
  /** The title detection found, or one made up for an untitled entry. */
  title: string;
  titleSource: TitleSource;
  /** Front or back matter, when the entry is one. */
  matter: MatterKind | null;
  /**
   * Whether it starts its own Section (or Part), or joins the row above:
   * its text, title line included, becomes the end of that one's. The
   * row's join button, never its tick.
   */
  starts: boolean;
  /**
   * Whether its text comes into the project at all: the row's tick. Every
   * row is the writer's to leave out, and every row is listed, so nothing
   * leaves without the writer seeing. A page the app would make for itself
   * starts left out, one tick away from coming in: the title page (its title
   * and author become the project's), the contents list (the structure is
   * the contents), the app's own export's facts page, an index, an EPUB's
   * off-spine extras (`linear="no"`: a cover, pop-up notes).
   */
  included: boolean;
  /**
   * An EPUB's extra outside the reading order, left out for that: the row
   * says so while it stays out, as a title page's says what it is.
   */
  offSpine?: boolean;
  /**
   * Who made the row, when detection did not: the writer, cutting a row in
   * two (joined back, it is gone again), or the scenes tick, which takes its
   * rows away when it is unticked.
   */
  origin?: "split" | "scenes";
  /** A scene's number in its chapter, for its made-up title. */
  scene?: number;
}

export type RuleId =
  | "headings"
  | "patterns"
  | "typography"
  | "pageBreaks"
  | "files"
  | "separator"
  | "none";

export const RULE_IDS: readonly RuleId[] = [
  "headings",
  "patterns",
  "typography",
  "pageBreaks",
  "files",
  "separator",
  "none",
];

export interface ImportOptions {
  /** The line the separator rule splits on ("###", "CHAPTER"). */
  separator: string;
}

export const DEFAULT_OPTIONS: ImportOptions = {
  separator: "",
};

/** One way of splitting the book, as the "Split by" menu offers it. */
export interface RuleCandidate {
  rule: RuleId;
  /** How well it fits; the highest wins on "auto". */
  score: number;
  /** False when the rule finds nothing in this book: shown, not offered. */
  available: boolean;
}

export interface ImportPlan {
  rule: RuleId;
  entries: PlanEntry[];
  options: ImportOptions;
  candidates: RuleCandidate[];
}
