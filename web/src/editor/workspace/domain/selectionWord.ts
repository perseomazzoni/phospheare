// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What a selection in the prose holds, for the surfaces that answer it: the
// repetition highlight and the clipboard verbs.

/**
 * The word a selection holds, for repetition highlighting: the core word when
 * the text is one word, possibly wrapped in punctuation or spaces, else null.
 */
export function extractWord(text: string): string | null {
  // Optional punctuation, one word with optional apostrophes, optional
  // punctuation.
  const match = text.match(
    /^\s*[.,;:!?'"()[\]{}\-–—…]*\s*(\w+(?:[''']\w+)*)\s*[.,;:!?'"()[\]{}\-–—…]*\s*$/,
  );
  return match ? match[1] : null;
}

interface Point {
  para: number;
  offset: number;
}

/** Whether the engine's selection covers any text, rather than a caret. */
export function coversText(selection: {
  anchor: Point;
  focus: Point;
}): boolean {
  return !(
    selection.anchor.para === selection.focus.para &&
    selection.anchor.offset === selection.focus.offset
  );
}
