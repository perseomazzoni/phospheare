// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The outcomes of the command workflows (`/verify`, `/where`, `/map`), their
// bounds, a turn's command and the stored summaries.
//
// Every bound here holds the stored answer as well as the run: the chat codec
// reads a replayed answer from the writer's own folder, which may be shared,
// and drops what is past a bound, so a run must never produce it.

import type { EvidenceAnchor } from "./findings";
import type { ModelRef } from "./models";
import type { CoverageReport } from "./review";

/**
 * What the sources say of a claim, as `/verify` reads them. Words
 * about the claim as the results read it, never true or false: the judge saw
 * at most nine excerpts, not the world. `inconclusive` is also what any
 * verdict becomes that no found quote earned.
 */
export const CLAIM_VERDICTS = [
  "plausible",
  "doubtful",
  "implausible",
  "inconclusive",
] as const;

export type ClaimVerdict = (typeof CLAIM_VERDICTS)[number];

/** How one cited result bears on the claim. */
export const CLAIM_STANCES = ["supports", "contradicts", "context"] as const;

export type ClaimStance = (typeof CLAIM_STANCES)[number];

/** One result the verdict rests on: its `web:N`, and what it shows. */
export interface ClaimSource {
  id: string;
  stance: ClaimStance;
  /**
   * The words the judge quoted, as the app found them in that result's
   * shown excerpt (`quoteIn`): never the model's own string, and absent when
   * they were not there.
   */
  quote?: string;
}

/**
 * A `/verify` that ran to its end: a judged verdict, or why there was
 * nothing to judge. Two shapes, never one with optional halves, so neither
 * the judge's enum nor a planted file can say "nothing found" with sources.
 *
 * - `unchecked`: no search came back; every one was declined or failed.
 * - `nothing-found`: at least one came back, with no results.
 */
export type VerifyOutcome =
  | {
      verdict: ClaimVerdict;
      sources: ClaimSource[];
      /** A suggested rewording, on a doubtful or implausible claim only. */
      fix?: string;
    }
  | { unjudged: "unchecked" | "nothing-found" };

/**
 * The most sources one verdict keeps: the judge reads at most nine
 * results, and a verdict that needs more than five to say so is a list, not
 * a reading.
 */
export const VERIFY_SOURCES_MAX = 5;

/** The longest suggested rewording kept, after its ids are stripped. */
export const VERIFY_FIX_MAX = 600;

/**
 * The longest reasoning a verdict may come with. Over it the answer is
 * invalid, never clipped: a cut reasoning can end mid-citation, or before
 * the sentence that said why.
 */
export const VERIFY_TEXT_MAX = 1_200;

/** A verdict was reached, whatever it was. */
export function judged(
  outcome: VerifyOutcome,
): outcome is Extract<VerifyOutcome, { verdict: ClaimVerdict }> {
  return "verdict" in outcome;
}

/**
 * The most passages one `/where` answer holds: the one the editor lands on
 * and five more, in book order.
 */
export const LOCATE_MAX_MATCHES = 6;

/**
 * The longest passage one workflow anchor may quote, a `/where` match or a
 * `/map` issue's quote, and the most context it may keep on either side. A
 * model that returns a whole paragraph as "prefix" would otherwise have its
 * right answer vanish the first time the chat is read back.
 */
export const ANCHOR_QUOTE_MAX = 2_000;

export const ANCHOR_CONTEXT_MAX = 200;

/**
 * What `/where` found.
 *
 * Only verified passages are here: each anchor's quote was found word for
 * word in the Section's text when the run read it. There is no "closest"
 * tier: how well a passage fits the writer's description is always the
 * model's own claim, and the one thing the app can prove is that the words
 * exist. Nothing verified is an empty list, said to the writer with the
 * coverage beside it, never a guess.
 *
 * Not `Finding`: a finding has a severity and a status the writer moves
 * through open, dismissed and resolved, and none of that applies to "here is
 * the scene you asked for".
 */
export interface LocateOutcome {
  /** Verified passages, in book order. At most `LOCATE_MAX_MATCHES`. */
  matches: EvidenceAnchor[];
  /** How much of the book the search could consider, and why not the rest. */
  coverage: CoverageReport;
}

/**
 * The structures `/map` can draw, by the stored `ShapeId`. `empty`
 * is the writer declaring none, and a map of it is the reading mode (shape
 * `null`), never a fifth shape. The table of what each one is lives in
 * `structureShapes.ts`; the ids are here so a stored answer can be checked
 * against them without importing it.
 */
export const MAP_SHAPE_IDS = [
  "threeact",
  "kishotenketsu",
  "freytagspyramid",
  "herosjourney",
] as const;

export type MapShapeId = (typeof MAP_SHAPE_IDS)[number];

/** A question command as the writer typed it (`ChatTurn.command`). */
export interface TurnCommand {
  /** The skill's command word, without its slash. */
  skill: string;
  /** What followed it, on a command that takes text. */
  argument?: string;
}

/**
 * The longest text a question command takes after its name (`/how-to-say`):
 * a description of what the writer means, not a passage. Refused
 * past it (`length > max`, the words given back), like `/where`'s sentence.
 * In the domain, not in `budgets.ts`, because the chat codec holds a
 * replayed `command` to it, and the codec imports only the domain.
 */
export const QUESTION_ARGUMENT_MAX = 500;

/** The most nodes one `/map` answer holds. */
export const MAP_NODES_MAX = 400;

/**
 * The most documents one named reference may stand for, as a chat file or a
 * plan may carry them. A name stands for one document, or a character's
 * sheet and arc.
 */
export const REVIEW_REFERENCES_MAX = 8;

/** The longest reference id a file may carry: `reference:` and a file name. */
export const REVIEW_REFERENCE_ID_MAX = 300;

/** One placement's reason: a line in a table cell at 300px. */
export const MAP_REASON_MAX = 160;

/** A node's title as the answer keeps it, to draw after a rename. */
export const MAP_TITLE_MAX = 300;

export type MapVerdict = "fits" | "partly" | "no";

/**
 * One Part or Section on the map.
 *
 * `standsIn` and `beat` are two different facts and never both present:
 * `standsIn` is the beat the app derived from the node's position, when the
 * top-level Parts line up one-to-one with the shape's beats; `beat` is the
 * one the model named when they do not, because a positional guess would put
 * Resolution on the second half of a split Confrontation. Read either
 * through `beatOf`.
 *
 * No verdict is a state, not a gap: the coverage says why (`unmapped`,
 * `too-large`, `unanswered`), or the map is a reading (shape `null`), or a
 * Hero's Journey Section enacts no stage, or a Section outside the Parts
 * sits on a map whose Parts line up with the beats. A `no`
 * the model named no beat for carries none: it said the node does the work
 * of no beat.
 */
export interface MapNode {
  sourceId: string;
  kind: "part" | "section";
  /** The Part it is drawn under, by source id, within the same answer. */
  parentId?: string;
  title: string;
  words?: number;
  standsIn?: string;
  beat?: string;
  /** Hero's Journey only: the Vogler stage the Section enacts. */
  stage?: string;
  verdict?: MapVerdict;
  /**
   * It does its beat's (or stage's) work, but after a node that comes later
   * in the shape. Worked out by the app, never the model's word.
   */
  outOfOrder?: true;
  /** The model's one line: why the verdict, or in reading mode what it does. */
  reason?: string;
  /** A verified quote showing an issue, when one verified (issues only). */
  anchor?: EvidenceAnchor;
}

/** How a map's units were placed: the one rule `planMap` answers. */
export type MapMode = "positional" | "named" | "hero" | "reading";

/** A shape the model says the scope would fit, or `none` of the four. */
export interface MapSuggestion {
  shape: MapShapeId | "none";
  /** The model's one line on why: its own words, drawn as text. */
  reason: string;
}

/**
 * Units placed on a shape's beats: the whole Structure, or a Part as
 * its own mini-arc. The app draws everything from `nodes`;
 * the model supplied only verdicts and reasons, and the quotes are verified
 * text. `mode` says how its units were placed.
 */
export interface MapArc {
  kind: "arc";
  mode: MapMode;
  /** `null`: no shape declared or typed, and the map is a reading. */
  shape: MapShapeId | null;
  /**
   * Whether the writer typed the shape after the scope: the question "Map
   * again" asks again. Whose shape it is, the header answers
   * against the live declaration.
   */
  shapeFrom: "typed" | "declared";
  scope: { kind: "structure" } | { kind: "node"; nodeId: string };
  /** The Structure the map was drawn from (`structureRevision`). */
  structureRevision: string;
  /** Book order. */
  nodes: MapNode[];
  coverage: CoverageReport;
  /**
   * Which shape the scope would fit, and why: asked on every map with no
   * shape typed, by one step that saw the whole arc (`mapFit`). Absent when
   * none was asked, or the step gave no usable answer; a missing note is
   * silent, never the app's own reason. "The declared shape fits" is
   * `suggestion.shape === shape`, never stored twice.
   */
  suggestion?: MapSuggestion;
}

/** The fewest characters a beat's start may be, short of a whole paragraph. */
export const MAP_START_MIN = 20;

/**
 * The most a beat's start may be: a first sentence, well under
 * `ANCHOR_QUOTE_MAX`, because a short exact copy is what an 8B model gets
 * right.
 */
export const MAP_START_MAX = 300;

/**
 * One beat of a Section map, in the shape's order, every beat once.
 * Three states, each carrying only what it can stand on:
 * - `found`: a start that verified in the Section, with where it falls
 *   (`at`, 0–1 of the text) and the app's order finding;
 * - `missing`: the model saying the beat is not in the Section, with its
 *   reason;
 * - `unanswered`: the model never answering for the beat, or naming a start
 *   that could not be located even after the one retry. No reason, no
 *   position, no button, so nothing unverified reaches the screen.
 */
export type MapPassage =
  | {
      beat: string;
      state: "found";
      at: number;
      anchor: EvidenceAnchor;
      reason: string;
      /** It begins before a beat the shape puts earlier: the app's finding. */
      outOfOrder?: true;
    }
  | { beat: string; state: "missing"; reason: string }
  | { beat: string; state: "unanswered" };

/**
 * One Section read as an arc of its own: where each beat of the
 * shape begins in its prose. Stale by the Section's content, never by the
 * Structure's fingerprint: a rename elsewhere changes nothing about this
 * Section's arc, and its button re-sends the whole Section.
 */
export interface MapPassages {
  kind: "passages";
  shape: MapShapeId;
  shapeFrom: "typed" | "declared";
  scope: { kind: "node"; nodeId: string };
  /** The `SourceText.revision` the starts verified against. */
  sectionRevision: string;
  /** The Section, alone. */
  nodes: MapNode[];
  passages: MapPassage[];
  coverage: CoverageReport;
  suggestion?: MapSuggestion;
}

/**
 * A Section read only for which structure it would fit: `/map
 * section` with no structure declared and none typed. No shape, so nothing
 * is placed: the note is the whole answer, and a run that got none writes no
 * block at all.
 */
export interface MapFitOnly {
  kind: "fit";
  scope: { kind: "node"; nodeId: string };
  sectionRevision: string;
  /** The Section, alone. */
  nodes: MapNode[];
  coverage: CoverageReport;
  suggestion: MapSuggestion;
}

/**
 * What `/map` wrote, by `kind`: an `arc` of units on beats, a
 * Section's `passages`, or a Section's `fit` alone. A block without `kind`
 * fails the codec and is dropped whole.
 */
export type MapOutcome = MapArc | MapPassages | MapFitOnly;

/** One original text a generated summary derives from. */
export interface SummarySource {
  nodeId: string;
  contentHash: string;
}

export interface SummaryMetadata {
  schemaVersion: 1;
  nodeId: string;
  scope: "node";
  sources: SummarySource[];
  /**
   * Which model generated it, as the caller chose it. The injected
   * provider's own `id` would be wrong once a composite routes, because the
   * composite's id is not the id of the provider that answered.
   */
  model: ModelRef;
  recipe: string;
  recipeRevision: string;
  language: string;
  generatedAt: string;
  /** Hash of the generated body; a mismatch means an edit outside the app. */
  bodyHash: string;
}

export type SummaryState = "missing" | "current" | "outdated" | "unverified";
