// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { SNAPSHOTS_CATALOGUE_FILE, STRUCTURE_FILE } from "../naming";
import { copyProject, survey, type CopyOptions } from "../transfer";
import {
  ROOT_PATH,
  StorageError,
  type ProjectRef,
  type StorageProvider,
} from "../../storage/types";
import { projectAgrees } from "./agreement";
import { backupLoser } from "./backup";
import {
  emptyManifest,
  withBaseline,
  withoutPath,
  type RemoteTarget,
  type SyncManifest,
} from "./manifest";
import { isNotFound, isScanned, remoteCopyGone, scan } from "./scan";
import { sha256Hex } from "../../text/hash";
import type { SyncVerdict } from "./compare";
import { appLog, describeError } from "../../log";

interface Side {
  provider: StorageProvider;
  ref: ProjectRef;
}

export async function fingerprintOrNull(
  provider: StorageProvider,
  ref: ProjectRef,
  path: string,
) {
  try {
    return await provider.fingerprintFile(ref, path);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/**
 * The refusal for a pull whose remote copy is gone: its emptiness is not a set
 * of deletions, and removing the device's files to match it would destroy the
 * only copy left.
 */
function remoteGoneError(): StorageError {
  return new StorageError(
    "The remote copy of this project is gone.",
    "not-found",
    "storage.remoteGone",
  );
}

/**
 * The non-conflict case: copy the remote-changed paths down to local. A path
 * the remote still has is written; a path it lacks, another device's
 * deletion, is removed. Returns `manifest` with baselines refreshed for the
 * touched paths only, cheaper than a full re-scan for a handful of files.
 *
 * The order keeps a pull that stops partway openable as far as it can: the
 * files first, then the structure and the catalogue that name them, then the
 * removals. Stopped, it leaves at most files no record names yet, never a
 * record whose file has not come down.
 *
 * Before the first deletion it asks whether the remote copy is still there,
 * and throws if it is gone: the check probed it before comparing, but the
 * folder can be trashed after that probe.
 */
export async function pull(
  local: Side,
  remote: Side,
  paths: readonly string[],
  manifest: SyncManifest,
): Promise<SyncManifest> {
  const began = Date.now();
  let next = manifest;
  let remotePresent = false;
  const held = new Map<string, boolean>();
  for (const path of paths)
    held.set(path, await remote.provider.exists(remote.ref, path));
  const records = (path: string) =>
    path === STRUCTURE_FILE || path === SNAPSHOTS_CATALOGUE_FILE;
  const ordered = [
    ...paths.filter((path) => held.get(path) && !records(path)),
    ...paths.filter((path) => held.get(path) && records(path)),
    ...paths.filter((path) => !held.get(path)),
  ];
  for (const path of ordered) {
    let remoteFileId = "";
    const remoteHasIt = held.get(path) === true;
    if (remoteHasIt) {
      const content = await remote.provider.readFile(remote.ref, path);
      remoteFileId = (await remote.provider.fileIdOf?.(remote.ref, path)) ?? "";
      await local.provider.writeFile(local.ref, path, content);
    } else {
      if (!remotePresent) {
        if (await remoteCopyGone(remote, local)) throw remoteGoneError();
        remotePresent = true;
      }
      try {
        await local.provider.removeFile(local.ref, path);
      } catch (err) {
        // Already gone locally is the goal. Any other failure stops the
        // pull with its mark and the old baseline kept, so the next check
        // retries the removal instead of uploading the file again.
        if (!isNotFound(err)) throw err;
      }
    }

    const localFp = await fingerprintOrNull(local.provider, local.ref, path);
    const remoteFp = await fingerprintOrNull(remote.provider, remote.ref, path);
    next =
      localFp && remoteFp
        ? withBaseline(next, path, {
            local: localFp.hash,
            remote: remoteFp.hash,
            remoteFileId,
            // The mtime this hash was computed at, never a wall-clock
            // stand-in, which would never match a real file's `lastModified`
            // and would turn the hint shortcut into a no-op. `0` when
            // the provider has no mtime: a sentinel no real file equals.
            localMtime: localFp.mtime ?? 0,
            weak: remoteFp.weak,
          })
        : withoutPath(next, path);
  }
  appLog.info("sync", "Changes were pulled.", {
    provider: remote.ref.providerId,
    files: paths.length,
    ms: Date.now() - began,
  });
  return next;
}

/**
 * The mirror of `pull`: copy the local-changed paths up to the remote.
 * Content is read at push time, so a newer local save is never pushed stale;
 * a path gone locally is a deletion to propagate. No pre-push re-verify is
 * needed, because nothing local is overwritten. Returns `manifest` with
 * baselines refreshed for the touched paths only.
 */
export async function push(
  local: Side,
  remote: Side,
  paths: readonly string[],
  manifest: SyncManifest,
): Promise<SyncManifest> {
  const began = Date.now();
  let next = manifest;
  for (const path of paths) {
    let remoteFileId = "";
    const localHasIt = await local.provider.exists(local.ref, path);
    if (localHasIt) {
      const content = await local.provider.readFile(local.ref, path);
      remoteFileId =
        (await remote.provider.writeFile(remote.ref, path, content)) ?? "";
    } else {
      try {
        await remote.provider.removeFile(remote.ref, path);
      } catch (err) {
        // Already gone on the remote is the goal; any other failure keeps the
        // old baseline, as in `pull`.
        if (!isNotFound(err)) throw err;
      }
    }

    const localFp = await fingerprintOrNull(local.provider, local.ref, path);
    const remoteFp = await fingerprintOrNull(remote.provider, remote.ref, path);
    next =
      localFp && remoteFp
        ? withBaseline(next, path, {
            local: localFp.hash,
            remote: remoteFp.hash,
            remoteFileId,
            localMtime: localFp.mtime ?? 0,
            weak: remoteFp.weak,
          })
        : withoutPath(next, path);
  }
  appLog.info("sync", "Changes were pushed.", {
    provider: remote.ref.providerId,
    files: paths.length,
    ms: Date.now() - began,
  });
  return next;
}

/**
 * A fresh manifest from a full scan of both sides: every path present on
 * both gets a baseline. A path on only one side, unexpected right after a
 * whole-project copy, is skipped rather than guessed at. Used after
 * `resolveConflict`, whose copy made both sides match, and to persist a
 * manifest-loss reconciliation, which `compare()` performs when handed an
 * empty manifest.
 */
export async function rebuildManifest(
  local: Side,
  remote: Side,
  remoteTarget: RemoteTarget,
): Promise<SyncManifest> {
  const [localScan, remoteScan] = await Promise.all([
    scan(local.provider, local.ref),
    scan(remote.provider, remote.ref),
  ]);

  let manifest = emptyManifest(remoteTarget);
  for (const [path, localFp] of localScan) {
    const remoteFp = remoteScan.get(path);
    if (!remoteFp) continue;
    manifest = withBaseline(manifest, path, {
      local: localFp.hash,
      remote: remoteFp.hash,
      remoteFileId: (await remote.provider.fileIdOf?.(remote.ref, path)) ?? "",
      localMtime: localFp.mtime ?? 0,
      weak: remoteFp.weak,
    });
  }
  return manifest;
}

/**
 * The baselines of a project just copied up whole, for its first manifest.
 * `sent` is each copied path's bytes. A tracked path gets a baseline only
 * while both sides still hold the bytes the copy sent: the device's hash is
 * theirs, and the remote's is theirs or, on a remote without digests, a weak
 * fingerprint. A path the writer changed since the copy read it is left
 * without one, so it reads as unsynced rather than as synced.
 *
 * Without these baselines the first edit after the upload would meet a
 * remote file with no baseline, which the queue's precondition stops as an
 * edit made elsewhere.
 */
export async function baselinesForUpload(
  local: Side,
  remote: Side,
  sent: ReadonlyMap<string, string>,
): Promise<SyncManifest["files"]> {
  const [localScan, remoteScan] = await Promise.all([
    scan(local.provider, local.ref),
    scan(remote.provider, remote.ref),
  ]);
  const files: SyncManifest["files"] = {};
  for (const [path, content] of sent) {
    const localFp = localScan.get(path);
    const remoteFp = remoteScan.get(path);
    if (!localFp || !remoteFp) continue;
    const hash = await sha256Hex(content);
    if (localFp.hash !== hash) continue;
    if (!remoteFp.weak && remoteFp.hash !== hash) continue;
    files[path] = {
      local: localFp.hash,
      remote: remoteFp.hash,
      remoteFileId: "",
      localMtime: localFp.mtime ?? 0,
      ...(remoteFp.weak ? { weak: true } : {}),
    };
  }
  return files;
}

/**
 * The error a resolution throws when the side it was asked to keep does not
 * agree with itself (`projectAgrees`): a remote another device is still
 * uploading, or a device copy a pull left partway. Nothing was copied.
 */
export function winnerUnsettledError(keep: "local" | "remote"): Error {
  return Object.assign(
    new Error(`The ${keep} copy does not agree with its own records`),
    { code: "winner-unsettled", keep },
  );
}

/** Whether `err` is `winnerUnsettledError`, read off its code. */
export function isWinnerUnsettled(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === "winner-unsettled";
}

/** A side's file, or `null` when it is not there or will not read. */
async function textOrNull(side: Side, path: string): Promise<string | null> {
  try {
    return await side.provider.readFile(side.ref, path);
  } catch (err) {
    if (!isNotFound(err))
      appLog.warn("sync", "A file could not be read to resolve a conflict.", {
        provider: side.ref.providerId,
        ...describeError(err),
      });
    return null;
  }
}

/**
 * The whole-project conflict resolution: keep local or keep the remote. Backs
 * up, from the losing side, every file the copy is about to overwrite whose
 * bytes differ from the kept side's, then overwrites the losing side
 * wholesale with `copyProject`. Resolution is per project, not a per-file
 * merge, by product choice.
 *
 * The backup set is surveyed at resolution time, not taken from `verdict`:
 * the verdict covers only the scanned paths and is as old as the check that
 * produced it, while the copy writes every file the kept side holds, history,
 * properties and bin included. A verdict for a gone remote has nothing to
 * resolve against.
 *
 * The copy only writes, so a scanned file that only the losing side holds
 * would outlive it: a losing snapshot left unlisted in `document/`, which
 * the open refuses. Each such file is backed up with the rest, then removed
 * once the copy is done, so the losing side ends with exactly the kept
 * side's scanned files.
 */
export async function resolveConflict(
  keep: "local" | "remote",
  local: Side,
  remote: Side,
  verdict: SyncVerdict,
  remoteTarget: RemoteTarget,
  opts: CopyOptions = {},
): Promise<{ manifest: SyncManifest; backupDir: string | null }> {
  if (verdict.remoteGone) throw remoteGoneError();
  const began = Date.now();
  const [kept, discarded] =
    keep === "local" ? [local, remote] : [remote, local];

  const { files } = await survey(kept, ROOT_PATH);
  // The kept side is read now, not when the conflict was shown: it must open
  // as it is, or the copy would hand the losing side a project the open
  // refuses. A remote still being uploaded is the usual case.
  if (
    !projectAgrees(
      await textOrNull(kept, STRUCTURE_FILE),
      await textOrNull(kept, SNAPSHOTS_CATALOGUE_FILE),
      files,
    )
  )
    throw winnerUnsettledError(keep);
  const keptFiles = new Set(files);
  const onlyLosing = (await survey(discarded, ROOT_PATH)).files.filter(
    (path) => isScanned(path) && !keptFiles.has(path),
  );
  const backupDir = await backupLoser(
    discarded,
    local,
    [...files, ...onlyLosing],
    kept,
  );

  await copyProject(kept, discarded, opts);
  for (const path of onlyLosing) {
    try {
      await discarded.provider.removeFile(discarded.ref, path);
    } catch (err) {
      // Already gone is the goal.
      if (!isNotFound(err)) throw err;
    }
  }

  const manifest = await rebuildManifest(local, remote, remoteTarget);
  appLog.info("sync", "A conflict was resolved.", {
    provider: remote.ref.providerId,
    keep,
    files: files.length,
    ms: Date.now() - began,
  });
  return { manifest, backupDir };
}
