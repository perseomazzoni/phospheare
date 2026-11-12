// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  RECYCLE_BIN_DIR,
  SNAPSHOTS_CATALOGUE_FILE,
  STRUCTURE_FILE,
} from "../naming";
import {
  ROOT_PATH,
  StorageError,
  type ProjectRef,
  type FileFingerprint,
  type FileHint,
  type StorageProvider,
} from "../../storage/types";

// What conflict detection looks at: the structure file, the snapshot
// catalogue and everything under `document/`, `recyclebin/`, `assistant/`,
// `reference/` and `comments/`. Never `document-properties.json`, which is
// rewritten on every save, even a background word-count record, so
// whole-project conflict detection would fire on every handoff. It stays
// last-write-wins, and so it holds nothing the open needs to match the files:
// the catalogue says which files are snapshots, and travels with them.
//
// Drive folds the fingerprint into its `listDir` request, turning a 100-file
// project's N+1 requests into 2; local and memory walk the folder inside
// `fingerprintDir`. `listDir` runs first either way, as the only source for
// which entries are folders, so two requests per folder is the floor for a
// provider that batches.
//
// `hints`, which `checkSync` builds from the stored manifest's `localMtime`
// and hash per path, let a provider that can detect "unchanged since that
// mtime" skip re-hashing. They flow to both `fingerprintFile` and
// `fingerprintDir`; a provider with no such signal ignores them.

// `comments/` holds the margin's threads, one file per node, beside the book.
// It is the writer's work, like the chats in `assistant/`. Unscanned,
// a note written on one device reaches the remote by the queue but never
// comes down to another device's disk, and two devices' notes on one node are
// never compared. `recyclebin/` holds the binned snapshots the catalogue
// still names: unscanned, a binned record would reach another device without
// its file, and Restore there would find nothing.
const SCAN_DIRS = [
  "/document",
  RECYCLE_BIN_DIR,
  "/assistant",
  "/reference",
  "/comments",
];

/** The files at the project's root that conflict detection looks at. */
const SCAN_FILES = [STRUCTURE_FILE, SNAPSHOTS_CATALOGUE_FILE];

/**
 * Whether conflict detection looks at `path`. A path it does not look at has
 * no baseline that means anything and stays last-write-wins.
 */
export function isScanned(path: string): boolean {
  return (
    SCAN_FILES.includes(path) ||
    SCAN_DIRS.some((dir) => path.startsWith(`${dir}/`))
  );
}

export type Scan = Map<string, FileFingerprint>;

interface Side {
  provider: StorageProvider;
  ref: ProjectRef;
}

/**
 * Whether a storage failure is `not-found`. `instanceof StorageError` alone is
 * unreliable across module boundaries: each dynamic import after
 * `vi.resetModules()` gets its own class, and mocked providers throw from
 * either one, so the code is read off the error itself.
 */
export function isNotFound(err: unknown): boolean {
  const code =
    err instanceof StorageError
      ? err.code
      : (err as { code?: unknown } | null)?.code;
  return code === "not-found";
}

/**
 * Whether the remote copy is gone. A deleted folder fails its root listing
 * with `not-found`. A trashed one still lists, but empty, because its children
 * are trashed with it, so the structure file the device's copy holds is the
 * proof: a remote without it is not the project any more. Any other listing
 * failure throws, so a network fault never reads as a deletion.
 */
export async function remoteCopyGone(
  remote: Side,
  local: Side,
): Promise<boolean> {
  let entries;
  try {
    entries = await remote.provider.listDir(remote.ref, ROOT_PATH);
  } catch (err) {
    if (isNotFound(err)) return true;
    throw err;
  }
  if (entries.some((entry) => entry.path === STRUCTURE_FILE)) return false;
  return local.provider.exists(local.ref, STRUCTURE_FILE);
}

async function walk(
  provider: StorageProvider,
  ref: ProjectRef,
  dir: string,
  hints: Map<string, FileHint> | undefined,
  out: Scan,
): Promise<void> {
  let entries;
  try {
    entries = await provider.listDir(ref, dir);
  } catch (err) {
    // The folder may not exist yet (`assistant/` and `reference/` start
    // empty, and a folder never written into may not exist on Drive), and
    // nothing to scan is not an error. Any other failure is: a listing that
    // failed would read as every file in the folder deleted.
    if (isNotFound(err)) return;
    throw err;
  }

  // `fingerprintDir`'s hints are keyed by name within this directory, so the
  // caller's full-path map is narrowed here.
  let dirHints: Map<string, FileHint> | undefined;
  if (hints) {
    dirHints = new Map();
    for (const entry of entries) {
      if (entry.kind !== "file") continue;
      const hint = hints.get(entry.path);
      if (hint) dirHints.set(entry.name, hint);
    }
  }

  // A failure degrades to the per-file loop below rather than failing the
  // walk: the bulk path is an optimization, never a new way for the scan to
  // fail.
  const bulk = await provider
    .fingerprintDir(ref, dir, dirHints)
    .catch(() => null);

  for (const entry of entries) {
    if (entry.kind === "folder") {
      await walk(provider, ref, entry.path, hints, out);
      continue;
    }
    const fingerprint =
      bulk?.get(entry.name) ??
      (await provider.fingerprintFile(ref, entry.path, hints?.get(entry.path)));
    out.set(entry.path, fingerprint);
  }
}

export async function scan(
  provider: StorageProvider,
  ref: ProjectRef,
  hints?: Map<string, FileHint>,
): Promise<Scan> {
  const out: Scan = new Map();

  for (const file of SCAN_FILES) {
    if (await provider.exists(ref, file))
      out.set(
        file,
        await provider.fingerprintFile(ref, file, hints?.get(file)),
      );
  }
  for (const dir of SCAN_DIRS) {
    await walk(provider, ref, dir, hints, out);
  }
  return out;
}
