// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Replacing find matches, written against the search provider's `Match`
// spans. This module never searches, and the search provider never edits.

import type { Doc, Paragraph, Format, Cursor, Match } from "../model";
import { runsToChars, charsToRuns, type Char } from "./editing";

// Replace a match's span, inside one paragraph or from one paragraph into a
// later one, which merges them. The replacement characters take the
// covered characters' formats position by position, so a bold stretch stays
// bold where it was, and a longer replacement continues in the last covered
// format. With `plain`, every format is cleared. `\n` in the replacement
// splits the paragraph, so the result is a list of paragraphs.
//
// The paragraphs that result stand for the ones the match covered, in order:
// the first takes the first's alignment and block type, the second the
// second's, and so on, with any past the last taking the last's.
function replaceSpan(
  doc: Doc,
  match: Match,
  text: string,
  plain: boolean,
): Paragraph[] {
  const { para, startOffset, endPara, endOffset } = match;
  const covered: Char[] = [];
  for (let p = para; p <= endPara; p++) {
    const chars = runsToChars(doc[p].runs);
    covered.push(
      ...chars.slice(
        p === para ? startOffset : 0,
        p === endPara ? endOffset : chars.length,
      ),
    );
  }
  const plainFormat: Format = { bold: false, italic: false, monospace: false };
  const replacementChars = text.split("").map((char, i) => ({
    char,
    format: plain
      ? { ...plainFormat }
      : i < covered.length
        ? { ...covered[i].format }
        : covered.length > 0
          ? { ...covered[covered.length - 1].format }
          : { ...plainFormat },
  }));
  const newChars = [
    ...runsToChars(doc[para].runs).slice(0, startOffset),
    ...replacementChars,
    ...runsToChars(doc[endPara].runs).slice(endOffset),
  ];

  const segments: Char[][] = [];
  let segment: Char[] = [];
  for (const c of newChars) {
    if (c.char === "\n") {
      segments.push(segment);
      segment = [];
    } else {
      segment.push(c);
    }
  }
  segments.push(segment);

  return segments.map((runs, i) => ({
    ...doc[Math.min(para + i, endPara)],
    runs: charsToRuns(runs),
  }));
}

export type ReplaceResult = { doc: Doc; cursor: Cursor };

// Replace every match with `replacement`. Matches come from `searchDoc` and
// are computed against `doc`, so they never overlap. They are applied last to
// first in document order, so a replacement, however many paragraphs it
// merges or splits, only moves text after every match still to come.
// The cursor lands right after the replacement text of the leftmost match.
export function replaceMatches(
  doc: Doc,
  matches: Match[],
  replacement: string,
  plain: boolean,
): ReplaceResult {
  if (matches.length === 0) return { doc, cursor: { para: 0, offset: 0 } };

  const ordered = [...matches].sort(
    (a, b) => a.para - b.para || a.startOffset - b.startOffset,
  );
  let result = doc;
  for (const m of [...ordered].reverse()) {
    result = [
      ...result.slice(0, m.para),
      ...replaceSpan(result, m, replacement, plain),
      ...result.slice(m.endPara + 1),
    ];
  }

  // Nothing before the leftmost match moved, so its place is where it was.
  const leftmost = ordered[0];
  const segments = replacement.split("\n");
  const cursor: Cursor =
    segments.length === 1
      ? {
          para: leftmost.para,
          offset: leftmost.startOffset + segments[0].length,
        }
      : {
          para: leftmost.para + segments.length - 1,
          offset: segments[segments.length - 1].length,
        };

  return { doc: result, cursor };
}
