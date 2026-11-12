// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Pure text helpers shared by modules whose boundaries forbid importing one
// another (the AI core, the comments core, the project layer). The editor
// engine imports nothing outside itself and keeps its own copy in
// `engine/adapters/regex.ts`; the two must escape the same set.

/** `text` with every regular-expression metacharacter escaped, for `new RegExp`. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
