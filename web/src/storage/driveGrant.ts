// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useSyncExternalStore } from "react";

// Whether Google still honours the Remote Storage grant, as Drive itself last
// answered. `user.driveConnected` is the writer record's note of the grant,
// and it cannot know about a revocation: a writer who removes the app from
// their Google account page revokes it at Google, and nothing tells the
// record. Without this latch, Settings would report Remote Storage connected
// while every Drive write was refused.
//
// It is set where a lapsed grant is discovered: a rejected refresh token in
// `driveToken`, and a 401/403 in `driveRest` after its own retry. Any accepted
// call clears it, so reconnecting heals itself: the first successful request
// is the proof, with no separate check to get wrong.
//
// In memory only, like the user id in `currentUser`: a persisted refusal would
// outlive itself and start the next session with an answer nobody asked Drive
// for. A reload re-learns it from the first call that needs it.

let lapsed = false;
const listeners = new Set<() => void>();

function publish(next: boolean): void {
  if (next === lapsed) return;
  lapsed = next;
  for (const listener of listeners) listener();
}

/**
 * Records that Drive refused the grant itself, not the request.
 *
 * Call it only once a refusal is separated from the transient cases: a
 * rate-limit 403 and an unreachable network are `unavailable`, and treating
 * them as a lapsed grant would tell a writer to reconnect an account that is
 * connected.
 */
export function noteDriveRefused(): void {
  publish(true);
}

/** Records that Drive accepted a call, so the grant holds now. */
export function noteDriveAccepted(): void {
  publish(false);
}

/**
 * Clears the latch. Sign-out only: a refusal earned by the previous account
 * must not greet the next one.
 */
export function resetDriveGrant(): void {
  publish(false);
}

export function driveGrantLapsed(): boolean {
  return lapsed;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether Drive has refused this session's grant and not accepted a call
 * since.
 */
export function useDriveGrantLapsed(): boolean {
  return useSyncExternalStore(subscribe, driveGrantLapsed, () => false);
}
