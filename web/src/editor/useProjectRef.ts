// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useState } from "react";
import type { ProjectRef } from "../storage";
import { libraryRefForId } from "../profile/library";
import { libraryRows, syncProfile } from "../profile/profileSync";

// From an address to a place. The URL names a project by its own id
// (`editor/path.ts`), and the library mirror turns that id back into a
// provider and a key. It is a hook rather than a function because the mirror
// can be cold: a project link pasted into a fresh browser arrives with an
// empty cache and a correct address.
//
//   `undefined`  not answered yet: the mirror had no match and the pull is
//                in flight. The route holds at the skeleton.
//   `null`       answered: no project of this account carries that id.
//   a ref        answered: this one.
//
// The mirror read comes first and is synchronous localStorage, so a click on
// a card of the writer's own shelf answers in the same tick and waits on no
// network. The route already holds at the skeleton for that tick, because
// `useProjectStore` starts `undefined`; only a cold mirror reaches the pull.
//
// The pull joins `syncProfile`, which `SessionGate` fires on every
// signed-in mount and which is single-flight per user, so the answer here
// agrees with the shelf's. A failure resolves to `null` rather than leaving
// the writer at a skeleton that never opens.
export function useProjectRef(
  projectId: string | undefined,
  userId: string | undefined,
): ProjectRef | null | undefined {
  const [ref, setRef] = useState<ProjectRef | null | undefined>(undefined);

  useEffect(() => {
    if (!projectId || !userId) {
      // No id in the URL, or nobody signed in: nothing to look up, so `null`
      // rather than a wait with no end.
      setRef(null);
      return;
    }
    // Held in state rather than derived on every render: `providerFor` is
    // memoized on this object downstream, and a fresh ref each render would
    // read to the editor as the project changing under it.
    const known = libraryRefForId(libraryRows(userId), projectId);
    if (known) {
      setRef(known);
      return;
    }
    setRef(undefined);
    let live = true;
    void syncProfile(userId)
      .catch(() => {
        // Best-effort, as `SessionGate`'s own call is. The re-read below still
        // runs: a failed merge leaves the local rows as they were.
      })
      .finally(() => {
        if (live) setRef(libraryRefForId(libraryRows(userId), projectId));
      });
    return () => {
      live = false;
    };
  }, [projectId, userId]);

  return ref;
}
