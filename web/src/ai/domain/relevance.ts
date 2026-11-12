// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What a request is about, as terms a passage can be matched on. A declared
// reference that does not fit the window whole is searched for passages on
// these terms, so a long timeline holding the one decisive line is not
// skipped while a short, unrelated sheet spends the room. The terms come from
// no language and no word list, because the book may be in any language and
// a list of stop words is one language's.
//
// Two sources of terms, both the writer's own words:
// - the request's longer words: five letters and more, folded. Short words
//   are the grammar of every language; the ones that carry a request's
//   subject ("Marta", "harbour", "timeline") are longer. A request in any
//   language yields its nouns and names this way, and a few function words
//   with them, which match rarely enough in a reference to cost little.
// - the prose's names: a capitalised word the prose writes at least twice
//   and never in lower case. A sentence's first word is capitalised too, but
//   it is written in lower case elsewhere; a name never is. This is the
//   heuristic `candidates.ts` uses for name drift, applied the other way.
//
// The list is bounded and ordered by how often the prose says each term, so
// the excerpt is built from the request's subject first.

import { fold } from "./textMatch";

/** The most terms one request is matched on. */
export const RELEVANCE_TERMS_MAX = 24;

/** The shortest word of a request that counts as its subject. */
const REQUEST_WORD_MIN = 5;

const CAPITALISED = /\p{Lu}[\p{Ll}\p{M}]{2,}/gu;
const WORD = /[\p{L}\p{M}]+/gu;

/**
 * The terms a declared document is searched for on this request: the
 * request's longer words and the prose's names, most frequent in the prose
 * first, at most `RELEVANCE_TERMS_MAX`. Empty when there is nothing to go
 * on, which leaves the caller with the whole-document rule alone.
 */
export function relevanceTerms(
  request: string,
  prose: readonly string[],
): string[] {
  const counts = new Map<string, number>();
  const lower = new Set<string>();
  const capitalised = new Map<string, number>();
  for (const text of prose) {
    for (const word of text.match(WORD) ?? []) {
      const folded = fold(word);
      counts.set(folded, (counts.get(folded) ?? 0) + 1);
      if (word === word.toLocaleLowerCase()) lower.add(folded);
    }
    for (const name of text.match(CAPITALISED) ?? []) {
      const folded = fold(name);
      capitalised.set(folded, (capitalised.get(folded) ?? 0) + 1);
    }
  }
  const terms = new Set<string>();
  for (const word of request.match(WORD) ?? []) {
    const folded = fold(word);
    if (folded.length >= REQUEST_WORD_MIN) terms.add(folded);
  }
  for (const [name, count] of capitalised)
    if (count >= 2 && !lower.has(name)) terms.add(name);
  return [...terms]
    .sort(
      (a, b) =>
        (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b),
    )
    .slice(0, RELEVANCE_TERMS_MAX);
}
