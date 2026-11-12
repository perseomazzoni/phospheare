// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { onUserChange } from "../auth/currentUser";

// `purgeLocalData` must run while its user is still signed in, because the
// IndexedDB stores it clears are scoped to the current user.
// Between the purge and the sign-out, a stray write (a pagehide flush, a
// stale component) could recreate what the purge deleted, resurrecting data
// after the writer accepted a wipe. Once a user is marked purged, every
// per-user store refuses writes for it until the next auth change, when a
// fresh session may write again.

const purged = new Set<string>();

/** Refuses further per-user writes for a user until the next auth change. */
export function markUserPurged(userId: string): void {
  purged.add(userId);
}

/** Whether the purge latch is held; a writer for that user must refuse. */
export function isUserPurged(userId: string): boolean {
  return purged.has(userId);
}

onUserChange(() => purged.clear());
