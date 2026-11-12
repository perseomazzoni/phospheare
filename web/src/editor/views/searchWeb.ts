// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The context menu's web search. There is no browser API for the user's
// default search engine, so the query goes through Google.

export function searchWebUrl(text: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}
