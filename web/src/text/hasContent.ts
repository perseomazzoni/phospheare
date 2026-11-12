// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

/**
 * Something a writer put there: a letter or a digit, as the word count
 * (`project/stats.ts`) counts. Punctuation, whitespace and markup alone are
 * not content.
 */
export function hasContent(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}
