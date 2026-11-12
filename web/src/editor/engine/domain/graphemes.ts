// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What one character is to the writer: a grapheme cluster, the unit Backspace
// and Delete remove. 👩‍💻 is five UTF-16 code units (two surrogate pairs and a
// joiner), 🇮🇹 is two regional indicators of two units each, and `é` can be
// `e` plus a combining accent; each is one character on screen.
//
// Offsets stay in UTF-16 code units everywhere in the engine and the DOM.
// These functions only answer where the next boundary lies, so a step never
// leaves half a cluster behind.
//
// Without `Intl.Segmenter` the boundaries fall back to code points: a
// surrogate pair is still never split, but a joined sequence is removed one
// code point at a time.

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** The boundary before `offset`, in code units; 0 at the start. */
export function graphemeBefore(text: string, offset: number): number {
  if (offset <= 0) return 0;
  const at = Math.min(offset, text.length);
  if (segmenter) return segmenter.segment(text).containing(at - 1)?.index ?? 0;
  const low = text.charCodeAt(at - 1);
  const high = text.charCodeAt(at - 2);
  const pair =
    at >= 2 &&
    low >= 0xdc00 &&
    low <= 0xdfff &&
    high >= 0xd800 &&
    high <= 0xdbff;
  return at - (pair ? 2 : 1);
}

/** The boundary after `offset`, in code units; `text.length` at the end. */
export function graphemeAfter(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  const at = Math.max(offset, 0);
  if (segmenter) {
    const cluster = segmenter.segment(text).containing(at);
    return cluster ? cluster.index + cluster.segment.length : text.length;
  }
  return at + ((text.codePointAt(at) ?? 0) > 0xffff ? 2 : 1);
}
