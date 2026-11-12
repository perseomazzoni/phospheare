// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { normalize } from "./normalize";

// What the palette shows, and what is selected. Ctrl/⌘K is the keyboard route
// to everything on the screen, so both of its failure points live here rather
// than in the component: which commands match the query, and where the
// highlight goes when the list under it changes length. A selection left
// pointing past the end makes Enter run nothing, or run whatever slid into
// that position.

export interface Command {
  id: string;
  label: string;
  /** Printed on the right of the row: "Remote Storage", "Create", "Account". */
  group: string;
}

/**
 * Searches both label and group. The group lets "remote" find every project in
 * Remote Storage without the writer knowing any titles, and "create" find the
 * ways to start one. Folding is shared with the shelf's search, so "perche"
 * finds "Perché" in both places.
 */
export function matchesCommand(command: Command, query: string): boolean {
  const q = normalize(query.trim());
  if (!q) return true;
  return (
    normalize(command.label).includes(q) || normalize(command.group).includes(q)
  );
}

export function filterCommands<T extends Command>(
  commands: readonly T[],
  query: string,
): T[] {
  return commands.filter((command) => matchesCommand(command, query));
}

/**
 * Where the highlight goes after a move of `delta`. Clamped rather than
 * wrapping: a palette is a short list read top to bottom, and holding Down
 * rests on the last row instead of cycling back to the first unseen.
 *
 * An empty list has no selection, which is -1; 0 would point at a row that
 * does not exist.
 */
export function nextIndex(
  count: number,
  current: number,
  delta: number,
): number {
  if (count <= 0) return -1;
  return Math.max(0, Math.min(count - 1, current + delta));
}

/**
 * Where the highlight goes after the list changes: back to the top, because
 * after another letter the best match is the first row and the next key is
 * Enter. Keeping the old position would make Enter run whatever slid into it.
 */
export function resetIndex(count: number): number {
  return count > 0 ? 0 : -1;
}
