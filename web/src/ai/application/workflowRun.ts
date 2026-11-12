// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What a workflow run reads and writes of the `Assistant`, named one by one,
// so a workflow is a function of its request and a host rather than a part of
// the aggregate. The entry point a run takes stays in the aggregate: the claim,
// `running` and the queue are its state.

import type {
  AssistantDependencies,
  AssistantSnapshot,
} from "./assistantTypes";
import type { ChatWrites } from "./chatWrites";
import { SearchPause, type SearchPauseDependencies } from "./searchAsk";
import { ModelRunError } from "./runStep";
import { now, runProblemOf, workflowPair } from "./runRecords";
import { newId } from "./ids";
import type {
  ChatRecord,
  ChatTurn,
  MapShapeId,
  PersonaDefinition,
  SourceDescriptor,
  TurnCommand,
} from "../domain/types";

/** One workflow's way through the run entry point. */
export interface WorkflowLaunch<P> {
  /** Every refusal, under the claim; null to refuse. */
  prepare: () => Promise<P | null>;
  /** What a throw from `prepare` says. */
  failure: string;
  chatId: (prepared: P) => string;
  /** Fields the run's first publish sets beside the run state. */
  start?: (prepared: P) => Partial<AssistantSnapshot>;
  run: (prepared: P, signal: AbortSignal) => Promise<void>;
  /** How a run that did not finish says so. */
  stopped: (prepared: P, error: unknown) => void | Promise<void>;
  /** Fields the run's last publish clears beside the run state. */
  end?: Partial<AssistantSnapshot>;
}

export interface WorkflowHost {
  readonly dependencies: AssistantDependencies;
  readonly writes: ChatWrites;
  snapshot(): AssistantSnapshot;
  isDisposed(): boolean;
  /** Deleted this session: nothing is written to the chat again. */
  isDeleted(chatId: string): boolean;
  publish(patch: Partial<AssistantSnapshot>): void;
  activeChat(): ChatRecord | null;
  resolvePersona(chat: ChatRecord): PersonaDefinition | null;
  declaredShape(): MapShapeId | null;
  listCatalogue(): Promise<SourceDescriptor[]>;
  readerBoundary(
    chat: ChatRecord,
  ): Promise<
    | { ok: true; allowed: ReadonlySet<string>; catalog: SourceDescriptor[] }
    | { ok: false }
  >;
  /** Write a question and its answer together; false when nothing was. */
  publishWorkflowPair(
    chatId: string,
    asked: string,
    answer: Pick<
      ChatTurn,
      "text" | "model" | "usage" | "located" | "mapped" | "summarisedPart"
    >,
    replacing?: string,
  ): Promise<boolean>;
  /** How a run that did not finish says so, never under another chat. */
  endWorkflowRun(
    chatId: string,
    error: unknown,
    words: [stopped: string, interrupted: string],
  ): void;
  /** Whether a command's words are over their bound, published when they are. */
  refusesArgument(
    command: TurnCommand | undefined,
    kind?: "question-too-long" | "verify-too-long",
  ): boolean;
  /** The run's web-search pause, which the aggregate's answer reaches. */
  searchPauseFor(
    webSearch: SearchPauseDependencies["webSearch"],
    run: Pick<
      SearchPauseDependencies,
      | "model"
      | "account"
      | "signal"
      | "lastWebIndex"
      | "bookTexts"
      | "onRecords"
    >,
  ): SearchPause;
  releasePause(pause: SearchPause | null): void;
  runWorkflow<P>(launch: WorkflowLaunch<P>): Promise<"started" | "rejected">;
}

/**
 * What the run helpers use of the aggregate, including the one slot for the
 * running search pause, which `answerSearches` reads.
 */
export interface RunSupport {
  readonly writes: ChatWrites;
  snapshot(): AssistantSnapshot;
  isDisposed(): boolean;
  isDeleted(chatId: string): boolean;
  publish(patch: Partial<AssistantSnapshot>): void;
  pause(): SearchPause | null;
  setPause(pause: SearchPause | null): void;
}

/** How a workflow run that did not finish says so. */
export function endWorkflowRun(
  host: RunSupport,
  chatId: string,
  error: unknown,
  [stopped, interrupted]: [string, string],
): void {
  if (error instanceof ModelRunError && error.failure.code === "cancelled") {
    // A deleted chat's run was stopped by the delete: saying "Stopped."
    // under whatever chat is left would be about a run the writer never
    // stopped.
    if (!host.isDeleted(chatId))
      host.publish({ error: stopped, errorCode: "cancelled" });
  } else reportRunError(host, error, interrupted);
}

/**
 * A workflow's question and its answer, written together to the chat that
 * asked, which may not be the active one by then. False when that chat is
 * gone.
 *
 * Replaces the pair `replacing` names, so a question asked again does not
 * leave the stale answer in the model's history. A pair that is gone by now
 * (a chat file edited under the run) is appended.
 */
export async function publishWorkflowPair(
  host: RunSupport,
  chatId: string,
  asked: string,
  answer: Pick<
    ChatTurn,
    "text" | "model" | "usage" | "located" | "mapped" | "summarisedPart"
  >,
  replacing?: string,
): Promise<boolean> {
  if (host.isDisposed() || host.isDeleted(chatId)) return false;
  const chat = host.snapshot().chats.find((one) => one.id === chatId);
  if (!chat) return false;
  await host.writes.persist(
    workflowPair(chat, { text: asked }, answer, replacing).chat,
  );
  return true;
}

/** A run's failure, published as the error, the problem or the fallback. */
export function reportRunError(
  host: Pick<RunSupport, "publish">,
  error: unknown,
  fallback: string,
): void {
  if (error instanceof ModelRunError) {
    host.publish({
      error: error.failure.message,
      errorCode: error.failure.code,
    });
    return;
  }
  const problem = runProblemOf(error);
  if (problem) {
    // The problem is the whole account. Its error's message is a kind, not
    // a sentence, and published beside it, it would surface raw in the dock
    // the moment the problem cleared and the error did not.
    host.publish({ problem, error: null });
    return;
  }
  host.publish({
    error: error instanceof Error ? error.message : fallback,
  });
}

/**
 * A run's search pause, made the one `answerSearches` reaches. Released by
 * `releasePause`, in the run's own `finally`.
 */
export function searchPauseFor(
  host: RunSupport,
  webSearch: SearchPauseDependencies["webSearch"],
  run: Pick<
    SearchPauseDependencies,
    "model" | "account" | "signal" | "lastWebIndex" | "bookTexts" | "onRecords"
  >,
): SearchPause {
  const pause = new SearchPause({
    ...run,
    webSearch,
    now,
    newId,
    // One publish per change (`onAsk`'s contract): the ask and the words for
    // it together, and on its settle the wait with the ask's removal. After
    // a settle the run is between sends or steps.
    onAsk: (ask, waitedMs) => {
      if (host.isDisposed()) return;
      host.publish(
        ask
          ? { pendingSearch: ask, activity: { kind: "awaiting-writer" } }
          : {
              pendingSearch: null,
              runWaitedMs: waitedMs,
              activity: { kind: "preparing" },
            },
      );
    },
    onActivity: (activity) => host.publish({ activity }),
  });
  host.setPause(pause);
  return pause;
}

/** The pause dies with its run: only its own, never a later run's. */
export function releasePause(
  host: RunSupport,
  pause: SearchPause | null,
): void {
  if (host.pause() === pause) host.setPause(null);
}
