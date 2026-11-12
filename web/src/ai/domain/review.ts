// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A review's coverage, its segments and candidates, and the checkpoint a
// review resumes from.

import type { RunUsage } from "./chat";
import type { Finding } from "./findings";
import type { ModelRef } from "./models";
import type { ReviewScope, ReviewTask } from "./vocabulary";

/**
 * Why a source a run meant to inspect was not, as a value, the same shape as
 * `TOOL_NAMES` and for the same reason. The dock renders each one as
 * `dock.coverageSkip.<reason>`, and a coverage report is replayed from a
 * chat file in the writer's own, possibly shared, folder: `chatCodec` checks
 * a coverage's shape (`coverageFields`) but keeps a row whatever its reason,
 * so the render has to recognise a reason at runtime rather than trust the
 * union.
 * - `not-read`: a source a run meant to read and did not: a focused run's
 *   the model never opened, a Section `/where` ranked and did not reach, a
 *   wide review's summarised Section no candidate sent it to.
 * - `unmapped`: a Section with no summary to route by (`/where`, a wide
 *   review, `/map`).
 * - `not-in-budget`: a declared reference no step had room for.
 * - `too-large`: a Section that could not fit the window with what it had to
 *   be read beside (a wide review, `/map`).
 * - `unanswered`: a `/map` row the model never placed.
 * - `unextracted`: a reference or note a fact check opened and could not
 *   read into a ledger, because the model answered its facts in no shape, so
 *   its facts were held against nothing. Opening a file is not analysing it,
 *   and the row says so.
 * The rest are a review's source states short of `complete`
 * (`ReviewSourceState`), which `publishReview` copies across as they are; a
 * new source state fails to typecheck there until it has a reason here.
 */
export const COVERAGE_SKIP_REASONS = [
  "not-read",
  "pending",
  "invalidated",
  "failed",
  // Never guessed from the Section's title.
  "unmapped",
  // Left out whole, and named, so a review that ran without the Characters
  // sheet says so.
  "not-in-budget",
  "too-large",
  // The row was asked about again once; said, never guessed. Per Section,
  // as every row here.
  "unanswered",
  // A Section "Summarise n Sections" tried and the model could not summarise
  // for a reason that would repeat on the same model: too long for its
  // window, cut off, declined (`blocksSummary`). Written only by the
  // run whose summary failed, never text: a fixed value. Unlike `unmapped`
  // the button does not offer it again while the chat keeps that model, or the
  // click would spend the same failing request forever.
  "unsummarisable",
  "unextracted",
] as const;

export type CoverageSkipReason = (typeof COVERAGE_SKIP_REASONS)[number];

export function isCoverageSkipReason(
  value: unknown,
): value is CoverageSkipReason {
  return COVERAGE_SKIP_REASONS.includes(value as CoverageSkipReason);
}

export interface CoverageReport {
  intended: number;
  inspected: number;
  skipped: Array<{ sourceId: string; reason: CoverageSkipReason }>;
  /**
   * Whether the review did everything it set out to: every intended source
   * read, and, where a fact check ran, every candidate it held judged.
   * Reading can be whole while judgement is not: a review whose judge
   * answered in no shape must not publish `complete: true` over no findings,
   * which would read as a clean bill.
   */
  complete: boolean;
  /**
   * What the fact check judged, when a review ran one: how many candidates
   * its ledgers held, how many the judge answered in shape, and each one it
   * was asked about and could not answer, by identity, so the answer can
   * name the fact and where it stands. Absent on a run with no fact stage.
   */
  judgement?: JudgementCoverage;
}

export interface JudgementCoverage {
  candidates: number;
  judged: number;
  unjudged: UnjudgedFact[];
  /**
   * The candidates the check held and did not put to the judge this time,
   * past the cap on fresh questions (`JUDGE_MAX`), by identity, the first
   * `DEFERRED_NAMED` of them; `candidates − judged − unjudged.length` is the
   * whole count. Named, so the writer can see what waits, and the next check
   * continues from them: the kept verdicts cost nothing and count against no
   * cap. Absent when none was recorded.
   */
  deferred?: UnjudgedFact[];
  /**
   * The references and notes the check opened and could not read into a
   * ledger: their facts were held against nothing, and the review is not
   * complete while any is here. Section ids never appear here: a Section the
   * model could not read keeps its own source state.
   */
  unread?: string[];
}

/**
 * How many deferred candidates a coverage names. The rest are a count: a
 * plan and a chat turn are files a dock reads whole, not a work queue.
 */
export const DEFERRED_NAMED = 40;

/**
 * A candidate a fact check put to the judge and got no answer in shape
 * for, by every sample. Kept by identity, the fact and the sources its two
 * places stand in, never as a count alone, so a resume, the coverage and the
 * dock can all say which fact the writer must read.
 */
export interface UnjudgedFact {
  key: string;
  entity: string;
  attribute: string;
  sourceIds: string[];
}

export type ReviewSegmentState = "pending" | "complete" | "invalidated";

export interface ReviewSegment {
  id: string;
  sourceId: string;
  start: number;
  end: number;
  revision?: string;
  state: ReviewSegmentState;
  /**
   * The findings a step that fell short kept, on a segment still pending.
   * Its next step replaces them, so a resumed pass never holds them twice.
   */
  findingIds?: string[];
}

/**
 * What a wide review holds per Section (or, for the segment sweep, per
 * source), and why one it meant to read was not. The states short of
 * `complete` are the coverage reasons, copied across as they are, so a state
 * added here fails to typecheck until it has a reason
 * (`COVERAGE_SKIP_REASONS`).
 */
export type ReviewSourceState =
  | "pending"
  | "complete"
  | "invalidated"
  | "failed"
  | "unmapped"
  | "not-read"
  | "too-large";

/** How many issues a wide review's map may send to the prose. */
export const REVIEW_CANDIDATES_MAX = 12;

/** One map step's nominations at most. */
export const REVIEW_NOMINATIONS_PER_STEP = 6;

/** How many Sections one nomination may name. */
export const REVIEW_CANDIDATE_SECTIONS_MAX = 4;

/**
 * A nomination's concern, in characters. Model text, fed back into the
 * verify step as data and stored in the plan in the writer's folder, so it
 * is one line and bounded, on the run and on the read.
 */
export const REVIEW_CONCERN_MAX = 300;

/**
 * One issue the map sent to the prose: which Sections to read together, and
 * the model's one-line reason: a lead, never evidence, and never published.
 */
export interface ReviewCandidate {
  id: string;
  concern: string;
  sourceIds: string[];
  state: "pending" | "complete" | "too-large";
  /** As on `ReviewSegment`: what a verify step that fell short kept. */
  findingIds?: string[];
}

/**
 * The resumable work plan for a review past one Section. It is a checkpoint
 * ledger, not a transcript: completed public findings live here until the
 * review publishes, and a resumed pass reuses the work whose sources have not
 * changed.
 *
 * Two methods, and the discriminant is what a resume dispatches on:
 * - `segments`: every source cut into windows, each read alone. Right for
 *   `/line-editing`, whose issues live inside a sentence.
 * - `sections`: the Sections read together: in one step when they fit, in
 *   batches beside the references for `/canon`, and otherwise mapped from
 *   their summaries to candidate issues, each verified against the prose of
 *   the Sections it names. `candidates` is `null` until a map has run; the
 *   path is decided again on every run, because edited Sections may stop
 *   fitting.
 */
interface ReviewCheckpointHeader {
  schemaVersion: 1;
  runId: string;
  chatId: string;
  task: ReviewTask;
  scope: ReviewScope;
  state: "planned" | "running" | "interrupted" | "complete" | "failed";
  /**
   * Which model planned this review. A checkpoint resumes only under the
   * same one, and a bare id could not say that: two vendors may both offer
   * `gpt-5`, and resuming across them would silently mix two models'
   * judgement inside one set of findings.
   */
  model: ModelRef;
  personaId: string;
  /**
   * The review answer this plan was started to replace (`completeReview`),
   * so a resume after a Stop still finishes that click, in the answer's
   * place and with its verdicts, instead of adding a second answer beside
   * it. A file's word: it names a turn only in the plan's own chat, and only
   * a review answer is ever replaced by it.
   */
  replaces?: string;
  recipe: string;
  recipeRevision: string;
  sources: Array<{
    sourceId: string;
    revision?: string;
    state: ReviewSourceState;
    /**
     * As on `ReviewSegment`, for the batches that read the Sections
     * together: what a batch that fell short kept, named on each of its
     * Sections. Batches are cut again on every run, so the next batch that
     * holds any of them replaces those findings.
     */
    findingIds?: string[];
  }>;
  findings: Finding[];
  usage: RunUsage;
  createdAt: string;
  updatedAt: string;
}

export interface SegmentsCheckpoint extends ReviewCheckpointHeader {
  method: "segments";
  segments: ReviewSegment[];
  /**
   * The characters each segment's step leaves for the references and the
   * clause that says how to read them: measured when the plan is
   * made, so the segments are cut that much narrower and no more, and the
   * most a step of this plan may carry beside its segment however the
   * references grow before it runs. 0 when there is nothing to attach.
   */
  referenceRoom: number;
}

export interface SectionsCheckpoint extends ReviewCheckpointHeader {
  method: "sections";
  candidates: ReviewCandidate[] | null;
  /**
   * What the last fact stage judged: written by the stage
   * that ran it, read by the publish for the coverage. Absent until a fact
   * stage has run, and on a task that runs none.
   */
  facts?: JudgementCoverage;
  /**
   * The documents the writer named: the plan checks against
   * these and the Editing brief, and nothing else it would read. Checked
   * again against the live catalogue on every run and resume. Here only: a
   * line sweep takes no reference.
   */
  references?: string[];
}

export type ReviewCheckpoint = SegmentsCheckpoint | SectionsCheckpoint;
