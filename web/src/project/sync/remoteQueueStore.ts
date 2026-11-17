// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { INDEX_QUEUE_USER_ID, STORE_QUEUE, tx } from "../../storage/idb";
import { getCurrentUserId } from "../../auth/currentUser";
import { refIdentity } from "../refIdentity";
import type { Op } from "../../storage/mirrored";
import { appLog, describeError } from "../../log";

/**
 * A queued project as a lookup names it: where its bytes are.
 *
 * The queue's index is keyed by address, `refIdentity(record.ref)`, because
 * an op is work owed to a destination, and two records for one folder are one
 * project's work whether or not anything can name the book. Readers ask by
 * address; only the writer supplies an identity.
 */
export type ProjectAddress = Pick<QueuedProject, "providerId" | "key">;

/**
 * The project an op belongs to: the whole ref, not a bare key. A Remote-only
 * project's key is a backend's folder id, not a local one.
 *
 * The structured pair, not the joined `refIdentity` string, because the drain
 * needs `providerId` to open the working copy and name the destination, and a
 * device project's `key` is a writer-chosen folder name that may contain a
 * colon. `refIdentity` is derived from it for map keys, never stored.
 */
export interface QueuedProject {
  /**
   * The project's own id. Stored, not looked up: this store can hold
   * work that exists nowhere else, so it answers with no library mirror. The
   * budget sweep decides whether a working copy is safe to destroy from these
   * records, and a lookup that came back empty would read as nothing to
   * protect.
   */
  id: string;
  providerId: string;
  key: string;
}

// Remote queue persistence: one shared IndexedDB store across every synced
// project, keyed by an autoincrement id that is also the FIFO order: `getAll()`
// returns rows in ascending key order, so filtering by
// `refIdentity(record.ref)` keeps each project's insertion order.
//
// Records carry `userId` as a field, not in the key, because a compound key
// would lose that order. The `userId` index declared in `idb.ts` keeps a
// per-user drain to its own rows. `getCurrentUserId()` supplies the id,
// because `main.tsx` resumes drains at boot, before any component could pass
// one.

export interface RemoteQueueRecord {
  id: number;
  userId: string;
  ref: QueuedProject;
  op: Op;
  /**
   * Present once this op has been given up on, absent while it is live.
   *
   * A failed op is never removed. The queue's source can be the working copy,
   * the only copy of those bytes, so an op deleted because it failed is a
   * manuscript deleted. The op stays where it was and the drain stops
   * at it: draining the op behind a stopped one writes a later state on top of
   * a missing earlier one, the right bytes at the wrong path.
   *
   * It holds `code` and no timestamp, because nothing reads the age of a
   * stop.
   */
  stopped?: { code: string | null };
}

/**
 * The stop code for a `put` whose bytes are gone.
 *
 * A Remote-only project's working copy is the only copy of a queued change,
 * so a `put` whose entry has vanished, as when an idle in-memory partition
 * drops OPFS bytes, can never land. No retry, re-grant or new session brings
 * the bytes back. So it is the one stop `clearStopped` leaves alone, the one
 * the drain steps past (a put carries no structure, so skipping it keeps the
 * order safe and the remote never gets that change), and the one the writer
 * can dismiss.
 */
export const LOST = "lost";

export async function appendOp(ref: QueuedProject, op: Op): Promise<number> {
  const userId = getCurrentUserId();
  if (!userId)
    throw new Error("remoteQueueStore: called with no signed-in user");
  return tx<number>(
    STORE_QUEUE,
    "readwrite",
    (s) => s.add({ userId, ref, op }) as IDBRequest<number>,
  );
}

export async function removeOp(id: number): Promise<void> {
  try {
    await tx(STORE_QUEUE, "readwrite", (s) => s.delete(id));
  } catch {
    // Already gone is the goal.
  }
}

/** Give up on one op without destroying it, as `RemoteQueueRecord.stopped`. */
export async function markStopped(
  id: number,
  code: string | null,
): Promise<void> {
  try {
    const record = await tx<RemoteQueueRecord | undefined>(
      STORE_QUEUE,
      "readonly",
      (s) => s.get(id) as IDBRequest<RemoteQueueRecord | undefined>,
    );
    // Gone means the drain removed it on a success that raced this call.
    // Re-adding it would resurrect a landed op.
    if (!record) return;
    await tx(STORE_QUEUE, "readwrite", (s) =>
      s.put({ ...record, stopped: { code } }),
    );
  } catch (err) {
    // Best-effort, like every write in this module: a failure to record the
    // stop leaves the op live, which retries and never destroys.
    appLog.warn("sync", "A stopped change could not be recorded.", {
      op: id,
      ...describeError(err),
    });
  }
}

/**
 * Let a project's stopped ops be tried again.
 *
 * Called when the cause of a stop may have changed: the writer asking
 * (`retryNow`), and a new session resuming (`drainAll`), when a lapsed folder
 * grant may have been renewed. Not on the `online` event: a refusal, an
 * oversized file or an unusable path is not a connection problem, and
 * retrying every stopped op on each reconnect would burn the failure cap
 * again.
 */
export async function clearStopped(ref: QueuedProject): Promise<void> {
  let failed = 0;
  let first: { op: number; err: unknown } | null = null;
  for (const record of await opsFor(ref)) {
    // A lost change stays lost: retrying it would only find it gone again.
    if (!record.stopped || record.stopped.code === LOST) continue;
    const { stopped: _dropped, ...live } = record;
    try {
      await tx(STORE_QUEUE, "readwrite", (s) => s.put(live));
    } catch (err) {
      // Best-effort, like `markStopped`.
      failed += 1;
      first ??= { op: record.id, err };
    }
  }
  if (first) {
    appLog.warn("sync", "Stopped changes could not be released.", {
      op: first.op,
      failed,
      ...describeError(first.err),
    });
  }
}

let pendingReadLogged = false;

/**
 * Every live op for the signed-in user, oldest first.
 *
 * The queue's index and the notice's count are both derived from this read,
 * so neither can be a row out of date with the other.
 *
 * It reads `getCurrentUserId()` at call time and fails closed to `[]`. It is
 * a read of metadata, not a write of prose, so the rule that binds the user
 * rather than consulting it does not apply. The caller re-checks the
 * id across the await.
 */
export async function allPendingOps(): Promise<RemoteQueueRecord[]> {
  const userId = getCurrentUserId();
  if (!userId) return [];
  try {
    return await tx<RemoteQueueRecord[]>(STORE_QUEUE, "readonly", (s) =>
      s.index(INDEX_QUEUE_USER_ID).getAll(userId),
    );
  } catch (err) {
    // Read on every drain step, so a store that stays unreadable writes
    // one line a session.
    if (!pendingReadLogged) {
      pendingReadLogged = true;
      appLog.warn("sync", "The sync queue could not be read.", {
        ...describeError(err),
      });
    }
    return [];
  }
}

/**
 * The open account's pending ops, refusing where `allPendingOps` answers
 * `[]`: a preflight to a destructive action must tell an unreadable queue
 * from an empty one.
 */
export async function pendingOpsOrThrow(): Promise<RemoteQueueRecord[]> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error("No account is open.");
  return tx<RemoteQueueRecord[]>(STORE_QUEUE, "readonly", (s) =>
    s.index(INDEX_QUEUE_USER_ID).getAll(userId),
  );
}

/** One project's pending ops, oldest first. */
export async function opsFor(
  ref: ProjectAddress,
): Promise<RemoteQueueRecord[]> {
  const identity = refIdentity(ref);
  return (await allPendingOps()).filter((r) => refIdentity(r.ref) === identity);
}

/** Every project with at least one op waiting; a cold boot resumes these. */
export async function pendingProjects(): Promise<QueuedProject[]> {
  return projectsOf(await allPendingOps());
}

/**
 * `pendingProjects`, for a caller that destroys what is not named: it throws
 * where `pendingProjects` answers `[]`, on a read that failed or with no
 * signed-in user.
 *
 * The cache budget evicts every working copy this does not name, and the
 * working copy can be the only copy of queued work. An empty answer
 * from a store that could not be read would name nothing, so the failure
 * must reach the sweep, which then evicts nothing.
 */
export async function pendingProjectsOrThrow(): Promise<QueuedProject[]> {
  const userId = getCurrentUserId();
  if (!userId)
    throw new Error("remoteQueueStore: called with no signed-in user");
  const records = await tx<RemoteQueueRecord[]>(STORE_QUEUE, "readonly", (s) =>
    s.index(INDEX_QUEUE_USER_ID).getAll(userId),
  );
  return projectsOf(records);
}

function projectsOf(records: readonly RemoteQueueRecord[]): QueuedProject[] {
  const seen = new Map<string, QueuedProject>();
  for (const record of records) {
    seen.set(refIdentity(record.ref), record.ref);
  }
  return [...seen.values()];
}

/** Drop every pending op for a project. */
export async function dropOps(ref: ProjectAddress): Promise<void> {
  for (const record of await opsFor(ref)) {
    await removeOp(record.id);
  }
}

/**
 * Drop every pending op that belongs neither to `currentUserId` nor to a
 * `spared` account kept on this browser. `INDEX_QUEUE_USER_ID` only scopes
 * reads to one user, and no index query excludes one, so this is a full scan.
 */
export async function removeQueuedExcept(
  currentUserId: string,
  ...spared: string[]
): Promise<void> {
  const kept = [currentUserId, ...spared];
  try {
    const all = await tx<RemoteQueueRecord[]>(STORE_QUEUE, "readonly", (s) =>
      s.getAll(),
    );
    const stale = all.filter((r) => !kept.includes(r.userId));
    await Promise.all(stale.map((r) => removeOp(r.id)));
  } catch {
    // Best-effort, like every clearing call in this module.
  }
}

/**
 * The writer has read that these changes were lost: let the rows go.
 *
 * The one removal of an op that did not land. A lost `put` carries a path and
 * no bytes, and the bytes it pointed at exist nowhere, so the row is the
 * notice of a loss, not the work. Removing it destroys only the sentence.
 */
export async function forgetLost(): Promise<void> {
  for (const record of await allPendingOps()) {
    if (record.stopped?.code === LOST) {
      await removeOp(record.id);
    }
  }
}
