// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ProjectRef, StorageProvider } from "../storage";
import { folderNameFor } from "./naming";

// A folder following its book's title.
//
// Every backend can change `document.title` with an ordinary file write; the
// folder can be renamed only where the backend allows. The File System Access
// API's `move()` renames directories only inside the origin-private file
// system, so a folder on the writer's own disk cannot be renamed.
//
// Faking a local rename (a new folder, every file moved in, the old one
// removed recursively) is refused: the removal is permanent, never into the
// system's bin, and on Windows a file held open by another program can stop
// it halfway, splitting the book across two folders.
//
// The folder follows after the title is written: a book whose folder kept its
// old name still opens, while the reverse is a folder nobody asked for. A
// card's title may differ from its folder's name, and the card shows the
// title.

/**
 * Let the folder follow a title already written, where the backend can, and
 * hand back the ref that now describes the book.
 *
 * Decided by the port's capability, never by a provider id: a provider
 * without `renameFolder` (only Drive has it) leaves the folder as it is. A
 * folder already carrying the title's name is left alone, as is one whose
 * title makes no folder name at all ("???"), so an unusable name never
 * reaches a remote folder whatever a caller let through.
 */
export async function followTitle(
  provider: StorageProvider,
  ref: ProjectRef,
  title: string,
): Promise<ProjectRef> {
  if (!provider.renameFolder) return ref;
  const wanted = folderNameFor(title);
  if (!wanted || wanted === ref.name) return ref;
  const folder = await provider.renameFolder(ref, wanted);
  return { ...ref, name: folder };
}
