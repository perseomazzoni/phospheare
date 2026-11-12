// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  StorageError,
  baseName,
  joinPath,
  parentPath,
  type Access,
  type DirEntry,
  type EntryKind,
  type ProjectRef,
  type StorageProvider,
} from "./types";

// ── The sync decorator ───────────────────────────────────────────────────────
//
// Sync is a decorator, not a provider. A Local+Synced project's `ProjectRef`
// stays `local:<key>`: a registered `'synced'` provider with a composite key
// would orphan the card cache and every `/project/:id` URL the moment a
// project is paired.
//
// Reads of bytes and lifecycle methods delegate straight to `base`. Writes
// `await base.<op>()` first and rethrow on its failure; only after it
// succeeds is the op enqueued.
//
// `enqueue` is awaited, and it can throw. The queue can be the only path the
// work has: for a remote-primary project the bytes live in the working copy
// and nowhere durable, so an op that never reached the store would be work
// that exists nowhere, reported as saved.
//
// The remote half is never in the caller's await chain: a save must succeed
// when the remote is unreachable. `enqueue` awaits one IndexedDB append and
// defers its coalescing behind the drain's lock without awaiting it.
//
// ── The answers that cannot delegate ─────────────────────────────────────────
//
// For a remote-primary project `cached` does not write through, so a
// `removeFile` or `moveFile` returns having touched nothing the base can see.
// A listing straight off the base would answer from a remote that has not
// been told yet: a deleted note would come back on the next re-list, and a
// stalled queue would make every delete look as if it had not taken.
//
// `cached` knows one file's bytes; `mirror` knows what is outstanding, so it
// alone can answer what a folder will hold once the queue has drained, which
// is what every caller above the port asks. `exists` asks the same question
// of one path: a comments file saved offline is a pending `put` the remote
// has never seen, and a "no" from the base would have the next save write
// over it. `pending` is injected like
// `enqueue`: this module must not import the queue, and the composition root
// binds both to the same project.
//
// The cost is a synchronous read of an in-memory array, with no IndexedDB
// transaction and no network, so nothing slow enters the caller's await
// chain.

export type Op =
  | { kind: "put"; path: string }
  | { kind: "mkdir"; path: string }
  | { kind: "rm"; path: string }
  | { kind: "mv"; from: string; toDir: string }
  | { kind: "rename"; path: string; newName: string };

export type Enqueue = (op: Op) => Promise<void>;

/** This project's outstanding ops, oldest first. Synchronous by contract. */
export type PendingOps = () => readonly Op[];

/**
 * One directory's listing as it will stand once `ops` have drained.
 *
 * Only ops whose path sits directly in `dir` count, because `listDir` is
 * shallow. Ops apply oldest first, so a delete followed by a re-create
 * resolves the way the writer performed it.
 *
 * A `mv` names no kind, and only `moveFile` produces one, so an arriving
 * entry is a file. A `rename` keeps the kind of the entry it renames, which
 * the base listing normally holds until the rename drains.
 */
export function applyPendingOps(
  entries: readonly DirEntry[],
  dir: string,
  ops: readonly Op[],
): DirEntry[] {
  const byName = new Map<string, DirEntry>();
  for (const entry of entries) byName.set(entry.name, entry);

  const entryFor = (name: string, kind: EntryKind): DirEntry => ({
    path: joinPath(dir, name),
    name,
    kind,
  });
  const add = (name: string, kind: EntryKind) => {
    if (!byName.has(name)) byName.set(name, entryFor(name, kind));
  };

  for (const op of ops) {
    switch (op.kind) {
      case "put":
        if (parentPath(op.path) === dir) add(baseName(op.path), "file");
        break;
      case "mkdir":
        if (parentPath(op.path) === dir) add(baseName(op.path), "folder");
        break;
      case "rm":
        if (parentPath(op.path) === dir) byName.delete(baseName(op.path));
        break;
      case "rename": {
        if (parentPath(op.path) !== dir) break;
        const from = baseName(op.path);
        const kind = byName.get(from)?.kind ?? "file";
        byName.delete(from);
        byName.set(op.newName, entryFor(op.newName, kind));
        break;
      }
      case "mv": {
        const name = baseName(op.from);
        if (parentPath(op.from) === dir) byName.delete(name);
        if (op.toDir === dir) add(name, "file");
        break;
      }
    }
  }
  return [...byName.values()];
}

/**
 * Whether `path` exists once `ops` have drained, or `null` when no op
 * decides it and the base must answer.
 *
 * The newest op that names the path decides. A path that is the parent of an
 * arriving entry exists, as in `arrivalsIn`. Every answer holds whether or
 * not the base has already applied the op, so it is the same over a device
 * base, which has, and a remote one, which has not.
 */
export function pendingPresence(
  path: string,
  ops: readonly Op[],
): boolean | null {
  const holds = (arrived: string) =>
    arrived === path || arrived.startsWith(`${path}/`);
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    switch (op.kind) {
      case "put":
      case "mkdir":
        if (holds(op.path)) return true;
        break;
      case "rm":
        if (op.path === path) return false;
        break;
      case "rename":
        if (holds(joinPath(parentPath(op.path), op.newName))) return true;
        if (op.path === path) return false;
        break;
      case "mv":
        if (holds(joinPath(op.toDir, baseName(op.from)))) return true;
        if (op.from === path) return false;
        break;
    }
  }
  return null;
}

/** Whether the pending ops put anything into `dir`. */
function arrivalsIn(dir: string, ops: readonly Op[]): boolean {
  return applyPendingOps([], dir, ops).length > 0;
}

export function mirror(
  base: StorageProvider,
  enqueue: Enqueue,
  pending: PendingOps,
): StorageProvider {
  // `statFile` is optional, so it is bound once to narrow.
  const statFile = base.statFile;
  return {
    id: base.id,
    // The base's kind, unchanged: `kind` says where the bytes live, and a
    // Local+Synced project's bytes live on this disk. Reporting "remote" here
    // would make every synced project read as remote-only to every caller
    // that branches on it.
    kind: base.kind,
    label: base.label,
    icon: base.icon,

    isAvailable: () => base.isAvailable(),
    reopenProject: (ref: ProjectRef) => base.reopenProject(ref),
    canAccess: (ref: ProjectRef): Promise<Access> => base.canAccess(ref),

    async listDir(ref: ProjectRef, path: string): Promise<DirEntry[]> {
      const ops = pending();
      try {
        return applyPendingOps(await base.listDir(ref, path), path, ops);
      } catch (error) {
        // A folder the base has never seen, with work queued into it, is the
        // bin on a remote-primary project: `moveFile` creates the target
        // folder only when the op drains, so the base answers "not found"
        // while the entry is already real to the writer. Anything else
        // (offline, a lapsed grant) rethrows, because the pending half alone
        // would report a folder of forty files as holding one.
        if (
          error instanceof StorageError &&
          error.code === "not-found" &&
          arrivalsIn(path, ops)
        )
          return applyPendingOps([], path, ops);
        throw error;
      }
    },

    async exists(ref: ProjectRef, path: string): Promise<boolean> {
      return pendingPresence(path, pending()) ?? base.exists(ref, path);
    },
    readFile: (ref: ProjectRef, path: string): Promise<string> =>
      base.readFile(ref, path),

    async writeFile(
      ref: ProjectRef,
      path: string,
      content: string,
    ): Promise<void> {
      await base.writeFile(ref, path, content);
      await enqueue({ kind: "put", path });
    },

    async createDir(ref: ProjectRef, path: string): Promise<void> {
      await base.createDir(ref, path);
      await enqueue({ kind: "mkdir", path });
    },

    async renameFile(
      ref: ProjectRef,
      path: string,
      newName: string,
    ): Promise<void> {
      await base.renameFile(ref, path, newName);
      await enqueue({ kind: "rename", path, newName });
    },

    async moveFile(
      ref: ProjectRef,
      fromPath: string,
      toDir: string,
    ): Promise<void> {
      await base.moveFile(ref, fromPath, toDir);
      await enqueue({ kind: "mv", from: fromPath, toDir });
    },

    async removeFile(ref: ProjectRef, path: string): Promise<void> {
      await base.removeFile(ref, path);
      await enqueue({ kind: "rm", path });
    },
    statFile: statFile
      ? (ref: ProjectRef, path: string) => statFile(ref, path)
      : undefined,
    fingerprintFile: (...args) => base.fingerprintFile(...args),
    fingerprintDir: (...args) => base.fingerprintDir(...args),
  };
}
