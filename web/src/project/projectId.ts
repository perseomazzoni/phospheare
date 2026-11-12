// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ProjectRef } from "../storage/types";
import { getCurrentUserId } from "../auth/currentUser";
import { libraryIdForRef } from "../profile/library";
import { libraryRows } from "../profile/profileSync";

// The one seam from an address (`ProjectRef`) to a project's identity, the
// uuid in its `document-properties.json`.
//
// It reads only the library mirror, which is in localStorage, so the answer
// is synchronous; reading the properties file would cost a provider round
// trip per call. Every project the sync layer touches is on the shelf, and a
// shelf row carries the id from creation.
//
// `null` means this device does not know what book is there, and every
// caller must fail closed on it rather than fall back to the address. It
// comes from a mirror not yet pulled or a folder not on the shelf; treating
// either as some project lets a second book inherit a first one's pairing.
export function projectIdFor(
  ref: Pick<ProjectRef, "providerId" | "key">,
): string | null {
  const userId = getCurrentUserId();
  if (!userId) return null;
  return libraryIdForRef(libraryRows(userId), ref);
}
