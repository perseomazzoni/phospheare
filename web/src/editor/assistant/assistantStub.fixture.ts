// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { vi } from "vitest";
import type { Assistant } from "../../ai";
import type { AssistantSnapshot } from "../../ai/application/assistant";

/**
 * An Assistant that exists and does nothing, for suites whose subject is a
 * way into it (the bubble's Ask, the Ask face, the guard in front of it)
 * rather than a conversation.
 *
 * A way in exists only where an Assistant does, so a row about a way in
 * needs one. Suites whose subject is the conversation keep their own
 * shaped doubles.
 *
 * Quiet on mount: an empty snapshot, no open node, no voices, no models. Every
 * other method is a spy made on first read that answers nothing, so a
 * way in that reaches in is observable (`vi.mocked(stub.selectChat)`) without
 * this file knowing the port. A feature object (`stub.chats`) is a group of
 * such spies. `then` is refused, so nothing mistakes the stub for
 * a promise and awaits it forever.
 */
export function assistantTestStub(
  over: Partial<AssistantSnapshot> = {},
): Assistant {
  const snapshot: AssistantSnapshot = {
    chats: [],
    unreadable: [],
    activeChatId: null,
    running: false,
    preparing: false,
    error: null,
    queued: 0,
    saveFailedChatId: null,
    // What a way-in row needs the Assistant to report, such as a search
    // waiting on the writer.
    ...over,
  };
  const known: Record<PropertyKey, unknown> = {
    subscribe: vi.fn(() => () => undefined),
    getSnapshot: vi.fn(() => snapshot),
    initialize: vi.fn(async () => undefined),
    currentNode: vi.fn(() => null),
    declaredShape: vi.fn(() => null),
    allPersonas: vi.fn(() => []),
    personasForKind: vi.fn(() => []),
    listModels: vi.fn(async () => []),
    listSources: vi.fn(async () => []),
    searchDocuments: vi.fn(() => []),
  };
  return spies(known, FEATURES) as unknown as Assistant;
}

/** The Assistant's feature objects: each one is a group of spies too. */
const FEATURES = new Set<PropertyKey>([
  "sources",
  "chats",
  "edits",
  "reviews",
  "maps",
  "locate",
  "summaries",
  "verify",
  "room",
  "reader",
  "margin",
]);

/**
 * An object whose unknown members are spies made on first read, or groups
 * of spies for the names in `groups`.
 */
function spies(
  known: Record<PropertyKey, unknown>,
  groups: ReadonlySet<PropertyKey> = new Set(),
): object {
  return new Proxy(known, {
    get(target, key) {
      if (key === "then") return undefined;
      if (!(key in target)) target[key] = groups.has(key) ? spies({}) : vi.fn();
      return target[key];
    },
  });
}
