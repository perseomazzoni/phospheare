// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The regex search provider behind the `SearchProvider` port. The query is
// literal text, with optional Unicode-aware whole-word boundaries.
//
// `wordCharRegex` is exported because the view's highlighter must use the
// same word definition, or the search bar's count and the DOM highlights
// disagree.

import type { Doc, Match } from "../domain/model";
import type { SearchOptions, SearchProvider } from "../ports/search";
export { wordCharRegex } from "../domain/words";
import { HYPHEN_JOINERS, WORD_CHARS } from "../domain/words";
import {
  PAGE_BREAK_MARK,
  cursorAt,
  joinedText,
  type JoinedText,
} from "../domain/joined";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nonWordClass(hyphensJoinWords: boolean): string {
  return hyphensJoinWords
    ? `[^${WORD_CHARS}${HYPHEN_JOINERS}]`
    : `[^${WORD_CHARS}]`;
}

/** Regex for `query`, or null when nothing is left to search for. */
export function buildRegex(query: string, opts: SearchOptions): RegExp | null {
  // A page break's mark is never something a query asks for.
  const literal = query.split(PAGE_BREAK_MARK).join("");
  if (!literal) return null;
  let pattern = escapeRegex(literal);
  if (opts.wholeWord) {
    // A Unicode-aware word boundary, as lookarounds so the boundary
    // characters are never part of the match. `\b` is ASCII-only.
    const nonWord = nonWordClass(opts.hyphensJoinWords ?? false);
    pattern = `(?<=^|${nonWord})${pattern}(?=$|${nonWord})`;
  }
  const flags = opts.caseSensitive ? "gu" : "giu";
  return new RegExp(pattern, flags);
}

/** The match `[start, end)` of the joined text, in paragraphs and offsets. */
function matchOf(joined: JoinedText, start: number, end: number): Match {
  const from = cursorAt(joined, start);
  const to = cursorAt(joined, end);
  return {
    para: from.para,
    startOffset: from.offset,
    endPara: to.para,
    endOffset: to.offset,
  };
}

/**
 * Scan `doc` against a regex from `buildRegex`, over the whole document as
 * one text, so a query with a paragraph break in it finds the passages that
 * run across one.
 */
export function searchDoc(doc: Doc, regex: RegExp | null): Match[] {
  if (!regex) return [];
  const joined = joinedText(doc);
  const matches: Match[] = [];
  let m: RegExpExecArray | null;
  regex.lastIndex = 0;
  while ((m = regex.exec(joined.text)) !== null) {
    matches.push(matchOf(joined, m.index, m.index + m[0].length));
    if (m[0].length === 0) regex.lastIndex++;
  }
  return matches;
}

function findMatches(doc: Doc, query: string, opts: SearchOptions): Match[] {
  return searchDoc(doc, buildRegex(query, opts));
}

function findTextOccurrences(doc: Doc, text: string): Match[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const joined = joinedText(doc);
  const haystack = joined.text.toLowerCase();
  const results: Match[] = [];
  let idx = 0;
  while ((idx = haystack.indexOf(lower, idx)) !== -1) {
    results.push(matchOf(joined, idx, idx + text.length));
    idx += text.length || 1;
  }
  return results;
}

export const regexSearch: SearchProvider = {
  buildRegex,
  searchDoc,
  findMatches,
  findTextOccurrences,
};
