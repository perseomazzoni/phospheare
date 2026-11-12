// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

/**
 * How long a run has taken, in wall-clock milliseconds, less any time it
 * spent waiting on the writer.
 *
 * Every reader of the number calls this, so the clock that is shown and the
 * one that is stored are one measurement. A web search can pause a run for
 * as long as the writer takes, and that wait is theirs, not the model's.
 */
export function runElapsedMs(
  createdAt: string,
  waitedMs: number,
  now: string,
): number {
  return Math.max(0, Date.parse(now) - Date.parse(createdAt) - waitedMs);
}
