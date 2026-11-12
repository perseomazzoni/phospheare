// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The ports the assistant's application layer reaches the host through. An
// optional member answers by its absence: a host that lacks the capability
// leaves the member out, and the application reads the absence, never a stub
// that pretends.

import type {
  AiConnectionSettings,
  ChatRecord,
  EvidenceAnchor,
  KnownName,
  ModelDescriptor,
  ModelEvent,
  ModelRef,
  ModelRequest,
  ReaderScope,
  ReviewCheckpoint,
  SourceDescriptor,
  SourceText,
  SummaryMetadata,
  WebEngine,
  WebSearchOutcome,
} from "../domain/types";
import type { EntityGroups } from "../domain/entities";
import type { Judgements } from "../domain/judgement";
import type { SectionLedger } from "../domain/ledger";
import type { KeyReset } from "../domain/openrouterKey";
import type { RuleChecks } from "../domain/rules";
import type {
  ChapterComments,
  CommentProposal,
  MarginSearch,
  ProposalOutcome,
} from "../domain/comments";

export interface ProjectSources {
  list(): Promise<SourceDescriptor[]>;
  read(
    sourceId: string,
    range?: { start: number; end: number },
  ): Promise<SourceText>;
  /**
   * The manuscript sources a reader chat may know about, in reading order.
   * `{ kind: "whole" }` is every adopted node, a choice rather than "no
   * horizon": it tracks a book that grows, where naming the last node could
   * not. `{ kind: "through", nodeId }` stops at that node inclusively.
   * Reference, notes, summaries, snapshots and future manuscript are
   * excluded by construction in both.
   */
  allowedReaderSources(scope: ReaderScope): Promise<ReadonlySet<string>>;
  /**
   * The names the given sources record, for the sources among them
   * that are a character sheet or the world's Locations. Any other id, one
   * the catalogue does not offer, and one the writer barred give nothing.
   * The adapter still checks each id, because the port is the boundary and
   * not its callers.
   *
   * At most `CHARACTER_NAMES_MAX + 1` entries in all, the one past the most
   * a caller lists telling it there were more. Absent on a backend that knows
   * no templates; `/where` then routes by the titles in its summaries.
   */
  knownNames?(sourceIds: readonly string[]): Promise<KnownName[]>;
}

/**
 * The margin's comments, which live in the editor's own files and reach the
 * assistant only through here. Optional: a host with no margin, such as the
 * harnesses, offers none, and a turn reads no comments.
 */
export interface Comments {
  /**
   * How many of one persona's ghost comments may wait in a chapter at once:
   * the margin's own cap, told to the model so it chooses its best.
   */
  readonly cap: number;
  /**
   * The comments of these nodes, in the order asked. A node whose file is
   * missing has none; one that cannot be read is left out rather than
   * guessed at.
   */
  threadsOf(nodeIds: readonly string[]): Promise<ChapterComments[]>;
  /**
   * A persona's answer, added to a thread as that persona's entry, with the
   * web searches it made, if any. The margin keeps it plain and holds it to
   * its cap; a thread gone since it was read refuses.
   */
  reply(
    nodeId: string,
    threadId: string,
    personaId: string,
    body: string,
    searched?: readonly MarginSearch[],
  ): Promise<void>;
  /**
   * A persona's proposals for one chapter's margin, each answered in
   * order: placed as a ghost comment, or why not. The margin applies the
   * cap and the writer's earlier answers itself, so a proposal the writer
   * dismissed never comes back however it is asked.
   */
  propose(
    nodeId: string,
    personaId: string,
    proposals: readonly CommentProposal[],
  ): Promise<ProposalOutcome[]>;
}

/** A malformed assistant file the writer can still rescue. */
export interface UnreadableChat {
  file: string;
  message: string;
}

export interface ChatListing {
  chats: ChatRecord[];
  unreadable: UnreadableChat[];
}

export interface SaveOutcome {
  /**
   * Set when the file on disk had changed since this session last saw it and
   * a copy of those bytes was preserved before the save. Both copies survive;
   * neither is called a merge.
   */
  conflictFile?: string;
  /**
   * The record is approaching the hard file bound; the writer should be
   * offered Continue in a new chat.
   */
  nearLimit?: boolean;
}

export interface Artifacts {
  listChats(): Promise<ChatListing>;
  loadChat(id: string): Promise<ChatRecord>;
  saveChat(chat: ChatRecord): Promise<SaveOutcome>;
  deleteChatFile(file: string): Promise<void>;
  deleteChat(id: string): Promise<void>;
  saveReview(review: ReviewCheckpoint): Promise<void>;
  loadReview(runId: string): Promise<ReviewCheckpoint>;
  deleteReview(runId: string): Promise<void>;
  readSummary(
    nodeId: string,
  ): Promise<{ metadata: SummaryMetadata; body: string } | null>;
  writeSummary(
    nodeId: string,
    metadata: SummaryMetadata,
    body: string,
  ): Promise<void>;
  /**
   * The facts a source was last read to state (`domain/ledger.ts`), or null
   * when there is none or it will not parse: a ledger is derived data,
   * rebuilt by reading the source again, so an unreadable one is absent.
   * Keyed by source id; the adapter owns the file name.
   */
  readLedger(sourceId: string): Promise<SectionLedger | null>;
  writeLedger(ledger: SectionLedger): Promise<void>;
  /**
   * The fact check's kept verdicts (`domain/judgement.ts`), or null when
   * there are none or they will not parse. One file for the project, and
   * derived like a ledger: an unreadable one means every candidate is
   * asked again.
   */
  readJudgements(): Promise<Judgements | null>;
  writeJudgements(judgements: Judgements): Promise<void>;
  /**
   * The fact check's kept place and thing groups (`domain/entities.ts`), or
   * null when there are none or they will not parse. Derived like a ledger:
   * an unreadable one is asked again.
   */
  readEntities(): Promise<EntityGroups | null>;
  writeEntities(groups: EntityGroups): Promise<void>;
  /**
   * The rule check's kept answers (`domain/rules.ts`), or null when
   * there are none or they will not parse. Optional: a host that keeps none
   * asks every rule again, which costs requests and never correctness.
   */
  readRuleChecks?(): Promise<RuleChecks | null>;
  writeRuleChecks?(checks: RuleChecks): Promise<void>;
}

/**
 * Read-only entry points into a source on the host surface; neither mutates
 * prose.
 *
 * `reveal` lands on a validated quotation; `open` only opens the source, for
 * a citation or a read that names no passage. Two verbs rather than
 * an optional quote, so that "never reveal without a quote" stays a fact the
 * type enforces.
 */
export interface Evidence {
  /**
   * `withheld` only when `onlyIf` was given and answered false: the call
   * checks it after its own awaits and before it moves anything, because the
   * writer may have started typing while it looked the source up.
   *
   * `held` when the source is another Section and the open one holds unsaved
   * prose: the host asks the writer whether to keep it, and that question
   * speaks for itself, so nothing lands and nothing more is said.
   */
  reveal(
    anchor: EvidenceAnchor,
    options?: { onlyIf?: () => boolean },
  ): Promise<"selected" | "unavailable" | "withheld" | "held">;
  open(sourceId: string): Promise<"selected" | "unavailable">;
  /**
   * Start watching the editor, for a run that may move it when it ends
   * (`/where`). The predicate answers true while the writer has
   * neither edited nor switched file since this call.
   *
   * Opaque, so this layer never learns what the writer typed, only whether
   * they did. A run that finds the answer after the writer has moved on
   * leaves it as rows to click; the page never jumps under someone writing.
   */
  watch(): () => boolean;
}

/**
 * The most messages one model request may carry, its instructions included.
 * The OpenRouter request gate refuses a longer conversation outright, so the
 * application compacts history well before it.
 */
export const REQUEST_MESSAGES_MAX = 200;

export interface ModelProvider {
  readonly id: string;
  listModels(signal: AbortSignal): Promise<ModelDescriptor[]>;
  describeModel(ref: ModelRef, signal: AbortSignal): Promise<ModelDescriptor>;
  estimate(request: ModelRequest): Promise<{ tokens: number; exact: boolean }>;
  generate(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent>;
  /** A synthetic protocol check of whether this model emits a tool call. */
  probeTools?(ref: ModelRef, signal: AbortSignal): Promise<boolean>;
}

/**
 * One way to search the web, as the application reaches it.
 *
 * `engine` is where every query given to this object goes, fixed at
 * construction: the ask holds the object itself, so the engine a writer
 * approved and the one that sends cannot come apart, and no code path can
 * send an approved query somewhere else.
 *
 * `search` sends `query` as given and refuses, sending nothing, a query that
 * is not already `normaliseQuery`'s value. It never throws: a refusal, a
 * timeout and Stop are all outcomes, each saying whether the query reached
 * the engine.
 */
export interface WebSearchEngine {
  readonly engine: WebEngine;
  search(query: string, signal: AbortSignal): Promise<WebSearchOutcome>;
}

/**
 * The web search the host offers an Assistant. `provider()` and
 * `accountId()` are read live; `wikipedia` is one fixed engine.
 *
 * - `wikipedia` is the floor, for any account.
 * - `provider(model)` is the search of the run's own model: its provider,
 *   when it can search on that model and its key can answer now, by its
 *   key's verdict, or `null`. No other model stands in. A thunk because the
 *   verdict moves while the Assistant lives (a limit spent, a key renewed);
 *   the choice between the two stays in the application. Read it once per
 *   ask and hold what it returned: a second read may answer differently.
 * - `accountId()` is who is signed in at this instant, for the check at
 *   approval and before each send. The core cannot import `auth/`.
 *
 * Absent when the host offers no search.
 */
export interface WebSearch {
  wikipedia: WebSearchEngine;
  provider(model: ModelRef): WebSearchEngine | null;
  accountId(): string | null;
}

/**
 * Where this device's Ollama listens. Never synced, never project data. It
 * carries no model: a selection lives on the chat that made it.
 */
export interface ConnectionPreferences {
  load(): AiConnectionSettings;
  save(settings: AiConnectionSettings): void;
}

/**
 * Which remote models the writer has said are theirs. A vendor's catalogue
 * is too long for the model menu, so the writer chooses in Settings and the
 * menu lists the device's models plus this set.
 *
 * Account-scoped, not device-scoped: it travels with the account's settings
 * while Remote Storage is connected. `ConnectionPreferences` is per device,
 * because an endpoint is a fact about a machine.
 *
 * Empty means empty, never "all": a freshly connected provider contributes
 * nothing to the model menu until the writer has chosen in Settings.
 */
export interface RemoteModelPreferences {
  chosen(): readonly ModelRef[];
  choose(models: readonly ModelRef[]): void;
}

/**
 * A remote provider the deployment offers, connected or not, as a settings
 * surface needs it.
 *
 * The figures are the vendor's own reading of the writer's key, taken in
 * this tab. `upstreamHost` is the destination the surface names to the
 * writer, and is never branched on.
 */
export interface RemoteProviderStatus {
  providerId: string;
  /**
   * Whether a credential is held for this provider right now. A field rather
   * than an absent row, because a disconnected row is the only place a
   * writer can start connecting.
   */
  connected: boolean;
  upstreamHost: string;
  /**
   * The provider's own page listing the writer's keys. Every connection
   * mints a new key and removing one here leaves it valid there, so this is
   * where the writer deletes the ones the app does not hold.
   */
  keysUrl?: string;
  /**
   * The writer removed the key from this app in this tab and has not
   * connected since: it still works at the provider until deleted there.
   */
  keyRemoved?: boolean;
  accountLabel: string | null;
  /**
   * The expiry at the latest, possibly sooner. Never a promise about who
   * enforces it.
   */
  expiresAtOrBefore: string | null;
  limitUsd: number | null;
  /**
   * How often the spend limit renews; absent or `null` for a limit that
   * never does, so `limitUsd` is then the key's whole spend.
   */
  limitReset?: KeyReset | null;
  /**
   * What the writer must set on the provider's own consent screen, or the
   * connection is refused. Present even when nothing is connected, so the
   * surface can state the rule before sending anyone to a form; the numbers
   * come from the check that applies them.
   */
  required: KeyRequirements;
  /** Whether the key outlives the session on this device. */
  remembered?: boolean;
  /**
   * Why the last connection or reading left no usable key, as a code the
   * surface words; absent when nothing was refused.
   */
  refusal?: string | null;
}

/** The bounds a minted key must satisfy. */
export interface KeyRequirements {
  /** The most the key's own spend limit may be, in US dollars. */
  limitUsd: number;
}
