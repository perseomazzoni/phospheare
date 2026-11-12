// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The sync manifest: one record per synced project in `manifestStore.ts`'s
// IndexedDB store, never in a file. `driveProvider.listDir` does not filter
// dotfiles, so a manifest file could travel to another device and assert
// baselines that machine never established.
//
// A `FileBaseline` holds the two-sided evidence `compare.ts` needs to answer
// whether local changed and whether the remote changed independently, rather
// than cross-comparing bytes that can differ (BOM, CRLF) for the same content.

/**
 * Which project on which backend the local one is paired with. Naming the
 * provider lets `remoteQueue.ts` resolve its destination through the registry
 * instead of importing `driveProvider`.
 */
export interface RemoteTarget {
  providerId: string;
  /** Opaque and provider-owned, such as a Drive folder id. */
  key: string;
}

export interface FileBaseline {
  /** SHA-256 hex of the local bytes at last sync. */
  local: string;
  /** The remote's checksum, or a weak `modifiedTime` stand-in. */
  remote: string;
  /** The remote's file id for this path; `''` where none was resolved. */
  remoteFileId: string;
  /** Lets a clean, untouched file skip re-hashing. */
  localMtime: number;
  /**
   * The remote gave no real checksum for this file, so `remote` is a
   * `modifiedTime` stand-in, which proves "changed" but never "unchanged".
   * Drive omits `sha256Checksum` for some files; any backend that answers with
   * a timestamp instead of a digest sets it.
   */
  weak?: boolean;
}

export interface SyncManifest {
  remote: RemoteTarget;
  /** Keyed by project-relative path, e.g. `/document/section--opening.md`. */
  files: Record<string, FileBaseline>;
  lastSyncedAt: string;
  /**
   * Set before a pull writes its first file and gone once the pull's
   * manifest is saved. Still set, a pull stopped partway: the device's copy
   * may hold files whose records have not come down, and the next check
   * finishes it. The open reads it to say so.
   */
  pulling?: true;
}

/** `manifest` without the pull mark: the same object when it has none. */
export function withoutPullMark(manifest: SyncManifest): SyncManifest {
  if (!manifest.pulling) return manifest;
  const { pulling: _mark, ...rest } = manifest;
  return rest;
}

export function emptyManifest(remote: RemoteTarget): SyncManifest {
  return { remote, files: {}, lastSyncedAt: new Date().toISOString() };
}

export function withBaseline(
  manifest: SyncManifest,
  path: string,
  baseline: FileBaseline,
): SyncManifest {
  return { ...manifest, files: { ...manifest.files, [path]: baseline } };
}

export function withoutPath(
  manifest: SyncManifest,
  path: string,
): SyncManifest {
  const { [path]: _dropped, ...rest } = manifest.files;
  return { ...manifest, files: rest };
}

/**
 * `manifest` with the baselines at `from`, and under it when `from` is a
 * folder, moved to the same place under `to`. A rename or a move changes where
 * the bytes are, not the bytes, so the evidence of the last sync goes with
 * them; one dropped would make the next edit at the new path read as a change
 * nobody synced. A baseline already at a destination path is replaced.
 */
export function withPathMoved(
  manifest: SyncManifest,
  from: string,
  to: string,
): SyncManifest {
  const kept: Record<string, FileBaseline> = {};
  const moved: Record<string, FileBaseline> = {};
  for (const [path, baseline] of Object.entries(manifest.files)) {
    if (path === from) moved[to] = baseline;
    else if (path.startsWith(`${from}/`))
      moved[`${to}${path.slice(from.length)}`] = baseline;
    else kept[path] = baseline;
  }
  return { ...manifest, files: { ...kept, ...moved } };
}
