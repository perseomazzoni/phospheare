// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { isRemoteRef } from "../../storage";
import type { ProjectRef } from "../../storage/types";
import type { RemoteTarget } from "./manifest";
import { pairingFor } from "./pairing";
import { projectIdFor } from "../projectId";

// Where a project commits to, answered in one place for the decoration seam
// (whether a project gets a cache and a queue), `CacheTarget.remote` (which
// `openCacheStore` requires) and the drain's destination. Two answers to this
// question could disagree, and a Remote-only project would then enqueue
// nothing.
//
// A remote-primary project is its own destination: the ref names the backend
// and the key, with no lookup and nothing that can be cold. So the drain's
// "pairing vanished, drop everything" branch is unreachable for it.
//
// A device project has a destination only if it is paired, and a pairing is a
// manifest, a relationship between two durable sides. This is the async half,
// and the only one that can answer `null`.
//
// The pairing is keyed by the book, so the address resolves to an identity
// first, in one of two ways that must not be confused.
//
//   A caller that knows the book passes its id as the ref's optional `id`.
//   The queue's drain does: its records store the id because the queue must
//   answer with no library mirror, and the manifest lives in IndexedDB,
//   independent of the shelf. Resolving through the mirror would let a cold
//   shelf read as an unpair, and the drain would drop work nobody chose to
//   drop. With the id, `null` means the manifest is gone, which only a
//   person's decision causes. A manifest store that cannot be read rejects
//   instead (`pairing.ts`), so a failed read never answers `null`.
//
//   A caller with only an address asks the shelf, the one seam from an
//   address to the book. An address the shelf has not answered for reads as
//   unpaired, failing closed: the project stays Local-only and its saves go
//   straight to disk. A queued record without an id takes this path too,
//   because the mirror is the only way to find its destination.
export async function remoteFor(
  ref: Pick<ProjectRef, "providerId" | "key"> & { id?: string },
): Promise<RemoteTarget | null> {
  if (isRemoteRef(ref)) return { providerId: ref.providerId, key: ref.key };
  const projectId = ref.id ?? projectIdFor(ref);
  return projectId ? pairingFor(projectId) : null;
}
