// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  emptyManifest,
  type RemoteTarget,
  type SyncManifest,
} from "./manifest";
import {
  allManifests,
  getManifest,
  putManifest,
  removeManifest,
} from "./manifestStore";
import { onUserChange } from "../../auth/currentUser";
import { dropWorkingCopy } from "../../storage/cache/opfsCacheStore";

// Pairing: whether a local project is paired, and with what on which
// backend. A pairing is a manifest that exists, and its target is the
// manifest's `remote` (`manifest.ts`). The answers are mirrored into an
// in-memory map loaded on first call and kept live by `pair` and `unpair`, the
// only two writers.
//
// Every read goes through the async functions, which load the cache on first
// call, except `pairingForSync`. The sync machinery never reads
// synchronously: `remoteFor` resolves the destination on entry, and it can
// await.
//
// `allManifests()` scopes to whoever `getCurrentUserId()` names, so the cache
// holds one user's data, and a map built for one user is wrong once another
// signs in on the same tab. It resets on every user change rather than warming
// at import, when there is no user yet, and reloads once a user exists so a
// route mounting after sign-in finds it warm.
//
// A load that fails is not kept: the read rejects to its caller, and the next
// call reads again. An empty map cached from a failed read would answer "not
// paired" for every project until the account changed, and the queue drops a
// device project's changes on that answer (`remoteQueue.ts`, `drainOnce`).

let cache: Map<string, RemoteTarget> | null = null; // projectId -> remote

async function ensureLoaded(): Promise<Map<string, RemoteTarget>> {
  if (!cache) {
    const all = await allManifests();
    cache = new Map(
      all.map(({ projectId, manifest }) => [projectId, manifest.remote]),
    );
  }
  return cache;
}

onUserChange((userId) => {
  cache = null;
  // Only a warm-up: a failed one leaves the cache empty, and the first real
  // read tries again and reports its own failure.
  if (userId) void ensureLoaded().catch(() => {});
});

function sameTarget(a: RemoteTarget, b: RemoteTarget): boolean {
  return a.providerId === b.providerId && a.key === b.key;
}

/**
 * Pairs the project with `remote`. `baselines`, when given, are what a copy
 * just made both sides hold (`baselinesForUpload`), and the manifest starts
 * from them in place of any it had. Rejects, writing nothing, when the stored
 * manifest cannot be read: an empty one written over it would drop its
 * baselines.
 */
export async function pair(
  projectId: string,
  remote: RemoteTarget,
  baselines?: SyncManifest["files"],
): Promise<void> {
  const map = await ensureLoaded();
  const existing = await getManifest(projectId);
  if (baselines) {
    await putManifest(projectId, {
      ...emptyManifest(remote),
      files: baselines,
    });
  } else if (!existing || !sameTarget(existing.remote, remote)) {
    await putManifest(
      projectId,
      existing ? { ...existing, remote } : emptyManifest(remote),
    );
  }
  map.set(projectId, remote);
}

export async function unpair(projectId: string): Promise<void> {
  const map = await ensureLoaded();
  const remote = map.get(projectId);
  await removeManifest(projectId);
  map.delete(projectId);
  // An unpaired project is Local and never reads a working copy, so the one
  // it filled for this remote is only disk.
  if (remote) await dropWorkingCopy({ id: projectId, remote });
}

/**
 * The project's remote, or `null` when it is not paired. Rejects when the
 * pairings cannot be read, which says nothing about whether it is paired.
 */
export async function pairingFor(
  projectId: string,
): Promise<RemoteTarget | null> {
  const map = await ensureLoaded();
  return map.get(projectId) ?? null;
}

/**
 * Synchronous and best-effort: on a cold load the first call can land before
 * `ensureLoaded`'s IndexedDB read resolves, and returns null for a paired
 * project. Use it only where a null degrades a menu, never the data.
 */
export function pairingForSync(projectId: string): RemoteTarget | null {
  return cache?.get(projectId) ?? null;
}

/**
 * Every pairing this device holds, project id to remote, as a copy so a
 * caller iterating it cannot mutate the live cache. Forward only: an inverse
 * keyed by remote folder id would need a composite key to keep two backends'
 * identical ids apart. Rejects when the pairings cannot be read.
 */
export async function allPairings(): Promise<Map<string, RemoteTarget>> {
  return new Map(await ensureLoaded());
}
