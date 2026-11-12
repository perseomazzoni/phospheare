// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { workflowAnswer } from "../../ai/domain/types";
import type { ChatTurn } from "../../ai/domain/types";

/** What the transcript as a whole says about every turn's actions. */
export interface TurnFacts {
  /** A run is going. */
  running: boolean;
  /** Questions wait behind it. */
  queued: number;
  /** The transcript's last turn. */
  lastTurnId: string | undefined;
  /** The last turn has a question of the writer's behind it. */
  lastWasAsked: boolean;
  /** The runs whose answer is a workflow's. */
  workflowRuns: ReadonlySet<string>;
}

/** Which of a turn's actions it offers now. */
export interface TurnOffer {
  retry: boolean;
  edit: boolean;
  renew: boolean;
  completeSearch: boolean;
  completeReview: boolean;
  completeMap: boolean;
  mapWith: boolean;
  openRoute: boolean;
  /** The last turn: its key verdict and the review's hint are about now. */
  last: boolean;
}

/** The facts every turn's offer is decided from, read once per render. */
export function turnFacts(
  turns: readonly ChatTurn[],
  running: boolean,
  queued: number,
): TurnFacts {
  const lastTurn = turns[turns.length - 1];
  return {
    running,
    queued,
    lastTurnId: lastTurn?.id,
    // A review or a summary fails or stops with no question behind it and
    // has its own resume, so Try again under it would be a button
    // `retryTurn` refuses.
    lastWasAsked:
      !!lastTurn?.runId &&
      turns.some((one) => one.role === "user" && one.runId === lastTurn.runId),
    // The runs whose answer is a workflow's (`/where`, `/map`, `/summarise
    // part`): their question is not one for the model, and an edit would
    // send it as the words "/where …". `editTurn` refuses it, so the pencil
    // is not drawn.
    workflowRuns: new Set(
      turns.flatMap((one) =>
        workflowAnswer(one) && one.runId ? [one.runId] : [],
      ),
    ),
  };
}

/**
 * Which actions `turn` offers now. Every gate lives here, so a new action is
 * decided beside the others rather than in the markup that draws it.
 */
export function turnActions(facts: TurnFacts, turn: ChatTurn): TurnOffer {
  const last = turn.id === facts.lastTurnId;
  const settled = !facts.running;
  const ran = turn.runId !== undefined;
  return {
    // Withheld while a run is going: a retry re-enters the send, which
    // queues behind the running turn, so the button would do nothing visible
    // until the current answer finishes. Offered on the last turn only: an
    // older failure is past, and `retryTurn` refuses it anyway. Its reason
    // still shows; only the button goes.
    retry: settled && last && facts.lastWasAsked,
    // Any of the writer's own questions. Withheld while anything runs or
    // waits: the rewind would pull turns from under a live run, and a queued
    // question would land in a conversation that has lost what it followed.
    edit:
      settled &&
      facts.queued === 0 &&
      !(turn.runId !== undefined && facts.workflowRuns.has(turn.runId)),
    // The last turn only, as Try again is: an older failure is past, and the
    // verdict is about the key as it is now.
    renew: last,
    completeSearch: settled && ran,
    completeReview: settled && ran,
    completeMap: settled && ran,
    mapWith: settled && !!turn.mapped,
    openRoute: settled,
    last,
  };
}
