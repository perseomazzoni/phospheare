// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The `Assistant`'s feature objects: each workflow module's `bind(host)`
// returns its public functions with the aggregate's host bound once, so
// `assistant.reviews.run(…)` is `runReview(host, …)`.

export function withHost<H, A extends unknown[], R>(
  host: H,
  fn: (host: H, ...args: A) => R,
): (...args: A) => R {
  return (...args) => fn(host, ...args);
}
