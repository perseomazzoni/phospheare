// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type {
  ChatKind,
  ChatRecord,
  MapShapeId,
  ModelDescriptor,
  PersonaDefinition,
  SearchAnswer,
  SourceDescriptor,
  TurnCommand,
  ModelRef,
} from "../domain/types";
import { ChatWrites } from "./chatWrites";
import { runTurn as runChatTurn, type TurnHost } from "./turnRun";
import { readerBoundary } from "./readerBoundary";
import { validateTurnFindings } from "./validateEvidence";
import * as locate from "./locateRun";
import * as maps from "./mapRun";
import * as reviews from "./reviewRun";
import type { ReviewHost } from "./reviewRun";
import * as summaries from "./summaryRun";
import * as verify from "./verifyRun";
import * as runs from "./workflowRun";
import type { WorkflowLaunch, WorkflowHost } from "./workflowRun";
import * as margin from "./commentAnswers";
import * as reader from "./readerRun";
import * as sources from "./sources";
import * as chatSearch from "./chatSearch";
import * as admin from "./chatAdmin";
import * as edits from "./turnEdits";
import * as room from "./roomMemory";
import * as listing from "./chatListing";
import {
  askWaiting,
  type AnswerText,
  type AssistantDependencies,
  type AssistantSnapshot,
  type ChatSearchDocument,
} from "./assistantTypes";
import { newId } from "./ids";
import {
  chatTitleFrom,
  reviewReads,
  reviewsFocused,
  titlesOf,
  wantsOf,
} from "./chatFacts";
import { now, runProblemOf, webOf } from "./runRecords";
// Re-exported: callers name these helpers from this module.
export {
  chatTitleFrom,
  newId,
  now,
  reviewReads,
  reviewsFocused,
  runProblemOf,
  titlesOf,
  wantsOf,
  webOf,
};
// The public shapes keep their address too.
export type {
  AnswerText,
  AnswerTextContext,
  AssistantDependencies,
  AssistantProblem,
  AssistantSnapshot,
  ChatSearchDocument,
} from "./assistantTypes";
export { askWaiting } from "./assistantTypes";
export type { MarginAnswer, MarginAsk } from "./commentAnswers";
import { chatSearched } from "../domain/webCitations";
import { sameTitles } from "../domain/citations";
import type { UnreadableChat } from "../ports";
import { PERSONAS, personaById, personasFor } from "../domain/personas";
import { composeVoice } from "../domain/voice";
import { QUEUE_LIMIT } from "./budgets";
import type { SearchPause } from "./searchAsk";
import { mapShapeOf } from "../domain/structureShapes";
import { QUESTION_ARGUMENT_MAX } from "../domain/types";
import { commandLine } from "../domain/skills";
import { appLog, describeError } from "../../log";

// ── The assistant aggregate ──────────────────────────────────────────────────
//
// One instance per open project. It owns the observable state (chats, active
// chat, queue, run flags) and the one serial write lane per chat; the
// workflows live in their own modules and take plain inputs. Every
// asynchronous continuation re-checks that the instance is still alive, so a
// disposed project cannot have a late model event write into a new one.

export class Assistant {
  private state: AssistantSnapshot = {
    chats: [],
    unreadable: [],
    activeChatId: null,
    running: false,
    preparing: false,
    error: null,
    queued: 0,
    saveFailedChatId: null,
  };
  private listeners = new Set<() => void>();
  private abort: AbortController | null = null;
  /**
   * The running answer's web-search pause, or null. Built inside the run and
   * cleared with it, so nothing it holds, the writer's refusal above all,
   * reaches a later run: no standing permission exists. Held here
   * only so `answerSearches` can find the ask in front of the writer.
   */
  private searchPause: SearchPause | null = null;
  private queue: QueuedAsk[] = [];
  private disposed = false;
  /** The margin's answers being written; leaving the project stops them. */
  private readonly marginRuns = new Set<AbortController>();
  /**
   * How a record reaches the file and the list (`chatWrites.ts`): the write
   * lane, the streaming preview and the list merge.
   */
  private readonly writes = new ChatWrites({
    save: (chat) => this.dependencies.artifacts.saveChat(chat),
    publish: (patch) => this.publish(patch),
    snapshot: () => this.state,
    gone: (chatId) => this.disposed || this.deletedChats.has(chatId),
  });
  /**
   * The single-run claim, held as an owned token rather than a boolean: a
   * frame that only awaited a holder must not be able to clear a claim the
   * queue's drain has since taken.
   */
  private claim: symbol | null = null;
  /**
   * Settles when the run holding the claim has released it, every write it
   * makes on the way out included. Undoing an edit stops the new run and
   * waits for this before restoring, or the aborted run's last write (its
   * turn marked interrupted) would land on top of the restored chat.
   */
  private settledRun: Promise<void> = Promise.resolve();
  /**
   * The one edit that can still be taken back: the chat as it was, and how
   * many of its turns the edit kept. Any new question withdraws it: undoing
   * then would silently drop what the writer asked since.
   */
  private rewind: edits.EditRewind | null = null;
  /** Chats deleted this session; a late continuation must not resurrect one. */
  private readonly deletedChats = new Set<string>();
  /** The in-flight first listing, which a second caller joins. */
  private initInFlight: Promise<void> | null = null;
  /**
   * The titles of the last catalogue listing that succeeded, by source id,
   * which `searchDocuments` reads an answer's citations as. Every listing
   * this class makes goes through `listSources`, which replaces the map
   * whole and never writes into it: a source deleted or renamed falls out
   * on the next listing, and a failed listing keeps the last one. Equal
   * titles keep the old map, so the search index compares it by identity;
   * a map written in place would compare equal to its own snapshot, and a
   * renamed source would keep its old title in the index.
   */
  private catalogueTitles: ReadonlyMap<string, string> = new Map();

  /**
   * The last search's documents per chat, reused for a chat the next search
   * finds unchanged: the search runs on every keystroke of the query, and
   * matching costs less than rebuilding every answer's text. Never
   * persisted.
   *
   * A chat is unchanged when it is the same record, since a record is
   * replaced, never written in place, when its turns, title or kind change.
   * The titles and the builder are the call's key: the builder decides what
   * an answer's text is, so one builder's documents are never served for
   * another. A chat that misses hands its last walk back as `previous`, so
   * an unchanged answer in it keeps its entry. Rebuilt every call, so a
   * deleted chat drops out at the next search.
   */
  private searchIndex: chatSearch.SearchIndex | null = null;

  // ── The features ───────────────────────────────────────────────────────────
  //
  // Each workflow module's public functions, bound once to this instance's
  // host. The hosts read the state through functions, so binding them at
  // construction sees every later change.

  /** The sources a chat reads and cites (`sources.ts`). */
  readonly sources: ReturnType<typeof sources.bind>;
  /** Creating, renaming and setting up chats (`chatAdmin.ts`). */
  readonly chats: ReturnType<typeof admin.bind>;
  /** Retry, edit and Undo of the writer's questions (`turnEdits.ts`). */
  readonly edits: ReturnType<typeof edits.bind>;
  /** The reviews: run, complete and resume (`reviewRun.ts`). */
  readonly reviews: ReturnType<typeof reviews.bind>;
  readonly maps: ReturnType<typeof maps.bind>;
  /** `/where` (`locateRun.ts`). */
  readonly locate: ReturnType<typeof locate.bind>;
  /** `/summarise` and the stored summaries (`summaryRun.ts`). */
  readonly summaries: ReturnType<typeof summaries.bind>;
  readonly verify: ReturnType<typeof verify.bind>;
  /** What the drafting and editorial rooms keep on a chat (`roomMemory.ts`). */
  readonly room: ReturnType<typeof room.bind>;
  /** A beta reader's `/read-on` and `/predict` (`readerRun.ts`). */
  readonly reader: ReturnType<typeof reader.bind>;
  /** A persona's answers in the margin (`commentAnswers.ts`). */
  readonly margin: ReturnType<typeof margin.bind>;

  constructor(private readonly dependencies: AssistantDependencies) {
    const workflow = this.workflowHost();
    this.sources = sources.bind(workflow);
    this.chats = admin.bind(this.chatAdminHost());
    this.edits = edits.bind(this.editHost());
    this.reviews = reviews.bind(this.reviewHost());
    this.maps = maps.bind(workflow);
    this.locate = locate.bind(workflow);
    this.summaries = summaries.bind(workflow);
    this.verify = verify.bind(workflow);
    this.room = room.bind(workflow);
    this.reader = reader.bind(workflow);
    this.margin = margin.bind({
      dependencies: this.dependencies,
      isDisposed: () => this.disposed,
      seedModel: () => this.seedModel(),
      listCatalogue: () => this.listSources(),
      marginRuns: this.marginRuns,
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): AssistantSnapshot => this.state;

  private publish(patch: Partial<AssistantSnapshot>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /**
   * Take the single-run claim, or null when a run or another claim holds it.
   * The token is the ownership proof: only its taker can release it.
   */
  private claimSlot(): symbol | null {
    if (this.disposed || this.state.running || this.claim !== null) return null;
    const token = Symbol("assistant-run-claim");
    this.claim = token;
    return token;
  }

  /** Release the claim, and only if this caller is still the holder. */
  private release(token: symbol): void {
    if (this.claim === token) this.claim = null;
  }

  /**
   * The one entry point every workflow run takes: `prepare` holds the claim,
   * then the run holds `running`. Resolves `rejected` for a refusal, made
   * before anything is written, asked or sent, and `started` once a run that
   * began has ended, whatever its ending.
   */
  private async runWorkflow<P>(
    launch: WorkflowLaunch<P>,
  ): Promise<"started" | "rejected"> {
    const prepared = await this.openRun(launch.prepare, launch.failure);
    if (prepared === null) {
      // A refusal ends the action, and a request queued behind the claim
      // must not wait for an unrelated run to start.
      this.drainQueue();
      return "rejected";
    }
    await this.holdRun(
      launch.chatId(prepared),
      (signal) => launch.run(prepared, signal),
      (error) => launch.stopped(prepared, error),
      launch.start?.(prepared),
      launch.end,
    );
    return "started";
  }

  /**
   * The entry point's first half: refuse while a run or a claim is live,
   * claim the slot before the first await, `prepare`, release. Null when
   * refused, and when the project closed while `prepare` awaited: `dispose`
   * cannot abort a run that has no controller yet, so nothing may start
   * after it.
   */
  private async openRun<P>(
    prepare: () => Promise<P | null>,
    failure: string,
  ): Promise<P | null> {
    if (this.state.running || this.claim !== null) {
      this.publish({ problem: { kind: "run-in-progress" } });
      return null;
    }
    const token = this.claimSlot();
    if (token === null) return null;
    let prepared: P | null = null;
    try {
      prepared = await prepare();
    } catch (error) {
      // A rejecting validation await is a refusal like any other: it speaks.
      appLog.warn("ai", "An assistant run was refused before it began.", {
        ...describeError(error),
      });
      runs.reportRunError(this.runSupport(), error, failure);
    } finally {
      this.release(token);
    }
    return this.disposed ? null : prepared;
  }

  /**
   * The entry point's second half: the run holds `running` for `chatId`, its
   * abort and `settledRun`, then gives the slot to the queue.
   *
   * A run withdraws an edit's Undo as a new question does: undoing during
   * it would stop it, and undoing after it would drop its answer.
   */
  private async holdRun(
    chatId: string,
    run: (signal: AbortSignal) => Promise<void>,
    stopped: (error: unknown) => void | Promise<void>,
    start: Partial<AssistantSnapshot> = {},
    end: Partial<AssistantSnapshot> = {},
  ): Promise<void> {
    this.rewind = null;
    let settle: () => void = () => undefined;
    this.settledRun = new Promise((resolve) => (settle = resolve));
    this.abort = new AbortController();
    const signal = this.abort.signal;
    // The claim is released before this publish, with no await between:
    // `running` is the run's exclusivity from here.
    this.publish({
      running: true,
      preparing: false,
      runningChatId: chatId,
      error: null,
      errorCode: null,
      problem: null,
      runProgress: undefined,
      ...start,
    });
    const began = Date.now();
    appLog.info("ai", "An assistant run started.", { chat: chatId });
    try {
      await run(signal);
      // A run may settle normally after Stop, keeping what it wrote.
      appLog.info("ai", "An assistant run finished.", {
        chat: chatId,
        stopped: signal.aborted || undefined,
        ms: Math.round(Date.now() - began),
      });
    } catch (error) {
      if (signal.aborted)
        appLog.info("ai", "An assistant run was stopped.", { chat: chatId });
      else
        appLog.error("ai", "An assistant run failed.", {
          chat: chatId,
          ...describeError(error),
        });
      await stopped(error);
    } finally {
      this.abort = null;
      this.publish({
        running: false,
        runningChatId: null,
        runProgress: undefined,
        ...end,
      });
      settle();
      this.drainQueue();
    }
  }

  /** Abort every run and refuse late writes; called when the project closes. */
  dispose(): void {
    this.disposed = true;
    this.queue = [];
    this.abort?.abort();
    this.abort = null;
    for (const run of this.marginRuns) run.abort();
    this.marginRuns.clear();
    this.claim = null;
    this.initInFlight = null;
    this.searchIndex = null;
  }

  /**
   * Load the chat list (`chatListing.ts`). Single-flight: two publishes
   * would race the unreadable list and the pending-review hydration.
   */
  async initialize(): Promise<void> {
    if (this.initInFlight) return this.initInFlight;
    const run = listing.listChats(this.workflowHost());
    this.initInFlight = run;
    try {
      await run;
    } finally {
      if (this.initInFlight === run) this.initInFlight = null;
    }
  }

  activeChat(): ChatRecord | null {
    return (
      this.state.chats.find((chat) => chat.id === this.state.activeChatId) ??
      null
    );
  }
  currentNode(): {
    id: string;
    title: string;
    kind: "part" | "section";
  } | null {
    return this.dependencies.defaultNode();
  }
  /**
   * The structure the project declares now, as a map's shape, or null. Read
   * from the same facts every run plans from, so the button and the run cannot
   * disagree.
   */
  declaredShape(): MapShapeId | null {
    return mapShapeOf(this.dependencies.projectFacts?.() ?? null);
  }
  /**
   * The models installed where this device's provider is pointed.
   *
   * A pass-through, because `dependencies` is private: a screen constructing
   * its own provider would reach past the port to name a backend.
   *
   * No `describeModel` beside it: one request per model for capability
   * flags belongs in the settings pane, where there is room to explain what
   * tools means.
   */
  listModels(signal: AbortSignal): Promise<ModelDescriptor[]> {
    return this.dependencies.model.listModels(signal);
  }
  /** The personas compatible with one chat kind. */
  personasForKind(kind: ChatKind): PersonaDefinition[] {
    return personasFor(kind);
  }
  /**
   * Every installed persona, whatever the chat. The picker lists them all and
   * marks the ones `personasForKind` would not offer, because a voice that
   * disappears when the chat changes kind reads as a voice that broke.
   * Offering is still `personasForKind`'s question: selection and the
   * refusal strip ask it.
   */
  allPersonas(): readonly PersonaDefinition[] {
    return PERSONAS;
  }
  /**
   * The display name of a persona by id, or `null` when the id names no
   * installed persona (a persona file renamed or removed after the chat was
   * written).
   *
   * Not `personasForKind`: that filters by `compatibleWith`, the right
   * question when offering a choice and the wrong one when naming what
   * answered.
   */
  personaName(id: string): string | null {
    return PERSONAS.find((one) => one.id === id)?.name ?? null;
  }

  listUnreadable(): UnreadableChat[] {
    return this.state.unreadable;
  }
  async deleteChatFile(file: string): Promise<void> {
    await this.dependencies.artifacts.deleteChatFile(file);
    this.publish({
      unreadable: this.state.unreadable.filter((one) => one.file !== file),
    });
  }

  /**
   * Neutral documents for the project search; no AI internals leak there.
   *
   * A source id is an AI internal, so `answerText` reads each cited id as
   * the transcript draws it: a search for "Capitolo 1" finds the answers
   * that cite it. It is the caller's, and required: the screen's Markdown
   * instance decides what a link is, and a default here would be a second,
   * non-inert answer to that.
   *
   * The titles are state React does not track: the search's memo does not
   * list them, and must not start to. It re-runs on every keystroke, so the
   * next keystroke reads a title map that moved.
   */
  searchDocuments(answerText: AnswerText): ChatSearchDocument[] {
    // Disposal is deferred a macrotask, so a keystroke can still reach a
    // dead instance: it gets nothing, and leaves nothing behind.
    if (this.disposed) return [];
    const { index, documents } = chatSearch.searchDocuments(
      this.searchIndex,
      this.state.chats,
      this.catalogueTitles,
      answerText,
    );
    this.searchIndex = index;
    return documents;
  }

  /**
   * The project's sources. Every catalogue listing this class makes goes
   * through here, so none skips the titles.
   */
  async listSources(): Promise<SourceDescriptor[]> {
    const sources = await this.dependencies.sources.list();
    const titles = new Map(sources.map((source) => [source.id, source.title]));
    // Replaced whole, never written into (`catalogueTitles`).
    if (!sameTitles(this.catalogueTitles, titles))
      this.catalogueTitles = titles;
    return sources;
  }

  /** The model a new chat inherits (`chatAdmin.ts`). */
  private seedModel(): ModelRef | null {
    return admin.seedModel(this.state.chats, this.dependencies.defaultModel);
  }

  /**
   * Continue an oversized conversation in a fresh chat. The new chat carries
   * a digest of the whole earlier conversation (one model call, disclosed)
   * and the same type and context choices; the earlier chat stays in the
   * project untouched: its history is never dropped, only left behind.
   * When no digest can be produced (no model, a failure), the new chat is
   * still created and the surface says the summary is missing.
   */
  async continueInNewChat(): Promise<ChatRecord | null> {
    if (this.state.running || this.claim !== null) {
      this.publish({ problem: { kind: "run-in-progress" } });
      return null;
    }
    // Claim the slot synchronously: the reader checks below await, and a
    // second call in that gap would start a rival continuation.
    const token = this.claimSlot();
    if (token === null) return null;
    try {
      const source = this.activeChat();
      if (!source) return null;
      // The reader boundary is checked before the digest exists: a chat whose
      // history already saw out-of-horizon material cannot be continued,
      // because the digest would carry the text `startTurn` refuses. Only a
      // reader pays the boundary's source sweep: this path consumes `ok`
      // alone, and a non-reader continuation has no horizon to enforce.
      if (source.kind === "alpha-reader" || source.kind === "beta-reader") {
        const boundary = await readerBoundary(this.workflowHost(), source);
        if (!boundary.ok) return null;
      }
      // The chat being continued decides, not an ambient default: this
      // creates a chat from another one, so its model is the one in hand.
      const model = source.preferences.model;
      let compaction: ChatRecord["compactedHistory"];
      // The digest is the source chat's run: a delete of that chat aborts it,
      // and Stop cancels the continuation rather than continuing without it.
      let cancelled = false;
      if (this.disposed) return null;
      if (model) {
        this.abort = new AbortController();
        const signal = this.abort.signal;
        this.publish({
          running: true,
          preparing: true,
          runningChatId: source.id,
          error: null,
          problem: null,
        });
        try {
          compaction = await admin.continuationDigest(
            this.chatAdminHost(),
            source,
            model,
            signal,
          );
        } catch (err) {
          cancelled = signal.aborted;
          // Disclosed: the new chat exists, the digest does not.
          if (!cancelled) {
            appLog.warn("ai", "A continuation digest could not be made.", {
              provider: model.providerId,
              model: model.modelId,
              ...describeError(err),
            });
            this.publish({ problem: { kind: "continuation-unavailable" } });
          }
        } finally {
          this.abort = null;
          this.publish({
            running: false,
            preparing: false,
            runningChatId: null,
          });
        }
      } else {
        this.publish({ problem: { kind: "continuation-unavailable" } });
      }
      if (cancelled || this.disposed || this.deletedChats.has(source.id))
        return null;
      const chat: ChatRecord = {
        schemaVersion: 1,
        id: newId(),
        title: `${source.title} · continued`,
        kind: source.kind,
        createdAt: now(),
        updatedAt: now(),
        preferences: { ...source.preferences },
        turns: [],
        ...(compaction ? { compactedHistory: compaction } : {}),
        // The searched latch carries over: the digest of a chat that
        // searched may carry a steered link.
        ...(chatSearched(source) ? { searchedBefore: true as const } : {}),
      };
      await this.writes.persist(chat, true);
      this.publish({ continuationOffered: false });
      return chat;
    } finally {
      this.release(token);
      // A send that queued behind the digest starts now, as it does after
      // every other run action.
      this.drainQueue();
    }
  }

  selectChat(chatId: string): void {
    if (this.state.chats.some((chat) => chat.id === chatId)) {
      this.publish({
        activeChatId: chatId,
        error: null,
        problem: null,
        conflictFile: null,
        // The offer belongs to the chat it was computed for; a switch clears
        // it until that chat's next save reports its own size.
        continuationOffered: false,
      });
      void listing.hydratePendingReview(
        this.workflowHost(),
        this.state.chats.find((one) => one.id === chatId) ?? null,
      );
    }
  }

  /**
   * Bring the writer to a search waiting on them: select the chat whose run
   * holds it, or nothing when no ask waits. The host never learns which chat
   * that is or what the ask holds.
   */
  revealPendingSearch(): void {
    const chatId = this.state.runningChatId;
    if (askWaiting(this.state) && chatId) this.selectChat(chatId);
  }

  /** A search hit: switch to the chat and mark the exact turn to reveal. */
  revealTurn(chatId: string, turnId: string): void {
    this.selectChat(chatId);
    this.publish({ revealTurnId: turnId });
  }

  clearRevealTurn(): void {
    this.publish({ revealTurnId: null });
  }

  async deleteChat(chatId: string): Promise<void> {
    const chat = this.state.chats.find((one) => one.id === chatId);
    if (!chat) return;
    // A deleted chat stays deleted: the in-flight run's cancellation must not
    // persist it back into the list or rewrite its file.
    this.deletedChats.add(chatId);
    // Dropped synchronously, before the abort: the abort's `finally` drains
    // at once, and the writer's queue count must settle before that. The
    // guard against a resurrected run is `deletedChats` itself (the drain
    // skips it), and the second call below runs after two awaits.
    this.dropQueued(chatId);
    // Abort this chat's run only: `stop()` would empty the queue with it and
    // silently drop another chat's queued request. The aborted run's
    // `finally` drains whatever remains.
    if (this.state.runningChatId === chatId) this.abort?.abort();
    // Settle the write lane before removing the file: a save already inside
    // `saveChat` would otherwise write the file back after the delete (the
    // lane's own re-checks skip a save that has not started, not one in
    // flight), and a queued save would land on a deleted file.
    await this.writes.settled(chatId);
    try {
      await this.dependencies.artifacts.deleteChat(chatId);
    } catch (err) {
      appLog.warn("ai", "A chat or its review files could not be deleted.", {
        chat: chatId,
        reviewRuns: chat.reviewRuns?.length ?? 0,
        ...describeError(err),
      });
      // A storage message is technical prose for logs (`StorageError`'s own
      // rule), and this layer may not import storage to translate it, so the
      // writer gets the one sentence the surface owns.
      this.publish({ problem: { kind: "delete-failed" }, error: null });
    }
    const chats = this.state.chats.filter((one) => one.id !== chatId);
    // Queued writes for a deleted chat are dead, and a second pass keeps the
    // count honest for anything queued during the awaits above.
    this.dropQueued(chatId);
    // Deleting a chat must not steal the surface from the one being read:
    // the active chat stays active unless it is the chat that was deleted.
    const activeChatId =
      this.state.activeChatId === chatId
        ? (chats[0]?.id ?? null)
        : this.state.activeChatId;
    this.publish({
      chats,
      activeChatId,
      runningChatId:
        this.state.runningChatId === chatId ? null : this.state.runningChatId,
      saveFailedChatId: this.writes.forget(chatId),
      pendingReview:
        this.state.pendingReview &&
        !chats.some((one) =>
          one.reviewRuns?.some(
            (review) => review.runId === this.state.pendingReview?.runId,
          ),
        )
          ? null
          : this.state.pendingReview,
    });
    if (this.state.activeChatId !== chatId)
      void listing.hydratePendingReview(this.workflowHost(), this.activeChat());
  }

  /** Re-persist a chat after a failed save; the answer is in memory. */
  async retrySave(chatId?: string): Promise<void> {
    const chat = chatId
      ? (this.state.chats.find((one) => one.id === chatId) ?? null)
      : this.activeChat();
    if (!chat) return;
    await this.writes.persist(chat);
  }

  stop(): void {
    this.dropQueue();
    this.abort?.abort();
  }

  /**
   * The writer's answer to the searches in front of them. False when
   * it is not an answer that ask can take; nothing is sent then, and the ask
   * stays pending. A pause lives only as long as its run, so no answer
   * carries over to a later one.
   */
  answerSearches(askId: string, answer: SearchAnswer): boolean {
    return this.searchPause?.answer(askId, answer) ?? false;
  }

  /** Whether an edited query repeats the writer's words. */
  searchQueryHoldsBookWords(askId: string, query: string): boolean {
    return this.searchPause?.holdsBookWords(askId, query) ?? false;
  }

  /** Cancel waiting requests only; the running one continues. */
  cancelQueued(): void {
    this.dropQueue();
  }

  /** Empty the queue, putting back every chat a waiting retry or edit cut. */
  private dropQueue(): void {
    const dropped = this.queue;
    this.queue = [];
    this.publish({ queued: 0 });
    for (const entry of dropped) edits.undoCut(this.editHost(), entry);
  }

  async send(
    text: string,
    quote?: string,
    command?: TurnCommand,
  ): Promise<"started" | "queued" | "rejected"> {
    // A new question withdraws an edit's Undo: taking the edit back now would
    // drop this question with it. Only once there is a question, started or
    // queued: a send refused before anything was asked (an over-long
    // `/how-to-say`) leaves the edit's Undo standing.
    const outcome = await this.ask(
      text,
      quote,
      () => {
        this.rewind = null;
      },
      command,
    );
    if (outcome === "queued") this.rewind = null;
    return outcome;
  }

  /**
   * `send` without touching the Undo: the entry point a retry and an edit
   * re-enter by.
   */
  private async ask(
    text: string,
    quote?: string,
    onStarted?: () => void,
    command?: TurnCommand,
    /** The chat before a retry's or an edit's cut, should it wait. */
    restore?: edits.Rewound,
  ): Promise<"started" | "queued" | "rejected"> {
    const chat = this.activeChat();
    if (!chat || !text.trim() || this.refusesArgument(command))
      return "rejected";
    if (this.state.running || this.claim !== null) {
      if (this.queue.length >= QUEUE_LIMIT) {
        this.publish({ problem: { kind: "queue-full" }, error: null });
        return "rejected";
      }
      this.queue.push({
        chatId: chat.id,
        text: text.trim(),
        quote,
        command,
        ...(restore ? { restore } : {}),
      });
      this.publish({ queued: this.queue.length, problem: null });
      return "queued";
    }
    return this.startTurn(chat.id, text.trim(), quote, onStarted, command);
  }

  /**
   * Whether a command's words are over their bound, published when they are.
   * One check for every way in (a send, a queued send, an edit), so none can
   * carry a longer description than the codec keeps on reload.
   */
  private refusesArgument(
    command: TurnCommand | undefined,
    // The refusal names what was too long: a description, or a claim.
    kind: "question-too-long" | "verify-too-long" = "question-too-long",
  ): boolean {
    if ((command?.argument?.length ?? 0) <= QUESTION_ARGUMENT_MAX) return false;
    this.publish({ problem: { kind, max: QUESTION_ARGUMENT_MAX } });
    return true;
  }

  private async startTurn(
    chatId: string,
    text: string,
    quote?: string,
    onStarted?: () => void,
    command?: TurnCommand,
  ): Promise<"started" | "rejected"> {
    // The claim belongs to the turn, not to `send`: the queue's drain enters
    // through this same entry point, and a `send` arriving while a drained
    // turn prepares (a `list()` against a remote is a real window) must queue
    // rather than start a rival run.
    if (this.state.running || this.claim !== null) return "rejected";
    const token = this.claimSlot();
    if (token === null) return "rejected";
    let settle: () => void = () => undefined;
    this.settledRun = new Promise((resolve) => (settle = resolve));
    try {
      return await this.runTurn(chatId, text, quote, onStarted, command);
    } finally {
      this.release(token);
      settle();
      this.drainQueue();
    }
  }

  /** The ordinary turn (`turnRun.ts`). */
  private async runTurn(
    chatId: string,
    text: string,
    quote?: string,
    onStarted?: () => void,
    command?: TurnCommand,
  ): Promise<"started" | "rejected"> {
    return runChatTurn(
      this.turnHost(),
      chatId,
      text,
      quote,
      onStarted,
      command,
    );
  }

  /**
   * What a turn may use of the aggregate. A host of functions, so every read
   * of the aggregate's state is explicit and the run can be driven without
   * one.
   */
  private turnHost(): TurnHost {
    return {
      dependencies: this.dependencies,
      writes: this.writes,
      deletedChats: this.deletedChats,
      snapshot: () => this.state,
      isDisposed: () => this.disposed,
      setAbort: (abort) => {
        this.abort = abort;
      },
      publish: (patch) => this.publish(patch),
      resolvePersona: (chat) => this.resolvePersona(chat),
      readerBoundary: (chat) => readerBoundary(this.workflowHost(), chat),
      searchPauseFor: (webSearch, run) =>
        runs.searchPauseFor(this.runSupport(), webSearch, run),
      releasePause: (pause) => runs.releasePause(this.runSupport(), pause),
      validateTurnFindings: (findings, used) =>
        validateTurnFindings(this.dependencies, findings, used),
    };
  }

  /**
   * What the shared run helpers use (`workflowRun.ts`), the pause slot with
   * it.
   */
  private runSupport(): runs.RunSupport {
    return {
      writes: this.writes,
      snapshot: () => this.state,
      isDisposed: () => this.disposed,
      isDeleted: (chatId) => this.deletedChats.has(chatId),
      publish: (patch) => this.publish(patch),
      pause: () => this.searchPause,
      setPause: (pause) => {
        this.searchPause = pause;
      },
    };
  }

  /** What a workflow run may use of the aggregate (`workflowRun.ts`). */
  private workflowHost(): WorkflowHost {
    return {
      dependencies: this.dependencies,
      writes: this.writes,
      snapshot: () => this.state,
      isDisposed: () => this.disposed,
      isDeleted: (chatId) => this.deletedChats.has(chatId),
      publish: (patch) => this.publish(patch),
      activeChat: () => this.activeChat(),
      resolvePersona: (chat) => this.resolvePersona(chat),
      declaredShape: () => this.declaredShape(),
      listCatalogue: () => this.listSources(),
      readerBoundary: (chat) => readerBoundary(this.workflowHost(), chat),
      publishWorkflowPair: (chatId, asked, answer, replacing) =>
        runs.publishWorkflowPair(
          this.runSupport(),
          chatId,
          asked,
          answer,
          replacing,
        ),
      endWorkflowRun: (chatId, error, words) =>
        runs.endWorkflowRun(this.runSupport(), chatId, error, words),
      refusesArgument: (command, kind) => this.refusesArgument(command, kind),
      searchPauseFor: (webSearch, run) =>
        runs.searchPauseFor(this.runSupport(), webSearch, run),
      releasePause: (pause) => runs.releasePause(this.runSupport(), pause),
      runWorkflow: (launch) => this.runWorkflow(launch),
    };
  }

  /**
   * What a retry, an edit or its Undo may use of the aggregate
   * (`turnEdits.ts`).
   */
  private editHost(): edits.EditHost {
    return {
      writes: this.writes,
      snapshot: () => this.state,
      activeChat: () => this.activeChat(),
      isDeleted: (chatId) => this.deletedChats.has(chatId),
      refusesArgument: (command, kind) => this.refusesArgument(command, kind),
      busy: () => this.state.running || this.claim !== null,
      queued: () => this.queue.length,
      rewind: () => this.rewind,
      setRewind: (rewind) => {
        this.rewind = rewind;
      },
      stop: () => this.stop(),
      settledRun: () => this.settledRun,
      ask: (text, quote, onStarted, command, restore) =>
        this.ask(text, quote, onStarted, command, restore),
      startVerify: (claim, quote, replacing) =>
        verify.startVerify(this.workflowHost(), claim, quote, replacing),
    };
  }

  private chatAdminHost(): admin.ChatAdminHost {
    return {
      ...this.workflowHost(),
      seedModel: () => this.seedModel(),
      firstListing: () => this.initInFlight,
    };
  }

  private reviewHost(): ReviewHost {
    return {
      ...this.workflowHost(),
      catalogueTitles: () => this.catalogueTitles,
      reportRunError: (error, fallback) =>
        runs.reportRunError(this.runSupport(), error, fallback),
      updatePreferences: (patch) => this.chats.updatePreferences(patch),
      selectChat: (chatId) => this.selectChat(chatId),
      send: (text, quote, command) => this.send(text, quote, command),
      drainQueue: () => this.drainQueue(),
      openRun: (prepare, failure) => this.openRun(prepare, failure),
      holdRun: (chatId, run, stopped, start, end) =>
        this.holdRun(chatId, run, stopped, start, end),
    };
  }

  /**
   * The chat's persona, composed for its room: the voice from the file, with
   * the chosen preset's obsessions, the referrals and the craft lenses around
   * it (`composeVoice`). Every prompt that says who is speaking reads
   * `instructions` from here, so none of them can speak in the bare voice
   * while another speaks as the professional.
   */
  private resolvePersona(chat: ChatRecord): PersonaDefinition | null {
    const persona = personaById(chat.preferences.personaId, chat.kind);
    if (!persona) return null;
    return {
      ...persona,
      instructions: composeVoice(
        persona,
        chat.kind,
        chat.preferences.preset,
        PERSONAS,
      ).instructions,
    };
  }

  /** Drop a chat's queued requests, announcing the new depth when it moved. */
  private dropQueued(chatId: string): void {
    if (!this.queue.some((entry) => entry.chatId === chatId)) return;
    this.queue = this.queue.filter((entry) => entry.chatId !== chatId);
    this.publish({ queued: this.queue.length });
  }

  private drainQueue(): void {
    if (this.disposed) return;
    // Nothing to drain while a run or a claim is live: the queue's next turn
    // starts when the holder releases, through `startTurn`'s own finally.
    // The deleted check is the guard a delete needs when its abort drains
    // mid-filter.
    if (this.state.running || this.claim !== null) return;
    const next = this.queue.shift();
    this.publish({ queued: this.queue.length });
    if (!next) return;
    if (this.deletedChats.has(next.chatId)) {
      this.drainQueue();
      return;
    }
    this.selectChat(next.chatId);
    void this.startTurn(
      next.chatId,
      next.text,
      next.quote,
      undefined,
      next.command,
    ).then((outcome) => {
      // Refused before it was asked (a named reference gone or too long by
      // now, no model, no reader horizon): nothing was written, so the chat a
      // retry or an edit cut goes back, and the words go back rather than
      // vanish.
      if (outcome !== "rejected" || this.deletedChats.has(next.chatId)) return;
      edits.undoCut(this.editHost(), next);
      this.publish({
        returned: {
          chatId: next.chatId,
          text: next.command ? commandLine(next.command) : next.text,
          ...(next.quote ? { quote: next.quote } : {}),
        },
      });
    });
  }
}

/** A question waiting for the running one to end. */
interface QueuedAsk {
  chatId: string;
  text: string;
  quote?: string;
  command?: TurnCommand;
  /**
   * A retry or an edit cuts its chat before it waits. Dropped from the queue
   * by Stop, it is put back from this: the turns before the cut, and the
   * digest the cut may have dropped.
   */
  restore?: edits.Rewound;
}
