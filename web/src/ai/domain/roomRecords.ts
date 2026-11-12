// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What the rooms keep on a chat: the editorial revision plan, the drafting
// room's memory and the beta reader's reading.

// ── The editorial revision plan ──────────────────────────────────────────────

export const PLAN_PRIORITIES = ["must", "should", "could"] as const;

export type PlanPriority = (typeof PLAN_PRIORITIES)[number];

/** One thing the letter asks the writer to do, and whether it is done. */
export interface PlanItem {
  id: string;
  priority: PlanPriority;
  text: string;
  state: "open" | "done";
  /** The letter that asked for it. */
  turnId: string;
  /**
   * The editor's last word on it: the next letter in the same chat judges
   * the plan against the pages as they are then, reporting each item
   * resolved, still open, or made worse. Absent until a letter has.
   */
  check?: PlanCheck;
}

export const PLAN_VERDICTS = ["resolved", "open", "worse"] as const;

export type PlanVerdict = (typeof PLAN_VERDICTS)[number];

export interface PlanCheck {
  verdict: PlanVerdict;
  /** One sentence: what the pages now do about it. The model's words. */
  note: string;
  /** The answer that judged it. */
  turnId: string;
}

export interface RevisionPlan {
  items: PlanItem[];
}

/** The bounds the codec holds a plan to, and the letter is asked within. */
export const PLAN_LIMITS = {
  /** Per priority: a plan of forty musts is not a plan. */
  perPriority: 5,
  item: 400,
  /** A check's note: one sentence, not a second letter. */
  note: 300,
} as const;

// ── The drafting room's memory ───────────────────────────────────────────────

/**
 * What the writer said they need, mid-draft: the room's opening question,
 * answered. Each is a sentence the model reads (`NEED_LINES`) and, for most,
 * a command that serves it (`NEED_COMMANDS`).
 */
export const DRAFTING_NEEDS = [
  "unstick",
  "what-if",
  "scene-plan",
  "words",
  "passage",
  "check",
] as const;

export type DraftingNeed = (typeof DRAFTING_NEEDS)[number];

export interface DraftingRecord {
  /** The need, and the Section it was given for: it holds only there. */
  need?: { kind: DraftingNeed; nodeId?: string; at: string };
  /**
   * The Sections this chat has drafted in, the most recent last: node ids
   * only, never prose. A chat back on a Section it knows starts from where
   * the writer stopped. The open Section, not the chat's attachment: a
   * drafting chat keeps its target while the writer moves.
   */
  visited?: string[];
}

/** The bounds the codec holds a drafting record to. */
export const DRAFTING_LIMITS = {
  /** A for-later note's passage, and its words, each (`forLaterNote`). */
  note: 300,
  /** Sections remembered as visited: a book's worth, not a history. */
  visited: 400,
} as const;

// ── The beta reader's reading ────────────────────────────────────────────────
//
// A stranger reading in order, one Section at a time, writing down what the
// reading was like and what they expect next, before the next Section is
// read. The horizon is what makes the predictions honest: a model that has
// read chapter thirty cannot predict at chapter five, and this one has not.

/** How much a Section held the reader, 1 (lost them) to 5 (could not stop). */
export type Attention = 1 | 2 | 3 | 4 | 5;

export interface JournalEntry {
  /** The Section read. */
  nodeId: string;
  readAt: string;
  /** What the reading was like, in the reader's own words. */
  reaction: string;
  /** What the reader believes is happening. */
  understanding: string;
  /** Questions put to the book, never to the writer. */
  questions: string[];
  /** Where the reader got lost. */
  confusion: string[];
  attention: Attention;
  /** The people the reader cares about now. */
  cares: string[];
  /** Would the reader read the next Section tonight, and why. */
  keepReading: boolean;
  why: string;
}

export type PredictionState = "open" | "confirmed" | "overturned";

export interface Prediction {
  id: string;
  text: string;
  /**
   * The Section the reader stood at when it wrote this down; absent for a
   * prediction made before the first page, from the back cover alone.
   */
  madeAt?: string;
  state: PredictionState;
  /** Where it was settled, and what the reader made of it. */
  resolvedAt?: string;
  note?: string;
}

export interface ReadingRecord {
  /** In reading order: one per Section read. */
  entries: JournalEntry[];
  /** In the order written. */
  predictions: Prediction[];
}

/** The bounds the codec holds a reading to, and the run asks within. */
export const READING_LIMITS = {
  entries: 400,
  predictions: 300,
  text: 1_200,
  line: 300,
  list: 6,
  name: 80,
} as const;
