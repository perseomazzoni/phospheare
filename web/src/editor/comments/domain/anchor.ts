// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { ANCHOR_CONTEXT } from "./limits";
import type { CommentAnchor } from "./model";

// Finding a comment's passage again. The editor keeps no coordinate mapping
// through edits: an anchor is text and the text around it, like every
// evidence anchor the assistant stores. So a comment is found again from its
// words, every time its chapter is read, cheapest step first:
//
//   1. the quote itself, once: it is there;
//   2. the quote several times: the occurrence whose surroundings agree best
//      with the stored prefix and suffix;
//   3. the quote gone, its surroundings still there: the writer edited
//      inside the passage, and what now stands between the two is the
//      passage;
//   4. nothing good enough: an orphan, shown with its original quote and
//      never deleted.
//
// The text is the chapter's visible text, one string per paragraph (what the
// writer sees, never markdown), read as the paragraphs joined by "\n". A
// passage may run across paragraphs (a comment on an exchange of dialogue, on
// a scene's last lines), and its quote then holds the "\n" between them, as
// the joined text does. The text either side is read over the same
// join, so a passage that opens a paragraph has the end of the one before as
// its prefix.

/**
 * A passage: where it starts (a paragraph and an offset in it) and where it
 * ends, in the same paragraph or a later one. `end` is an offset in
 * `endPara`, exclusive.
 */
export interface Placement {
  para: number;
  start: number;
  endPara: number;
  end: number;
}

/** A passage inside one paragraph. */
export function within(para: number, start: number, end: number): Placement {
  return { para, start, endPara: para, end };
}

/**
 * The anchor for a passage of the given paragraphs. Whitespace at either
 * edge, a paragraph break included, is left out: a double-click takes the
 * word and the space after it, a drag to the next line's start takes the
 * break, and a comment about the words marks the words. A passage of nothing
 * but whitespace has no anchor: an empty quote could never be found again,
 * and the file holding it would read as damaged.
 */
export function anchorFrom(
  paragraphs: readonly string[],
  placement: Placement,
): CommentAnchor | null {
  const joined = paragraphs.join("\n");
  let from = paragraphStart(paragraphs, placement.para) + placement.start;
  let to = paragraphStart(paragraphs, placement.endPara) + placement.end;
  while (from < to && /\s/.test(joined[from])) from++;
  while (to > from && /\s/.test(joined[to - 1])) to--;
  if (from >= to) return null;
  return {
    quote: joined.slice(from, to),
    prefix: joined.slice(Math.max(0, from - ANCHOR_CONTEXT), from),
    suffix: joined.slice(to, to + ANCHOR_CONTEXT),
  };
}

/** Where the anchored passage is now, or null for an orphan. */
export function place(
  anchor: CommentAnchor,
  paragraphs: readonly string[],
): Placement | null {
  if (!anchor.quote) return null;
  const joined = paragraphs.join("\n");
  const exact = occurrencesIn(joined, anchor.quote);
  if (exact.length === 1) return toPlacement(paragraphs, exact[0], anchor);
  if (exact.length > 1) {
    let best = exact[0];
    let bestScore = -1;
    for (const at of exact) {
      const score =
        sharedTail(joined.slice(0, at), anchor.prefix) +
        sharedHead(joined.slice(at + anchor.quote.length), anchor.suffix);
      if (score > bestScore) {
        best = at;
        bestScore = score;
      }
    }
    return toPlacement(paragraphs, best, anchor);
  }
  return between(joined, paragraphs, anchor);
}

/** The anchor refreshed to where it was found, or the same one if unchanged. */
export function refreshed(
  anchor: CommentAnchor,
  paragraphs: readonly string[],
  placement: Placement,
): CommentAnchor {
  const next = anchorFrom(paragraphs, placement);
  // A place found is never only whitespace (every step matches words), but
  // if one were, the anchor that found it is the better one to keep.
  return !next ||
    (next.quote === anchor.quote &&
      next.prefix === anchor.prefix &&
      next.suffix === anchor.suffix)
    ? anchor
    : next;
}

/**
 * The anchor for a passage quoted from somewhere else (an imported editor's
 * comment, a persona's quote) as these paragraphs hold it, kept whole across
 * the paragraphs it spans. Found, the anchor is built again from the text as
 * it is here. Not found, it is kept as quoted: an orphan that still shows the
 * words it was about, never a comment quietly dropped. Null when nothing
 * visible is quoted.
 */
export function anchorForQuote(
  paragraphs: readonly string[],
  quoted: CommentAnchor,
): CommentAnchor | null {
  const quote = quoted.quote.trim();
  if (!quote) return null;
  const lead = quoted.quote.slice(
    0,
    quoted.quote.length - quoted.quote.trimStart().length,
  );
  const trail = quoted.quote.slice(quoted.quote.trimEnd().length);
  const candidate: CommentAnchor = {
    quote,
    prefix: (quoted.prefix + lead).slice(-ANCHOR_CONTEXT),
    suffix: (trail + quoted.suffix).slice(0, ANCHOR_CONTEXT),
  };
  const at = place(candidate, paragraphs);
  return (at && anchorFrom(paragraphs, at)) ?? candidate;
}

/**
 * The third way of finding a passage: the words either side of it, still
 * close together, with what lies between them taken as the passage after the
 * writer's edit. Only the context's nearest characters are asked for, because
 * an edit just outside the passage eats into the context too. The passage
 * found must not have grown or shrunk past recognition, because the same
 * context around a paragraph rewritten whole is not the same passage. It
 * crosses a paragraph break only if the passage did: a passage inside one
 * paragraph never grows into the next.
 */
const CONTEXT_PROBE = 12;

function between(
  joined: string,
  paragraphs: readonly string[],
  anchor: CommentAnchor,
): Placement | null {
  const before = anchor.prefix.slice(-CONTEXT_PROBE);
  const after = anchor.suffix.slice(0, CONTEXT_PROBE);
  if (before.trim().length < 4 || after.trim().length < 4) return null;
  const length = anchor.quote.length;
  const spans = anchor.quote.includes("\n");
  for (const at of occurrencesIn(joined, before)) {
    const from = at + before.length;
    const window = joined.slice(from, from + length * 3 + CONTEXT_PROBE);
    const end = window.indexOf(after);
    if (end <= 0) continue;
    const middle = window.slice(0, end);
    if (!spans && middle.includes("\n")) continue;
    if (middle.trim().length === 0) continue;
    const ratio = middle.length / length;
    if (ratio < 0.34 || ratio > 3) continue;
    return toPlacementRange(paragraphs, from, from + middle.length);
  }
  return null;
}

function paragraphStart(paragraphs: readonly string[], para: number): number {
  let offset = 0;
  for (let i = 0; i < para; i++) offset += paragraphs[i].length + 1;
  return offset;
}

function toPlacement(
  paragraphs: readonly string[],
  at: number,
  anchor: CommentAnchor,
): Placement {
  return toPlacementRange(paragraphs, at, at + anchor.quote.length);
}

/** A paragraph and an offset for a position in the joined text. */
function pointAt(
  paragraphs: readonly string[],
  offset: number,
): { para: number; offset: number } {
  let base = 0;
  for (let para = 0; para < paragraphs.length; para++) {
    const end = base + paragraphs[para].length;
    if (offset <= end) return { para, offset: offset - base };
    base = end + 1;
  }
  const last = Math.max(0, paragraphs.length - 1);
  return { para: last, offset: paragraphs[last]?.length ?? 0 };
}

function toPlacementRange(
  paragraphs: readonly string[],
  from: number,
  to: number,
): Placement {
  const start = pointAt(paragraphs, from);
  const end = pointAt(paragraphs, to);
  return {
    para: start.para,
    start: start.offset,
    endPara: end.para,
    end: end.offset,
  };
}

function occurrencesIn(text: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let at = text.indexOf(needle);
  while (at !== -1) {
    out.push(at);
    at = text.indexOf(needle, at + 1);
  }
  return out;
}

/** How many characters `text` ends with of `want`'s end. */
function sharedTail(text: string, want: string): number {
  let n = 0;
  while (
    n < want.length &&
    n < text.length &&
    text[text.length - 1 - n] === want[want.length - 1 - n]
  )
    n += 1;
  return n;
}

/** How many characters `text` begins with of `want`'s start. */
function sharedHead(text: string, want: string): number {
  let n = 0;
  while (n < want.length && n < text.length && text[n] === want[n]) n += 1;
  return n;
}
