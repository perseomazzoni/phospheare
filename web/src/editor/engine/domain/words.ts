// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What a word is: the one definition of a word character, shared by the
// search adapter, the view's highlighter and the diff engine so they never
// disagree about a word.
//
// A word character is a Unicode letter, a Unicode digit, a combining mark or
// an underscore; everything else (spaces, punctuation, hyphens) separates
// words. With `hyphensJoinWords` set, the hyphen characters below join word
// parts instead, so `e-mail` and `well-known` are single words.
//
// Combining marks (`\p{M}`) ride with the base letter they modify. Without
// them a decomposed (NFD) accent would separate words, so the same word
// spelled two Unicode-equivalent ways would diff as different.
//
// En and em dashes stay separators: an em dash is sentence punctuation
// (`she paused—then spoke`) and an en dash marks ranges (`1990–2000`), so
// joining them would break the most common whole-word searches.

// Hyphen-minus (U+002D), hyphen (U+2010), non-breaking hyphen (U+2011),
// small hyphen-minus (U+FE63) and fullwidth hyphen-minus (U+FF0D).
export const WORD_CHARS = "\\p{L}\\p{N}\\p{M}_";
export const HYPHEN_JOINERS = "\\u2010\\u2011\\uFE63\\uFF0D-";

const wordCharCache = new Map<boolean, RegExp>();

/** The single-character word regex, cached per flag. */
export function wordCharRegex(hyphensJoinWords: boolean): RegExp {
  let re = wordCharCache.get(hyphensJoinWords);
  if (!re) {
    re = new RegExp(
      `[${WORD_CHARS}${hyphensJoinWords ? HYPHEN_JOINERS : ""}]`,
      "u",
    );
    wordCharCache.set(hyphensJoinWords, re);
  }
  return re;
}

export interface WordToken {
  text: string;
  /** The token's offset in the source string, in code units. */
  start: number;
  /** One past the token's last code unit in the source string. */
  end: number;
}

/**
 * Split prose into word tokens with their offsets: the diff's units.
 *
 * A word is a maximal run of word characters with hyphens joining, so for
 * diffing `state-of-the-art` is one word. Separators are not tokens.
 *
 * The scanning regex is built here with the `+` and `g` flags: the shared
 * `wordCharRegex` matches a single character, and `exec` on a non-global
 * regex would loop forever.
 */
export function splitWords(text: string): WordToken[] {
  const re = new RegExp(`[${WORD_CHARS}${HYPHEN_JOINERS}]+`, "gu");
  const tokens: WordToken[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
    if (match[0].length === 0) re.lastIndex++;
  }
  return tokens;
}
