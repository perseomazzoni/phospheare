// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useMemo, useSyncExternalStore } from "react";
import { isPending, pendingRecords, subscribe } from "./remoteQueue";
import { pathsTouched } from "./deviceWork";
import { LOST } from "./remoteQueueStore";
import { refIdentity } from "../refIdentity";
import type { ProjectRef } from "../../storage/types";

// The sync badge, live. Whether a project is synced or pending is the queue's
// module state, outside React, so these hooks re-render per project when it
// changes.
//
// The hooks take the whole ref, not a key: two backends can hand out
// the same key string, and a badge asking by key alone would answer for
// whichever project is queued under it.

export function useSyncPending(
  /**
   * `null` for a surface with no project behind it: the demo editor, which
   * runs on `memoryProvider` and never queues anything. Accepted here because
   * a hook cannot be conditional, and "nothing owed" is the true answer.
   */
  ref: Pick<ProjectRef, "providerId" | "key"> | null,
): boolean {
  // A boolean snapshot cannot fail `useSyncExternalStore`'s identity
  // comparison the way an object or array would.
  return useSyncExternalStore(
    subscribe,
    () => (ref ? isPending(ref) : false),
    () => false,
  );
}

/** Nothing is queued. One instance, so the empty answer is stable too. */
const NOTHING: ReadonlySet<string> = new Set();

/**
 * Which of a project's files are queued, not only whether any are: many rows
 * can wait while only one is open, and `isPending` is per project, so it
 * cannot answer for the file being read.
 *
 * The Set is memoised on the queue's stable snapshot, not built in the
 * getter: `useSyncExternalStore` compares snapshots by identity, and an
 * allocating getter loops forever. `pendingRecords()` is replaced only when
 * the rows differ, so this recomputes only when the queue moves.
 */
export function useSyncPendingPaths(
  ref: Pick<ProjectRef, "providerId" | "key"> | null,
): ReadonlySet<string> {
  const records = useSyncExternalStore(
    subscribe,
    pendingRecords,
    pendingRecords,
  );
  const identity = ref ? refIdentity(ref) : null;
  return useMemo(() => {
    if (!identity) return NOTHING;
    const paths = new Set<string>();
    for (const record of records) {
      if (refIdentity(record.ref) !== identity) continue;
      for (const path of pathsTouched(record)) paths.add(path);
    }
    return paths.size > 0 ? paths : NOTHING;
  }, [records, identity]);
}

/**
 * Which of a project's files lost a queued change for good: the
 * paths the editor may restore from a buffer that still holds the change.
 * Memoised on the snapshot, like `useSyncPendingPaths`.
 */
export function useLostPaths(
  ref: Pick<ProjectRef, "providerId" | "key"> | null,
): ReadonlySet<string> {
  const records = useSyncExternalStore(
    subscribe,
    pendingRecords,
    pendingRecords,
  );
  const identity = ref ? refIdentity(ref) : null;
  return useMemo(() => {
    if (!identity) return NOTHING;
    const paths = new Set<string>();
    for (const record of records) {
      if (refIdentity(record.ref) !== identity) continue;
      if (record.stopped?.code !== LOST || record.op.kind !== "put") continue;
      paths.add(record.op.path);
    }
    return paths.size > 0 ? paths : NOTHING;
  }, [records, identity]);
}
