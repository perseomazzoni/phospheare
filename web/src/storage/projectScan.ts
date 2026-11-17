// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { STRUCTURE_FILE } from "../project/naming";
import {
  LOCAL_PROVIDER_ID,
  MAX_DIR_ENTRIES,
  StorageError,
  baseName,
  type ProjectRef,
  type StorageProvider,
} from "./types";
import { appLog, describeError } from "../log";

// Which folders under the projects root are projects. Drive addresses its
// folders through the `StorageProvider` port by id, while a local root is a
// handle tree only the File System Access API can walk, so there are two
// scans:
//
//   - `listProjectsInFolder`, through the port; the ref is the folder to
//     list.
//   - `listLocalProjectsIn`, over handles. A local root has no portable ref,
//     and a magic key passed through the port would be a flag, not an
//     address; `localProvider.listDir` stays project-scoped.
//
// A folder that cannot be listed is not an error: `assistant/` and
// `reference/` start empty on a fresh project, and a root whose permission
// has lapsed yields nothing. The caller decides what nothing means.

export async function listProjectsInFolder(
  provider: StorageProvider,
  rootRef: ProjectRef,
  dirPath: string,
): Promise<ProjectRef[]> {
  let entries;
  try {
    entries = await provider.listDir(rootRef, dirPath);
  } catch (err) {
    // A folder not made yet is the empty case above, not a failure.
    if ((err as { code?: unknown } | null)?.code !== "not-found")
      appLog.warn("storage", "The projects folder could not be listed.", {
        provider: provider.id,
        ...describeError(err),
      });
    return [];
  }

  const out: ProjectRef[] = [];
  for (const entry of entries) {
    if (entry.kind !== "folder") continue;
    // Drive identifies folders by id, local disk by the folder's name; the
    // key is whatever the provider resolves.
    const key = (await provider.fileIdOf?.(rootRef, entry.path)) ?? entry.name;
    const ref: ProjectRef = {
      providerId: provider.id,
      key,
      name: entry.name,
      openedAt: new Date().toISOString(),
    };
    try {
      if (await provider.exists(ref, STRUCTURE_FILE)) out.push(ref);
    } catch {
      // A folder that cannot be probed is not a project to offer.
    }
  }
  return out;
}

/**
 * The local scan, against the root handle itself. Each ref is keyed by folder
 * name, so the card points at what a file manager shows.
 *
 * The probe is the filter: dotfiles and stray folders fail it and never reach
 * the shelf. No permission is asked; the caller checks the root is readable
 * first.
 *
 * The probe uses the manifest's bare name, never the port's path form.
 * `STRUCTURE_FILE` is the path `/document-structure.yaml`, and the File System
 * Access API rejects a name containing `/` with a `TypeError`: every probe
 * would throw, every folder would be skipped, and the shelf would look empty
 * while the books sat on disk.
 */
export async function listLocalProjectsIn(
  root: FileSystemDirectoryHandle,
): Promise<ProjectRef[]> {
  const manifestName = baseName(STRUCTURE_FILE);
  const refs: ProjectRef[] = [];
  let entries = 0;
  for await (const [name, handle] of root.entries()) {
    // The ceiling the port's `listDir` applies. The root is any folder the
    // writer chooses, so an accidental home-directory pick is refused
    // instead of probed entry by entry. The caller degrades a
    // throw to "nothing found", the safe direction.
    if (++entries > MAX_DIR_ENTRIES) {
      throw new StorageError(
        `That folder holds more than ${MAX_DIR_ENTRIES} items — it may not be a project.`,
        "too-large",
        "storage.tooLargeFolder",
        { max: MAX_DIR_ENTRIES },
      );
    }
    if (handle.kind !== "directory") continue;
    const dir = handle as FileSystemDirectoryHandle;
    try {
      await dir.getFileHandle(manifestName);
    } catch {
      continue;
    }
    refs.push({
      providerId: LOCAL_PROVIDER_ID,
      key: name,
      name,
      openedAt: new Date().toISOString(),
    });
  }
  return refs;
}
