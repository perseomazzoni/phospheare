// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The sentence splitter, the diff's middle grain: a paragraph at its sentence
// boundaries. A sentence token is a maximal run of non-terminal characters
// plus the run of terminal punctuation that ends it (`.`, `!`, `?`, `…` and
// their runs, so "?!", "..." and "…" each end one sentence). The terminal
// mark stays in the token: in prose it is sentence content, and as a
// separator it would vanish from the merged doc and from the accept's
// compared slice.
//
// The splitter is conservative, not a natural-language parser: "Mr." splits
// after the abbreviation, "e.g." after each period. It needs only to be
// monotone and in bounds: it derives tokens only from match offsets, so every
// token lies inside the text.

import type { WordToken } from "../../domain/words";

export function splitSentences(text: string): WordToken[] {
  // Leading whitespace is a separator, not sentence content: the merge walk
  // picks it up as the gap between sentences, as it does between words.
  const re = /[^.!?…]+?[.!?…]+|[^.!?…]+/g;
  const tokens: WordToken[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    if (raw.length === 0) {
      re.lastIndex++;
      continue;
    }
    if (raw.trim().length === 0) continue;
    const lead = raw.length - raw.trimStart().length;
    tokens.push({
      text: raw.slice(lead),
      start: match.index + lead,
      end: match.index + raw.length,
    });
  }
  return tokens;
}
