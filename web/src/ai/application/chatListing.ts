// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ChatRecord } from "../domain/types";
import { reviewProgressOf } from "./reviewRun";
import type { WorkflowHost } from "./workflowRun";

// The chat list as the project opens: the stored listing merged with what
// this session holds, and the Resume offer a stored review plan earns. The
// single flight that joins a second caller stays in the aggregate.

/** What the listing reads and writes of the aggregate. */
export type ListingHost = Pick<
  WorkflowHost,
  | "dependencies"
  | "writes"
  | "snapshot"
  | "isDisposed"
  | "isDeleted"
  | "publish"
  | "activeChat"
  | "listCatalogue"
>;

/**
 * Load the chat list and publish it.
 *
 * The publish merges three sources: the stored listing; the session's
 * own copy of a chat whose last save failed (the stored copy is stale by
 * definition); and any record only this session has (a chat created during
 * the listing). The re-sort restores the newest-first order the adapter
 * established, because the session rows are appended.
 */
export async function listChats(host: ListingHost): Promise<void> {
  const listing = await host.dependencies.artifacts.listChats();
  if (host.isDisposed()) return;
  const state = host.snapshot();
  const local = new Map(state.chats.map((chat) => [chat.id, chat]));
  // A delete landing while the listing was in flight must not resurrect
  // its row: the session owns that predicate, so the merge reads it.
  const merged = listing.chats
    .filter((chat) => !host.isDeleted(chat.id))
    .map((chat) => {
      // The lookup is total on this branch: a failure is only ever
      // recorded with its row and only cleared with it.
      if (!host.writes.failed(chat.id)) return chat;
      return local.get(chat.id) ?? chat;
    });
  for (const chat of state.chats) {
    if (host.isDeleted(chat.id)) continue;
    if (!listing.chats.some((one) => one.id === chat.id)) merged.push(chat);
  }
  merged.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  host.publish({
    chats: merged,
    unreadable: listing.unreadable,
    activeChatId:
      state.activeChatId &&
      merged.some((chat) => chat.id === state.activeChatId)
        ? state.activeChatId
        : (merged[0]?.id ?? null),
  });
  await hydratePendingReview(host, host.activeChat());
  // Warms the titles the project search reads citations with. Until a
  // listing succeeds an answer's ids stay as the model wrote them: an id
  // nobody listed is never resolved.
  await host.listCatalogue().catch(() => undefined);
}

/**
 * A reload must not orphan a review plan: the chat's own `reviewRuns` link
 * is durable, so the Resume offer is rebuilt from the checkpoint's state.
 * A resume is offered, never automatic.
 */
export async function hydratePendingReview(
  host: ListingHost,
  chat: ChatRecord | null,
): Promise<void> {
  if (host.snapshot().running || host.isDisposed()) return;
  if (!chat?.reviewRuns?.length) {
    if (host.snapshot().pendingReview) host.publish({ pendingReview: null });
    return;
  }
  // The offer belongs to the chat on screen: a switch during a load ends
  // this one, and the newer selection publishes its own.
  const shown = () =>
    host.snapshot().activeChatId === chat.id &&
    !host.snapshot().running &&
    !host.isDisposed();
  for (const review of chat.reviewRuns) {
    try {
      const checkpoint = await host.dependencies.artifacts.loadReview(
        review.runId,
      );
      if (!shown()) return;
      if (checkpoint.state !== "complete") {
        host.publish({ pendingReview: reviewProgressOf(checkpoint) });
        return;
      }
    } catch {
      // An unreadable plan cannot be resumed; try the next link.
    }
  }
  if (shown()) host.publish({ pendingReview: null });
}
