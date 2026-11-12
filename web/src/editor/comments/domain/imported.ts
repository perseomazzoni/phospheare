// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { cleanBody } from "./codec";
import { NAME_MAX } from "./limits";
import { EMPTY_FILE, type CommentAnchor, type CommentsFile } from "./model";

// Comments that came in with a manuscript. An editor's comments in a .docx or
// an .odt are threads like any other once they are in the book: the same
// file, the same margin, the same states. What is particular to them is who
// wrote them (an editor, by the name the source gave, never the writer and
// never a persona), and that a thread the editor resolved arrives resolved.
// Their words are third-party text: kept plain and capped here like every
// body, and shown to a persona as evidence, never as instructions.

export interface EditorEntry {
  /** The name the source gave, or empty when it gave none. */
  name: string;
  at: string;
  body: string;
}

export interface EditorThread {
  anchor: CommentAnchor | null;
  resolved: boolean;
  /** The comment first, then its replies in the order they were written. */
  entries: EditorEntry[];
}

/** One chapter's comments file, from the threads an import found in it. */
export function editorsFile(
  threads: readonly EditorThread[],
  newId: () => string,
): CommentsFile {
  return {
    ...EMPTY_FILE,
    threads: threads
      .filter((thread) => thread.entries.length > 0)
      .map((thread) => ({
        id: newId(),
        state: thread.resolved ? "resolved" : "open",
        anchor: thread.anchor,
        entries: thread.entries.map((entry) => ({
          id: newId(),
          author: { kind: "editor", name: cleanBody(entry.name, NAME_MAX) },
          at: entry.at,
          body: cleanBody(entry.body),
        })),
      })),
  };
}
