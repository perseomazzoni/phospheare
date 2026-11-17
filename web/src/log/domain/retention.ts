// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// How long and how much the browser keeps: the same 14 days as the desktop
// program's files, and a size that a quota never feels.

/** No line is kept longer than this. */
export const KEEP_MS = 14 * 24 * 60 * 60 * 1000;

/** Past this many characters of lines, the oldest go. */
export const MAX_SIZE = 10 * 1024 * 1024;

/** What a trim leaves, so the next one is not a line away. */
export const TRIM_TO = 8 * 1024 * 1024;

/**
 * Whether the oldest line goes, given the size of all the lines and whether
 * a trim has started: a trim starts past `MAX_SIZE` and goes on down to
 * `TRIM_TO`.
 */
export function dropsOldest(total: number, trimming: boolean): boolean {
  return total > (trimming ? TRIM_TO : MAX_SIZE);
}
