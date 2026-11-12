// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { matchBareNumber, matchHeading } from "../domain/patterns";
import type { RuleId } from "../domain/plan";
import type { PreparedBook } from "./prepare";
import type { Boundary } from "./rules";

// Which reading of the file fits best. Every rule that found something is
// scored, and "auto" takes the best. A score is evidence × fit:
//
//   - evidence: how much a rule's boundaries mean when it finds them: a
//     heading style is the writer's choice, a page break may be layout;
//   - fit: chapters a novel actually has. Tiny chapters (a stray bold line
//     read as a title) and one giant chapter (a rule that barely fired) both
//     cost; regular lengths and numbers that count up (1, 2, 3…) earn.
//
// A short text with no real chapters ranks "none" first: a story is one
// Section, and splitting it at every bold line is the importer's mistake.

const EVIDENCE: Record<RuleId, number> = {
  headings: 1,
  separator: 1,
  patterns: 0.95,
  files: 0.9,
  typography: 0.7,
  pageBreaks: 0.6,
  none: 0.05,
};

/**
 * Words per chapter, each running to the next boundary of any kind. A Part's
 * own entry is often just its heading and is no chapter at all, so Parts and
 * matter are left out of the measure.
 */
function lengths(
  book: PreparedBook,
  boundaries: readonly Boundary[],
): number[] {
  const starts = boundaries.map((b) => b.index);
  const out: number[] = [];
  // Text before the first boundary becomes an entry of its own.
  let before = 0;
  for (let n = 0; n < (starts[0] ?? 0); n++) before += book.blocks[n].words;
  if (before > 0) out.push(before);
  for (let i = 0; i < starts.length; i++) {
    if (boundaries[i].level === "part" || boundaries[i].matter) continue;
    const end = i + 1 < starts.length ? starts[i + 1] : book.blocks.length;
    let words = 0;
    for (let n = starts[i]; n < end; n++) words += book.blocks[n].words;
    out.push(words);
  }
  return out;
}

/** The share of titles whose numbers count up by one. */
function counting(book: PreparedBook, boundaries: readonly Boundary[]): number {
  const numbers = boundaries
    .map((b) => {
      const text = book.blocks[b.index]?.text ?? "";
      return matchHeading(text)?.number ?? matchBareNumber(text);
    })
    .filter((n): n is number => n !== null);
  if (numbers.length < 3) return 0;
  let steps = 0;
  for (let i = 1; i < numbers.length; i++)
    if (numbers[i] === numbers[i - 1] + 1 || numbers[i] === 1) steps += 1;
  return steps / (numbers.length - 1);
}

export function score(
  rule: RuleId,
  book: PreparedBook,
  boundaries: readonly Boundary[],
): number {
  // One chapter is a modest claim, stronger the shorter the text: it wins
  // only where every real rule's fit is weak.
  if (rule === "none") return book.words < 3000 ? 0.25 : EVIDENCE.none;
  if (!boundaries.length) return 0;
  const sizes = lengths(book, boundaries);
  if (!sizes.length) return 0;
  const chapters = sizes;
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  const mean = total / sizes.length;
  // Tiny against the book's own scale: a hundred words is a stray line in a
  // novel and a whole chapter in a short piece.
  const tiny = Math.min(100, mean * 0.1);
  const tinyShare = sizes.filter((w) => w < tiny).length / sizes.length;
  const sd = Math.sqrt(
    sizes.reduce((s, w) => s + (w - mean) ** 2, 0) / sizes.length,
  );
  const regularity = 1 / (1 + sd / (mean || 1) / 2);
  const giant = Math.max(...sizes) / total;
  let fit = (1 - tinyShare) * regularity;
  if (chapters.length <= 1) fit *= 0.3;
  else if (giant > 0.6) fit *= 0.5;
  if (counting(book, boundaries) >= 0.7) fit *= 1.2;
  // A short text split by its look is usually a misreading: a story with two
  // bold lines is still one story. A heading style or a "Chapter 2" line is
  // the writer's own mark, and is trusted at any length.
  if (rule === "typography" || rule === "pageBreaks") {
    if (book.words < 1500) fit *= 0.25;
    else if (book.words < 3000) fit *= 0.6;
  }
  return EVIDENCE[rule] * fit;
}
