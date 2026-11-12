// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { FileFingerprint } from "../../storage/types";
import type { SyncManifest } from "./manifest";
import type { Scan } from "./scan";

// The pure compare. Whether local changed and whether the remote changed are
// answered independently, each against that side's own baseline in
// `manifest.ts`, never by comparing a local hash with the remote checksum,
// which can differ for the same content (a BOM `Blob.text()` strips locally,
// CRLF). Only a change on both sides is a conflict.
//
// A path with no baseline, created on one side since the last sync, is a
// one-sided change to push or pull. A path with no baseline on both sides
// (the pairing copy landed before the first manifest write, or two devices
// created the same name) is `clean` if the bytes match. If they differ, no
// baseline says which side changed, so it is `unknown` rather than a false
// `conflict`; both get the whole-project banner.
//
// Equal bytes on both sides are `clean` whatever the baseline says. The
// queue's drain can push between a check's manifest read and its scan, so a
// baseline can trail both sides; that is agreement, not a conflict. Only a
// real digest proves equality, never a weak remote fingerprint.
//
// A remote copy that is gone, its folder deleted or trashed, scans as empty,
// which per file reads as every path deleted on the remote. It gets its own
// verdict, `remoteGoneVerdict`: nothing to pull, nothing to push, and a banner
// that offers to disable sync or upload the device's copy again.

export type FileStatus =
  "clean" | "local-changed" | "remote-changed" | "conflict" | "unknown";

export interface FileVerdict {
  path: string;
  status: FileStatus;
}

export interface SyncVerdict {
  files: FileVerdict[];
  /**
   * True when any file is `conflict` or `unknown`, or the remote copy is gone;
   * each blocks auto-sync.
   */
  conflict: boolean;
  /** The `remote-changed` paths, empty when `conflict` is true. */
  toPull: string[];
  /** The `local-changed` paths, empty when `conflict` is true. */
  toPush: string[];
  /**
   * The remote copy is missing, its folder deleted or trashed. `conflict` is
   * true with it, so auto-sync stays blocked and the banner stands until the
   * writer chooses.
   */
  remoteGone?: true;
}

export function remoteGoneVerdict(): SyncVerdict {
  return {
    files: [],
    conflict: true,
    toPull: [],
    toPush: [],
    remoteGone: true,
  };
}

/** Both sides hold the same bytes, by a real digest on each side. */
export function sameBytes(
  local: FileFingerprint | undefined,
  remote: FileFingerprint | undefined,
): boolean {
  return (
    local !== undefined &&
    remote !== undefined &&
    remote.weak !== true &&
    local.hash === remote.hash
  );
}

function statusFor(
  path: string,
  local: FileFingerprint | undefined,
  remote: FileFingerprint | undefined,
  manifest: SyncManifest,
): FileStatus {
  if (sameBytes(local, remote)) return "clean";

  const baseline = manifest.files[path];

  if (!baseline) {
    if (local !== undefined && remote !== undefined) return "unknown";
    return local !== undefined ? "local-changed" : "remote-changed";
  }

  // Gone from both sides is agreement: no deletion to propagate and nothing
  // to back up.
  if (local === undefined && remote === undefined) return "clean";

  // Missing where the baseline says it existed is a change, a deletion.
  const localChanged = local ? local.hash !== baseline.local : true;
  const remoteChanged = remote ? remote.hash !== baseline.remote : true;

  if (localChanged && remoteChanged) return "conflict";
  if (localChanged) return "local-changed";
  if (remoteChanged) return "remote-changed";
  return "clean";
}

export function compare(
  localScan: Scan,
  remoteScan: Scan,
  manifest: SyncManifest,
): SyncVerdict {
  const paths = new Set<string>([
    ...localScan.keys(),
    ...remoteScan.keys(),
    ...Object.keys(manifest.files),
  ]);

  const files: FileVerdict[] = [...paths].sort().map((path) => ({
    path,
    status: statusFor(
      path,
      localScan.get(path),
      remoteScan.get(path),
      manifest,
    ),
  }));

  const conflict = files.some(
    (f) => f.status === "conflict" || f.status === "unknown",
  );
  const toPull = conflict
    ? []
    : files.filter((f) => f.status === "remote-changed").map((f) => f.path);
  const toPush = conflict
    ? []
    : files.filter((f) => f.status === "local-changed").map((f) => f.path);

  return { files, conflict, toPull, toPush };
}
