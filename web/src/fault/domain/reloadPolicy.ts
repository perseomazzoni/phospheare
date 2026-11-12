// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// One automatic reload per tab per window. A build that is replaced once is
// fixed by one reload; a chunk that is missing from the new build too would
// otherwise reload the tab forever.

export const RELOAD_WINDOW_MS = 60_000;

/**
 * Whether a stale build may reload the tab by itself.
 *
 * @param last When this tab last reloaded itself, in epoch milliseconds, or
 * `null` when it never has. A time ahead of `now` is a clock that moved back,
 * and counts as no reload at all.
 */
export function mayAutoReload(last: number | null, now: number): boolean {
  return last === null || now < last || now - last >= RELOAD_WINDOW_MS;
}
