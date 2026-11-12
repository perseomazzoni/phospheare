// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { plainLine } from "./webText";

// Whether a search query repeats the writer's own words.
//
// A search query leaves the machine, so the ask flags a row that carries a
// run of `n` consecutive words from the text this run showed the model. It
// is a warning for the writer's eyes, never a gate: it is positive-only, so a
// paraphrase passes unflagged, and the writer decides.
//
// The index is built once when the ask is posed and held on the pending ask
// for as long as the writer takes. So it is one padded token stream, about
// the size of the text it came from, checked with `includes`. A set of every
// shingle would be `n` times that plus per-entry overhead, held through an
// unbounded wait.

const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:'[\p{L}\p{N}\p{M}]+)*/gu;

/**
 * Normalizes the query and the book alike: one visible line,
 * compatibility-composed so a ligature or a full-width letter reads as the
 * letter, lower-cased, and every apostrophe the same one, so a straight quote
 * in a query matches the curly one a manuscript was typed with.
 */
function tokensOf(text: string): string[] {
  const line = plainLine(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘ʼ]/gu, "'");
  return line.match(TOKEN) ?? [];
}

/**
 * The checker for `texts`. Each text is its own padded stretch, joined by a
 * line break that no shingle contains, so a run can never be found across
 * the seam between two texts that were never adjacent.
 */
export function bookWordsIn(
  texts: readonly string[],
  n: number,
): (query: string) => boolean {
  const stream = texts
    .map((text) => ` ${tokensOf(text).join(" ")} `)
    .join("\n");
  return (query) => {
    const words = tokensOf(query);
    for (let at = 0; at + n <= words.length; at += 1)
      if (stream.includes(` ${words.slice(at, at + n).join(" ")} `))
        return true;
    return false;
  };
}
