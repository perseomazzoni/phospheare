// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { remoteFor } from "./sync/remoteFor";
import { providerFor } from "./sync/resolve";
import type { CacheStore } from "../storage/cache/cacheStore";
import { openCacheStore } from "../storage/cache/opfsCacheStore";
import type { ProjectRef, StorageProvider } from "../storage/types";

// A book's storage, opened outside the editor as the editor would hold it.
//
// A book with a remote is read through its working copy, so an undrained
// queue still shows what the writer last wrote, and a write goes
// `disk → cache → queue → remote` as the editor's does. A write through the
// bare provider would reach a Local + Synced book's disk alone, with nothing
// queued for the remote.
//
// The working copy holds a subscription, so the caller disposes it when done.
// An unregistered provider yields null, with nothing left open.

interface ProjectStorage {
  storage: StorageProvider;
  /** Lets go of the working copy. Idempotent. */
  dispose: () => void;
}

export async function openProjectStorage(
  ref: ProjectRef,
  projectId: string,
): Promise<ProjectStorage | null> {
  // An unreadable pairing opens the book without a store, as the editor does
  // (`useProjectStore`): a device project's writes still reach its disk.
  const remote = await remoteFor({ ...ref, id: projectId }).catch(() => null);
  let store: CacheStore | null = remote
    ? openCacheStore({ id: projectId, remote })
    : null;
  const dispose = () => {
    store?.dispose();
    store = null;
  };
  const storage = providerFor(ref, { store, projectId });
  if (!storage) {
    dispose();
    return null;
  }
  return { storage, dispose };
}
