// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { PreparedBook } from "./prepare";

// Which language the book is in. What the source says comes first
// (`w:lang`, `fo:language`, `dc:language`, HTML `lang`, front matter, RTF
// `\deflang`), because the app the writer wrote it in put it there. When it
// says nothing, the commonest words over the first few thousand vote, and a
// language that wins by a margin is the book's. When the vote is unclear, the
// interface's language stands: the writer's best guess at their own book, one
// press from changing in the Finish step.

const STOP_WORDS: Record<string, string[]> = {
  en: [
    "the",
    "and",
    "of",
    "to",
    "was",
    "he",
    "she",
    "it",
    "that",
    "her",
    "his",
    "with",
    "you",
    "had",
    "but",
    "not",
  ],
  it: [
    "il",
    "di",
    "che",
    "la",
    "non",
    "un",
    "una",
    "per",
    "si",
    "era",
    "lo",
    "gli",
    "del",
    "della",
    "come",
    "anche",
  ],
  es: [
    "el",
    "la",
    "que",
    "de",
    "los",
    "las",
    "una",
    "por",
    "con",
    "se",
    "su",
    "pero",
    "era",
    "como",
    "más",
    "para",
  ],
  fr: [
    "le",
    "la",
    "les",
    "et",
    "des",
    "une",
    "est",
    "que",
    "il",
    "elle",
    "pas",
    "dans",
    "du",
    "pour",
    "qui",
    "avec",
  ],
  de: [
    "der",
    "die",
    "und",
    "das",
    "nicht",
    "ist",
    "ich",
    "sie",
    "es",
    "ein",
    "eine",
    "zu",
    "mit",
    "den",
    "war",
    "auf",
  ],
  pt: [
    "o",
    "que",
    "não",
    "uma",
    "os",
    "do",
    "da",
    "com",
    "para",
    "ele",
    "ela",
    "mas",
    "como",
    "foi",
    "era",
    "seu",
  ],
};

const SAMPLE_WORDS = 5000;

/** The primary subtag of a BCP 47 tag ("en-GB" → "en"), lower case. */
export function primaryOf(tag: string | undefined): string | undefined {
  const primary = tag?.trim().split(/[-_]/)[0]?.toLowerCase();
  return primary && /^[a-z]{2,3}$/.test(primary) ? primary : undefined;
}

export function detectLanguage(
  declared: string | undefined,
  book: PreparedBook,
  supported: readonly string[],
  fallback: string,
): string {
  const stated = primaryOf(declared);
  if (stated && supported.includes(stated)) return stated;
  const votes = new Map<string, number>();
  let seen = 0;
  outer: for (const block of book.blocks) {
    for (const word of block.text.toLowerCase().split(/[^\p{L}]+/u)) {
      if (!word) continue;
      seen += 1;
      for (const [lang, list] of Object.entries(STOP_WORDS))
        if (list.includes(word)) votes.set(lang, (votes.get(lang) ?? 0) + 1);
      if (seen >= SAMPLE_WORDS) break outer;
    }
  }
  const ranked = [...votes.entries()]
    .filter(([lang]) => supported.includes(lang))
    .sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  // Only a clear winner: enough votes, and well ahead of the next.
  if (
    first &&
    first[1] >= Math.max(5, seen * 0.05) &&
    (!second || first[1] >= second[1] * 1.5)
  )
    return first[0];
  return supported.includes(fallback) ? fallback : (supported[0] ?? fallback);
}
