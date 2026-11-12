// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { driveProvider, localProvider } from "../../storage";
import type { SourceFilter } from "./libraryFilter";

// Why a shelf shows no projects. "Nothing matches" answers a query that found
// nothing, not a store the writer just selected: it would offer to clear a
// search they never typed and say nothing about the place they asked about.
//
// Selecting Remote Storage while it is disconnected is not an empty shelf but
// an unseen one, and the panel says so and offers the one remedy. Otherwise it
// would read as the writer's projects being gone.

export type EmptyState =
  /** A query, or a filter the writer set, narrowed everything away. */
  | "noMatch"
  /** Remote Storage is selected and there is no connection to look through. */
  | "driveDisconnected"
  /** Remote Storage is selected and connected, and holds nothing yet. */
  | "driveEmpty"
  /** This device is selected and no local root has been chosen yet. */
  | "localEmpty"
  /**
   * This device is selected, a root is mapped, and its scan found no
   * projects. Unlike `localEmpty`, a folder not yet chosen, it says "this
   * folder holds no projects" rather than "choose a folder".
   */
  | "localScannedEmpty";

/**
 * Which empty panel a shelf showing no projects draws.
 *
 * A typed query outranks the store filter. With Remote Storage selected and a
 * query typed, the search is the better explanation: the writer did it most
 * recently and can undo it. Saying Remote Storage is empty over a mistyped
 * title would send them to reconnect an account that was never the problem.
 */
export function emptyState(
  query: string,
  filter: SourceFilter,
  driveConnected: boolean,
  localRootReady: boolean,
): EmptyState {
  if (query.trim().length > 0) return "noMatch";
  if (filter === driveProvider.id)
    return driveConnected ? "driveEmpty" : "driveDisconnected";
  if (filter === localProvider.id)
    return localRootReady ? "localScannedEmpty" : "localEmpty";
  // `all`, with no query and no projects to show: no place explains it, so
  // the generic panel does.
  return "noMatch";
}
