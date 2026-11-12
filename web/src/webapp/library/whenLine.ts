// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Which date a card prints: one date for one question, when did this project
// last change. The document's own edit stamp (`updatedAt`) comes first; a
// folder listed but never read has none, so the card falls back to the last
// time a change was observed (`cachedAt`, which advances only when the
// content changed, never on a plain look). Both answer the same question, so
// one label serves both.
//
// A card with neither stamp says nothing rather than inventing a date: its
// word count is already dimmed, and it does not claim to be current.

export type WhenLine = { id: "edited"; when: string } | null;

/**
 * @param edited  `updatedAt`, already humanised, or null when there is none
 * @param checked `cachedAt`, already humanised, or null when there is none
 */
export function whenLine(
  edited: string | null,
  checked: string | null,
): WhenLine {
  const when = edited ?? checked;
  return when ? { id: "edited", when } : null;
}
