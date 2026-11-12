// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { ownerOf, type CommentsFile } from "./model";

// What a chapter's row counts. The structure panel shows, per chapter, one
// coloured circle per persona with the number of threads that persona opened,
// and one transparent circle with the number everyone else opened: the writer
// and imported editors. A thread counts for whoever opened it: one the writer
// opened and tagged a persona in is the writer's. Waiting ghost comments and
// kept ones both count; a resolved thread never does.

export interface CommentCounts {
  /** Persona id → open and proposed threads it owns, in first-seen order. */
  personas: Record<string, number>;
  /** Open threads the writer or an editor owns. */
  others: number;
}

export function countsOf(file: CommentsFile): CommentCounts {
  const personas: Record<string, number> = {};
  let others = 0;
  for (const thread of file.threads) {
    if (thread.state === "resolved") continue;
    const owner = ownerOf(thread);
    if (owner.kind === "persona")
      personas[owner.id] = (personas[owner.id] ?? 0) + 1;
    else others += 1;
  }
  return { personas, others };
}

/** Whether there is anything to show at all. */
export function anyCounted(counts: CommentCounts): boolean {
  return counts.others > 0 || Object.keys(counts.personas).length > 0;
}
