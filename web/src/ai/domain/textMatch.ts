// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { escapeRegExp } from "../../text/regExp";

// The one way of finding words in a text: every check and search over the
// book matches through it. Two folds would be two answers to "is this the
// same passage", and a finding would verify in one place and not in the next.
//
// Offsets survive every fold. Each fold here maps one UTF-16 unit to one
// UTF-16 unit, so an offset found in the folded text is the same offset in
// the writer's, and a match can be quoted, opened or read around where it is.
// That is why the accent strip goes letter by letter instead of through a
// whole-string normalisation, which changes lengths.

/**
 * A text with the marks a faithful copy may still change (the apostrophe,
 * the quotation marks, the dash, a non-breaking space) made one of each, one
 * character for one. The words are kept as written: case, spacing and every
 * letter. An exact-mark rule would print a true finding as unverified because
 * a model copied a curly apostrophe straight.
 */
export function typographic(text: string): string {
  return text
    .replace(/[’‘ʼ`´]/gu, "'")
    .replace(/[“”«»„]/gu, '"')
    .replace(/[–—]/gu, "-")
    .replace(/\u00a0/gu, " ");
}

/**
 * `typographic`, in lower case and without accents, still one unit for one:
 * what a search reads, where "Perché" and "perche" and "PERCHÉ" are the same
 * word. A letter whose lower case is longer than itself (the Turkish dotted
 * İ) keeps its case, and a surrogate half is kept as it is, so no offset
 * moves.
 */
export function fold(text: string): string {
  const marks = typographic(text);
  let folded = "";
  for (let at = 0; at < marks.length; at += 1) {
    const unit = marks[at];
    const code = unit.charCodeAt(0);
    if (code >= 0xd800 && code <= 0xdfff) {
      folded += unit;
      continue;
    }
    const lower = unit.toLowerCase();
    const one = lower.length === 1 ? lower : unit;
    // A precomposed letter decomposes into its base first ("é" → "e" + ◌́).
    const base = one.normalize("NFD")[0];
    folded += base.length === 1 ? base : one;
  }
  return folded;
}

/** Every offset where `needle` starts in `haystack`, never overlapping. */
export function occurrences(haystack: string, needle: string): number[] {
  // An empty needle is found everywhere and the scan below would never end:
  // `indexOf("", n)` past the end answers the end again, forever.
  if (needle.length === 0) return [];
  const found: number[] = [];
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    found.push(at);
    at = haystack.indexOf(needle, at + Math.max(1, needle.length));
  }
  return found;
}

/** One place a term was found. */
export interface TermMatch {
  start: number;
  end: number;
  /** The term as it was asked for. */
  term: string;
}

const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;

/**
 * Every place any of `terms` appears in `text`, folded (`fold`), in reading
 * order. With `wholeWord`, only where the match is not part of a longer word
 * ("Leo" never in "Leonardo"). Where two terms overlap, the earlier and longer
 * match is kept, so one passage is one match.
 */
export function findTerms(
  text: string,
  terms: readonly string[],
  options: { wholeWord?: boolean } = {},
): TermMatch[] {
  const folded = fold(text);
  const found: TermMatch[] = [];
  for (const term of terms) {
    const needle = fold(term.trim());
    for (const start of occurrences(folded, needle)) {
      const end = start + needle.length;
      if (
        options.wholeWord &&
        ((start > 0 && WORD_CHARACTER.test(folded[start - 1])) ||
          (end < folded.length && WORD_CHARACTER.test(folded[end])))
      )
        continue;
      found.push({ start, end, term });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: TermMatch[] = [];
  for (const match of found)
    if (kept.length === 0 || match.start >= kept[kept.length - 1].end)
      kept.push(match);
  return kept;
}

/**
 * The words around `start..end`, `side` characters each way at most, cut at
 * whole words and marked with "…" where the text goes on. Spacing is kept as
 * written except line breaks, which become spaces, so a quotation taken from
 * an excerpt is still found in the text it came from.
 */
export function excerptAround(
  text: string,
  start: number,
  end: number,
  side: number,
): string {
  let from = Math.max(0, start - side);
  let to = Math.min(text.length, end + side);
  if (from > 0) {
    const space = text.indexOf(" ", from);
    if (space >= 0 && space < start) from = space + 1;
  }
  if (to < text.length) {
    const space = text.lastIndexOf(" ", to);
    if (space >= end) to = space;
  }
  const body = text.slice(from, to).replace(/\r?\n/g, " ");
  return `${from > 0 ? "…" : ""}${body}${to < text.length ? "…" : ""}`;
}

/** Two words' edit distance, a swap of neighbours counting as one edit. */
export function editDistance(a: string, b: string): number {
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= a.length; i += 1)
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  return rows[a.length][b.length];
}

/**
 * Where `quote` stands in `text`, folded (`fold`), with any run of spacing in
 * the quote matching any run in the text: a model copying a line out of the
 * book joins its line breaks and doubled spaces, and the words are still the
 * writer's. The first place it stands, or `null`.
 */
export function locate(
  text: string,
  quote: string,
): { start: number; end: number } | null {
  const words = fold(quote).trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return null;
  const escaped = words.map(escapeRegExp);
  const found = new RegExp(escaped.join("\\s+"), "u").exec(fold(text));
  return found
    ? { start: found.index, end: found.index + found[0].length }
    : null;
}
