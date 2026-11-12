// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { SourceDescriptor, SourceText } from "../domain/types";
import { excerptAround, findTerms } from "../domain/textMatch";

// `grep`: every place the book says it, so a continuity check need not read
// each Section whole to find the rest.
//
// Literal terms, any of them, folded (case, accents and typographic marks
// forgiven, `textMatch.fold`), optionally whole words. Every match comes in
// reading order, with offsets in the same text `read_source` serves, so a hit
// is one ranged read away from its scene. Terms are literal because a regular
// expression cannot be interrupted on the editor's thread, and a writer's
// names and words are literal.
//
// Generated summaries are left out unless asked for by id, because a summary
// is not evidence (`PROSE_BOUNDARY`) and a hit in one would read as if the
// book said it.

/** How many matches one call returns at most, and by default. */
export const GREP_LIMIT_MAX = 60;
export const GREP_LIMIT_DEFAULT = 30;
/** Characters of context each side of a match, at most and by default. */
export const GREP_CONTEXT_MAX = 400;
export const GREP_CONTEXT_DEFAULT = 120;

export interface GrepRequest {
  terms: readonly string[];
  sourceIds?: readonly string[];
  wholeWord?: boolean;
  context?: number;
  limit?: number;
}

export interface GrepMatch {
  sourceId: string;
  title: string;
  start: number;
  end: number;
  /** The words around the match, as written: quotable. */
  excerpt: string;
}

export interface GrepResult {
  matches: GrepMatch[];
  /** Sources whose title holds a term: a Section asked for by name. */
  titles: Array<{ sourceId: string; title: string }>;
  /** Every match found, including those past `limit`. */
  total: number;
  /** Matches per source, all of them. */
  perSource: Record<string, number>;
  truncated: boolean;
}

/**
 * The sources a grep reads, in reading order: the ids asked for, or every
 * allowed source but generated summaries. An id outside the allowed set is
 * not read, the same silence as a source that does not exist, so a search
 * cannot probe past a reader's horizon.
 */
export function grepScope(
  catalog: readonly SourceDescriptor[],
  allowed: ReadonlySet<string>,
  sourceIds?: readonly string[],
): SourceDescriptor[] {
  const asked = sourceIds ? new Set(sourceIds) : null;
  return catalog
    .filter((source) => allowed.has(source.id))
    .filter((source) =>
      asked ? asked.has(source.id) : source.kind !== "summary",
    )
    .sort(
      (a, b) =>
        Number(a.kind !== "manuscript") - Number(b.kind !== "manuscript") ||
        (a.order ?? 0) - (b.order ?? 0),
    );
}

/** A grep over texts already read. */
export function grepIn(
  texts: ReadonlyArray<{ source: SourceDescriptor; capture: SourceText }>,
  request: GrepRequest,
): GrepResult {
  const side = Math.min(
    GREP_CONTEXT_MAX,
    Math.max(0, request.context ?? GREP_CONTEXT_DEFAULT),
  );
  const limit = Math.min(
    GREP_LIMIT_MAX,
    Math.max(1, request.limit ?? GREP_LIMIT_DEFAULT),
  );
  const options = { wholeWord: request.wholeWord === true };
  const matches: GrepMatch[] = [];
  const titles: GrepResult["titles"] = [];
  const perSource: Record<string, number> = {};
  let total = 0;
  for (const { source, capture } of texts) {
    if (findTerms(source.title, request.terms, options).length > 0)
      titles.push({ sourceId: source.id, title: source.title });
    const found = findTerms(capture.text, request.terms, options);
    if (found.length === 0) continue;
    perSource[source.id] = found.length;
    total += found.length;
    for (const match of found) {
      if (matches.length >= limit) break;
      matches.push({
        sourceId: source.id,
        title: source.title,
        start: match.start,
        end: match.end,
        excerpt: excerptAround(capture.text, match.start, match.end, side),
      });
    }
  }
  return {
    matches,
    titles,
    total,
    perSource,
    truncated: total > matches.length,
  };
}
