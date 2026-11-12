// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { MatterKind } from "../domain/source";
import { tidyText } from "../domain/text";
import type { TitleWords } from "../ports";

// Titles are free: two chapters may share one, and any punctuation
// is allowed, so the import never invents a suffix to make a title unique; a
// chapter called "Anna" twice is called "Anna" twice. What it does:
//
//   1. takes the title from the source, a bare marker's subtitle when it has
//      one ("CHAPTER ONE" over "The Beginning" → "The Beginning");
//   2. tidies it: whitespace collapsed, invisible characters out, cut at 120
//      characters on a word. Its letters stay as the writer typed them: a
//      title set in capitals is "TIMO" in the tree too, because the case is
//      the writer's choice and the import cannot tell a styled heading from a
//      name meant to shout, so nothing is title-cased;
//   3. when there is none, names matter by its kind ("Dedication") and
//      anything else "Untitled", in the book's language. Never a number:
//      "Chapter 1" made up for a page before the book's own Chapter 1 reads
//      as the book's numbering, and is wrong.

export const MAX_TITLE = 120;

/** A title as the app keeps it; empty when nothing of it survives. */
export function tidyTitle(raw: string): string {
  let title = tidyText(raw).trim();
  // Measured in UTF-16 units, as the project's `titleProblem` measures, so a
  // title of emoji is never cut to a length the project then refuses;
  // the cut walks whole characters, so no pair is split.
  if (title.length > MAX_TITLE) {
    let chars = "";
    for (const char of title) {
      if (chars.length + char.length > MAX_TITLE - 1) break;
      chars += char;
    }
    const cut = chars.lastIndexOf(" ");
    title = `${(cut > MAX_TITLE / 2 ? chars.slice(0, cut) : chars).trimEnd()}…`;
  }
  return title;
}

/**
 * An entry's title: the source's, tidied; for untitled matter its usual
 * name ("Dedication"); for anything else "Untitled", as book formatters
 * name it; the writer names it in the editor.
 */
export function titleFor(
  entry: { title: string; matter: MatterKind | null },
  words: TitleWords,
): string {
  const tidy = tidyTitle(entry.title);
  if (tidy) return tidy;
  if (entry.matter) return words.matter(entry.matter);
  return words.untitled;
}
