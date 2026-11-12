// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The assistant's public shapes: the snapshot it publishes, the problems it
// refuses with, the dependencies a host hands it and the chat search's
// documents. Apart from the class, so a workflow module names them without
// importing the aggregate that imports it. `assistant.ts` re-exports them.

import type { ReviewReferenceProblem } from "./context";
import type { WebCitations } from "../domain/webCitations";
import type {
  ChatKind,
  ChatRecord,
  ChatTurn,
  ModelFailureCode,
  ModelRef,
  ProjectFacts,
  ReadRef,
  ReviewTask,
  RunActivity,
  SearchAsk,
} from "../domain/types";
import type {
  Artifacts,
  Comments,
  Evidence,
  ModelProvider,
  ProjectSources,
  UnreadableChat,
  WebSearch,
} from "../ports";

/**
 * Read-only because the Assistant hands the same frozen objects back on every
 * search that finds its chat unchanged: a caller that wrote to one
 * would be writing into the next keystroke's index.
 */
export type ChatSearchDocument = {
  readonly chatId: string;
  readonly turnId: string;
  readonly title: string;
  readonly kind: ChatKind;
  readonly speaker: "you" | "assistant";
  readonly text: string;
};

/**
 * What an answer's searchable text is built from: the project titles it may
 * cite (`citableTitles`, already narrowed) and its web citations, from the
 * one walk per chat that the screen reads too.
 */
export interface AnswerTextContext {
  titles: ReadonlyMap<string, string>;
  web: WebCitations;
}

/**
 * An answer as the chat search indexes it. Supplied by the caller, because
 * the one definition of what a link is lives with the renderer's Markdown
 * instance, which this layer cannot import. Do not define a second one here.
 */
export type AnswerText = (turn: ChatTurn, context: AnswerTextContext) => string;

export type AssistantProblem =
  | { kind: "reader-contaminated" }
  | { kind: "reader-horizon-missing" }
  | { kind: "persona-missing"; personaId: string }
  | { kind: "model-capability-missing"; capability: "tools" }
  | { kind: "review-outdated" }
  | { kind: "review-plan-too-large" }
  /**
   * A review against a named reference (`/canon Marta`) that cannot
   * be made as asked: a named document is gone or outside what the chat may
   * read, every one is empty, or they do not fit beside the prose. Refused,
   * never run against every reference instead. `references` is the set, when
   * it is still there to be named. Too large on a near review has its own
   * kind: its copy cannot offer a narrower scope, because there is none.
   */
  | {
      kind: ReviewReferenceProblem | "review-reference-too-large-section";
      references?: readonly string[];
    }
  | { kind: "continuation-unavailable" }
  | { kind: "run-in-progress" }
  | { kind: "queue-full" }
  | { kind: "delete-failed" }
  /** A review scoped to a Part or Section that is gone. */
  | { kind: "review-node-missing" }
  /**
   * `part` with no Part to read: the open Section sits at the top of the
   * Structure (or nothing is open). Two spellings, because the remedy the copy
   * offers is the next word up, and `/line-editing` offers no `structure`.
   */
  | { kind: "review-no-part" }
  | { kind: "review-no-part-no-structure" }
  /**
   * A wide review with no Section in it to read: an empty Part, a Structure
   * with no Sections yet. Refused, never published: a review of nothing
   * would say "no issues were found" about a check that was not made.
   */
  | { kind: "review-nothing-to-read" }
  /** A review of the open Section, asked with none open. */
  | { kind: "review-no-section" }
  /**
   * `/where` on a model that cannot call tools, named by its label: the
   * search is the app's, and it asks every question through a tool.
   */
  | { kind: "where-needs-tools"; model: string }
  | { kind: "where-too-long"; max: number }
  /**
   * `/verify` on a model that cannot read a tool result: the judge
   * reads the searches as tool messages, and a model whose template drops
   * them would judge pages it never saw.
   */
  | { kind: "verify-needs-tools"; model: string }
  | { kind: "verify-too-long"; max: number }
  /**
   * `/verify` with nobody signed in, or no search wired: a check searches
   * the web, and search works only for a signed-in writer.
   */
  | { kind: "verify-needs-account" }
  /**
   * A beta reader's journal refusals, each before anything is written or
   * sent. A reader that already knows the whole book cannot read on or
   * predict blind, and a Section is never journaled in part.
   */
  | { kind: "reading-whole-book" }
  | { kind: "reading-finished" }
  | { kind: "reading-journal-full" }
  | { kind: "reading-empty-section"; title: string }
  | { kind: "reading-too-long"; title: string; model: string }
  | { kind: "reading-needs-tools"; model: string }
  | { kind: "predict-nothing-read" }
  /**
   * A command that works from documents the writer has not written: none of
   * its `needs:` exists. Refused before anything is written or sent, so the
   * writer can compile them and come back.
   */
  | { kind: "reference-needed"; command: string; needs: readonly ReadRef[] }
  /**
   * A question command's words over their bound (`/how-to-say`), refused
   * before anything is sent or queued. The words are a description, not a
   * passage; a passage is a quote.
   */
  | { kind: "question-too-long"; max: number }
  /**
   * `/map`'s refusals, each before a request. `part` with the open Section
   * in no Part has two spellings, since "or nothing for the whole
   * manuscript" is a false remedy in a project a bare `/map` would refuse.
   * With no structure declared and no Part to read, a reading of bare
   * Sections would repeat their summaries, so it is refused.
   */
  | { kind: "map-no-part" }
  | { kind: "map-no-part-no-parts" }
  /**
   * A Section map's refusals, each before a byte leaves. A Section is never
   * mapped in pieces, so one too long is refused, naming the Part map it
   * could take instead only when that Part map would run.
   */
  | { kind: "map-no-section" }
  | { kind: "map-section-empty" }
  | { kind: "map-section-too-long"; model: string; offersPart: boolean }
  /**
   * A Section read for its fit alone got no usable answer: a fit-only answer
   * is its note, so there is nothing to keep, and no turn is written.
   */
  | { kind: "map-fit-failed"; model: string }
  /**
   * A Part with one child is no arc to place: refused, naming the
   * child and whether it is a Part or a Section, so the answer can say the
   * move that maps it instead.
   */
  | { kind: "map-one-unit"; title: string; unit: "part" | "section" }
  | { kind: "map-nothing-to-read" }
  | { kind: "map-no-parts" }
  | { kind: "map-needs-tools"; model: string }
  /**
   * `/summarise part`'s refusals. "Nothing to read" is checked before a
   * request and again after the summaries. A Section whose summary this run
   * could not write is named, so no account with a missing middle is ever
   * told. Summaries that together do not fit are refused, never clipped.
   */
  | { kind: "summarise-open-section"; title: string }
  | { kind: "summarise-no-part" }
  | { kind: "summarise-no-part-no-parts" }
  | { kind: "summarise-nothing-to-read" }
  | { kind: "summarise-section-failed"; title: string }
  | { kind: "summarise-part-too-large"; model: string };

export interface AssistantSnapshot {
  chats: ChatRecord[];
  unreadable: UnreadableChat[];
  activeChatId: string | null;
  running: boolean;
  /** A run is preparing context before its first inference step. */
  preparing: boolean;
  /**
   * What the run is doing at this instant. Null between runs. Published
   * rather than derived: "thinking" and "reading chapter four" are the same
   * `running: true` from outside.
   */
  activity?: RunActivity | null;
  error: string | null;
  errorCode?: ModelFailureCode | null;
  problem?: AssistantProblem | null;
  /**
   * How far a long run has got, for the one live line: a review's sources, or
   * the Sections `/where` is reading in full. The work is named so
   * the dock can say which count it is, and a total of 0 means the run has
   * not yet decided how much there is to do.
   */
  runProgress?: {
    work: "review" | "locate" | "summarise" | "map";
    complete: number;
    total: number;
  };
  /** A review plan waiting for an explicit Resume. */
  pendingReview?: {
    runId: string;
    task: ReviewTask;
    complete: number;
    total: number;
    /** The answer the plan replaces: its button waits while this is offered. */
    replaces?: string;
    /**
     * The reference the plan was named against: the panel offers no
     * Resume when the book does not hold it.
     */
    references?: readonly string[];
  } | null;
  /**
   * A chat whose last save failed, if any: the latest failure still
   * standing. Scoped by id: a failure in a background chat must not put a
   * Retry under a different one.
   */
  saveFailedChatId: string | null;
  /**
   * The active chat is approaching the hard file bound; the surface offers
   * Continue in a new chat with a compacted context.
   */
  continuationOffered?: boolean;
  /** A search hit asked for this turn to be revealed in the transcript. */
  revealTurnId?: string | null;
  /** The chat whose run is in flight, which the switcher marks. */
  runningChatId?: string | null;
  /**
   * Web searches the running answer proposed, waiting on the writer.
   * Nothing leaves until `answerSearches` answers it; null otherwise. The run
   * is paused under it: `activity` says `awaiting-writer`, published with it.
   * Whether one waits is `askWaiting`'s to say, never the activity's.
   */
  pendingSearch?: SearchAsk | null;
  /**
   * How long the running answer has waited on the writer so far:
   * published with each ask's settle, 0 outside a run. The stored clock
   * leaves the wait out; this lets the live one do the same through
   * `runElapsedMs`.
   */
  runWaitedMs?: number;
  queued: number;
  /**
   * A queued question that was refused when its turn came, given back:
   * the composer let go of it when it was queued, so the words exist
   * nowhere else. A new object each time, so the panel applies it once.
   */
  returned?: { chatId: string; text: string; quote?: string } | null;
  conflictFile?: string | null;
}

export interface AssistantDependencies {
  sources: ProjectSources;
  artifacts: Artifacts;
  model: ModelProvider;
  /**
   * The model a chat starts with when no earlier chat names one. Only a host
   * with a single model passes it; with several, a default is a guess at
   * which provider the writer meant.
   */
  defaultModel?: ModelRef;
  defaultNode: () => {
    id: string;
    title: string;
    kind: "part" | "section";
  } | null;
  /**
   * What the book is, read fresh on every turn.
   *
   * A thunk rather than a `ProjectSources` member: a title and a word target
   * are not sources, and widening that port would widen the one surface that
   * decides what the model may address.
   *
   * It is the one answer to "what language is this book in", summary
   * generation included; a second thunk would be a second copy of the fact.
   */
  projectFacts?: () => ProjectFacts | null;
  evidence?: Evidence;
  /**
   * The web search the host offers, where the chat kind allows search.
   * Absent means no search is offered at all.
   */
  webSearch?: WebSearch;
  /**
   * A reference document's name in the writer's interface language (the
   * catalogue section's label, or a group's plural, "Characters"), so a
   * persona asking for a document it needs names it as the writer's own
   * Guidebook does. Absent in harnesses, where the reference's own address
   * stands in.
   */
  referenceLabel?: (ref: ReadRef) => string;
  /**
   * A chat kind's name in the writer's interface language ("Revisione
   * editoriale"), so General points the writer at another chat by the name
   * they will find it under. Without it a model translates the prompt's own
   * word and names a chat that does not exist. Absent in harnesses: no names
   * are sent, and the instructions fall back to their English descriptions.
   */
  chatKindLabel?: (kind: ChatKind) => string;
  /**
   * The margin's comments. Absent where there is no margin (the harnesses
   * and the demo), and a turn then reads none.
   */
  comments?: Comments;
}

/**
 * Whether a web search waits on the writer. Every surface that marks the wait
 * reads this one predicate, so no two disagree; the activity carries words
 * only.
 */
export function askWaiting(
  snapshot: Pick<AssistantSnapshot, "pendingSearch">,
): boolean {
  return snapshot.pendingSearch != null;
}
