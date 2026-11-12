// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Asking again: a retry of the last turn, an edit of one of the writer's
// questions and its Undo, and the cut both share. Each re-enters the
// aggregate's one entry point (`ask`); `EditHost` lends what an edit reads and
// writes of its state.

import { now } from "./runRecords";
import type { WorkflowHost } from "./workflowRun";
import { commandArgument, verifySkill } from "../domain/skills";
import { workflowAnswer } from "../domain/types";
import type {
  ChatCompaction,
  ChatRecord,
  ChatTurn,
  TurnCommand,
} from "../domain/types";
import { withHost } from "./features";

type AskOutcome = "started" | "queued" | "rejected";

/** A chat as it stood before `rewindAndAsk` cut it. */
export interface Rewound {
  turns: ChatTurn[];
  /** How many of `turns` the cut kept. */
  kept: number;
  compactedHistory?: ChatCompaction;
}

/** The chat an edit's Undo puts back, and how many turns the edit kept. */
export interface EditRewind {
  chatId: string;
  before: ChatTurn[];
  title: string;
  kept: number;
  /** The digest `before` had: the edit's cut may have dropped it. */
  compactedHistory?: ChatCompaction;
}

export interface EditHost extends Pick<
  WorkflowHost,
  "writes" | "snapshot" | "activeChat" | "isDeleted" | "refusesArgument"
> {
  /** A run holds the slot, or an entry point has claimed it. */
  busy(): boolean;
  queued(): number;
  rewind(): EditRewind | null;
  setRewind(rewind: EditRewind | null): void;
  stop(): void;
  /** Settles when the run holding the claim has released it. */
  settledRun(): Promise<void>;
  /**
   * `send` without touching the Undo: the entry point a retry and an edit
   * re-enter by.
   */
  ask(
    text: string,
    quote?: string,
    onStarted?: () => void,
    command?: TurnCommand,
    restore?: Rewound,
  ): Promise<AskOutcome>;
  startVerify(
    claim: string,
    quote: string | undefined,
    replacing: string,
  ): Promise<"started" | "rejected">;
}

/**
 * A retry or an edit cut its chat before it waited. Dropped, or refused
 * when its turn came, it leaves the question gone with nothing asked: its
 * chat goes back as it was, when nothing has been written there since the
 * cut.
 */
export function undoCut(
  host: Pick<EditHost, "snapshot" | "isDeleted" | "writes">,
  entry: { chatId: string; restore?: Rewound },
): void {
  const restore = entry.restore;
  const chat = host.snapshot().chats.find((one) => one.id === entry.chatId);
  if (!restore || !chat || host.isDeleted(chat.id)) return;
  const cut =
    chat.turns.length === restore.kept &&
    chat.turns.every((turn, at) => turn.id === restore.turns[at]?.id);
  if (!cut) return;
  void host.writes.persist({
    ...chat,
    turns: restore.turns,
    ...(restore.compactedHistory
      ? { compactedHistory: restore.compactedHistory }
      : {}),
    updatedAt: now(),
  });
}

/** Ask again, after the last turn failed or was stopped. */
export async function retryTurn(
  host: EditHost,
  turnId: string,
): Promise<AskOutcome> {
  const chat = host.activeChat();
  if (!chat) return "rejected";

  // The last turn only. An older failure retried from here would be lifted
  // out of its place and asked again at the bottom, with every later turn
  // in its history: a different question, and a rearranged transcript.
  // Enforced here rather than only by the panel withholding the button, so
  // no other caller can do it either.
  const last = chat.turns[chat.turns.length - 1];
  if (
    !last ||
    last.id !== turnId ||
    last.role !== "assistant" ||
    !last.runId ||
    (last.outcome !== "failed" && last.outcome !== "interrupted")
  )
    return "rejected";
  // A stopped turn can be retried too. An assistant turn is written as
  // `interrupted` the moment its run begins, so while any run is live the
  // last "interrupted" turn may be the one still streaming: refused then,
  // rather than tearing a live answer out from under its own run.
  if (last.outcome === "interrupted" && host.busy()) return "rejected";

  const askedAt = chat.turns.findIndex(
    (turn) => turn.runId === last.runId && turn.role === "user",
  );
  const asked = chat.turns[askedAt];
  // A turn with no question behind it is a review or a summary, not a
  // conversation. Those have their own resume affordance, and re-running
  // one from here would send an empty message, which breaks the chat for
  // good.
  if (!asked || !asked.text.trim()) return "rejected";

  // A `/verify` is asked again as a `/verify`, never as the words
  // "/verify …" sent to the model: its claim read back off the stored
  // line, its quote from the turn, and the new pair in the old one's
  // place. A refusal leaves the old pair as it was, because nothing is
  // written before the refusals are through.
  if (last.verifies) {
    const claim = commandArgument(asked.text, verifySkill);
    if (claim === null) return "rejected";
    const outcome = await host.startVerify(claim, asked.quote, last.runId);
    if (outcome === "started") host.setRewind(null);
    return outcome;
  }

  // A retry is a new ask: an earlier edit's Undo does not describe the
  // chat it would restore.
  host.setRewind(null);
  return rewindAndAsk(
    host,
    chat,
    askedAt,
    asked.text,
    asked.quote,
    undefined,
    asked.command,
  );
}

/**
 * Change one of the writer's own questions and ask it again, dropping
 * everything that followed it. A rewind without branches, with an Undo in
 * their place, because a chat is a project file and what the rewind drops
 * would otherwise be gone. Any of the writer's questions, not only the
 * last.
 *
 * Resolves "started" as soon as the edited question is on disk and its run
 * is live, not when the answer ends, because that is when the Undo must be
 * offered: a local model can take minutes, and the writer's old
 * conversation has already left the screen. Resolves "queued" when a run
 * took the slot while the cut was saved: the edit waits, with no Undo.
 */
export function editTurn(
  host: EditHost,
  turnId: string,
  text: string,
  command?: TurnCommand,
  /**
   * `withoutQuote`: ask it without the turn's quote, as the same line
   * typed would be (`/summarise section` reads the whole Section). The
   * Undo restores the turn, quote and all.
   */
  options?: { withoutQuote?: boolean },
): Promise<AskOutcome> {
  const chat = host.activeChat();
  const at = chat ? chat.turns.findIndex((turn) => turn.id === turnId) : -1;
  const turn = chat?.turns[at];
  // Refused while anything is running or waiting: the rewind would pull
  // turns out from under a live run, and a queued question would land in a
  // conversation that lacks what it was asked after.
  if (
    !chat ||
    !turn ||
    turn.role !== "user" ||
    !text.trim() ||
    host.busy() ||
    host.queued() > 0 ||
    // A `/where`, a `/map` or a `/summarise part` is a workflow, not a
    // question: asked again from here it would go to the model as the
    // words "/where …".
    chat.turns.some((one) => one.runId === turn.runId && workflowAnswer(one))
  )
    return Promise.resolve("rejected");
  // Before the rewind, so an over-long edit leaves the chat untouched
  // rather than cut back and restored.
  if (host.refusesArgument(command)) return Promise.resolve("rejected");

  const before = chat.turns;
  return new Promise((resolve) => {
    let started = false;
    void rewindAndAsk(
      host,
      chat,
      at,
      text.trim(),
      options?.withoutQuote ? undefined : turn.quote,
      () => {
        started = true;
        host.setRewind({
          chatId: chat.id,
          before,
          title: chat.title,
          kept: at,
          ...(chat.compactedHistory
            ? { compactedHistory: chat.compactedHistory }
            : {}),
        });
        resolve("started");
      },
      command,
    ).then((outcome) => {
      if (!started) resolve(outcome);
    });
  });
}

/**
 * Take the last edit back: the chat as it was before it. Stops the edit's
 * answer if it is still coming, and waits for that run to finish writing
 * before restoring, or the aborted run's last write would land on top of
 * the restore.
 *
 * Refused (false) when there is nothing to undo, when the chat is gone, or
 * when anything other than the edit's own exchange now follows the turns it
 * kept: restoring then would drop something the writer did not ask to lose.
 */
export async function undoEdit(host: EditHost): Promise<boolean> {
  const rewind = host.rewind();
  if (!rewind) return false;
  host.setRewind(null);

  if (host.busy()) {
    host.stop();
    await host.settledRun();
  }

  const chat = host.snapshot().chats.find((one) => one.id === rewind.chatId);
  if (!chat || host.isDeleted(chat.id)) return false;
  const keptIntact =
    chat.turns.length >= rewind.kept &&
    chat.turns
      .slice(0, rewind.kept)
      .every((turn, index) => turn.id === rewind.before[index]?.id);
  const since = new Set(chat.turns.slice(rewind.kept).map((one) => one.runId));
  if (!keptIntact || since.size > 1) return false;

  // The digest goes back with the turns it was made over, and one the
  // edit's answer made over turns the undo removes goes with them.
  const { compactedHistory: _made, ...rest } = chat;
  await host.writes.persist({
    ...rest,
    ...(rewind.compactedHistory
      ? { compactedHistory: rewind.compactedHistory }
      : {}),
    title: rewind.title,
    turns: rewind.before,
    updatedAt: now(),
  });
  // The lane never rejects: a failed save shows as the chat's save row,
  // and the restore is not done until the file holds it.
  return !host.writes.failed(chat.id);
}

/**
 * Cut the chat back to just before turn `from`, then ask `text` again: the
 * one path retry and edit share, so neither can drift into a weaker
 * version of asking.
 *
 * It removes instead of appending. A failed or stopped turn keeps whatever
 * prose arrived, and `turnMessages` replays an assistant turn's text as
 * history, so appending would hand the model its own broken attempt as
 * context, and the answer it produces would look plausible.
 *
 * It re-enters `ask`, so the claim, the persona and model resolution, the
 * reader boundary and the deleted-chat guard are the one run path's code.
 *
 * Nothing is resent automatically: both callers are buttons. After a
 * credential failure the writer renews through a consent screen, and a
 * resend that fired by itself would make that consent retroactive for
 * prose composed before it.
 */
async function rewindAndAsk(
  host: EditHost,
  chat: ChatRecord,
  from: number,
  text: string,
  quote: string | undefined,
  onStarted?: () => void,
  command?: TurnCommand,
): Promise<AskOutcome> {
  // Captured before anything is removed: this is the writer's own prose and
  // for the next few lines it exists nowhere else.
  const before = chat.turns;
  const kept = before.slice(0, from);
  // A digest whose last covered turn the cut removed summarises turns that
  // are gone, and `requestHistory` would still send it: it goes with them.
  const { compactedHistory, ...rest } = chat;
  const digestKept =
    compactedHistory !== undefined &&
    kept.some((turn) => turn.id === compactedHistory.coversThroughTurnId);
  let started = false;
  // The lane never rejects; a cut whose save fails is still asked.
  await host.writes.persist({
    ...rest,
    ...(digestKept ? { compactedHistory } : {}),
    turns: kept,
    updatedAt: now(),
  });

  const outcome = await host.ask(
    text,
    quote,
    () => {
      started = true;
      onStarted?.();
    },
    command,
    {
      turns: before,
      kept: from,
      ...(compactedHistory ? { compactedHistory } : {}),
    },
  );
  // Put the chat back only when the ask was refused before its question
  // existed (no model, a missing reader horizon, a full queue), so the
  // restore is complete rather than approximate. Once started, the run owns
  // the chat; and a chat deleted meanwhile is never written back to life.
  if (outcome === "rejected" && !started && !host.isDeleted(chat.id))
    await host.writes.persist({ ...chat, turns: before, updatedAt: now() });
  return outcome;
}

/** Retry, edit and Undo, bound to the aggregate. */
export function bind(host: EditHost) {
  return {
    retry: withHost(host, retryTurn),
    edit: withHost(host, editTurn),
    undo: withHost(host, undoEdit),
  };
}
