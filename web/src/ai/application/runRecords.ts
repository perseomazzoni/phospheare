// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What a run writes into its chat: the time stamp, the searches it made, the
// refusal its error stands for, and a workflow's question and answer.

import type { ChatRecord, ChatTurn, WebSearchRecord } from "../domain/types";
import type { AssistantProblem } from "./assistantTypes";
import { ReviewReferenceError } from "./context";
import { newId } from "./ids";
import { ReviewPlanTooLargeError } from "./reviewProject";
import type { SearchPause } from "./searchAsk";

export function now(): string {
  return new Date().toISOString();
}

/**
 * What a run's searches leave on its turn: every attempt, declined rows
 * included, or nothing when it asked about none. The one expression every
 * ending writes, finished, failed or stopped.
 */
export function webOf(
  pause: SearchPause | null,
): WebSearchRecord[] | undefined {
  return pause && pause.written.length > 0 ? [...pause.written] : undefined;
}

/** The refusal a run's error stands for, when it is one the panel names. */
export function runProblemOf(
  error: unknown,
  /** A focused turn: the open Section or the quote, the nearest scope. */
  near = false,
): AssistantProblem | null {
  if (error instanceof ReviewPlanTooLargeError)
    return { kind: "review-plan-too-large" };
  if (error instanceof ReviewReferenceError)
    return {
      kind:
        near && error.problem === "review-reference-too-large"
          ? "review-reference-too-large-section"
          : error.problem,
      ...(error.ids ? { references: error.ids } : {}),
    };
  return null;
}

/**
 * A workflow's question and its answer, placed in the chat: in place of the
 * pair `replacing` names when the chat still holds it, and at the end
 * otherwise.
 */
export function workflowPair(
  chat: ChatRecord,
  asked: Pick<ChatTurn, "text" | "quote">,
  answer: Omit<Partial<ChatTurn>, "id" | "runId" | "role" | "createdAt">,
  replacing?: string,
): { chat: ChatRecord; answerId: string } {
  const runId = newId();
  const at = now();
  const answerId = newId();
  const pair: ChatTurn[] = [
    {
      id: newId(),
      runId,
      role: "user",
      createdAt: at,
      outcome: "complete",
      ...asked,
    },
    {
      id: answerId,
      runId,
      role: "assistant",
      text: "",
      createdAt: at,
      outcome: "complete",
      ...answer,
    },
  ];
  const place = replacing
    ? chat.turns.findIndex((turn) => turn.runId === replacing)
    : -1;
  const others = chat.turns.filter(
    (turn) => replacing === undefined || turn.runId !== replacing,
  );
  const turns =
    place < 0
      ? [...others, ...pair]
      : [...others.slice(0, place), ...pair, ...others.slice(place)];
  return { chat: { ...chat, updatedAt: at, turns }, answerId };
}
