// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { getCurrentUserId, onUserChange } from "../auth/currentUser";
import { applyAdd, applyPref, applyRemove } from "./portableDoc";
import { asCardContent, sameCardContent, sameMembership } from "./library";
import {
  editProfile,
  mergeWithDrive,
  profileDoc,
  profileRows,
  type CardContent,
  type LibraryRow,
  type RemoteProfile,
} from "./profileStore";
import type { DocumentProperties, DocumentStructure } from "../project/types";
import { appLog } from "../log";

// The app's entry point to the account's profile: the writer's preferences
// (theme, language, the AI models, library view state, the global Editor
// Settings), their library membership (provider, key and name per project)
// and the derived card content (title, type, counts, goal, per-node stats,
// structure shape, never the manuscript body text), one row per project
// carrying membership and card together. Reads and writes go to the local
// profile (`profileStore.ts`) synchronously, each write under its own clock
// (prefs: `updatedAt`; membership: `at`; card content: the card's
// `cachedAt`), and the profile applies last-write-wins.
//
// The merge with the account's other installations through Remote Storage is
// the one asynchronous step. It runs at session start, when the shelf mounts,
// when the page is left, at sign-out, and after changes: once they pause for
// `MERGE_QUIET_MS`, so a burst of Settings clicks is one merge, and no later
// than `MERGE_AT_MOST_MS` after the first change it carries, so steady
// editing still reaches the account's other devices.
//
// `SessionGate` renders nothing of the signed-in app without a signed-in
// account, so nothing calls `getPref` for an account that is not confirmed.

export interface PrefEntry {
  value: unknown;
  updatedAt: string;
}

export type PrefStore = Record<string, PrefEntry>;

/**
 * What `syncProfile` reports about the library after a merge. Content-only
 * changes are not a second flag: `refreshContent` re-applies the rows' cards
 * idempotently and returns the same array when nothing drawn changed, so it
 * runs on every settled merge.
 */
export interface LibraryReconcileResult {
  /** The merge ran for the account still signed in. */
  librarySettled: boolean;
  /** The merge changed membership (identity set or names); re-gather. */
  membershipChanged: boolean;
  /** What the merge found in Remote Storage. */
  remote: RemoteProfile;
}

export function getPref<T>(key: string, fallback: T): T {
  const userId = getCurrentUserId();
  if (!userId) return fallback;
  const entry = profileDoc(userId).prefs[key];
  return entry ? (entry.value as T) : fallback;
}

/**
 * The preferences whose value may go in the log beside the key: each holds
 * a theme, a language, an option of a fixed list, a switch or a number, and
 * never text a writer typed. A key not listed is logged by name alone, so a
 * new preference stays out until it is read and added here.
 */
const LOGGED_VALUES: ReadonlySet<string> = new Set([
  "theme",
  "language",
  "filter",
  "density",
  "proseSize",
  "typewriter",
  "focus",
  "smoothCaret",
  "autosave",
  "autosaveDelay",
  "henosis",
  "henosisAfter",
  "henosisFade",
  "henosisPause",
]);

/** The value a preference shows in the log, or `undefined` for none. */
function loggedValue(
  key: string,
  value: unknown,
): string | number | boolean | undefined {
  if (!LOGGED_VALUES.has(key)) return undefined;
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : undefined;
}

export function setPref<T>(key: string, value: T): void {
  const userId = getCurrentUserId();
  if (!userId) return; // no per-user store to write to
  const before = profileDoc(userId).prefs[key];
  const updatedAt = new Date().toISOString();
  editProfile(userId, (doc) => applyPref(doc, key, { value, updatedAt }));
  changed(userId);
  // A write that keeps the value, such as a choice made again, changes
  // nothing the writer sees.
  if (before && JSON.stringify(before.value) === JSON.stringify(value)) return;
  appLog.info("profile", "A preference changed.", {
    key,
    value: loggedValue(key, value),
  });
}

/** The library's live rows; the same array until the profile changes. */
export function libraryRows(userId: string): LibraryRow[] {
  if (!userId) return [];
  return profileRows(userId);
}

/**
 * Add a project to the library, with the card content when supplied (a sweep
 * that just read the book, a forget-then-undo carrying the restored
 * content). The card is reduced through `asCardContent` here, and only the
 * reduced shape reaches the profile.
 *
 * A row already held with the same name, location and, when a card is
 * supplied, the same drawn content (`sameCardContent`) writes nothing. The
 * adopt and scan flows call this for every project they touch, and an
 * unchanged membership must not bump a clock or schedule a merge.
 */
export function addToLibrary(
  userId: string,
  row: { id: string; provider: string; key: string; name: string },
  card?: CardContent,
): void {
  if (!userId) return;

  // An untrustable card reads as no card.
  const reduced = card === undefined ? undefined : asCardContent(card);

  // By identity, never by location. On a move the row found here is
  // the same row, so the add updates where the book lives instead of
  // starting a second row for the same book.
  const existing = libraryRows(userId).find((r) => r.id === row.id);
  if (
    existing &&
    existing.name === row.name &&
    existing.provider === row.provider &&
    existing.key === row.key &&
    (reduced === undefined || sameCardContent(existing.card, reduced))
  ) {
    return;
  }

  const at = new Date().toISOString();
  editProfile(userId, (doc) =>
    applyAdd(doc, { ...row, at, ...(reduced ? { card: reduced } : {}) }),
  );
  changed(userId);
}

/**
 * Remove a project from the library: the profile keeps a tombstone, so
 * another installation cannot bring it back. The card goes with the row: a
 * removed project's metadata does not outlive the removal.
 */
export function removeFromLibrary(userId: string, id: string): void {
  if (!userId) return;
  const at = new Date().toISOString();
  editProfile(userId, (doc) => applyRemove(doc, id, at));
  changed(userId);
}

/**
 * The reduced card a project read builds from what the files said: the pure
 * half of `rememberCard`, exported so a read that must not persist can still
 * hand its content on.
 */
export function rememberedCard(
  props: DocumentProperties,
  structure: DocumentStructure,
  at: string = new Date().toISOString(),
): CardContent | null {
  return asCardContent({
    id: props.document.id,
    title: props.document.title,
    type: props.document.type,
    words: props.stats.words,
    parts: props.stats.parts,
    sections: props.stats.sections,
    goal: props.document.goal,
    perNode: props.stats.perNode,
    structure,
    updatedAt: props.document.updatedAt,
    cachedAt: at,
  });
}

/**
 * Record what a document's properties and structure just said onto the
 * project's library row. Called only after a successful read of the real
 * file, never from a UI edit.
 *
 * An unchanged card (`sameCardContent`: every drawn field but `cachedAt`)
 * writes nothing and bumps no clock, because `cachedAt` means the last
 * observed change. A changed card, or a row's first, is a content push: it
 * names the row's membership stamp as `seenAt`, and the profile applies the
 * card under its `cachedAt` clock and never creates, revives or reorders a
 * row on it, because a content observation carries no membership authority.
 * A project with no row, removed or not yet added, gets its card back
 * unpersisted.
 *
 * It takes no ref: where the book lives is a membership fact, and a read's
 * address passed in would let a read of a copy drag the row to the copy's
 * folder, slipping past the shelf's refusal. For the same reason a read of a
 * copy (a folder holding a shelved uuid at a different address) must not
 * reach this function, or it repaints the row's card with the copy's bytes;
 * `read()` in `useProjects.ts` calls the pure `rememberedCard` then.
 */
export function rememberCard(
  userId: string,
  props: DocumentProperties,
  structure: DocumentStructure,
  at: string = new Date().toISOString(),
): CardContent | null {
  const card = rememberedCard(props, structure, at);
  if (!card || !userId) return card;

  // By the id the read produced, not by where the file was read from.
  const row = libraryRows(userId).find((r) => r.id === card.id);
  if (!row || (row.card && sameCardContent(row.card, card))) return card;
  editProfile(userId, (doc) =>
    applyAdd(doc, {
      id: card.id,
      // The row's location, not this read's: where a book lives is a
      // membership fact.
      provider: row.provider,
      key: row.key,
      name: row.name,
      at: new Date().toISOString(),
      seenAt: row.lastSeenAt ?? at,
      card,
    }),
  );
  changed(userId);
  return card;
}

/**
 * The row's name tracks the folder it describes. A Remote Storage rename is
 * a content push carrying the new name under the row's membership stamp,
 * which the profile accepts and which moves the row's clock, so the merge
 * prefers the renamed row over a copy that never saw the rename. Local
 * folders are never renamed: the File System Access API cannot rename one.
 */
export function renameLibraryRow(
  userId: string,
  provider: string,
  key: string,
  name: string,
): void {
  const row = libraryRows(userId).find(
    (r) => r.provider === provider && r.key === key,
  );
  if (!row || row.name === name) return;
  const at = new Date().toISOString();
  editProfile(userId, (doc) =>
    applyAdd(doc, {
      id: row.id,
      provider,
      key,
      name,
      at,
      seenAt: row.lastSeenAt ?? at,
    }),
  );
  changed(userId);
}

// ── The merge with Remote Storage ────────────────────────────────────────────

/** How long changes must pause before their merge runs, in milliseconds. */
export const MERGE_QUIET_MS = 5_000;

/**
 * The longest a change waits for the merge that carries it, in milliseconds,
 * however steadily changes follow it.
 */
export const MERGE_AT_MOST_MS = 30_000;

/**
 * The merge in flight in this tab. `SessionGate`, the shelf and the editor
 * all ask for one as they mount, twice per commit in dev under
 * `<React.StrictMode>`, so a call for the same account joins it rather than
 * listing and reading Remote Storage again.
 */
let running: { userId: string; task: Promise<LibraryReconcileResult> } | null =
  null;

/**
 * The merge scheduled for changes that has not started yet, with the time of
 * the first change it carries.
 */
let pending: {
  userId: string;
  timer: ReturnType<typeof setTimeout>;
  since: number;
} | null = null;

function cancelPending(userId?: string): void {
  if (!pending || (userId !== undefined && pending.userId !== userId)) return;
  clearTimeout(pending.timer);
  pending = null;
}

// A merge scheduled for one account never runs for the next.
onUserChange(() => cancelPending());

/**
 * Schedules the merge that carries a change: `MERGE_QUIET_MS` after the
 * latest change, and never later than `MERGE_AT_MOST_MS` after the first one
 * not yet merged. A change made while a merge runs schedules the next one,
 * since the running merge may have read the profile before it.
 */
function changed(userId: string): void {
  if (userId !== getCurrentUserId()) return;
  const now = Date.now();
  const since = pending?.userId === userId ? pending.since : now;
  cancelPending();
  const delay = Math.max(
    0,
    Math.min(MERGE_QUIET_MS, since + MERGE_AT_MOST_MS - now),
  );
  pending = {
    userId,
    since,
    timer: setTimeout(() => {
      pending = null;
      void mergeAfterNow(userId).catch(() => {
        // Never rejects; the next trigger merges again.
      });
    }, delay),
  };
}

async function merge(userId: string): Promise<LibraryReconcileResult> {
  const before = profileRows(userId);
  const remote = await mergeWithDrive(userId);
  if (getCurrentUserId() !== userId)
    return { librarySettled: false, membershipChanged: false, remote: "off" };
  return {
    librarySettled: true,
    membershipChanged: !sameMembership(before, profileRows(userId)),
    remote,
  };
}

function startMerge(userId: string): Promise<LibraryReconcileResult> {
  if (running?.userId === userId) return running.task;
  // This merge carries every change made so far.
  cancelPending(userId);
  const task = merge(userId).finally(() => {
    if (running?.task === task) running = null;
  });
  running = { userId, task };
  return task;
}

/** A merge that starts after this call: after the one in flight, if any. */
function mergeAfterNow(userId: string): Promise<LibraryReconcileResult> {
  const prior = running?.task;
  if (!prior) return startMerge(userId);
  return prior.then(
    () => startMerge(userId),
    () => startMerge(userId),
  );
}

/**
 * Merges the account's profile with Remote Storage and reports what changed
 * on the shelf. Joins a merge in flight; with `fresh`, waits for it and runs
 * one that starts after this call, so every change made before it is
 * carried.
 */
export function syncProfile(
  userId: string,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<LibraryReconcileResult> {
  return fresh ? mergeAfterNow(userId) : startMerge(userId);
}

/**
 * Runs the merge a change scheduled now, or waits for the one in flight, so
 * a change made before the page is left or the account signs out does not
 * wait for the next session to reach the account's other installations.
 */
export async function flushProfile(): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId) return;
  if (pending?.userId === userId) {
    cancelPending();
    await mergeAfterNow(userId);
    return;
  }
  if (running?.userId === userId) await running.task;
}
