// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { stemOf } from "../domain/formats";
import type { SourceMeta } from "../domain/source";
import type { ProjectRules } from "../ports";
import { tidyTitle } from "./titles";

// The new project's facts, which the creation wizard's questions open with,
// every one the writer's to change: the title the source gives (its metadata,
// its title line, or the file's name made readable), the author it names, the
// type its length says by the creation dialog's own ranges, and a goal no
// smaller than the book already is, because a writer importing ninety
// thousand words is not aiming at eighty.

export interface ProjectFacts {
  title: string;
  author: string;
  type: string;
  goal: number;
}

/** "the_long_night v2" → "the long night v2": a file name a person can read. */
export function readableName(fileName: string): string {
  return stemOf(fileName).replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

export function deriveFacts(
  meta: SourceMeta,
  bookTitle: string | undefined,
  firstFile: string,
  words: number,
  rules: ProjectRules,
): ProjectFacts {
  const title =
    tidyTitle(meta.title ?? "") ||
    tidyTitle(bookTitle ?? "") ||
    tidyTitle(readableName(firstFile));
  const type = rules.typeForWords(words);
  return {
    title,
    author: meta.author?.trim() ?? "",
    type,
    goal: goalFor(type, words, rules),
  };
}

/**
 * The goal to propose for a type: its range's top, or the book's length
 * rounded up to the next thousand when that is more. It is asked again for
 * every type the writer picks, so changing the type never proposes a goal
 * the manuscript has already passed.
 */
export function goalFor(type: string, words: number, rules: ProjectRules) {
  const roundedUp = Math.ceil(Math.max(words, 1) / 1000) * 1000;
  return Math.max(rules.typeGoal(type) ?? 0, roundedUp);
}
