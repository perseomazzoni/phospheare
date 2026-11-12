// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ProjectRef } from "../storage";

// `${providerId}:${key}` keys a project by where its bytes are, and only by
// that. A project's identity is the uuid in its `document-properties.json`;
// `project/projectId.ts` is the one seam between the two.
//
// Legitimate uses mean "the same place": the card lookups, the queue's index
// of ops and its projections (`deviceWork`, `useSyncState`), which must answer
// without a library mirror, and the ref-to-ref comparisons in `cardEvidence`
// and `useProjectBodies`. Do not use it to mean "this book": a membership
// probe keyed by address against an id-keyed set is always false.

export function refIdentity(
  ref: Pick<ProjectRef, "providerId" | "key">,
): string {
  return `${ref.providerId}:${ref.key}`;
}
