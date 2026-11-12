// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Focus units: the visual line the caret is in, or the whole paragraph. No
// unit between them (sentence, clause) is offered, because its boundary moves
// under the caret while the writer types.
//
// Layout is asked through the injected `topOf`, so the module needs no DOM.

export interface TextUnit {
  start: number;
  end: number;
}

/**
 * The line-top of the character at index `k`, or null when it cannot be
 * measured (layout not ready). Non-decreasing in `k`, which makes both edges
 * of a line findable by binary search.
 */
export type TopOf = (k: number) => number | null;

/** The first index in `[lo, hi)` where `pred`, monotonic, turns true. */
function firstTrue(
  lo: number,
  hi: number,
  pred: (i: number) => boolean,
): number {
  let a = lo;
  let b = hi;
  while (a < b) {
    const mid = (a + b) >>> 1;
    if (pred(mid)) b = mid;
    else a = mid + 1;
  }
  return a;
}

/**
 * Trim trailing whitespace off `end`, or the lit region extends into the
 * margin at every wrap point.
 */
function trimTrailingWhitespace(
  text: string,
  start: number,
  end: number,
): number {
  let e = end;
  while (e > start && /\s/.test(text[e - 1])) e -= 1;
  return e;
}

/**
 * The visual line containing `caretIndex`, re-derived every paint and never
 * cached, because the boundary moves the moment a word wraps.
 */
export function lineAt(
  text: string,
  caretIndex: number,
  topOf: TopOf,
): TextUnit {
  const length = text.length;
  if (length === 0) return { start: 0, end: 0 };

  const ref = Math.min(Math.max(caretIndex, 0), length - 1);
  const refTop = topOf(ref);
  if (refTop === null) return { start: 0, end: length };

  const start = firstTrue(0, ref + 1, (i) => {
    const t = topOf(i);
    return t !== null && t >= refTop;
  });
  const afterRef = firstTrue(ref, length, (i) => {
    const t = topOf(i);
    return t !== null && t > refTop;
  });

  return { start, end: trimTrailingWhitespace(text, start, afterRef) };
}

/** The whole paragraph; no layout query is needed. */
export function paragraphAt(length: number): TextUnit {
  return { start: 0, end: length };
}
