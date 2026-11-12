// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The working copy's port: one project's slice of bucket (e), the only bucket
// that holds the writer's body text, and the source every queued op reads
// from. A Local+Synced project runs
// `disk → cache → queue → remote`, a Remote-only one runs
// `cache → queue → remote`, and a Local project never comes here.
//
// A miss is a value and an error is an error. `read` resolves `null` for an
// absent entry and never throws `not-found`. The queue classifies `not-found`
// as permanent (`isPermanent` in `remoteQueue.ts`) and dead-letters the op,
// and the cache is the queue's only source, so a miss thrown as `not-found` at
// drain time would silently discard the writer's only copy of that work. The
// handling of a miss belongs above this port, against the null.
//
// A write resolves only once the bytes are in the file, and rejects on
// failure. `cacheRoot.ts` is the inverse: its functions are best-effort and
// never throw, because a purge must not block a sign-out. A write that
// swallows its failure lets the queue append an op for a write that never
// happened, and that op has no source to drain from.
//
// An entry carries its own hash: SHA-256 hex over the UTF-8 bytes, the same
// value `fingerprintFile` produces locally and Drive returns as
// `sha256Checksum`. A drain compares the cache against the remote with it
// before a put, with no second store. It is also the only torn-write
// detection: OPFS has no portable atomic rename, so a failure after truncation
// leaves a short file, and a short file as a queue source can overwrite a good
// remote one.

/** One cached file: its bytes, and the hash that proves they are complete. */
export interface CachedEntry {
  /** The bytes as written, never normalized or trimmed. */
  text: string;
  /** SHA-256 hex over `text`, the hash every store in the estate compares. */
  hash: string;
}

export interface CacheStore {
  /** The entry, or `null` for a miss. Never throws for an absent entry. */
  read(path: string): Promise<CachedEntry | null>;

  /**
   * Writes, and resolves only once the bytes are durable in the file.
   * Rejects with a `StorageError` on failure; the caller treats it as a
   * failed save.
   */
  write(path: string, text: string): Promise<CachedEntry>;

  /**
   * Whether a complete entry is present; a half-written file answers false.
   * Creates nothing: a probe that scaffolds directories would leave empty
   * writer directories behind, turning a read into a side effect.
   */
  has(path: string): Promise<boolean>;

  /** Idempotent: removing an absent entry succeeds. */
  remove(path: string): Promise<void>;

  /**
   * Drop this project's whole copy for this store's remote. The project, not
   * the file, is the eviction unit.
   *
   * A segment holding undrained queue work is never an eviction candidate.
   * The queue and the cache both key on the project's ref, so that
   * check is a set-membership test.
   */
  dropProject(): Promise<void>;

  /**
   * Release the instance; every later call rejects.
   *
   * The store subscribes to `onUserChange` at construction so a user switch
   * can poison it. The drain opens one store per pass, so an undisposed store
   * leaks one listener, and its closure, per drain.
   */
  dispose(): void;
}

/**
 * What a project must have before any of its bytes may be cached.
 *
 * The store is opened against a remote destination, and that is the whole
 * eligibility rule: a property, not a list of things to refuse. The cache
 * exists to feed a queue and a queue exists to reach a remote, so a project
 * with nowhere to send anything has no reason to be here.
 *
 * - The demo cannot cache: `memoryProvider` has no remote. Refusing on
 *   identity would not hold: `getCurrentUserId()` is global, not
 *   route-scoped, so a signed-in writer who opens the demo in the same tab
 *   has a live id.
 * - A Local-only project cannot cache, which keeps "saved" a fact about a
 *   file the writer can open in another editor.
 * - An anonymous visitor cannot cache, because `openCacheStore` also fails
 *   closed on an unresolved user.
 */
export interface CacheTarget {
  /**
   * The project's own id, which the segment name is digested from.
   * It names the book, not its current address.
   */
  id: string;
  /**
   * Where its bytes are bound. Its presence is the eligibility, and the copy
   * inside the book's segment is keyed by it, so a book bound to a new remote
   * never reads the copy it filled for the last one.
   */
  remote: { providerId: string; key: string };
}
