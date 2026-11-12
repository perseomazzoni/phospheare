// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ProjectRef, StorageProvider } from "../storage";
import { PROPERTIES_FILE } from "./naming";
import {
  newProjectId,
  parseProperties,
  serializeProperties,
} from "./properties";
import { followTitle } from "./retitle";
import { copyProject, type CopyOptions, type CopyResult } from "./transfer";

// Duplicating a project: `copyProject`'s walk, pointed at a destination on
// the same backend. The copy's `document-properties.json` is written already
// carrying the copy's own identity, so the new folder never holds the
// original's, not even halfway through. After the copy the folder follows the
// title where the backend can rename one; on the device the caller already
// made the folder under the title's name.
//
// `document.id` is new: the uuid is the project's identity everywhere (the
// URL, the shelf row, every store keyed on a book), and a copy that kept it,
// finished or not, would be a second book at the first one's address.
// `copyProject` does not mint one: a move, a re-pairing and a conflict
// resolution are the same book changing homes.
//
// `sync` is cleared, because a duplicate starts Local-only. A stale hint would
// surface when this device's pairing record is lost: the recovery path in
// `sync/pairing.ts` re-pairs on `sync.remote`, pointing the duplicate at the
// original's Remote Storage folder.
//
// A cancelled duplicate removes what it wrote. The destination is a fresh
// folder, so removing it touches nothing of the writer's.

interface Side {
  provider: StorageProvider;
  ref: ProjectRef;
}

/**
 * Copy a project into a folder that has already been made, and name it.
 *
 * The caller creates the destination, empty: on this device that takes a
 * folder picker, which the browser opens only inside a user gesture, never
 * behind an await in here.
 */
export async function duplicateProject(
  from: Side,
  to: Side,
  title: string,
  options: CopyOptions = {},
): Promise<CopyResult> {
  const id = newProjectId();
  const files: string[] = [];
  const dirs: string[] = [];
  let named = false;

  // The destination as the copy sees it: every write is recorded for a
  // cancel to remove, and the properties file is rewritten on its way in.
  const target: StorageProvider = Object.create(to.provider);
  target.createDir = async (ref, path) => {
    await to.provider.createDir(ref, path);
    dirs.push(path);
  };
  target.writeFile = async (ref, path, content) => {
    let text = content;
    if (path === PROPERTIES_FILE) {
      const props = parseProperties(content, title);
      text = serializeProperties({
        ...props,
        document: { ...props.document, id, title },
        sync: null,
      });
      named = true;
    }
    await to.provider.writeFile(ref, path, text);
    files.push(path);
  };

  const result = await copyProject(
    from,
    { provider: target, ref: to.ref },
    options,
  );
  if (result.cancelled) {
    await removeWritten(to, files, dirs);
    return result;
  }
  // A source without a properties file is not a project, and its copy would
  // be a folder with no identity.
  if (!named) throw new Error("duplicate-source-without-properties");

  await followTitle(to.provider, to.ref, title);
  return result;
}

/**
 * Removes what a cancelled copy wrote: the files, then the folders deepest
 * first, because a folder is removed only once it is empty. Best-effort: a
 * file left behind is a copy under the new identity, never the original's.
 */
async function removeWritten(
  to: Side,
  files: readonly string[],
  dirs: readonly string[],
): Promise<void> {
  for (const path of [...files, ...[...dirs].reverse()]) {
    await to.provider.removeFile(to.ref, path).catch(() => {});
  }
}
