// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

/**
 * A fold's computed `transition-duration`, in milliseconds: how long the bar
 * waits before it lets go of its pin.
 *
 * Computed durations come back in seconds ("0.22s"); "ms" is handled too. A
 * fold lists one duration per property, all sharing `--t`, so the first is
 * read. Anything unreadable waits for nothing.
 */
export function foldDurationMs(raw: string): number {
  const collapse =
    parseFloat(raw) * (raw.trim().split(",")[0].endsWith("ms") ? 1 : 1000);
  return Number.isFinite(collapse) ? collapse : 0;
}
