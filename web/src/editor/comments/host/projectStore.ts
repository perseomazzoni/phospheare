// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { commentsFilePath } from "../../../project/naming";
import type { ProjectRef, StorageProvider } from "../../../storage/types";
import type { CommentStore, StoredComments } from "../application/comments";

// The comments files, read and written through the project's own provider,
// the one the editor writes prose with. A book in Remote Storage writes its
// comments into the working copy and the queue like every other file, and a
// book in Local Storage writes them straight to the folder. `writeFile` makes
// the `comments/` folder the first time one is written, on both kinds, so
// nothing is scaffolded.

export function projectCommentStore(
  provider: StorageProvider,
  ref: ProjectRef,
): CommentStore {
  return {
    async read(nodeId): Promise<StoredComments> {
      const path = commentsFilePath(nodeId);
      if (!(await provider.exists(ref, path))) return { kind: "missing" };
      return { kind: "text", text: await provider.readFile(ref, path) };
    },
    async write(nodeId, text) {
      await provider.writeFile(ref, commentsFilePath(nodeId), text);
    },
  };
}
