// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The working copy's root, and the only file that may open OPFS. Anything
// bound for a remote is written to the working copy first and committed by
// the queue; local disk stays direct. This file owns the layout
// and nothing else: no read policy, no staleness rule, no retry. Those live
// above the port, where a fake can reach them.
//
// `navigator.storage.getDirectory()` appears in this one file in `web/src`.
// No browser reports an eviction as an event, so a test can produce one only
// through a fake that drops entries between two awaits inside the layer's own
// operation, and a fake needs a single seam. `opfsSeam.test.ts` pins the
// count.
//
// The layout is `<opfs root>/cache/<userId>/…`. Per-project scoping belongs
// to the store above it; this layer keeps every user's working copy purgeable
// as a whole.

/** The one directory this app claims in OPFS. */
export const CACHE_DIR = "cache";

/**
 * A user id that is safe as a directory name.
 *
 * Identity issues auto-increment ids (`$table->id()`), which are digits, but
 * the check is anchored and total anyway: the value arrives in a JSON body,
 * and a path segment built from an untrusted string admits traversal and name
 * shadowing. A ulid or uuid passes unchanged.
 *
 * Fails closed, like `handleStore`: a caller with no usable id gets an
 * exception, never a shared "anonymous" directory. One account's prose must
 * never be reachable from another's session, and refusing to name a directory
 * guarantees that.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function userDirName(userId: string): string {
  if (!SAFE_ID.test(userId)) {
    throw new Error(`cacheRoot: refusing to build a path from "${userId}"`);
  }
  return userId;
}

/**
 * Whether this browser has OPFS.
 *
 * Chrome/Edge 86+, Firefox 111+ and Safari 15.2+ have it, iOS included, where
 * the File System Access picker does not exist. Absence is not an error; every
 * caller in this file is best-effort.
 */
export function cacheSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
}

async function cacheDir(): Promise<FileSystemDirectoryHandle | null> {
  if (!cacheSupported()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(CACHE_DIR, { create: false });
  } catch {
    // Nothing cached yet, or storage unavailable: either way there is nothing
    // to purge, which is the answer every caller below wants.
    return null;
  }
}

/**
 * One user's cache directory, or `null` where there is no OPFS or, with
 * `create: false`, no directory yet.
 *
 * The one way anything above this file reaches OPFS. It returns a handle, not
 * a path: a caller holding a string would re-walk from the root, and
 * re-walking admits traversal.
 *
 * It uses the id it is given and never reads `getCurrentUserId()`. The caller
 * binds an identity once, at construction, and re-checks it just before bytes
 * land. A helper that read the current id on every call would re-point a
 * write to another user mid-operation.
 *
 * Rejects on a real failure, unlike the best-effort deletes below. This is the
 * write path: a caller that cannot get a directory fails its save, never
 * skips it silently. Where there is no OPFS it resolves `null`, so the layer
 * above declines to cache instead of breaking.
 *
 * A probe passes `create: false`. A read that scaffolded `cache/<userId>/` on
 * its way to a miss would leave an empty directory for `dropOtherUserCaches`
 * to sweep, turning a read into a side effect on the sign-out path. An absent
 * directory resolves `null`, the same answer as an empty cache.
 */
export async function userCacheDir(
  userId: string,
  { create }: { create: boolean },
): Promise<FileSystemDirectoryHandle | null> {
  if (!cacheSupported()) return null;
  const name = userDirName(userId);
  const root = await navigator.storage.getDirectory();
  try {
    const cache = await root.getDirectoryHandle(CACHE_DIR, { create });
    return await cache.getDirectoryHandle(name, { create });
  } catch (err) {
    // Absent is not a failure when the caller did not ask to create it.
    if (
      !create &&
      err instanceof DOMException &&
      err.name === "NotFoundError"
    ) {
      return null;
    }
    throw err;
  }
}

/**
 * Drop one user's whole working copy.
 *
 * Runs on every sign-out, in all four cells of the purge table, whatever the
 * writer answers to the purge question. That question is about setup (device
 * handles, prefs, the Remote Storage grant), and the working copy re-fills on
 * demand, so keeping it has no upside and a real cost on a shared machine.
 *
 * Unlike a project folder, the working copy is a place the writer never chose
 * and cannot reach, so the app deletes it.
 *
 * Never throws, like `purgeLocalData`: it must not block a sign-out or an
 * account deletion.
 */
export async function dropUserCache(userId: string): Promise<void> {
  let name: string;
  try {
    name = userDirName(userId);
  } catch {
    // An unusable id never named a directory, so there is nothing to drop.
    return;
  }
  const dir = await cacheDir();
  if (!dir) return;
  try {
    await dir.removeEntry(name, { recursive: true });
  } catch {
    // Already gone, or unreadable. Best-effort by contract.
  }
}

/**
 * Drop every user's working copy except the account the sign-in confirmed
 * and any `spared` account kept on this browser.
 *
 * `SessionGate` runs it on every confirmed identity resolution, a warm reload
 * included. On a shared browser it is what keeps a previous
 * writer's prose from accumulating here when nobody purged at sign-out.
 */
export async function dropOtherUserCaches(
  currentUserId: string,
  ...spared: string[]
): Promise<void> {
  const dir = await cacheDir();
  if (!dir) return;
  const keep: string[] = [];
  try {
    keep.push(userDirName(currentUserId));
  } catch {
    // An unusable current id refuses the sweep: sweeping everything would
    // delete the signed-in writer's own working copy.
    return;
  }
  for (const id of spared) {
    try {
      keep.push(userDirName(id));
    } catch {
      // An unusable spared id names no directory to keep.
    }
  }
  try {
    const names: string[] = [];
    // `keys()` is the part of the async iteration the OPFS spec guarantees.
    for await (const name of dir.keys()) {
      if (!keep.includes(name)) names.push(name);
    }
    await Promise.all(
      names.map((name) =>
        dir.removeEntry(name, { recursive: true }).catch(() => {}),
      ),
    );
  } catch {
    // Best-effort, like every delete in this file.
  }
}
