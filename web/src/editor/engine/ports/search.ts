// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The `SearchProvider` port. The UI uses the lower-level
// `buildRegex`/`searchDoc` pair so a per-keystroke search never rebuilds its
// regex.
//
// Contract, for every provider:
//
//   1. `buildRegex` returns null for an empty query, and treats the query as
//      literal text: regex metacharacters in the query match themselves.
//   2. `wholeWord` matches only spans bordered by non-word characters; the
//      boundary characters are never included in the match. A word character
//      is a Unicode letter, digit, combining mark or underscore.
//   3. `hyphensJoinWords` (default false) makes hyphen-minus and the Unicode
//      hyphens word characters too. En and em dashes stay separators.
//   4. `searchDoc` never returns overlapping or out-of-range matches, and
//      returns them in document order (para, then startOffset).
//   5. `findMatches` is `searchDoc(buildRegex(query, opts))`.
//   6. Zero-length matches are impossible: a non-empty literal query always
//      matches at least one character.
//   7. The document is read as one text, its paragraphs joined by a line
//      break (`domain/joined.ts`): a query's break matches a
//      paragraph break, and its match runs from `para` to `endPara`. A query
//      without one never crosses a break. Nothing matches into, out of or
//      through a page break.

import type { Doc, Match } from "../domain/model";

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Hyphens join word parts; it matters only together with `wholeWord`. */
  hyphensJoinWords?: boolean;
}

export interface SearchProvider {
  buildRegex(query: string, opts: SearchOptions): RegExp | null;
  searchDoc(doc: Doc, regex: RegExp | null): Match[];
  findMatches(doc: Doc, query: string, opts: SearchOptions): Match[];
  findTextOccurrences(doc: Doc, text: string): Match[];
}
