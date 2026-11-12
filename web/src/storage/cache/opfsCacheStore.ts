// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { getCurrentUserId, onUserChange } from "../../auth/currentUser";
import { isUserPurged } from "../../profile/purgeLatch";
import { sha256Hex } from "../../text/hash";
import { StorageError } from "../types";
import { pathSegments, remoteSegmentFor, segmentFor } from "./cachePath";
import { userCacheDir } from "./cacheRoot";
import { sweepSoon } from "./budget";
import type { CacheStore, CacheTarget, CachedEntry } from "./cacheStore";

// ── The OPFS adapter ─────────────────────────────────────────────────────────
//
// The only implementation of `CacheStore`, and it holds only the platform: no
// staleness rule, no fingerprint comparison, no size cap, no LRU, no retry.
// Those live above the port, where a fake can reach them. An `if` here that is
// not an exception mapping or a refusal is a branch no test can reach.
//
// ── The stored format ────────────────────────────────────────────────────────
//
// A cached file is `<64 hex>\n<the exact bytes>`. The hex is SHA-256 over
// those bytes; a read recomputes it and treats any mismatch as a miss.
//
// - `has()` means a complete entry. A bare `getFileHandle` only says a file
//   node exists, and an incomplete entry is a queue source that would be
//   pushed over a good remote file.
// - The hash matches the remote's `sha256Checksum`, so a drain can compare the
//   cache against the remote before a put with no second store.
// - It does not depend on swap-file semantics: OPFS has no portable atomic
//   rename (`FileSystemFileHandle.move()` is Chromium-only), and the
//   durability of a half-finished write is the engine's choice, not the
//   spec's promise.
//
// On Chromium, `createWritable()` writes to a swap file: the previous entry
// stays readable and `abort()` leaves it as it was (`e2e/cache-store.spec.ts`).
// The unit suite drives the pessimistic fake in `fakeOpfs.fixture.ts`, which
// proves the adapter never relies on the original surviving.
//
// ── Identity ─────────────────────────────────────────────────────────────────
//
// The user id is bound once, at construction, and never supplied by a caller.
// `handleStore` and `remoteQueueStore` read `getCurrentUserId()` at call time,
// which for prose is the wrong instant: a user switch mid-operation would
// re-point the write. Here every handle descends from a root resolved under
// the captured id, the id is re-read just before `createWritable()`, and any
// change poisons the instance instead of re-pointing it.
//
// No prose method takes a `userId`: a caller-supplied id is an authorization
// decision made by code that cannot verify it. Only the purge functions in
// `cacheRoot.ts` take one, because they delete rather than disclose.

const HEX = /^[0-9a-f]{64}$/;

/** Maps a platform rejection onto the port's error codes. */
function codeFor(err: unknown): StorageError["code"] {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "QuotaExceededError":
      // The device is full, not the content too large (`storage/types.ts`).
      return "no-space";
    case "NotAllowedError":
    case "SecurityError":
      return "permission";
    case "NotFoundError":
      return "not-found";
    default:
      // `NoModificationAllowedError`, `InvalidStateError`, `AbortError` and
      // anything an engine invents: all transient and worth retrying.
      return "io";
  }
}

function fail(err: unknown): never {
  if (err instanceof StorageError) throw err;
  throw new StorageError(
    `opfsCacheStore: ${err instanceof Error ? err.message : String(err)}`,
    codeFor(err),
  );
}

export function openCacheStore(target: CacheTarget): CacheStore {
  // Fails closed. `getCurrentUserId()` returns null both before a writer
  // session is adopted and when auth answered nobody, and the two cannot be
  // told apart from here, so null is refused outright. A session claim is not
  // an identity, and prose must never land in a shared directory.
  const claimed = getCurrentUserId();
  if (!claimed) {
    throw new Error("openCacheStore: refusing to cache with no resolved user");
  }
  const userId: string = claimed;
  if (!target.remote.providerId || !target.remote.key) {
    throw new Error("openCacheStore: refusing to cache with no remote target");
  }

  let poisoned = false;
  let disposed = false;
  const unsubscribe = onUserChange(() => {
    poisoned = true;
  });

  function alive(): void {
    if (disposed) {
      // A disposed store is a programming error, but it arrives as a
      // `StorageError` so the drain classifies it on the source axis and
      // retries instead of treating it as the remote's refusal.
      throw new StorageError(
        "opfsCacheStore: this store has been disposed",
        "io",
      );
    }
    if (poisoned || getCurrentUserId() !== userId) {
      throw new StorageError(
        "opfsCacheStore: the signed-in user changed under this store",
        "permission",
      );
    }
  }

  /**
   * A write also refuses once this user's local data is being purged, from
   * the latch until the next auth change: a save still in flight when the
   * account is forgotten must not recreate what the purge deletes.
   */
  function mayWrite(): void {
    alive();
    if (isUserPurged(userId)) {
      throw new StorageError(
        "opfsCacheStore: this user's local data has been purged",
        "permission",
      );
    }
  }

  let segmentPromise: Promise<[string, string]> | null = null;
  function segment(): Promise<[string, string]> {
    // Memoized per instance, so it never outlives the identity it was
    // computed under. The book's segment, then this remote's copy inside it
    // (`remoteSegmentFor`).
    segmentPromise ??= Promise.all([
      segmentFor(target.id),
      remoteSegmentFor(target.remote),
    ]);
    return segmentPromise;
  }

  /**
   * Walks to the directory holding `path`'s file and returns it with the
   * file's name. `create` passes straight through: a read that created what it
   * did not find would turn every probe into a write.
   */
  async function locate(
    path: string,
    create: boolean,
  ): Promise<{ dir: FileSystemDirectoryHandle; name: string } | null> {
    const parts = pathSegments(path);
    const name = parts.pop() as string;
    const root = await userCacheDir(userId, { create });
    if (!root) return null;
    const [book, copy] = await segment();
    let dir = await root.getDirectoryHandle(book, { create });
    dir = await dir.getDirectoryHandle(copy, { create });
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return { dir, name };
  }

  /** Reads and verifies. Any incompleteness is a miss, never a throw. */
  async function load(path: string): Promise<CachedEntry | null> {
    const at = await locate(path, false);
    if (!at) return null;
    const handle = await at.dir.getFileHandle(at.name, { create: false });
    const raw = await (await handle.getFile()).text();
    const hash = raw.slice(0, 64);
    if (!HEX.test(hash) || raw[64] !== "\n") return null;
    const text = raw.slice(65);
    // The torn-write check: a short file passes the header test and fails
    // here.
    return (await sha256Hex(text)) === hash ? { text, hash } : null;
  }

  /** Absent at any level is a miss, so a cold start answers the same way. */
  function missOnAbsent(err: unknown): null {
    if (err instanceof DOMException && err.name === "NotFoundError")
      return null;
    return fail(err);
  }

  return {
    async read(path) {
      alive();
      try {
        return await load(path);
      } catch (err) {
        return missOnAbsent(err);
      }
    },

    async has(path) {
      alive();
      try {
        return (await load(path)) !== null;
      } catch (err) {
        return missOnAbsent(err) !== null;
      }
    },

    async write(path, text) {
      mayWrite();
      const hash = await sha256Hex(text);
      let writable: FileSystemWritableFileStream | null = null;
      try {
        // Checked again before any directory is created.
        mayWrite();
        const at = await locate(path, true);
        if (!at) {
          throw new StorageError(
            "opfsCacheStore: no working copy on this browser",
            "unavailable",
          );
        }
        const handle = await at.dir.getFileHandle(at.name, { create: true });
        // The last instant this write can still be abandoned on a user switch
        // or a purge.
        mayWrite();
        writable = await handle.createWritable();
        await writable.write(`${hash}\n${text}`);
        // Resolve only after close: the bytes are not committed until it
        // settles, whether the engine truncated on open (as
        // `fakeOpfs.fixture.ts` models) or wrote through a swap file (as
        // Chromium does). The caller is a queue that may hold the only copy,
        // so resolving on `write()` would promise a save that has not
        // happened.
        await writable.close();
        writable = null;
        // Only a write grows the bucket, read-through fills included, so the
        // sweep hangs off the write and not the drain. It is never awaited:
        // housekeeping must not fail or delay a save.
        sweepSoon(userId);
        return { text, hash };
      } catch (err) {
        // An unclosed writable leaves the file locked, and the next attempt
        // fails with `NoModificationAllowedError`, across sessions, looking
        // like an eviction. An abort that throws must not replace the original
        // error, or a quota rejection would be reported as a lock.
        await writable?.abort().catch(() => {});
        return fail(err);
      }
    },

    async remove(path) {
      alive();
      try {
        const at = await locate(path, false);
        if (at) await at.dir.removeEntry(at.name);
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotFoundError") return;
        fail(err);
      }
    },

    async dropProject() {
      alive();
      try {
        const root = await userCacheDir(userId, { create: false });
        if (!root) return;
        const [book, copy] = await segment();
        const dir = await root.getDirectoryHandle(book, { create: false });
        await dir.removeEntry(copy, { recursive: true });
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotFoundError") return;
        fail(err);
      }
    },

    dispose() {
      // Idempotent, and safe on a store that never did anything: the drain
      // disposes in a `finally`, which also runs when opening the store was
      // the last thing that happened.
      disposed = true;
      unsubscribe();
    },
  };
}

/**
 * Drops a book's copy for one remote, once nothing will send it there again.
 *
 * Best-effort, and it never throws: it runs on the way out of a pairing,
 * which must not fail over housekeeping. A copy left behind costs disk that
 * the budget sweep reclaims, never a wrong read, because a book bound to that
 * remote again revalidates every entry on open.
 */
export async function dropWorkingCopy(target: CacheTarget): Promise<void> {
  let store: CacheStore;
  try {
    store = openCacheStore(target);
  } catch {
    return;
  }
  try {
    await store.dropProject();
  } catch {
    // Locked or unavailable; the budget sweep sees it again.
  } finally {
    store.dispose();
  }
}
