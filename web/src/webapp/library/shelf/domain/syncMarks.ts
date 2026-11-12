// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { SyncCheckResult } from "../../../../project/sync/check";

/**
 * The one conflicts-map change. `null`, or a result without
 * `verdict.conflict`, deletes the entry. An unchanged map is returned as is,
 * which skips a re-render.
 */
export function withConflict(
  conflicts: Map<string, SyncCheckResult>,
  projectId: string,
  result: SyncCheckResult | null,
): Map<string, SyncCheckResult> {
  if (result === null || !result.verdict.conflict) {
    if (!conflicts.has(projectId)) return conflicts;
    const next = new Map(conflicts);
    next.delete(projectId);
    return next;
  }
  return new Map(conflicts).set(projectId, result);
}

/** Adds a synced mark; an unchanged set is returned as is. */
export function withSynced(
  synced: Set<string>,
  projectId: string,
): Set<string> {
  return synced.has(projectId) ? synced : new Set(synced).add(projectId);
}

/** Removes a synced mark; an unchanged set is returned as is. */
export function withoutSynced(
  synced: Set<string>,
  projectId: string,
): Set<string> {
  if (!synced.has(projectId)) return synced;
  const next = new Set(synced);
  next.delete(projectId);
  return next;
}
