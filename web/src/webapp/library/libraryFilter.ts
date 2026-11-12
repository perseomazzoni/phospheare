// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Which projects the shelf shows: search, the source filter and the order, as
// one decision over a plain list.

import { normalize } from "../../ui/normalize";

/**
 * `all`, or a provider's id. The strip offers exactly the sources that exist.
 */
export type SourceFilter = string;

export interface Listing {
  providerId: string;
  /** The folder's name, which a writer may type looking for it. */
  name: string;
  /** The document's own title, once read; often different. */
  title: string | null;
  /** `document.updatedAt`, or `''` when this one was never read. */
  editedAt: string;
}

export { normalize };

/**
 * Searches both names, because they differ: a folder called `once-dark` holds
 * a project titled "Once Dark", and the writer may remember either.
 */
export function matchesQuery(item: Listing, query: string): boolean {
  const q = normalize(query.trim());
  if (!q) return true;
  return (
    normalize(item.name).includes(q) || normalize(item.title ?? "").includes(q)
  );
}

export function matchesSource(item: Listing, filter: SourceFilter): boolean {
  return filter === "all" || item.providerId === filter;
}

/**
 * Most recently edited first. A project never read sorts last: its empty
 * `editedAt` means unknown, not the beginning of time, and guessing would put
 * a blocked folder above the chapter the writer just closed.
 */
export function byRecency(a: Listing, b: Listing): number {
  if (a.editedAt === b.editedAt)
    return normalize(a.name).localeCompare(normalize(b.name));
  if (!a.editedAt) return 1;
  if (!b.editedAt) return -1;
  return b.editedAt.localeCompare(a.editedAt);
}

export function shown<T extends Listing>(
  items: readonly T[],
  query: string,
  filter: SourceFilter,
): T[] {
  return items
    .filter((item) => matchesSource(item, filter) && matchesQuery(item, query))
    .sort(byRecency);
}
