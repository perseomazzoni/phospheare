// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Manifest persistence, keyed `[userId, projectId]`. `projectId` is the
// project's own `document.id`, and `userId` keeps two accounts sharing
// a browser from reading each other's pairing state. `userId` comes from
// `getCurrentUserId()`, because `pairing.ts`'s cache warms before a component
// could supply one.
//
// Do not key it by the local folder name. A writer who forgets a synced book
// and starts a new one in a folder of the same name would see the new book
// inherit the old one's pairing and baselines, and the queue would commit the
// new book's files into the old book's remote folder.
//
// Losing this store costs one reconciliation pass, never data: the `remote`
// hint in `document-properties.json` lets a device re-establish the pairing.
//
// The two reads answer "absent" only for a record that is not there. A read
// that fails rejects instead: the queue takes an absent pairing as the
// writer's unpairing and drops the project's queued changes, so a database
// hiccup must never look like one.

import { STORE_SYNC, tx, txPair } from "../../storage/idb";
import { getCurrentUserId } from "../../auth/currentUser";
import type { SyncManifest } from "./manifest";

type StoredKey = [userId: string, projectId: string];

function keyFor(projectId: string): StoredKey {
  const userId = getCurrentUserId();
  if (!userId) throw new Error("manifestStore: called with no signed-in user");
  return [userId, projectId];
}

/**
 * The project's manifest, or `null` when none is stored or nobody is signed
 * in. Rejects when the store cannot be read.
 */
export async function getManifest(
  projectId: string,
): Promise<SyncManifest | null> {
  if (!getCurrentUserId()) return null;
  const record = await tx<SyncManifest | undefined>(
    STORE_SYNC,
    "readonly",
    (s) => s.get(keyFor(projectId)),
  );
  return record ?? null;
}

export async function putManifest(
  projectId: string,
  manifest: SyncManifest,
): Promise<void> {
  await tx(STORE_SYNC, "readwrite", (s) => s.put(manifest, keyFor(projectId)));
}

export async function removeManifest(projectId: string): Promise<void> {
  try {
    await tx(STORE_SYNC, "readwrite", (s) => s.delete(keyFor(projectId)));
  } catch {
    // A failed delete of a manifest is not worth failing over.
  }
}

/**
 * Drop every stored manifest that belongs neither to `currentUserId` nor to
 * a `spared` account kept on this browser. The user-scoped key keeps a
 * manifest from answering for the wrong account, but a stale account's rows
 * stay in IndexedDB until this clears them.
 */
export async function removeManifestsExcept(
  currentUserId: string,
  ...spared: string[]
): Promise<void> {
  const kept = [currentUserId, ...spared];
  try {
    const keys = await tx<IDBValidKey[]>(STORE_SYNC, "readonly", (s) =>
      s.getAllKeys(),
    );
    const stale = keys.filter(
      (k): k is StoredKey => Array.isArray(k) && !kept.includes(k[0] as string),
    );
    await Promise.all(
      stale.map((k) => tx(STORE_SYNC, "readwrite", (s) => s.delete(k))),
    );
  } catch {
    // Best-effort, like every clearing call in this module.
  }
}

/**
 * Every paired project the signed-in user has on this device. Rejects when
 * the store cannot be read.
 */
export async function allManifests(): Promise<
  { projectId: string; manifest: SyncManifest }[]
> {
  const userId = getCurrentUserId();
  if (!userId) return [];
  // Both reads share one transaction: a write landing between separate
  // `getAllKeys()` and `getAll()` transactions would shift every
  // `manifests[i]` one row away from its `keys[i]`.
  const [keys, manifests] = await txPair<IDBValidKey[], SyncManifest[]>(
    STORE_SYNC,
    (s) => [s.getAllKeys(), s.getAll()],
  );
  return keys
    .map((key, i) => ({ key, manifest: manifests[i] }))
    .filter(
      (e): e is { key: StoredKey; manifest: SyncManifest } =>
        Array.isArray(e.key) && e.key[0] === userId && !!e.manifest,
    )
    .map((e) => ({ projectId: String(e.key[1]), manifest: e.manifest }));
}
