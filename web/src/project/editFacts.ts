// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ProjectRef, StorageProvider } from "../storage/types";
import { factsOf, withFacts, type ProjectFacts } from "./facts";
import { PROPERTIES_FILE } from "./naming";
import {
  parseProperties,
  serializeProperties,
  validateProperties,
} from "./properties";
import { followTitle } from "./retitle";
import type { DocumentProperties } from "./types";

// Reading and changing a book's facts, over the storage `openProjectStorage`
// hands back, so a write to a book with a remote lands in its working copy
// and is queued like any edit made in the editor.
//
// Every write is one read-modify-write of the properties file, read fresh at
// the moment of saving, so the rest of the file (the stats, the panel widths,
// the snapshot records) is kept as it is now, not as it was when the window
// opened.

/** A folder whose properties file is missing or unreadable is not a book. */
export const FACTS_UNREADABLE = "facts-unreadable";

/**
 * The properties file, judged as the editor's open pipeline judges it.
 *
 * Throws `FACTS_UNREADABLE` when `validateProperties` refuses the file, and
 * passes a failed read on as it failed, so a lapsed permission or a vanished
 * folder says so in its own words. Every reader outside the editor uses it,
 * so "is this a book" has one answer whichever window asks.
 */
export async function readCheckedProperties(
  storage: StorageProvider,
  ref: ProjectRef,
): Promise<DocumentProperties> {
  const raw = await storage.readFile(ref, PROPERTIES_FILE);
  if (validateProperties(raw).length > 0) throw new Error(FACTS_UNREADABLE);
  return parseProperties(raw, ref.name);
}

/** What the book says about itself today. */
export async function readProjectFacts(
  storage: StorageProvider,
  ref: ProjectRef,
): Promise<ProjectFacts> {
  return factsOf(await readCheckedProperties(storage, ref));
}

/**
 * Write the facts, and hand back the ref that now describes the book.
 *
 * The file goes first, then the folder, as in `retitle.ts`: a book whose
 * title changed and whose folder did not still opens. The folder is renamed
 * through `backend`, the bare provider, because a folder is not a file the
 * working copy holds; only a backend offering `renameFolder` can rename one
 * (Remote Storage, never the device).
 *
 * A title change is measured against `wasTitle`, the title the writer saw
 * when asking (the window's opening facts, or for an Undo the save it undoes),
 * never against the fresh read. A save whose file landed and whose rename
 * failed leaves the new title in the file, so measured against the file a
 * second Save would rename nothing under a window that promised "Folder
 * becomes …". It is trimmed, as `withFacts` stores it, so spaces
 * around a hand-edited title are not a change.
 */
export async function saveProjectFacts(
  storage: StorageProvider,
  backend: StorageProvider,
  ref: ProjectRef,
  facts: ProjectFacts,
  wasTitle: string,
): Promise<ProjectRef> {
  const before = await readCheckedProperties(storage, ref);
  const after = withFacts(before, facts);
  await storage.writeFile(ref, PROPERTIES_FILE, serializeProperties(after));
  if (after.document.title === wasTitle.trim()) return ref;
  return followTitle(backend, ref, after.document.title);
}
