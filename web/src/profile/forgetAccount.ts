// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Imported by their own paths, not through the storage index, which registers
// every provider and would bring the Drive client with it.
import { forgetDriveToken } from "../storage/driveToken";
import { resetDriveGrant } from "../storage/driveGrant";
import {
  listHandles,
  removeHandle,
  removeHandlesExcept,
} from "../storage/handleStore";
import {
  allManifests,
  removeManifest,
  removeManifestsExcept,
} from "../project/sync/manifestStore";
import { forgetProject } from "../project/sync/remoteQueue";
import {
  pendingProjects,
  removeQueuedExcept,
} from "../project/sync/remoteQueueStore";
import { markUserPurged } from "./purgeLatch";
import { dropOtherUserCaches, dropUserCache } from "../storage/cache/cacheRoot";
import { AI_SETTINGS_PREFIX } from "../ai/settings";
import { IDENTITY_PROOF_PREFIX } from "../platform/identityProof";
import { syncProfile } from "./profileSync";
import {
  PROFILE_PREFIX,
  profileSyncState,
  removeProfile,
} from "./profileStore";

// The remember-the-key choice's account-keyed localStorage prefix, which
// `ai/host/openrouterConnection.ts` does not export. It must match the key
// that module writes.
const OPENROUTER_REMEMBER_PREFIX = "openrouter.remember.";

// ── Purging one account's local data ─────────────────────────────────────────
//
// The one routine that clears an account's local data, run by a cleaning
// sign-out: afterwards this browser holds nothing of the account, as before
// its first entry. A sign-out that leaves everything does not run it.
//
// One key per user holds the account's profile (prefs, library membership,
// card content), so that wipe is one `removeProfile`: the account finds it
// again at the next sign-in only through Remote Storage.
//
// It does not disconnect Remote Storage: that is the caller's network call.
// This function is local storage only and never throws.
//
// Precondition: `getCurrentUserId()` still equals `userId`. The handle, sync
// and queue stores are scoped to whichever account is signed in, not to a
// parameter, so `AuthContext`'s `signOut` purges before clearing the local
// user.
export async function purgeLocalData(userId: string): Promise<void> {
  // Set first: the profile refuses writes from here until the next auth
  // change, so nothing written before sign-out resurrects what this wipe
  // deletes.
  markUserPurged(userId);
  // Through `removeProfile`, so the parse memo goes with the key.
  removeProfile(userId);
  // The choice to remember the OpenRouter key, and the identity proof, go
  // with the account; the key itself is the vault's to forget.
  removeRawKeys(
    accountKeys(OPENROUTER_REMEMBER_PREFIX, (id) => id === userId),
    accountKeys(IDENTITY_PROOF_PREFIX, (id) => id === userId),
  );
  // The device-local Ollama connection is account-scoped too. No signed-out
  // key exists.
  removeRawKeys(accountKeys(`${AI_SETTINGS_PREFIX}.`, (id) => id === userId));
  await dropUserCache(userId);
  forgetDriveToken();
  // The token and the grant latch are one fact in two places: a refusal this
  // account earned must not greet the next one before its first Remote
  // Storage request.
  resetDriveGrant();

  try {
    const [handles, manifests, queued] = await Promise.all([
      listHandles(),
      // A manifest store that cannot be read leaves its rows, which are keyed
      // by the account, and the handles and the queue are still cleared.
      allManifests().catch(() => []),
      pendingProjects(),
    ]);
    await Promise.all([
      ...handles.map((h) => removeHandle(h.key)),
      ...manifests.map((m) => removeManifest(m.projectId)),
      ...queued.map((ref) => forgetProject(ref)),
    ]);
  } catch {
    // Best-effort: a record that fails to clear does not block a sign-out.
  }
}

// ── Sweeping every other account ─────────────────────────────────────────────
//
// Data under an id with no account record is a leftover: a cleaning sign-out
// that did not finish, or a crash between steps. It is wiped on every entry
// to the app, a warm reload included. The signed-in account and
// every account that signed out leaving its things here keep a record, and
// their data is never touched.
//
// It never touches `currentUserId`'s own data and never calls
// `forgetDriveToken()`: the token belongs to the confirmed session.

/**
 * Every `localStorage` key that starts with `prefix` and then names an
 * account id matching the predicate: `<prefix><userId>` or
 * `<prefix><userId>.<name>`. Account ids hold no dot. Keys that are missed
 * outlive sign-out and greet the next session with another account's
 * endpoint, profile or key.
 */
function accountKeys(
  prefix: string,
  predicate: (id: string) => boolean,
): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length).split(".")[0];
      if (id && predicate(id)) keys.push(key);
    }
  } catch {
    // Storage disabled or unreadable: nothing to sweep.
  }
  return keys;
}

function removeRawKeys(...groups: string[][]): void {
  for (const key of groups.flat()) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Best-effort, as in `purgeLocalData`.
    }
  }
}

export async function purgeOtherUsersLocalData(
  currentUserId: string,
  ...spared: string[]
): Promise<void> {
  const kept = [currentUserId, ...spared];
  const other = (id: string) => !kept.includes(id);
  // Every account-keyed entry but the kept accounts' own, whatever id it
  // carries, `anonymous` included.
  removeRawKeys(
    accountKeys(`${AI_SETTINGS_PREFIX}.`, other),
    accountKeys(PROFILE_PREFIX, other),
    accountKeys(OPENROUTER_REMEMBER_PREFIX, other),
    accountKeys(IDENTITY_PROOF_PREFIX, other),
  );

  try {
    await Promise.all([
      removeHandlesExcept(currentUserId, ...spared),
      removeManifestsExcept(currentUserId, ...spared),
      removeQueuedExcept(currentUserId, ...spared),
      dropOtherUserCaches(currentUserId, ...spared),
    ]);
  } catch {
    // Best-effort, as in `purgeLocalData`.
  }
}

// ── Saving the profile before a purge ────────────────────────────────────────
//
// While Remote Storage is connected, a cleaning sign-out writes the profile
// to Remote Storage before it disconnects or removes anything, and waits a
// bounded time: a writer leaving a shared computer is not held by a slow
// network.

/**
 * How long a sign-out waits for the profile to reach Remote Storage, in
 * milliseconds.
 */
export const PROFILE_UPLOAD_MS = 10_000;

/**
 * True when `work` resolves within `ms`; false when it rejects or the time
 * runs out first. Never rejects, and leaves no timer running.
 */
export async function settlesWithin(
  work: Promise<unknown>,
  ms: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([
      work.then(
        () => true,
        () => false,
      ),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Writes the account's profile to Remote Storage, every change included,
 * before a cleaning sign-out removes the local copy. True only when a merge
 * that started after this call finished within `PROFILE_UPLOAD_MS`; false
 * when it failed, ran out of time or Remote Storage is not connected. Never
 * rejects.
 */
export async function uploadProfile(userId: string): Promise<boolean> {
  const started = Date.now();
  if (
    !(await settlesWithin(
      syncProfile(userId, { fresh: true }),
      PROFILE_UPLOAD_MS,
    ))
  )
    return false;
  // A failed merge is reported in the sync state, not by rejecting.
  const state = profileSyncState(userId);
  return state.kind === "synced" && Date.parse(state.at) >= started;
}
