// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  StorageError,
  baseName,
  parentPath,
  type Access,
  type DirEntry,
  type FileFingerprint,
  type ProjectRef,
  type StorageProvider,
} from "../types";
import type { CacheStore, CachedEntry } from "./cacheStore";

// ── The working copy as a decorator ──────────────────────────────────────────
//
// Anything bound for a remote is written to the working copy, and the queue
// commits it from there. This decorator fills the store;
// `remoteQueue.ts` drains it.
//
// It wraps the provider that owns the project's bytes and branches only on
// that provider's `kind`, never on its id.
//
// A device base is written through: `disk → cache → queue → remote`, in that
// order. The disk write goes first because the writer can verify it in another
// editor; if it fails nothing else happens, and `mirror()` does not enqueue
// because this rejects. Reads come from disk, which is the truth for these
// projects; the cache is a source for the queue, not a substitute for the
// file.
//
// A remote base is not written through: `cache → queue → remote`. Only the
// queue sends bytes to the network. A direct write would be a save that claims
// to have landed while the connection decides otherwise. Reads come
// from the cache and fall back to the remote, filling on the way past.
//
// The read-through fill makes the drain's cache miss recoverable for a project
// with a durable side, and it is the same code path as an ordinary read, so
// the store has one way to become populated and it is always exercised. A
// fill is best-effort: the reader already holds the text, and a full disk
// must not turn a good read into a failed one.
//
// A hit is revalidated once per open against the remote's checksum, unless
// the queue owes that path. Another device may have saved since this entry
// was filled, and a working copy that never asks would serve the older text
// for as long as it survives. One folder listing answers every file in it.
// Offline, or when the remote does not list the file, the entry is served:
// it is the best copy this device has, and absence from one listing does not
// prove a file gone.
//
// The working copy is shared by every tab and every instance of this
// decorator, and this tab's view of the queue hears only this tab's ops. So a
// fill from the remote runs under the queue view's `exclusive`, which saves
// hold from write to op, and replaces the entry only if it is still the one
// the reader saw and the queue's stored rows owe the path nothing. An entry
// another tab saved and has not sent is never replaced with older text.
//
// A path the queue still owes the remote is the exception to the fill.
// An entry can vanish under a queued `put`: an in-memory storage
// partition (incognito, an embedded browser pane) drops every OPFS file's bytes
// after an idle stretch while the queue's IndexedDB rows survive.
//
// - A remote base must not fill it. The working copy was the only copy of the
//   queued change, and the remote holds the state before it. Filling from the
//   remote would hand the put the remote's older bytes as its source: the
//   drain would send the remote what it already had, clear, and drop the
//   notice that work is held while the work is gone. The reader still gets the
//   remote's text, and `lostRead` tells the queue the change is lost, which
//   also tells the editor not to save that buffer back as the change.
// - A device base must fill it. The disk is written before the working copy,
//   so it holds everything the put was queued for. Device reads otherwise
//   never touch the working copy, and the put would retry to the cap and stop
//   while the bytes sat on disk.
//
// `queue` is required, not defaulted, because the default a caller would
// reach for, "owes nothing", is the one that loses the prose.
//
// Everything that is not one file's bytes delegates untouched, except one
// answer of `exists`. The cache holds files, not a tree, so it cannot answer
// `listDir`; an answer built from what happens to be cached would make a
// half-filled working copy look like a project with missing chapters.
// `exists` answers true for a path the queue owes a put whose bytes are here,
// which a remote base has not seen yet, and leaves every other answer to the
// base. A leftover entry alone proves nothing, because `release` keeps the
// entry of a path deleted while still owed.

/** What `cached()` needs to know about the queue that commits its bytes. */
export interface QueueView {
  /**
   * Whether the queue holds a `put` for this path that has not landed, as far
   * as this tab knows. Synchronous, for the read path.
   */
  owes: (path: string) => boolean;
  /**
   * The same question asked of the queue's stored rows, which every tab
   * appends to. Asked before an entry is replaced with the remote's text.
   */
  owedNow: (path: string) => Promise<boolean>;
  /**
   * Runs `fn` exclusive of every save to this project, in this tab and every
   * other. A save holds it from its working-copy write until its op is
   * queued, so inside it an entry is either saved and owed, or neither.
   */
  exclusive: <T>(fn: () => Promise<T>) => Promise<T>;
  /** A remote base served an owed path from the remote: the change is lost. */
  lostRead: (path: string) => void;
}

/**
 * What a fill from the remote did: replaced the entry, found it changed since
 * the read (`entry` is what it holds now), found a stored op owing the path,
 * or could not tell.
 */
type RemoteFill =
  | { kind: "filled" }
  | { kind: "moved"; entry: CachedEntry | null }
  | { kind: "owed"; entry: CachedEntry | null }
  | { kind: "unsure" };

export function cached(
  base: StorageProvider,
  store: CacheStore,
  queue: QueueView,
): StorageProvider {
  const { owes, owedNow, exclusive, lostRead } = queue;
  const writesThrough = base.kind === "device";
  const statFile = base.statFile;
  const folderUrl = base.folderUrl;
  const trashProject = base.trashProject;

  // ── Entries the queue still owes ───────────────────────────────────────────
  //
  // The queue replays the writer's acts in order, so a save and then a rename
  // of the same Section, both queued, drain as `put a.md` and then
  // `rename a.md → b.md`. The put's source is the old path's entry. Dropping
  // that entry on the rename leaves the queue's head with no source: the FIFO
  // stops there, the rename never runs, and for a Remote-only project the
  // saved text exists nowhere. A delete after a save does the same.
  //
  // So an owed entry is released only once nothing owes it, and the drain
  // lands the save where it was made and then moves or deletes it, as the
  // writer did. Rewriting the queue (drop the old put, put again at the new
  // path) would rename on the remote a file the remote may never have had,
  // which is every Section created and retitled offline.
  //
  // The cost is an entry for a path that is gone once the queue has drained.
  // It is disposable: the budget sweep drops a project's whole working copy
  // once the queue holds nothing for it. A later file at that path is written
  // before it is read, so it replaces the entry instead of being served from
  // it.
  const release = async (path: string): Promise<void> => {
    if (!owes(path)) await store.remove(path);
  };

  // ── What this open has seen ────────────────────────────────────────────────
  //
  // `current` holds the paths whose entry is the newest copy this open knows
  // of: checked against the remote, filled from it, or written here. `writes`
  // counts every change to a path made through this instance, so a fill that
  // started before a save or a delete never lands over it.
  const current = new Set<string>();
  const writes = new Map<string, number>();
  const generation = (path: string): number => writes.get(path) ?? 0;
  const touch = (path: string): void => {
    writes.set(path, generation(path) + 1);
  };

  const fill = async (path: string, text: string, since: number) => {
    if (generation(path) !== since) return;
    try {
      await store.write(path, text);
    } catch {
      // Best-effort: the reader already has the text, and the next read
      // fills again.
    }
  };

  /**
   * Replaces the entry at `path` with the remote's `text`, if the entry still
   * has the hash the reader saw (`seen`, `null` for a miss) and no stored op
   * owes the path a put. Otherwise it says why it did not.
   */
  const fillFromRemote = async (
    path: string,
    text: string,
    since: number,
    seen: string | null,
  ): Promise<RemoteFill> => {
    try {
      return await exclusive(async (): Promise<RemoteFill> => {
        const entry = await store.read(path);
        if (generation(path) !== since || (entry?.hash ?? null) !== seen) {
          return { kind: "moved", entry };
        }
        if (await owedNow(path)) return { kind: "owed", entry };
        await fill(path, text, since);
        return { kind: "filled" };
      });
    } catch {
      // The entry or the queue could not be read, so nothing proves the
      // entry safe to replace. The reader still gets the remote's text.
      return { kind: "unsure" };
    }
  };

  // One listing per folder per open. A failed listing is dropped, so the next
  // read asks again instead of treating a lost connection as an answer.
  const listings = new Map<string, Promise<Map<string, FileFingerprint>>>();
  const remoteFingerprint = async (
    ref: ProjectRef,
    path: string,
  ): Promise<FileFingerprint | undefined> => {
    const dir = parentPath(path);
    let listing = listings.get(dir);
    if (!listing) {
      listing = base.fingerprintDir(ref, dir);
      listings.set(dir, listing);
      listing.catch(() => listings.delete(dir));
    }
    return (await listing).get(baseName(path));
  };

  const revalidate = async (
    ref: ProjectRef,
    path: string,
    hit: CachedEntry,
  ): Promise<string> => {
    const since = generation(path);
    let remote: FileFingerprint | undefined;
    try {
      remote = await remoteFingerprint(ref, path);
    } catch {
      return hit.text;
    }
    if (!remote) return hit.text;
    if (!remote.weak && remote.hash === hit.hash) {
      current.add(path);
      return hit.text;
    }
    let text: string;
    try {
      text = await base.readFile(ref, path);
    } catch {
      return hit.text;
    }
    // A save landed while the remote was asked: the entry is newer than
    // either answer above, and the read starts again from it.
    if (generation(path) !== since || owes(path)) return read(ref, path);
    const filled = await fillFromRemote(path, text, since, hit.hash);
    switch (filled.kind) {
      case "filled":
        current.add(path);
        return text;
      case "moved":
        // Saved or deleted by another instance or tab after the read; a
        // saved entry is newer than the remote's answer.
        if (!filled.entry) return read(ref, path);
        current.add(path);
        return filled.entry.text;
      case "owed":
        // Another tab's save the remote has not had yet.
        current.add(path);
        return filled.entry?.text ?? hit.text;
      case "unsure":
        return hit.text;
    }
  };

  const read = async (ref: ProjectRef, path: string): Promise<string> => {
    if (writesThrough) {
      const since = generation(path);
      const text = await base.readFile(ref, path);
      // In this order, the common read of a path nothing is owed for costs
      // no OPFS access.
      if (owes(path) && !(await store.has(path))) await fill(path, text, since);
      return text;
    }
    const hit = await store.read(path);
    if (hit) {
      if (current.has(path) || owes(path)) return hit.text;
      return revalidate(ref, path, hit);
    }
    // A miss is a value, neither an error nor an empty file: the remote's
    // text fills the working copy for the next reader and the drain, except
    // for an owed path, whose change is lost.
    const since = generation(path);
    const text = await base.readFile(ref, path);
    if (owes(path)) {
      lostRead(path);
      return text;
    }
    const filled = await fillFromRemote(path, text, since, null);
    switch (filled.kind) {
      case "filled":
        current.add(path);
        return text;
      case "moved":
        if (!filled.entry) return text;
        current.add(path);
        return filled.entry.text;
      case "owed":
        // Another tab queued a put whose entry is gone.
        lostRead(path);
        return text;
      case "unsure":
        return text;
    }
  };

  // The entry follows its file. For a Remote-only project with the rename
  // still queued, the new path has no durable side to refill from, because the
  // remote has not moved the file yet; without the copy, the renamed Section
  // cannot open offline.
  //
  // Over a remote base, a path with no entry and no owed put is read from the
  // remote first. That read is the only copy the new path has until the queue
  // moves the file. A remote that answers `not-found` proves the path exists
  // nowhere, so the rename throws instead of queueing an op that can never
  // land. Any other failure lets the rename through, because offline is not
  // absence.
  const carry = async (
    ref: ProjectRef,
    from: string,
    to: string,
  ): Promise<void> => {
    const entry = await store.read(from);
    let text = entry?.text ?? null;
    let fresh = current.has(from);
    if (text === null && !writesThrough && !owes(from)) {
      try {
        text = await base.readFile(ref, from);
        fresh = true;
      } catch (err) {
        if (err instanceof StorageError && err.code === "not-found") throw err;
      }
    }
    touch(to);
    current.delete(to);
    if (text !== null) {
      await store.write(to, text);
      if (fresh) current.add(to);
    }
    touch(from);
    current.delete(from);
    await release(from);
  };

  return {
    id: base.id,
    // The base's kind, unchanged: `kind` says where the bytes live, and
    // caching them on the way past does not move them, as in `mirror()`.
    kind: base.kind,
    label: base.label,
    icon: base.icon,

    isAvailable: () => base.isAvailable(),
    reopenProject: (ref: ProjectRef) => base.reopenProject(ref),
    canAccess: (ref: ProjectRef): Promise<Access> => base.canAccess(ref),
    listDir: (ref: ProjectRef, path: string): Promise<DirEntry[]> =>
      base.listDir(ref, path),

    async exists(ref: ProjectRef, path: string): Promise<boolean> {
      if (!writesThrough && owes(path) && (await store.has(path))) return true;
      return base.exists(ref, path);
    },

    readFile: read,

    async writeFile(
      ref: ProjectRef,
      path: string,
      content: string,
    ): Promise<void> {
      if (writesThrough) await base.writeFile(ref, path, content);
      touch(path);
      await store.write(path, content);
      current.add(path);
    },

    async createDir(ref: ProjectRef, path: string): Promise<void> {
      // Nothing to cache: the working copy holds file bytes, and creates a
      // directory on the way to writing a file in it.
      if (writesThrough) await base.createDir(ref, path);
    },

    async removeFile(ref: ProjectRef, path: string): Promise<void> {
      if (writesThrough) await base.removeFile(ref, path);
      // After the base: an entry left for a deleted path would be served to a
      // later read of a path the writer removed.
      touch(path);
      current.delete(path);
      await release(path);
    },

    async renameFile(
      ref: ProjectRef,
      path: string,
      newName: string,
    ): Promise<void> {
      if (writesThrough) await base.renameFile(ref, path, newName);
      await carry(
        ref,
        path,
        `${path.slice(0, path.lastIndexOf("/"))}/${newName}`,
      );
    },

    async moveFile(
      ref: ProjectRef,
      fromPath: string,
      toDir: string,
    ): Promise<void> {
      if (writesThrough) await base.moveFile(ref, fromPath, toDir);
      await carry(
        ref,
        fromPath,
        `${toDir}/${fromPath.slice(fromPath.lastIndexOf("/") + 1)}`,
      );
    },

    statFile: statFile
      ? (ref: ProjectRef, path: string) => statFile(ref, path)
      : undefined,
    fingerprintFile: (...args) => base.fingerprintFile(...args),
    fingerprintDir: (...args) => base.fingerprintDir(...args),
    folderUrl: folderUrl ? (ref: ProjectRef) => folderUrl(ref) : undefined,
    // Above the port, the absence of an optional member is the answer to what
    // the provider can do, so it must pass through unchanged.
    trashProject: trashProject
      ? (ref: ProjectRef) => trashProject(ref)
      : undefined,
  };
}
