// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The order a model list is read in: alphabetical by id. A provider's own
// order is not one a writer can predict (OpenRouter lists hundreds, by its
// own ranking), and a list read to find a name is read alphabetically.
// Numeric and case-blind, so `llama3.1` follows `llama3` and `Qwen` sits by
// `qwen`.
//
// One copy, so a name learnt in one model list is in the same place in the
// other.

export function compareModelIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
