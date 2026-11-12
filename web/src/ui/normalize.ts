// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

/**
 * Casefolds and strips accents. Italian is a first-class language here, and a
 * writer typing "perche" for a project called "Perché" has used the keyboard
 * in front of them, not made a mistake; a search without this hides the
 * project.
 *
 * It lives in `ui/` because both halves search, and one answer to whether
 * two strings match keeps the shelf, the palette and the structure panel
 * alike.
 *
 * Not for the editor's prose search, which is literal by contract and lives in
 * the engine's search adapter.
 */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
