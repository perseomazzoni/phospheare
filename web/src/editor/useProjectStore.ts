// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useState } from "react";
import { remoteFor } from "../project/sync/remoteFor";
import type { CacheStore } from "../storage/cache/cacheStore";
import { openCacheStore } from "../storage/cache/opfsCacheStore";

// The working copy, for the lifetime of one mount. Before the route opens
// anything it must know whether the project has a remote to commit to, which
// decides whether there is a working copy and a queue at all. For a device
// project the answer is asynchronous, because a pairing lives in IndexedDB.
//
// `undefined` means not answered yet and is distinct from `null`, which means
// the project has no remote. Collapsing them opens a paired project as plain
// Local for the first render, and its earliest writes never reach the queue,
// a silent way to lose work.
//
// The store is disposed on unmount because it holds an `onUserChange`
// subscription so a user switch can poison it, and an undisposed one leaks
// the listener and its closure.
export function useProjectStore(
  providerId: string | undefined,
  projectKey: string | undefined,
  projectId: string | undefined,
): CacheStore | null | undefined {
  const [store, setStore] = useState<CacheStore | null | undefined>(undefined);

  useEffect(() => {
    if (!providerId || !projectKey || !projectId) return;
    // The book's id rides the ref: `remoteFor` resolves a device
    // project's pairing from it in IndexedDB, so this path never waits on the
    // library mirror, the same rule the queue's records follow.
    const ref = { providerId, key: projectKey, id: projectId };
    let live = true;
    let opened: CacheStore | null = null;
    // An unreadable pairing opens the book without a store: a device
    // project's saves still reach its disk, and the next sync check pushes
    // what the queue did not carry.
    void remoteFor(ref)
      .catch(() => null)
      .then((remote) => {
        // The unmount may have happened while the pairing read was in flight.
        // Do not open a store nothing will dispose.
        if (!live) return;
        // Named by the book, which the route knows from the URL, so no
        // lookup happens here.
        opened = remote ? openCacheStore({ id: projectId, remote }) : null;
        setStore(opened);
      });
    return () => {
      live = false;
      opened?.dispose();
      // Back to "not answered yet" rather than "no remote": the next project
      // has not been looked up, and "no remote" would open it undecorated.
      setStore(undefined);
    };
  }, [providerId, projectKey, projectId]);

  return store;
}
