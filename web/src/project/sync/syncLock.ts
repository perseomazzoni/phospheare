// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The project sync lock: one lock per book over its manifest, shared by every
// tab. The manifest is read-modify-written by three writers that nothing else
// serializes. `checkSync` reads it, scans both sides and writes it back; the
// queue's drain applies each op and levels its baseline; a conflict
// resolution copies one side over the other and writes a rebuilt one.
// Interleaved, the later write carries the earlier one's stale copy and drops
// its baselines, so each holds this lock for its whole step. The manifest
// lives in IndexedDB, which every tab of the origin shares, so a lock that
// ordered one tab would leave another tab's check free to undo this one's
// drain.
//
// The key is the signed-in user and the book, as the manifest's is: one
// account's push still in flight must not hold the next account's checks.
//
// Never take the queue's own per-project lock inside this one: the drain holds
// that lock when it asks for this one, and the reverse order would deadlock.

import { getCurrentUserId } from "../../auth/currentUser";
import { exclusive } from "./tabLock";

export function withSyncLock<T>(
  projectId: string,
  run: () => Promise<T>,
): Promise<T> {
  return exclusive(
    `project-sync\u0000${getCurrentUserId() ?? ""}\u0000${projectId}`,
    run,
  );
}
