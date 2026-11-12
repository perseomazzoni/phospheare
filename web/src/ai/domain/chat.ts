// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A chat as it is stored: its preferences, its turns and its record.

import type { ContextUse, Finding, ToolReceipt } from "./findings";
import type { ModelFailureCode, ModelRef, TurnTrace } from "./models";
import type { CoverageReport } from "./review";
import type {
  DraftingRecord,
  ReadingRecord,
  RevisionPlan,
} from "./roomRecords";
import type { ChatKind, ReviewScope, ReviewTask } from "./vocabulary";
import type { WebSearchRecord } from "./webSearch";
import type {
  LocateOutcome,
  MapOutcome,
  TurnCommand,
  VerifyOutcome,
} from "./workflows";

/**
 * How much of the manuscript a reader chat may know about: the whole book, or
 * everything through one node inclusively. A discriminated union rather than
 * an optional node id, because "the whole manuscript" must be a real answer:
 * naming the last node stops meaning it once a chapter is added.
 */
export type ReaderScope =
  { kind: "whole" } | { kind: "through"; nodeId: string };

export interface ChatPreferences {
  personaId: string;
  /**
   * The persona's focus in this chat, a `PersonaPreset.id`. Absent, or one
   * the persona does not offer in this room, reads as the persona's first
   * preset for the room (`presetFor`): a preset is a focus, not a boundary,
   * so a stale one falls back rather than refusing the chat.
   */
  preset?: string;
  /**
   * The model this conversation answers with, and the one place a selection
   * is stored. Two stores consulted by two chains could disagree, so
   * one model answers while the model menu names another; one store
   * makes that unrepresentable.
   *
   * `null` means this chat has no model yet: a new chat with nothing to
   * inherit from. The model menu offers setup rather than pretending.
   */
  model: ModelRef | null;
  targetNodeId?: string;
  /**
   * Absent means the writer has not chosen, and a reader chat with no scope
   * is refused rather than defaulted, because defaulting either way is how a
   * boundary fails open.
   */
  readerScope?: ReaderScope;
  pinnedSourceIds: string[];
  reviewTask?: ReviewTask;
  reviewScope?: ReviewScope;
  /**
   * The documents the writer named for this chat's review (`/canon Marta`):
   * the ids of the set the name stands for. Written by the run the
   * parse started and cleared by every review without one, so it never
   * supplies a fresh run's reads; checked again against what the review may
   * name on every turn that reads it.
   */
  reviewReferences?: string[];
  /**
   * Where the chat's Mode dragbar sits, 0 (Creative) to 1 (Standard): the one
   * stored fact behind both its temperature and its reasoning effort
   * (`domain/mode.ts`). Beside the model for the model's reason: two answers
   * in one conversation asked for differently are not comparable. Absent is
   * the middle. Read through `chatMode`, never directly: the chat file is the
   * writer's, and a hand-edited value must not reach a provider.
   */
  mode?: number;
}

export interface RunUsage {
  /** Summed over every request the run made: what it cost, not how full. */
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /**
   * Part of `inputTokens`: the prompt the provider served from its cache,
   * summed like it. A tool loop re-sends its context on every step, and this
   * is what tells a re-read book from a new one. Absent when no step reported
   * it: unknown is not 0.
   */
  cachedInputTokens?: number;
  durationMs?: number;
  steps: number;
  /**
   * How much of the window the run's largest single request filled: its
   * prompt plus what it wrote, as the panel's context reading shows it. Not
   * `inputTokens`, which sums every step, so a run that read three sources
   * would read as three windows' worth.
   */
  contextTokens?: number;
  /** The window that run was sized against: the model's own, or the default. */
  contextWindow?: number;
}

/** Another chat an answer offers to open (`route.ts`). */
export interface ChatRoute {
  kind: ChatKind;
  /** A reader's horizon: the node id of the last Section it reads. */
  through?: string;
}

export interface ChatTurn {
  id: string;
  runId?: string;
  role: "user" | "assistant";
  text: string;
  quote?: string;
  /**
   * The command the writer typed, on a question a command asked for them:
   * `/summarise`, `/how-to-say when you feel you cannot do
   * something`. `text` is what the model was sent, the skill's rubric and
   * the argument after it, and stays what Retry and history send; this is
   * what the bubble shows and what Edit offers, since the writer never
   * typed the rubric. Kept by the codec only while the skill still composes
   * `text` from it, so it can never show one thing and send another.
   */
  command?: TurnCommand;
  createdAt: string;
  outcome: "complete" | "interrupted" | "failed";
  /**
   * Why a failed turn failed, kept on the turn so a reload does not lose it.
   *
   * The live state's copy is gone after a reload, and without the code the
   * transcript can say a run failed but not what to offer: `key-expired`
   * gets a button that mints a new key, `credit-exhausted` a link to the
   * vendor, and everything else a plain retry.
   *
   * Absent on a turn that did not fail. A turn with `outcome: "failed"` and
   * no code gets the plain retry.
   */
  errorCode?: ModelFailureCode;
  /**
   * How the answer was reached, step by step: the model's working, the prose
   * it wrote beside a tool call, and which calls each step made — shown apart
   * from the answer in a fold the writer can open while it streams. Kept
   * with the chat so a reload does not lose it, and capped (`trace.ts`).
   *
   * Never the answer and never context: history, compaction, summaries,
   * evidence and tool calls all read `text` and `tools`, and none of them may
   * read this. A model's working can restate an instruction planted in the
   * writer's sources, and replaying it would hand the model that instruction
   * again in its own voice.
   */
  trace?: TurnTrace;
  /**
   * Wall-clock milliseconds from the moment the question was sent to the
   * run's ending, whatever the ending was: the number the live clock showed
   * when it stopped. Not `usage.durationMs`, which is the provider's own
   * compute time summed per step, a different fact in which a free model's
   * queue never shows. Absent when not recorded.
   */
  elapsedMs?: number;
  /**
   * Who answered, by id: never by name, and never by version. The
   * name is resolved against the installed set at render time, so renaming a
   * persona reaches every message it ever wrote instead of leaving old turns
   * signed with a name that exists nowhere.
   */
  personaId?: string;
  model?: ModelRef;
  sources?: ContextUse[];
  tools?: ToolReceipt[];
  findings?: Finding[];
  usage?: RunUsage;
  coverage?: CoverageReport;
  /** Set on the turn a full review produced, so Resume can find its plan. */
  review?: {
    runId: string;
    task: ReviewTask;
    scope: ReviewScope;
    /** The documents the review was named against. */
    references?: string[];
  };
  /** What `/where` found, on the turn that answered it. */
  located?: LocateOutcome;
  /**
   * The web searches this answer made or was refused, one row per attempt.
   * Written ahead of each send, so a reload mid-search still
   * says a query may have left.
   */
  web?: WebSearchRecord[];
  /**
   * On the answer to a `/verify`, from the moment it is written
   * ahead of the run, whatever the run then does. It makes the turn a
   * workflow's answer (`workflowAnswer`) while there is no verdict yet: an
   * interrupted or failed check has none, and must still never be edited
   * into a question.
   */
  verifies?: true;
  /**
   * A beta reader's journal turn: the Section it read (`/read-on`) or the
   * Section it stood at when it wrote down what it expects (`/predict`), with
   * no node for a prediction made before the first page. The turn's text is
   * the reader's own words; the structured half lives on the chat
   * (`ChatRecord.reading`), keyed by the same node, so the curve and the
   * ledger read one record.
   */
  journal?: { kind: "read" | "predict"; nodeId?: string };
  /**
   * What `/verify` settled, on the turn that answered it: a judged verdict
   * with the sources that earned it, or why nothing was judged. Only beside
   * `verifies` (the codec keeps it nowhere else).
   */
  verified?: VerifyOutcome;
  /** What `/map` placed, on the turn that answered it. */
  mapped?: MapOutcome;
  /**
   * The answer's quotations whose words are in nothing the run read
   * (`quoteCheck.ts`), as the answer wrote them. Absent when every one was
   * found, or when the turn was not checked.
   */
  unfoundQuotes?: string[];
  /**
   * How many signal pre-pass candidates the run handed the model, over the
   * attached prose and every Section it read. Absent where the room runs no
   * pre-pass or nothing was found, so a chat file says whether the persona's
   * detectors ran.
   */
  signalCandidates?: number;
  /**
   * The findings this answer left in the margin instead of the chat, as
   * ghost comments, chapter by chapter. Absent when it left none. A count,
   * never the comments: they live in the margin, and the writer's answers to
   * them are the margin's to keep.
   */
  commented?: { nodeId: string; count: number }[];
  /**
   * The chat this answer pointed the writer to, as a button: the
   * kind, and for a reader the Section it should read through. General and
   * Drafting only; checked against the book before it is kept (`route.ts`).
   */
  route?: ChatRoute;
  /**
   * The Part a `/summarise part` answer was composed for: its
   * `nodeId`, so the provenance line names it by its live title, and
   * `withheld` when some of its Sections were kept from the assistant. The
   * one field the answer adds; the account itself is the turn's prose, and
   * nothing else about it is stored anywhere.
   */
  summarisedPart?: { nodeId: string; withheld?: true };
}

/**
 * Whether a turn is a workflow's answer (`/where`, `/map`, `/summarise
 * part`, `/verify`, a beta reader's `/read-on` and `/predict`): the answer to
 * a run, not to a question, so its asking line is never edited into a
 * question for the model.
 *
 * `/verify` answers by its marker, not by its outcome: the others only exist
 * once they have an answer, while a check is written ahead of its run and
 * may end with no verdict at all.
 */
export function workflowAnswer(turn: ChatTurn): boolean {
  return (
    turn.located !== undefined ||
    turn.mapped !== undefined ||
    turn.summarisedPart !== undefined ||
    turn.verifies === true ||
    turn.journal !== undefined
  );
}

export interface ChatCompaction {
  recipe: string;
  recipeRevision: string;
  coversThroughTurnId: string;
  text: string;
  usage?: RunUsage;
}

export interface ChatRecord {
  schemaVersion: 1;
  id: string;
  title: string;
  kind: ChatKind;
  createdAt: string;
  updatedAt: string;
  preferences: ChatPreferences;
  turns: ChatTurn[];
  compactedHistory?: ChatCompaction;
  reviewRuns?: Array<{ runId: string; file: string }>;
  /**
   * Set on a chat continued from one that searched the web:
   * its digest may carry a link a page steered the model into writing, so
   * the chat starts with the inert-links latch on, as its parent ended. Only
   * ever `true` (the codec drops any other value), and carried down every
   * later continuation. On the chat, not on `compactedHistory`: an in-chat
   * compaction replaces that record, and the latch must outlive it.
   */
  searchedBefore?: true;
  /** A beta reader's journal and predictions ledger. */
  reading?: ReadingRecord;
  /** A drafting chat's remembered need and Sections. */
  drafting?: DraftingRecord;
  /** An editorial chat's revision plan, from its last letter. */
  plan?: RevisionPlan;
}
