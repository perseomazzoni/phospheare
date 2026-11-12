// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The reviews: a focused review is a turn in its chat, handed to `send`; a
// wide review (a Part, a Part's title, the Structure) is a plan its run
// reads Section by Section, saved as it goes so an interrupted one can be
// resumed. Every refusal comes before anything is written or asked, and
// the runs take the aggregate's entry point through `ReviewHost`.

import type { AssistantSnapshot } from "./assistantTypes";
import type { WorkflowHost } from "./workflowRun";
import { chatTitleFrom } from "./chatFacts";
import { now, runProblemOf } from "./runRecords";
import { newId } from "./ids";
import { divertFindings } from "./comments";
import { ReviewReferenceError } from "./context";
import { resumable } from "./reviewProject";
import { executePlan, planWideReview, wideSections } from "./reviewWide";
import { ModelRunError } from "./runStep";
import { completeRun } from "./summaryRun";
import { namedByTitle } from "../domain/citations";
import { isPart, partFor } from "../domain/parts";
import { focusedReviewRequest } from "../domain/policy";
import { isReviewReferences, wideScope } from "../domain/scope";
import {
  commandLine,
  namesReference,
  offersReviewAgain,
  readsFor,
  skillForReviewTask,
} from "../domain/skills";
import {
  markUnsummarisable,
  namedSources,
  summaryBlockLifted,
  toSummarise,
} from "../domain/sourceView";
import { keptVerdicts } from "../domain/verdicts";
import type {
  ChatRecord,
  ChatTurn,
  ModelRef,
  PersonaDefinition,
  ReviewCheckpoint,
  ReviewScope,
  ReviewTask,
  SourceDescriptor,
  TurnCommand,
} from "../domain/types";
import { withHost } from "./features";

/** What a review uses of the aggregate beyond a workflow's host. */
export interface ReviewHost extends WorkflowHost {
  /** The titles of the last catalogue listing, by source id. */
  catalogueTitles(): ReadonlyMap<string, string>;
  reportRunError(error: unknown, fallback: string): void;
  updatePreferences(patch: Partial<ChatRecord["preferences"]>): Promise<void>;
  selectChat(chatId: string): void;
  /** The focused review's hand-off: a question in its chat. */
  send(
    text: string,
    quote?: string,
    command?: TurnCommand,
  ): Promise<"started" | "queued" | "rejected">;
  drainQueue(): void;
  /** The run entry point's first half (`Assistant.openRun`). */
  openRun<P>(
    prepare: () => Promise<P | null>,
    failure: string,
  ): Promise<P | null>;
  /** The run entry point's second half (`Assistant.holdRun`). */
  holdRun(
    chatId: string,
    run: (signal: AbortSignal) => Promise<void>,
    stopped: (error: unknown) => void | Promise<void>,
    start?: Partial<AssistantSnapshot>,
    end?: Partial<AssistantSnapshot>,
  ): Promise<void>;
}

/** A wide review every refusal let through. */
interface ReviewTarget {
  source: ChatRecord;
  persona: PersonaDefinition;
  model: ModelRef;
  /** What this run may read: the chat's boundary, narrowed to the scope. */
  allowed: ReadonlySet<string>;
  /**
   * The chat's whole boundary, for a sheet's chapter numbering: a Part
   * review reads its Part and numbers by the book.
   */
  book: ReadonlySet<string>;
  /** The Sections the review covers, in reading order. */
  sectionIds: string[];
  /** The listing the scope was taken from. */
  catalog: readonly SourceDescriptor[];
}

/** A plan a Resume may run, and what it may read. */
interface ResumeTarget {
  chat: ChatRecord;
  persona: PersonaDefinition;
  model: ModelRef;
  checkpoint: ReviewCheckpoint;
  allowed: ReadonlySet<string>;
  /** The chat's whole boundary, for chapter numbering. */
  book: ReadonlySet<string>;
}

/** What `runReview` writes on a chat before the run can refuse. */
type ReviewPreferences = Pick<
  ChatRecord["preferences"],
  "reviewTask" | "reviewScope" | "reviewReferences" | "targetNodeId"
>;

/**
 * Every field `runReview` writes, present even when unset, so putting it
 * back clears what the refused review set rather than keeping it.
 */
function reviewPreferencesOf(
  preferences: ChatRecord["preferences"],
): ReviewPreferences {
  return {
    reviewTask: preferences.reviewTask,
    reviewScope: preferences.reviewScope,
    reviewReferences: preferences.reviewReferences,
    targetNodeId: preferences.targetNodeId,
  };
}

/** The one place a checkpoint becomes the writer-visible progress shape. */
export function reviewProgressOf(
  checkpoint: ReviewCheckpoint,
): NonNullable<AssistantSnapshot["pendingReview"]> {
  return {
    runId: checkpoint.runId,
    task: checkpoint.task,
    // Settled, not only read: a Section the map left unread, or one too
    // long to read, is not work a resume still has to do.
    complete: checkpoint.sources.filter(
      (one) => one.state !== "pending" && one.state !== "invalidated",
    ).length,
    total: checkpoint.sources.length,
    ...(checkpoint.replaces ? { replaces: checkpoint.replaces } : {}),
    ...(checkpoint.method === "sections" && checkpoint.references
      ? { references: checkpoint.references }
      : {}),
  };
}

/**
 * The target a full review needs, validated and refused in one place: the
 * active chat (the caller owns the editorial-kind check), its persona, a
 * model, and a model that can call tools. A refusal publishes its own
 * problem and returns null, except the no-active-chat case, which returns
 * null silently because there is nothing to say it about.
 */
async function fullReviewTarget(
  host: ReviewHost,
  scope: ReviewScope,
  /**
   * The chat the run belongs to, when that is not simply the active one:
   * `completeReview` takes the target again after minutes of summaries,
   * and the writer may be in another chat by then.
   */
  chatId?: string,
): Promise<ReviewTarget | null> {
  const source =
    chatId === undefined
      ? host.activeChat()
      : host.isDeleted(chatId)
        ? undefined
        : host.snapshot().chats.find((one) => one.id === chatId);
  if (!source) return null;
  const persona = host.resolvePersona(source);
  if (!persona) {
    host.publish({
      problem: {
        kind: "persona-missing",
        personaId: source.preferences.personaId,
      },
    });
    return null;
  }
  const model = source.preferences.model;
  if (!model) {
    host.publish({ errorCode: "not-configured", error: null });
    return null;
  }
  const descriptor = await host.dependencies.model.describeModel(
    model,
    new AbortController().signal,
  );
  if (!descriptor.capabilities.tools) {
    host.publish({
      problem: { kind: "model-capability-missing", capability: "tools" },
    });
    return null;
  }
  const boundary = await host.readerBoundary(source);
  if (!boundary.ok) return null;
  // The same `wideSections` a resume re-derives, so a plan and its resume read the
  // same Sections, and neither reads past the scope.
  const wide = wideSections(boundary.catalog, boundary.allowed, scope);
  if (wide.sectionIds.length === 0) {
    host.publish({ problem: { kind: "review-nothing-to-read" } });
    return null;
  }
  return {
    source,
    persona,
    model,
    allowed: wide.allowed,
    book: boundary.allowed,
    sectionIds: wide.sectionIds,
    catalog: boundary.catalog,
  };
}

/**
 * Run `/<command>` at a scope. The nearest scope (the quote, or
 * the open Section) and a named Section are a turn in this chat that reads
 * the minimum it needs. `part`, a named Part and `structure` are a planned
 * run that reads their Sections together. `quote` is used only by
 * `current`, which is what reading "the quote" means.
 *
 * `references` is a reference the writer named: the ids of the set
 * the name stood for when the line was parsed. Checked again here, against
 * what this chat may read now and what the task reads, before anything is
 * written: a sheet deleted since the name was typed refuses, and never
 * becomes every reference. Only a task whose command takes a reference may
 * carry one at all.
 *
 * Resolves `"rejected"` when the review was refused rather than run
 * (before anything was written, or before its first step), so the panel
 * gives the writer's words back.
 */
export async function runReview(
  host: ReviewHost,
  task: ReviewTask,
  scope: ReviewScope,
  quote?: string,
  references?: readonly string[],
): Promise<"started" | "rejected"> {
  // Written by the checks below. The claim is released before anything
  // else is started: the focused hand-off is a `send`, which takes its own.
  let planned: ReviewScope = scope;
  let named = undefined as readonly string[] | undefined;
  // Each document once: a name is a set, and the files keep it as one.
  const asked = references && [...new Set(references)];
  let focusedChatId = null as string | null;
  let passage = undefined as string | undefined;
  // The chat's review as it was, put back if this one is refused: the
  // preferences are written before the run can refuse, and a review that
  // never ran must not leave the chat set up as it.
  let before = null as {
    chatId: string;
    preferences: ReviewPreferences;
  } | null;
  const prepared = await host.openRun(async () => {
    const chat = host.activeChat();
    if (chat && chat.kind === "editorial") {
      // What the turn is about is its target node, which `selectContext`
      // attaches: the open Section for the nearest scopes, never whatever
      // was open when the chat was made, and the named node for a title.
      let target: string | undefined;
      let missing = false;
      let noPart = false;
      let noSection = false;
      // What a wide run plans: `structure`, or the Part. A `part` is
      // resolved here, where the open node is known, and planned as the
      // `node` naming it, so a resume reads the Part that was meant.
      let wide: ReviewScope | null = null;
      switch (scope.kind) {
        case "current":
        case "section":
          target = host.dependencies.defaultNode()?.id;
          // With no Section open, a focused review would ask the model to
          // review "the source attached below" with nothing attached, and
          // the model would choose Sections from their summaries on its
          // own. A quoted passage is a target of its own; nothing else is.
          noSection =
            target === undefined && !(scope.kind === "current" && quote);
          break;
        case "part": {
          const open = host.dependencies.defaultNode();
          const part = open
            ? partFor(await host.listCatalogue(), open.id)
            : null;
          if (part) wide = { kind: "node", nodeId: part };
          else noPart = true;
          break;
        }
        case "node": {
          // Checked again here, not only when the title was typed: the node
          // can be deleted in between, and a scope that names nothing must
          // refuse, never quietly read something wider.
          const catalog = await host.listCatalogue();
          missing = !catalog.some((one) => one.nodeId === scope.nodeId);
          // A Part named by its title is the Part's every Section, read
          // together; its own file is only its heading.
          if (!missing && isPart(catalog, scope.nodeId)) wide = scope;
          else target = scope.nodeId;
          break;
        }
        case "structure":
          wide = scope;
          break;
        default:
          // A scope added to the union without a run here fails to
          // compile, rather than falling through to the whole Structure.
          scope satisfies never;
      }
      const unnamed =
        asked !== undefined && !(await nameable(host, chat, task, asked));
      if (missing) host.publish({ problem: { kind: "review-node-missing" } });
      else if (noSection)
        host.publish({ problem: { kind: "review-no-section" } });
      else if (unnamed)
        host.publish({ problem: { kind: "review-reference-missing" } });
      else if (noPart)
        host.publish({
          problem: {
            kind: skillForReviewTask(task)?.scopes.includes("structure")
              ? "review-no-part"
              : "review-no-part-no-structure",
          },
        });
      else {
        // A wide run's scope lives on its plan and its turn, never on the
        // chat: the preference is what makes the chat's next question a
        // focused review, and after a wide one it must be an ordinary
        // question. Cleared, not only left unwritten, or a focused scope
        // from before would outlive it.
        before = {
          chatId: chat.id,
          preferences: reviewPreferencesOf(chat.preferences),
        };
        await host.updatePreferences({
          reviewTask: task,
          reviewScope: wide ? undefined : scope,
          // Written only by the run a parse started, and cleared by every
          // review that named none: a name from an earlier review never
          // narrows this one, and a stored one never supplies a fresh
          // run's reads.
          reviewReferences: wide || !asked ? undefined : asked,
          ...(target ? { targetNodeId: target } : {}),
        });
        if (wide) {
          planned = wide;
          named = asked;
          return fullReviewTarget(host, wide);
        }
        focusedChatId = chat.id;
        if (scope.kind === "current" && quote) passage = quote;
      }
    }
    return null;
  }, "The review could not be started.");
  if (focusedChatId !== null) {
    // Backup for a delete landing between the preference save and `send`
    // (startTurn refuses a deleted chat too); without it the prompt would
    // land in whatever chat is active, and the action would end silently.
    if (!host.snapshot().chats.some((one) => one.id === focusedChatId)) {
      host.drainQueue();
      return "rejected";
    }
    // The review prompt belongs to the chat that asked for it: a switch
    // during the preferences save must not land the turn in another chat.
    if (host.snapshot().activeChatId !== focusedChatId)
      host.selectChat(focusedChatId);
    const what = passage ? "the quoted passage" : "the source attached below";
    // Sent as the command it is, so the writer's bubble and the chat's
    // title read "/continuity" rather than this English instruction, which
    // is what the model reads.
    const word = skillForReviewTask(task)?.command;
    const outcome = await host.send(
      focusedReviewRequest(task, what),
      passage,
      word ? { skill: word } : undefined,
    );
    if (outcome === "rejected") {
      await restoreReview(host, before);
      host.drainQueue();
    }
    // Queued is a run that will happen: only a refusal gives words back.
    return outcome === "rejected" ? "rejected" : "started";
  }
  if (!prepared) {
    // The wide target's refusals come after the preferences were written.
    await restoreReview(host, before);
    // A refusal ends the action, and a request queued behind it must not
    // wait for an unrelated run to start.
    host.drainQueue();
    return "rejected";
  }
  const { source } = prepared;
  // A plan too large, or a named reference with no room, is refused
  // before the first step: the caller gives the words back for those, as
  // for every refusal above, and never for a run that stopped or failed.
  // No count until the engine has one: its route, and so its steps, is
  // decided only once it has read the Sections.
  let refused = false as boolean;
  await host.holdRun(
    source.id,
    (signal) =>
      planAndRun(host, prepared, task, planned, signal, undefined, named),
    async (error) => {
      refused = runProblemOf(error) !== null;
      if (refused) await restoreReview(host, before);
      reportReviewStop(host, source.id, error);
    },
  );
  return refused ? "rejected" : "started";
}

/**
 * Plan a wide review of `prepared` and run it to its answer. The caller
 * holds the run (`running`, the abort) and reports what is thrown; a plan
 * that was made is marked interrupted first, so its Resume is offered.
 * `replacing` is the answer this one takes the place of (`completeReview`);
 * `references`, the reference the writer named, which the plan
 * carries so a resume checks against the same one.
 */
async function planAndRun(
  host: ReviewHost,
  prepared: ReviewTarget,
  task: ReviewTask,
  planned: ReviewScope,
  signal: AbortSignal,
  replacing?: string,
  references?: readonly string[],
  /** This run's summaries that failed for good (`completeReview`). */
  unsummarisable?: ReadonlySet<string>,
): Promise<void> {
  const { source, persona, model, allowed, book, sectionIds } = prepared;
  let plannedRunId: string | null = null;
  try {
    const dependencies = reviewDependencies(host);
    const checkpoint = await planWideReview(
      dependencies,
      {
        chat: source,
        task,
        scope: planned,
        model,
        personaId: persona.id,
        sectionIds,
        replaces: replacing,
        references,
        allowed,
      },
      signal,
    );
    plannedRunId = checkpoint.runId;
    host.publish({ pendingReview: reviewProgressOf(checkpoint) });
    // The writer's command goes in the moment the plan exists, not with the
    // answer minutes later: a long review under an empty chat reads as
    // nothing having been asked. It names a chat it opens, as a typed
    // command does. A Review again keeps the line it has.
    const word = skillForReviewTask(task)?.command;
    const asked: ChatTurn[] =
      word && replacing === undefined
        ? [
            {
              id: newId(),
              runId: checkpoint.runId,
              role: "user",
              text: commandLine({ skill: word }),
              command: { skill: word },
              createdAt: checkpoint.createdAt,
              outcome: "complete",
            },
          ]
        : [];
    // Onto the chat as it is now: the plan took a while, and what the
    // writer changed meanwhile is theirs (`ontoLatest`).
    await host.writes.persistRun(source, {
      ...source,
      updatedAt: now(),
      turns: [...source.turns, ...asked],
      title:
        asked.length > 0 && source.turns.length === 0
          ? chatTitleFrom(asked[0].text)
          : source.title,
      reviewRuns: [
        ...(source.reviewRuns ?? []),
        // Named for the writer, relative to the assistant folder: a review
        // run is memory, not a chat. Only a failure message reads
        // it; the adapter finds the file by `runId`.
        {
          runId: checkpoint.runId,
          file: `memory/review--${checkpoint.runId}.json`,
        },
      ],
    });
    const outcome = await executePlan(
      dependencies,
      checkpoint,
      persona,
      allowed,
      signal,
      book,
    );
    await publishReviewTurn(
      host,
      persona,
      {
        ...outcome,
        coverage: markUnsummarisable(outcome.coverage, unsummarisable),
      },
      replacing,
    );
  } catch (error) {
    if (plannedRunId && error instanceof ReviewReferenceError)
      await discardPlan(host, plannedRunId);
    else if (plannedRunId) await markReviewInterrupted(host, plannedRunId);
    throw error;
  }
}

/**
 * Put a chat's review preferences back as they were before a review that
 * was refused. A plain write: `updatePreferences` would clear
 * the very refusal this follows.
 */
async function restoreReview(
  host: ReviewHost,
  before: { chatId: string; preferences: ReviewPreferences } | null,
): Promise<void> {
  const chat =
    before && host.snapshot().chats.find((one) => one.id === before.chatId);
  if (!before || !chat) return;
  await host.writes.persist({
    ...chat,
    updatedAt: now(),
    preferences: { ...chat.preferences, ...before.preferences },
  });
}

/**
 * Take back a plan its named reference refused. The refusal comes
 * before the plan's first step (`executePlan` reads the set before any
 * Section), so the plan holds no work, and kept as interrupted it would
 * offer a Resume that could only refuse the same way. Best-effort: a file
 * that will not go is only an orphan the reload already tolerates, never a
 * second refusal to show.
 */
async function discardPlan(host: ReviewHost, runId: string): Promise<void> {
  if (host.snapshot().pendingReview?.runId === runId)
    host.publish({ pendingReview: null });
  const chat = host
    .snapshot()
    .chats.find((one) => one.reviewRuns?.some((run) => run.runId === runId));
  try {
    if (chat && !host.isDeleted(chat.id))
      await host.writes.persist({
        ...chat,
        updatedAt: now(),
        reviewRuns: chat.reviewRuns?.filter((run) => run.runId !== runId),
      });
    await host.dependencies.artifacts.deleteReview(runId);
  } catch {
    // Left as it is: an orphan the reload tolerates.
  }
}

/** How a wide review's run ends when it does not end in an answer. */
function reportReviewStop(
  host: ReviewHost,
  chatId: string,
  error: unknown,
): void {
  if (!(error instanceof ModelRunError && error.failure.code === "cancelled"))
    host.reportRunError(error, "The review was interrupted.");
  // A deleted chat's review was stopped by the delete, not the writer:
  // saying so would land under whichever chat is active now.
  else if (!host.isDeleted(chatId))
    host.publish({ error: "Review stopped.", errorCode: "cancelled" });
}

/**
 * Summarise the Sections a wide review could not consider, then run the
 * same review again in place of its answer. The map route's `unmapped` rows
 * are Sections it had no summary to route by.
 *
 * A click only, never started by a review itself: on a local model each
 * summary takes minutes. Everything comes from the answer `runId` names,
 * as the chat file holds it after `parseChat`: the task, the scope the plan
 * reviewed (the Part by its id, not whichever Part is open now), and only a
 * pair its command offers (`offersReviewAgain`). Every refusal a wide review
 * has applies before a single summary is written, and again before the
 * review. The Sections to summarise are the answer's rows ∩ the review's
 * scope now ∩ what is still unsummarised; a row is a request from a file,
 * never an address.
 *
 * Stop ends it and leaves the old answer where it was, with the summaries
 * already written.
 */
export async function completeReview(
  host: ReviewHost,
  runId: string,
): Promise<void> {
  await completeRun(
    host,
    async () => {
      const chat = host.activeChat();
      const answer = chat?.turns.find(
        (turn) => turn.runId === runId && turn.review !== undefined,
      );
      const review = answer?.review;
      if (
        chat?.kind !== "editorial" ||
        !review ||
        !wideScope(review.scope) ||
        !offersReviewAgain(review.task, review.scope)
      )
        return null;
      const scope = review.scope;
      if (
        scope.kind === "node" &&
        !isPart(await host.listCatalogue(), scope.nodeId)
      ) {
        host.publish({ problem: { kind: "review-node-missing" } });
        return null;
      }
      const target = await fullReviewTarget(host, scope);
      if (!target) return null;
      return {
        target,
        task: review.task,
        scope,
        references: review.references,
        chatId: target.source.id,
        model: target.model,
        // Less what this model already could not summarise, until the
        // chat asks another.
        nodes: toSummarise(
          answer.coverage,
          target.catalog,
          target.allowed,
          new Set(target.sectionIds),
          summaryBlockLifted(answer.model, target.model),
        ),
      };
    },
    async ({ task, scope, references, chatId }, signal, _failed, blocked) => {
      // Taken again, not reused: the summaries just written are sources the
      // scope taken before them does not hold, and the map reads only what
      // the scope allows. The writer may also have changed the model, the
      // persona or the Part while the summaries ran.
      host.publish({ runProgress: undefined });
      // The Part may have been dissolved while the summaries ran: the
      // refusal a fresh run gets, not "nothing to read".
      if (
        scope.kind === "node" &&
        !isPart(await host.listCatalogue(), scope.nodeId)
      ) {
        host.publish({ problem: { kind: "review-node-missing" } });
        return;
      }
      const again = await fullReviewTarget(host, scope, chatId);
      if (again)
        await planAndRun(
          host,
          again,
          task,
          scope,
          signal,
          runId,
          references,
          blocked,
        );
    },
    ({ chatId }, error) => reportReviewStop(host, chatId, error),
  );
}

export async function resumeReview(
  host: ReviewHost,
  runId: string,
): Promise<void> {
  await host.runWorkflow({
    prepare: () => resumeTarget(host, runId),
    failure: "The review could not be resumed.",
    chatId: ({ chat }) => chat.id,
    // The offer counts Sections; the run counts steps, which only the
    // engine knows, so nothing until it reports.
    start: ({ checkpoint }) => ({
      pendingReview: reviewProgressOf(checkpoint),
    }),
    run: async ({ persona, checkpoint, allowed, book }, signal) => {
      const outcome = await executePlan(
        reviewDependencies(host),
        checkpoint,
        persona,
        allowed,
        signal,
        book,
      );
      // A review-again's plan finishes its click: in place of the answer
      // it was started from, with its verdicts.
      await publishReviewTurn(host, persona, outcome, checkpoint.replaces);
    },
    stopped: async ({ chat }, error) => {
      // A deleted chat's run was stopped by the delete (`reportReviewStop`).
      if (!(
        error instanceof ModelRunError &&
        error.failure.code === "cancelled" &&
        host.isDeleted(chat.id)
      ))
        host.reportRunError(error, "The review could not be resumed.");
      if (error instanceof ReviewReferenceError) await discardPlan(host, runId);
      else await markReviewInterrupted(host, runId);
    },
  });
}

/** Every refusal a Resume can meet, before anything is asked or written. */
async function resumeTarget(
  host: ReviewHost,
  runId: string,
): Promise<ResumeTarget | null> {
  let prepared: ResumeTarget | null = null;
  const chat = host.activeChat();
  if (chat && chat.kind === "editorial") {
    const persona = host.resolvePersona(chat);
    const model = chat.preferences.model;
    if (!persona || !model) {
      host.publish({
        problem: persona
          ? { kind: "review-outdated" }
          : {
              kind: "persona-missing",
              personaId: chat.preferences.personaId,
            },
      });
    } else {
      let checkpoint: ReviewCheckpoint | null = null;
      try {
        checkpoint = await host.dependencies.artifacts.loadReview(runId);
      } catch {
        host.publish({ error: "That review plan could not be found." });
      }
      if (checkpoint === null) {
        // The load already published its own refusal.
      } else if (!resumable(checkpoint, { model, personaId: persona.id })) {
        host.publish({ problem: { kind: "review-outdated" } });
      } else {
        // What the chat may read now, within what the plan's scope
        // covers now, never what the plan says: a plan is a file in the
        // writer's folder, and one planted there reads nothing outside
        // host.
        const boundary = await host.readerBoundary(chat);
        // A Part's plan names its Part by id, and the Part may have been
        // dissolved or deleted since: the same refusal a fresh run gets,
        // never a review of no Section at all.
        const scope = checkpoint.scope;
        if (
          boundary.ok &&
          scope.kind === "node" &&
          !isPart(boundary.catalog, scope.nodeId)
        )
          host.publish({ problem: { kind: "review-node-missing" } });
        else if (boundary.ok)
          prepared = {
            chat,
            persona,
            model,
            checkpoint,
            allowed: wideSections(
              boundary.catalog,
              boundary.allowed,
              checkpoint.scope,
            ).allowed,
            book: boundary.allowed,
          };
      }
    }
  }
  return prepared;
}

/**
 * Whether every id of a reference the writer named is still one `task`
 * reads and this chat may read, in a set the chat file can carry
 * (`isReviewReferences`); a set it would drop on the next load takes the
 * scope with it. The run asks again when it reads them; this
 * is the refusal before anything is written.
 */
async function nameable(
  host: ReviewHost,
  chat: ChatRecord,
  task: ReviewTask,
  references: readonly string[],
): Promise<boolean> {
  if (!namesReference(task) || !isReviewReferences(references)) return false;
  const boundary = await host.readerBoundary(chat);
  return (
    boundary.ok &&
    namedSources(
      boundary.catalog,
      boundary.allowed,
      readsFor(task),
      references,
    ) !== null
  );
}

function reviewDependencies(host: ReviewHost) {
  return {
    sources: host.dependencies.sources,
    artifacts: host.dependencies.artifacts,
    model: host.dependencies.model,
    projectFacts: host.dependencies.projectFacts,
    // Steps, not Sections: a wide review maps, then verifies, and its
    // count is the stage's. The Resume offer counts Sections, from
    // the saved plan (`reviewProgressOf`), and the two are never mixed;
    // the offer is hidden while a run is going.
    onProgress: (progress: { complete: number; total: number }) => {
      host.publish({ runProgress: { work: "review", ...progress } });
    },
  };
}

/** Keep an interrupted plan resumable: its state must say interrupted. */
async function markReviewInterrupted(
  host: ReviewHost,
  runId: string,
): Promise<void> {
  // A clear belongs to the runId it clears: another chat's Resume offer
  // must survive a deleted chat's plan finishing or failing.
  const clearIfMine = () => {
    if (host.snapshot().pendingReview?.runId === runId)
      host.publish({ pendingReview: null });
  };
  try {
    const checkpoint = await host.dependencies.artifacts.loadReview(runId);
    // A deleted chat's plan must not come back as a pending review.
    if (host.isDeleted(checkpoint.chatId)) {
      clearIfMine();
      return;
    }
    if (checkpoint.state === "complete") {
      clearIfMine();
      return;
    }
    await host.dependencies.artifacts.saveReview({
      ...checkpoint,
      state: "interrupted",
      updatedAt: now(),
    });
    // The offer carries no chat, so it shows only under its own; the
    // plan's chat offers it again when it is selected.
    if (host.snapshot().activeChatId === checkpoint.chatId)
      host.publish({ pendingReview: reviewProgressOf(checkpoint) });
    else clearIfMine();
  } catch {
    // The plan itself is unreadable, so there is nothing to resume, but
    // only this run's offer may be withdrawn.
    clearIfMine();
  }
}

async function publishReviewTurn(
  host: ReviewHost,
  persona: PersonaDefinition,
  outcome: Awaited<ReturnType<typeof executePlan>>,
  /** The answer this one takes the place of (`completeReview`). */
  replacing?: string,
): Promise<void> {
  if (host.isDisposed()) return;
  const { checkpoint, usage, coverage } = outcome;
  // The plan's task and scope, not the words typed (`runReview`).
  const { task, scope } = checkpoint;
  // The turn belongs to the chat the plan belongs to, not to whatever is
  // active now: a writer may have switched while the review ran.
  if (host.isDeleted(checkpoint.chatId)) return;
  const chat = host
    .snapshot()
    .chats.find((one) => one.id === checkpoint.chatId);
  if (!chat) return;
  if (host.snapshot().pendingReview?.runId === checkpoint.runId)
    host.publish({ pendingReview: null });
  // A finding's prose is read by the writer as written, so a Section id the
  // model put there is read as its title (`namedByTitle`).
  const named = (text: string) => namedByTitle(text, host.catalogueTitles());
  const titled = checkpoint.findings.map((finding) => ({
    ...finding,
    title: named(finding.title),
    explanation: named(finding.explanation),
    ...(finding.uncertainty ? { uncertainty: named(finding.uncertainty) } : {}),
  }));
  // A finding about one chapter's words goes beside them, as a ghost
  // comment; what stays here is what has no one place (`divertFindings`).
  const { findings, commented } = await divertFindings(
    host.dependencies.comments,
    titled,
    await host.listCatalogue(),
    persona.id,
  );
  if (host.isDisposed()) return;
  // The message is a line, not a second renderer: the structured findings
  // render below it, and duplicating them as Markdown would show every
  // finding twice.
  const unjudged = coverage.judgement?.unjudged.length ?? 0;
  const waiting = coverage.judgement
    ? coverage.judgement.candidates - coverage.judgement.judged - unjudged
    : 0;
  const unread = coverage.judgement?.unread?.length ?? 0;
  // A review whose coverage is short (a Section still pending, a fact not
  // judged, a reference not read) is never called complete: its line says
  // it stopped short, and the coverage below says what it did not reach.
  const plural = findings.length === 1 ? "" : "s";
  const head = coverage.complete
    ? findings.length === 0
      ? commented.length > 0
        ? "Completed the review; what it found is in the margin."
        : "No evidence-backed issues were found in the completed review."
      : `Completed the ${task} review with ${findings.length} finding${plural}.`
    : findings.length === 0
      ? commented.length > 0
        ? "The review stopped short; what it found is in the margin."
        : "The review stopped short; it found no evidence-backed issue in what it read."
      : `The ${task} review stopped short with ${findings.length} finding${plural}.`;
  const summary = `${head}${
    unjudged > 0
      ? ` ${unjudged} fact${unjudged === 1 ? "" : "s"} could not be judged; see what was covered.`
      : ""
  }${
    waiting > 0
      ? ` ${waiting} fact${waiting === 1 ? "" : "s"} the check held ${waiting === 1 ? "was" : "were"} not reached this time; review again to continue from ${waiting === 1 ? "it" : "them"}.`
      : ""
  }${
    unread > 0
      ? ` ${unread} reference${unread === 1 ? "" : "s"} could not be read into the check; see what was covered.`
      : ""
  }`;
  const turn: ChatTurn = {
    id: newId(),
    runId: checkpoint.runId,
    role: "assistant",
    text: summary,
    createdAt: now(),
    outcome: "complete",
    findings,
    ...(commented.length > 0 ? { commented } : {}),
    coverage,
    review: {
      runId: checkpoint.runId,
      task,
      scope,
      // What Resume and Review again check against: the name, not every
      // reference.
      ...(checkpoint.method === "sections" && checkpoint.references
        ? { references: checkpoint.references }
        : {}),
    },
    model: checkpoint.model,
    personaId: persona.id,
    usage,
  };
  // In place of the answer it completes, where it stood; at the end when
  // that answer has gone meanwhile (a deleted turn is not brought back).
  // Only a review answer is replaced: `replacing` can come from a plan
  // file on resume, and must not be able to take a question or a chat
  // turn out of the conversation.
  const replaced = (one: ChatTurn) =>
    replacing !== undefined &&
    one.runId === replacing &&
    one.review !== undefined;
  const place = chat.turns.findIndex(replaced);
  // The writer's verdicts on the answer being replaced are their work, not
  // the model's: a new finding standing on the same evidence as one they
  // resolved or dismissed arrives with that verdict. One with no match goes
  // with its finding, because the new review does not claim it.
  if (place >= 0) turn.findings = keptVerdicts(chat.turns[place], findings);
  // The writer's command went in when the plan was made (`planAndRun`). A
  // chat file edited while the plan waited to resume can have lost it, and
  // an answer never stands under nothing: its line goes back above it.
  const word = skillForReviewTask(task)?.command;
  const asked: ChatTurn[] =
    word && !chat.turns.some((one) => one.runId === checkpoint.runId)
      ? [
          {
            id: newId(),
            runId: checkpoint.runId,
            role: "user",
            text: commandLine({ skill: word }),
            command: { skill: word },
            createdAt: checkpoint.createdAt,
            outcome: "complete",
          },
        ]
      : [];
  const turns =
    place < 0
      ? [...chat.turns, ...asked, turn]
      : [
          ...chat.turns.slice(0, place),
          turn,
          ...chat.turns.slice(place).filter((one) => !replaced(one)),
        ];
  // Onto the chat as it is when the save starts: the margin and the
  // catalogue were awaited since `chat` was read.
  await host.writes.persistRun(chat, { ...chat, updatedAt: now(), turns });
}

/** The reviews, bound to the aggregate (`assistant.reviews`). */
export function bind(host: ReviewHost) {
  return {
    run: withHost(host, runReview),
    complete: withHost(host, completeReview),
    resume: withHost(host, resumeReview),
  };
}
