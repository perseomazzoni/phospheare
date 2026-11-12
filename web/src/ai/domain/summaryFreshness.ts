// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Whether a generated summary still stands. The catalogue's `freshness` and
// the Reference reader's badge both judge through `summaryFreshness`, so the
// model and the writer never disagree about one summary.

import { hashOf } from "../../text/hash";
import type { SummaryMetadata, SummaryState } from "./types";

/** Whether stored metadata still matches a set of current source hashes. */
export function sourcesCurrent(
  metadata: SummaryMetadata,
  current: ReadonlyMap<string, string>,
): boolean {
  return metadata.sources.every(
    (source) => current.get(source.nodeId) === source.contentHash,
  );
}

/**
 * Outdated when a source's current revision differs from the one it was
 * generated from, or cannot be read (absent from `current`). Otherwise
 * current when the body still hashes to its recorded `bodyHash`, and
 * unverified when it does not: the file was edited outside the app.
 */
export async function summaryFreshness(
  summary: { metadata: SummaryMetadata; body: string },
  current: ReadonlyMap<string, string>,
): Promise<Exclude<SummaryState, "missing">> {
  if (!sourcesCurrent(summary.metadata, current)) return "outdated";
  const bodyOk = (await hashOf(summary.body)) === summary.metadata.bodyHash;
  return bodyOk ? "current" : "unverified";
}
