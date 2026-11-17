// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

/** The words of `query` in lower case; none for a blank query. */
export function queryWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Whether `line`, a formatted line in lower case, holds every word, anywhere:
 * the time, the level, the area, the message or a field. The line is
 * formatted once, when the log is read, not at each key the search takes.
 */
export function matches(line: string, words: readonly string[]): boolean {
  return words.every((word) => line.includes(word));
}
