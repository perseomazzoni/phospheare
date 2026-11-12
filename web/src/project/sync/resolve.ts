// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { getProvider } from "../../storage";
import { cached } from "../../storage/cache/cached";
import type { CacheStore } from "../../storage/cache/cacheStore";
import { mirror } from "../../storage/mirrored";
import type { ProjectRef, StorageProvider } from "../../storage/types";
import { getCurrentUserId } from "../../auth/currentUser";
import { refIdentity } from "../refIdentity";
import { enqueue, noteStaleRead, owesPut, pendingOpsFor } from "./remoteQueue";
import { exclusive } from "./tabLock";

// What the editor route opens. One fact decides it: whether the project has a
// remote to commit to. `remoteFor` answers once, on entry, and the answer
// arrives as `store`, non-null exactly when there is a destination, because
// `openCacheStore` requires one. The composition is:
//
//   `mirror(cached(base))` for a project with a destination:
//     device base → `disk → cache → queue → remote`
//     remote base → `cache → queue → remote`
//   the bare provider for a project without one → `disk` only.
//
// `cached` sits inside `mirror`, so a failure to write the disk or the working
// copy rejects before `mirror` appends an op. An op whose source was never
// written drains a stale file or none. With `mirror` outside, the enqueue is
// the last step, after both durable writes.
//
// A project with no destination gets its provider bare, with no working copy
// and no queue, so a Local project's "saved" stays a fact about a file the
// writer can open in another editor.

export function providerFor(
  ref: ProjectRef,
  opts: { store: CacheStore | null; projectId: string },
): StorageProvider | null {
  const base = getProvider(ref.providerId);
  if (!base) return null;
  if (!opts.store) return base;
  // The enqueue's promise is returned, never voided. `appendOp` throws with no
  // signed-in user, so after a 401 mid-session a voided call would leave the
  // next save reporting success while nothing was queued. The failure stays
  // on the save path, where the writer is told.
  //
  // The op names the book and where its bytes are today: the queue must
  // answer with no mirror, so it carries both rather than resolving one from
  // the other when it drains. The same address answers what is still
  // outstanding, so `mirror` lists a folder as it will stand once the queue
  // has drained, not as the remote last saw it.
  const address = {
    id: opts.projectId,
    providerId: ref.providerId,
    key: ref.key,
  };
  // What the queue still owes the remote is what `cached` must not refill
  // from the remote, and must refill from a disk, read from the same rows
  // through the same address.
  const owes = (path: string) =>
    pendingOpsFor(address).some((op) => op.kind === "put" && op.path === path);
  // One lock per working copy across every tab. A save holds it from its
  // working-copy write until its op is queued, and `cached` fills from the
  // remote under it, so a fill never lands between a save and its op, where
  // nothing yet says the entry is unsent. No network round trip sits inside:
  // a save writes the disk, OPFS and IndexedDB, and the drain it kicks runs
  // outside.
  const workingCopy = <T>(fn: () => Promise<T>): Promise<T> =>
    exclusive(
      `working-copy\u0000${getCurrentUserId() ?? ""}\u0000${refIdentity(address)}`,
      fn,
    );
  const composed = mirror(
    cached(base, opts.store, {
      owes,
      owedNow: (path) => owesPut(address, path),
      exclusive: workingCopy,
      lostRead: (path) => noteStaleRead(address, path),
    }),
    (op) => enqueue(address, op),
    () => pendingOpsFor(address),
  );
  return {
    ...composed,
    writeFile: (target, path, content) =>
      workingCopy(() => composed.writeFile(target, path, content)),
  };
}
