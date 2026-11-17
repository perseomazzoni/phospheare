// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// How a chat record reaches the file and the list: the write lane,
// the optimistic preview and the list merge that every answer, rename, edit
// and workflow ending shares. Nothing here decides anything about a chat's
// content.

import type { ChatRecord, ChatTurn } from "../domain/types";
import { appLog, describeError } from "../../log";

/** What the writes read and publish, as `Assistant` holds it. */
export interface ChatListState {
  chats: ChatRecord[];
  activeChatId: string | null;
  saveFailedChatId: string | null;
  conflictFile?: string | null;
  continuationOffered?: boolean;
}

export interface ChatWritesHost {
  /** The one port a chat is saved through (`Artifacts.saveChat`). */
  save: (
    chat: ChatRecord,
  ) => Promise<{ conflictFile?: string; nearLimit?: boolean }>;
  /** Publish a patch of the live state; a no-op once the host is disposed. */
  publish: (patch: Partial<ChatListState>) => void;
  /** The live state, read at the moment a write settles, never cached. */
  snapshot: () => ChatListState;
  /**
   * Whether a chat may not be written or shown any more: deleted this session,
   * or the host disposed. Read before and after every await, because a
   * delete can land while a save is in flight.
   */
  gone: (chatId: string) => boolean;
}

/** `chat` with one turn patched; the record is replaced, never mutated. */
export function withTurn(
  chat: ChatRecord,
  turnId: string,
  patch: Partial<ChatTurn>,
): ChatRecord {
  return {
    ...chat,
    turns: chat.turns.map((turn) =>
      turn.id === turnId ? { ...turn, ...patch } : turn,
    ),
  };
}

/**
 * A run's copy of a chat laid onto the chat as it is now.
 *
 * `base` is the record the run started from. A field the run changed is the
 * run's; every other field is `latest`'s, so a rename, a model switch or a
 * plan tick made while the run worked survives the run's writes. The
 * preferences are taken key by key the same way, because a run that sets
 * its own target must not carry back the model it started with.
 *
 * Turns follow the run's order. A turn the run added or changed is the
 * run's; one it left alone is `latest`'s, and left out when `latest` lacks
 * it. A turn only `latest` holds goes last.
 *
 * With no `latest` (the chat is not in the list) the run's record stands.
 */
export function ontoLatest(
  latest: ChatRecord | undefined,
  base: ChatRecord,
  run: ChatRecord,
): ChatRecord {
  if (!latest) return run;
  return {
    ...threeWay(latest, base, run),
    preferences: threeWay(
      latest.preferences,
      base.preferences,
      run.preferences,
    ),
    turns: mergeTurns(latest.turns, base.turns, run.turns),
  };
}

/** `latest` with every key `run` changed from `base` taken from `run`. */
function threeWay<T extends object>(latest: T, base: T, run: T): T {
  const was = base as Record<string, unknown>;
  const now = run as Record<string, unknown>;
  const merged = { ...latest } as Record<string, unknown>;
  for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (Object.is(was[key], now[key])) continue;
    if (now[key] === undefined) delete merged[key];
    else merged[key] = now[key];
  }
  return merged as T;
}

function mergeTurns(
  latest: readonly ChatTurn[],
  base: readonly ChatTurn[],
  run: readonly ChatTurn[],
): ChatTurn[] {
  const before = new Map(base.map((turn) => [turn.id, turn]));
  const current = new Map(latest.map((turn) => [turn.id, turn]));
  const ran = new Set(run.map((turn) => turn.id));
  const turns = run.flatMap((turn) => {
    if (before.get(turn.id) !== turn) return [turn];
    const now = current.get(turn.id);
    return now ? [now] : [];
  });
  return [
    ...turns,
    ...latest.filter((turn) => !ran.has(turn.id) && !before.has(turn.id)),
  ];
}

export class ChatWrites {
  private readonly lanes = new Map<string, Promise<void>>();
  /**
   * Every chat whose last save failed, the latest failure last. The list
   * shows one (`saveFailedChatId`), and the next one stands when it clears.
   */
  private readonly failures: string[] = [];

  constructor(private readonly host: ChatWritesHost) {}

  /** Whether `chatId`'s last save failed: its stored copy is stale. */
  failed(chatId: string): boolean {
    return this.failures.includes(chatId);
  }

  /**
   * Drop a chat's failure (a delete), returning the failed chat the list
   * shows now.
   */
  forget(chatId: string): string | null {
    this.clearFailure(chatId);
    return this.shownFailure(chatId);
  }

  private clearFailure(chatId: string): void {
    const at = this.failures.indexOf(chatId);
    if (at >= 0) this.failures.splice(at, 1);
  }

  /** The failure to show once `cleared`'s has gone. */
  private shownFailure(cleared: string): string | null {
    const shown = this.host.snapshot().saveFailedChatId;
    return shown === cleared
      ? (this.failures[this.failures.length - 1] ?? null)
      : shown;
  }

  previewRun(base: ChatRecord, run: ChatRecord): void {
    this.preview(this.onto(base, run));
  }

  /**
   * `persist` for a run: its record laid onto the listed chat when the save
   * starts, not when it is queued, so a write the lane ran first is kept.
   *
   * `settle` finishes the laid record at that same moment, for a change the
   * run makes on top of what the writer changed meanwhile, such as its plan
   * folded over the writer's ticks.
   */
  persistRun(
    base: ChatRecord,
    run: ChatRecord,
    settle: (laid: ChatRecord) => ChatRecord = (laid) => laid,
  ): Promise<void> {
    return this.write(run.id, () => settle(this.onto(base, run)), false);
  }

  /**
   * `persist` for one change the writer made (a rename, a model, a tick):
   * `change` is applied to the chat as listed when the save starts. The row
   * as it was at the click may be a run's streaming preview, and saved
   * whole it would put back over the run's answer. `chat` stands when the
   * list does not hold it.
   */
  persistChange(
    chat: ChatRecord,
    change: (latest: ChatRecord) => ChatRecord,
  ): Promise<void> {
    return this.write(
      chat.id,
      () => change(this.listed(chat.id) ?? chat),
      false,
    );
  }

  private onto(base: ChatRecord, run: ChatRecord): ChatRecord {
    return ontoLatest(this.listed(run.id), base, run);
  }

  private listed(chatId: string): ChatRecord | undefined {
    return this.host.snapshot().chats.find((one) => one.id === chatId);
  }

  /**
   * Show a chat's in-flight state in the list without saving it. The list
   * updates and the active chat does not, so the next delta cannot undo a
   * switch to another chat while a run streams. A deleted chat's in-flight
   * deltas never draw it back into the list the writer removed it from.
   */
  preview(chat: ChatRecord): void {
    if (this.host.gone(chat.id)) return;
    this.host.publish({
      chats: [
        chat,
        ...this.host.snapshot().chats.filter((one) => one.id !== chat.id),
      ],
    });
  }

  /**
   * Settles when the chat's last write has, whichever way it went. A delete
   * waits for it before removing the file, so a save in flight cannot
   * recreate it.
   */
  settled(chatId: string): Promise<void> {
    return (this.lanes.get(chatId) ?? Promise.resolve()).catch(() => undefined);
  }

  /**
   * One serial write lane per chat. The 2-second checkpoint debounce, the
   * optimistic preview and the terminal write all go through it, so a slow
   * write never interleaves with the next one for the same file.
   *
   * `activate` is for creation-shaped calls: a new chat becomes the active
   * one. Ordinary saves never move the writer's place.
   */
  persist(chat: ChatRecord, activate = false): Promise<void> {
    return this.write(chat.id, () => chat, activate);
  }

  private write(
    chatId: string,
    record: () => ChatRecord,
    activate: boolean,
  ): Promise<void> {
    if (this.host.gone(chatId)) return Promise.resolve();
    let written: ChatRecord | null = null;
    const previous = this.lanes.get(chatId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        if (this.host.gone(chatId)) return;
        written = record();
        const outcome = await this.host.save(written);
        if (this.host.gone(chatId)) return;
        this.host.publish({
          ...(outcome.conflictFile
            ? { conflictFile: outcome.conflictFile }
            : {}),
          continuationOffered: outcome.nearLimit === true,
        });
      });
    this.lanes.set(chatId, next);
    return next
      .then(() => {
        if (this.host.gone(chatId)) return;
        this.clearFailure(chatId);
        this.host.publish({
          ...this.mergeRows(written ?? record(), activate),
          saveFailedChatId: this.shownFailure(chatId),
        });
      })
      .catch((err: unknown) => {
        appLog.error("ai", "A chat could not be saved.", {
          chat: chatId,
          ...describeError(err),
        });
        if (this.host.gone(chatId)) return;
        const chat = written ?? record();
        this.clearFailure(chatId);
        this.failures.push(chatId);
        // The in-memory answer stays, and the panel offers Retry and Copy for
        // this chat only, so a background failure never puts a Retry under
        // another one. No `error` is published: the row's copy is static, and
        // a save message would outlive the save as a stale run error.
        //
        // The record joins the list even though its write failed. A new chat
        // whose first save failed exists nowhere else, and the row that
        // speaks for it resolves against this list; without it the failure
        // would be silent, and the app never holds unsaved work silently.
        this.host.publish({
          ...this.mergeRows(chat, activate),
          saveFailedChatId: chat.id,
        });
      });
  }

  /**
   * The record's row goes first, and the writer's place is kept. The persisted
   * chat becomes active only when asked (creation) or when no other chat is.
   */
  private mergeRows(
    chat: ChatRecord,
    activate: boolean,
  ): { chats: ChatRecord[]; activeChatId: string | null } {
    const state = this.host.snapshot();
    const chats = [
      chat,
      ...state.chats.filter((one) => one.id !== chat.id),
    ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const activeChatId =
      activate ||
      !state.activeChatId ||
      !chats.some((one) => one.id === state.activeChatId)
        ? chat.id
        : state.activeChatId;
    return { chats, activeChatId };
  }
}
