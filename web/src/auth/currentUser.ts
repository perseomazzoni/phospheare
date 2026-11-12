// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The current user, for everything below the account boundary.
// `StorageProvider` is account-agnostic, and several callers cannot take a
// user id as a parameter: the cache in `pairing.ts` warms at module import,
// and `main.tsx` reads the stored theme before `AuthContext` has adopted the
// signed-in account.
//
// Only `AuthContext` sets it, through its one `adopt`; everything below reads
// it here.
//
// A slot, not a map: one user is signed in per browser tab.

type Listener = (userId: string | null) => void;

let current: string | null = null;

/**
 * Whether `AuthContext` has answered at all.
 *
 * `current === null` covers two states: `AuthContext` not mounted yet, and
 * auth having answered nobody. Listeners must hear the move into the second
 * even when `current` was already `null`, and this flag is how
 * `setCurrentUserId` tells them apart.
 */
let resolved = false;
const listeners = new Set<Listener>();

export function getCurrentUserId(): string | null {
  return current;
}

/**
 * Called by `AuthContext` on every auth transition, including the one that
 * concludes there is no user.
 *
 * The first answer always notifies, even `null` when `current` was already
 * `null`: it is the moment an unverified session stops being a claim, and
 * listeners that painted a pre-auth guess must hear it. After that, setting
 * the id already held notifies nobody, so re-reading the same signed-in user
 * resets nothing.
 */
export function setCurrentUserId(userId: string | null): void {
  const firstAnswer = !resolved;
  resolved = true;
  if (userId === current && !firstAnswer) return;
  current = userId;
  for (const listener of listeners) listener(userId);
}

/**
 * Subscribes to every change of user, sign-out included; returns the
 * unsubscribe. A module holding in-memory state built for the user then
 * current must discard it on every switch.
 */
export function onUserChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
