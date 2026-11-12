// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  PROPERTIES_FILE,
  SNAPSHOTS_CATALOGUE_FILE,
  STRUCTURE_FILE,
} from "../naming";
import { parseProperties } from "../properties";
import type { DocumentStats } from "../types";
import type {
  ProjectRef,
  FileHint,
  StorageProvider,
} from "../../storage/types";
import { fingerprintOrNull, pull, push, rebuildManifest } from "./apply";
import {
  compare,
  remoteGoneVerdict,
  sameBytes,
  type SyncVerdict,
} from "./compare";
import { holdsTheBook, projectAgrees } from "./agreement";
import {
  emptyManifest,
  withBaseline,
  withoutPullMark,
  type RemoteTarget,
  type SyncManifest,
} from "./manifest";
import { getManifest, putManifest } from "./manifestStore";
import { pairingFor } from "./pairing";
import { remoteCopyGone, scan, type Scan } from "./scan";
import { withSyncLock } from "./syncLock";

// A check is a read-modify-write over one manifest and one set of local
// files, and nothing above this module serializes callers: the Library's
// background pass runs one per paired project while a manual "Sync now" can
// run on the same key, and the queue's drain levels baselines in the same
// manifest after each push. All of them hold the project sync lock.

export interface Side {
  provider: StorageProvider;
  ref: ProjectRef;
}

export interface SyncCheckResult {
  remoteTarget: RemoteTarget;
  verdict: SyncVerdict;
  /**
   * Set only on a conflict, as the whole-project banner's context.
   * `document-properties.json` is outside conflict detection, but its `stats`
   * block is the display data the banner needs.
   */
  localStats: DocumentStats | null;
  remoteStats: DocumentStats | null;
  /**
   * The remote does not agree with itself (`projectAgrees`): another device
   * is still uploading this project. Nothing was pulled or pushed, and the
   * next check tries again.
   */
  uploading?: true;
}

/** A remote file's text, or `null` when it is not there or not readable. */
async function readOrNull(side: Side, path: string): Promise<string | null> {
  try {
    return await side.provider.readFile(side.ref, path);
  } catch {
    return null;
  }
}

/**
 * The manifest's per-path local hash and the `lastModified` it was confirmed
 * at (`FileBaseline.local`, `.localMtime`), as `scan()` hints. Local skips
 * re-hashing a file whose mtime has not moved since the last check.
 * Only the local scan takes them, because the remote's checksum is free.
 */
function hintsFromManifest(manifest: SyncManifest): Map<string, FileHint> {
  const hints = new Map<string, FileHint>();
  for (const [path, baseline] of Object.entries(manifest.files)) {
    hints.set(path, { mtime: baseline.localMtime, hash: baseline.local });
  }
  return hints;
}

async function readStats(
  provider: StorageProvider,
  ref: ProjectRef,
): Promise<DocumentStats | null> {
  try {
    const raw = await provider.readFile(ref, PROPERTIES_FILE);
    return parseProperties(raw, ref.name).stats;
  } catch {
    return null;
  }
}

/**
 * The paths a pull is about to overwrite that moved locally since the scan
 * that produced the verdict. A save from another tab can land in that window,
 * and stale remote bytes over it would destroy it, so those paths become a
 * conflict.
 */
async function pathsWhereLocalMoved(
  local: Side,
  manifest: SyncManifest,
  paths: readonly string[],
): Promise<string[]> {
  const moved: string[] = [];
  for (const path of paths) {
    const baseline = manifest.files[path];
    if (!baseline) continue;
    const now = await fingerprintOrNull(local.provider, local.ref, path);
    if (now === null || now.hash !== baseline.local) moved.push(path);
  }
  return moved;
}

/**
 * `manifest` with a fresh baseline for every path both sides hold with the
 * same bytes where the stored one trails them or is missing. `compare` reads
 * those paths as clean whatever their baseline; left stale, the next one-sided
 * edit would read as a change on both sides, a false conflict.
 */
function levelAgreed(
  manifest: SyncManifest,
  localScan: Scan,
  remoteScan: Scan,
): SyncManifest {
  let next = manifest;
  for (const [path, local] of localScan) {
    const remote = remoteScan.get(path);
    if (!remote || !sameBytes(local, remote)) continue;
    const baseline = manifest.files[path];
    if (baseline?.local === local.hash && baseline.remote === remote.hash)
      continue;
    next = withBaseline(next, path, {
      local: local.hash,
      remote: remote.hash,
      remoteFileId: baseline?.remoteFileId ?? "",
      localMtime: local.mtime ?? 0,
      weak: remote.weak,
    });
  }
  return next;
}

/**
 * The whole check: `null` when unpaired. Otherwise scans both sides and
 * compares against the stored manifest. An absent manifest, lost or never
 * written, becomes an empty one, so `compare()` performs the manifest-loss
 * reconciliation: equal bytes read `clean` and differing ones `unknown`.
 *
 * A non-conflicting result is applied at once: changed paths are pulled or
 * pushed and the manifest is persisted. Only a conflict leaves work for the
 * caller.
 *
 * The remote copy is probed first. A gone one yields `remoteGoneVerdict` and
 * touches nothing: its empty scan would otherwise pull the deletion of every
 * file on the device.
 */
export async function checkSync(
  local: Side,
  remote: Side,
  projectId: string,
): Promise<SyncCheckResult | null> {
  return withSyncLock(projectId, async () => {
    const remoteTarget = await pairingFor(projectId);
    if (!remoteTarget) return null;

    if (await remoteCopyGone(remote, local)) {
      return {
        remoteTarget,
        verdict: remoteGoneVerdict(),
        localStats: null,
        remoteStats: null,
      };
    }

    const stored = await getManifest(projectId);
    const manifest = stored ?? emptyManifest(remoteTarget);

    const [localScan, remoteScan] = await Promise.all([
      scan(local.provider, local.ref, hintsFromManifest(manifest)),
      scan(remote.provider, remote.ref),
    ]);
    let verdict = compare(localScan, remoteScan, manifest);

    if (!verdict.conflict && verdict.toPull.length > 0) {
      const moved = await pathsWhereLocalMoved(local, manifest, verdict.toPull);
      if (moved.length > 0) {
        verdict = {
          files: verdict.files.map((f) =>
            moved.includes(f.path) ? { ...f, status: "conflict" as const } : f,
          ),
          conflict: true,
          toPull: [],
          toPush: [],
        };
      }
    }

    if (verdict.conflict) {
      const [localStats, remoteStats] = await Promise.all([
        readStats(local.provider, local.ref),
        readStats(remote.provider, remote.ref),
      ]);
      return { remoteTarget, verdict, localStats, remoteStats };
    }

    // A pull that touches the book takes it from a remote that agrees with
    // itself, or not at all: a remote another device is still uploading
    // would leave this device a copy the open refuses.
    if (
      verdict.toPull.some(holdsTheBook) &&
      !projectAgrees(
        await readOrNull(remote, STRUCTURE_FILE),
        await readOrNull(remote, SNAPSHOTS_CATALOGUE_FILE),
        remoteScan.keys(),
      )
    )
      return {
        remoteTarget,
        verdict,
        localStats: null,
        remoteStats: null,
        uploading: true,
      };

    // Either direction can have work: a pull settles `remote-changed` paths and
    // a push settles `local-changed` ones, and both may be present at once.
    // A mark left by a pull that stopped partway goes once this check's
    // manifest is saved.
    let next = levelAgreed(withoutPullMark(manifest), localScan, remoteScan);
    if (verdict.toPull.length > 0) {
      await putManifest(projectId, { ...manifest, pulling: true });
      next = await pull(local, remote, verdict.toPull, next);
    }
    if (verdict.toPush.length > 0)
      next = await push(local, remote, verdict.toPush, next);
    if (next !== manifest) {
      await putManifest(projectId, next);
    } else if (Object.keys(manifest.files).length === 0) {
      // No baselines yet: `pair()` created an empty manifest, or a real one
      // was lost. Reconciliation succeeded without a conflict, so adopt real
      // baselines now rather than re-deriving them on every check.
      await putManifest(
        projectId,
        await rebuildManifest(local, remote, remoteTarget),
      );
    }

    return { remoteTarget, verdict, localStats: null, remoteStats: null };
  });
}
