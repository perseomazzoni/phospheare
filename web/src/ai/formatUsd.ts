// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

/**
 * A dollar amount the way the writer's language writes money.
 *
 * Two fraction digits from one cent up, as every price reads. Under a cent,
 * two significant digits instead: a web search's reported cost is often a
 * fraction of a cent, and "$0.00" for money that was spent says it was free,
 * which a cost line must never say. Zero itself is "$0.00".
 *
 * The one formatter for money the Assistant shows, so the same amount never
 * prints two ways on one screen.
 */
export function formatUsd(amount: number, locale: string): string {
  const small = amount > 0 && amount < 0.01;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    ...(small
      ? { minimumSignificantDigits: 1, maximumSignificantDigits: 2 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  }).format(amount);
}
