// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A notice that outlives the account it is about. By the time the landing
// renders, the account is gone, so the act that ended it leaves the notice
// here and the landing shows it once. In memory only: a reload is a new
// visit, and a notice from a past one would greet the wrong person.

let pending: string | null = null;

/** Leaves the string key of a notice for the landing. */
export function leaveFarewell(key: string): void {
  pending = key;
}

/** The notice left for the landing, or `null`; reading keeps it. */
export function peekFarewell(): string | null {
  return pending;
}

/** Drops the notice, once shown or when the act it was about failed. */
export function clearFarewell(): void {
  pending = null;
}
