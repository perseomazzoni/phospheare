// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A chat's birth and its settings: a new chat, a clean copy, a rename, a
// preference change, the model a new chat inherits and the digest a
// continuation carries. None takes a run slot. Deleting a chat, selecting one
// and continuing one stay in the aggregate: they write its run state.

import { now } from "./runRecords";
import { newId } from "./ids";
import { limitsFor } from "./budgets";
import { compactAllHistory } from "./history";
import type { WorkflowHost } from "./workflowRun";
import { DEFAULT_CHAT_TITLES } from "../domain/chatTitle";
import { STANDARD, samplingFields } from "../domain/mode";
import { DEFAULT_PERSONA, personasFor } from "../domain/personas";
import type { ChatKind, ChatRecord, ModelRef } from "../domain/types";
import { withHost } from "./features";

export interface ChatAdminHost extends Pick<
  WorkflowHost,
  "dependencies" | "writes" | "snapshot" | "activeChat" | "publish"
> {
  seedModel(): ModelRef | null;
  /** The first listing still running, or null. */
  firstListing(): Promise<void> | null;
}

/**
 * `through` sets a reader's horizon at birth: the button an answer offers to
 * "a Beta reader chat through chapter 5". Ignored for any other kind,
 * which has no horizon.
 */
export async function createChat(
  host: ChatAdminHost,
  kind: ChatKind,
  options: { through?: string } = {},
): Promise<ChatRecord> {
  const target = host.dependencies.defaultNode();
  const compatible = personasFor(kind);
  const stamp = now();
  const chat: ChatRecord = {
    schemaVersion: 1,
    id: newId(),
    title: DEFAULT_CHAT_TITLES[kind],
    kind,
    createdAt: stamp,
    updatedAt: stamp,
    preferences: {
      // The first compatible voice, or the folder's declared default when a
      // kind has none. Never a literal id: the name of a persona belongs in
      // its file name and nowhere else.
      personaId: compatible[0]?.id ?? DEFAULT_PERSONA.id,
      // The model the last chat used: a selection lives on the chat that
      // made it, so a new chat has nothing of its own to read. With no
      // previous chat it is the host's `defaultModel`, or `null`, which the
      // model menu shows as its "set up a model" state.
      model: host.seedModel(),
      targetNodeId: target?.id,
      // Unset for a reader, even with a target node in hand: a reader chat
      // with no scope chosen is refused, and seeding it from wherever the
      // writer happened to be would make that guard fire only by accident.
      // Only a horizon the writer chose is set.
      ...(options.through && (kind === "alpha-reader" || kind === "beta-reader")
        ? {
            readerScope: {
              kind: "through" as const,
              nodeId: options.through,
            },
          }
        : {}),
      pinnedSourceIds: [],
    },
    turns: [],
  };
  // A create during the first listing lands after it: the merge would keep
  // the row anyway, but the fence makes the create's own publish the last
  // word on the list.
  await host.firstListing();
  await host.writes.persist(chat, true);
  return chat;
}

/**
 * A fresh chat of the same type and context choices with no history: the
 * supported transition when a reader horizon narrows or a history becomes
 * inadmissible, and the writer wants a context reset without losing setup.
 */
export async function startCleanChat(
  host: ChatAdminHost,
): Promise<ChatRecord | null> {
  const source = host.activeChat();
  if (!source) return null;
  const chat: ChatRecord = {
    schemaVersion: 1,
    id: newId(),
    title: `${source.title} · fresh`,
    kind: source.kind,
    createdAt: now(),
    updatedAt: now(),
    preferences: { ...source.preferences },
    turns: [],
  };
  await host.writes.persist(chat, true);
  return chat;
}

/** The digest of a whole chat that its continuation carries. */
export async function continuationDigest(
  host: Pick<ChatAdminHost, "dependencies">,
  source: ChatRecord,
  model: ModelRef,
  signal: AbortSignal,
): Promise<ChatRecord["compactedHistory"]> {
  const descriptor = await host.dependencies.model.describeModel(model, signal);
  const limits = limitsFor(descriptor);
  return (
    await compactAllHistory(
      source,
      host.dependencies.model,
      model,
      signal,
      limits,
      samplingFields(STANDARD, descriptor),
    )
  ).compaction;
}

export async function renameChat(
  host: ChatAdminHost,
  chatId: string,
  title: string,
): Promise<void> {
  const chat = host.snapshot().chats.find((one) => one.id === chatId);
  if (!chat || !title.trim()) return;
  await host.writes.persistChange(chat, (latest) => ({
    ...latest,
    title: title.trim().slice(0, 120),
    updatedAt: now(),
  }));
}

export async function updatePreferences(
  host: ChatAdminHost,
  next: Partial<ChatRecord["preferences"]>,
): Promise<void> {
  const chat = host.activeChat();
  if (!chat) return;
  // A new voice opens on its own focus: a preset is one persona's, and a
  // stored one the new persona does not offer would only fall back. It is
  // cleared, so the file says what the chat does.
  await host.writes.persistChange(chat, (latest) => {
    const voiceChanged =
      next.personaId !== undefined &&
      next.personaId !== latest.preferences.personaId &&
      !("preset" in next);
    return {
      ...latest,
      updatedAt: now(),
      preferences: {
        ...latest.preferences,
        ...next,
        ...(voiceChanged ? { preset: undefined } : {}),
      },
    };
  });
  // A chosen replacement (or any change the writer makes) answers the
  // refusal it was about; leaving it up would ask the same question twice.
  host.publish({ problem: null });
}

/**
 * The model a new chat inherits: the most recently updated chat that names
 * one. Ordering is read from `updatedAt` rather than from the array, so it
 * does not depend on how the list is sorted.
 */
export function seedModel(
  chats: readonly ChatRecord[],
  defaultModel: ModelRef | undefined,
): ModelRef | null {
  return (
    [...chats]
      .filter((chat) => chat.preferences.model)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.preferences
      .model ??
    defaultModel ??
    null
  );
}

/** Chat administration, bound to the aggregate. */
export function bind(host: ChatAdminHost) {
  return {
    create: withHost(host, createChat),
    startClean: withHost(host, startCleanChat),
    rename: withHost(host, renameChat),
    updatePreferences: withHost(host, updatePreferences),
  };
}
