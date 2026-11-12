// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Opens a book for export outside the editor. An export starts from a Library
// card, where no editor holds the book, so the window opens it itself
// with the same steps the editor's open pipeline takes and nothing more, since
// the export only reads:
//
//   1. the destination, and the working copy when the book has a remote;
//   2. the provider the editor would hold over it, both from
//      `openProjectStorage`, shared with the Library's Properties window. A
//      queue not yet drained to Remote Storage still exports what the writer last
//      wrote, as the editor would show it;
//   3. the properties (`readCheckedProperties`, the one "is this a book"
//      check every window outside the editor makes) and the structure,
//      checked the way the editor checks them, with the records reconciled
//      onto the nodes; `reconcileRecords` sets `node.adopted`, the file each
//      node's text is read from.
//
// A book the editor would refuse to open is refused here too, and the window
// says it could not open it; the export does not invent a lenient second
// reading of a broken folder. The working copy holds a subscription, so the
// caller disposes it when the window closes, and any refusal disposes it here.

import {
  SNAPSHOTS_CATALOGUE_FILE,
  STRUCTURE_FILE,
} from "../../../project/naming";
import { reconcileRecords } from "../../../project/properties";
import { readCheckedProperties } from "../../../project/editFacts";
import { readCatalogue } from "../../../project/snapshotCatalogue";
import { parseStructure } from "../../../project/structure";
import { openProjectStorage } from "../../../project/projectStorage";
import type {
  DocumentProperties,
  DocumentStructure,
} from "../../../project/types";
import type { ProjectRef, StorageProvider } from "../../../storage/types";

/** The one reason an export window gives for a book it could not open. */
export const EXPORT_UNOPENABLE = "export-unopenable";

export interface ExportBook {
  /** The provider the editor would hold, over the working copy if any. */
  storage: StorageProvider;
  structure: DocumentStructure;
  properties: DocumentProperties;
  /** Lets go of the working copy. Idempotent. */
  dispose: () => void;
}

export async function openExportBook(
  ref: ProjectRef,
  projectId: string,
): Promise<ExportBook> {
  const opened = await openProjectStorage(ref, projectId);
  if (!opened) throw new Error(EXPORT_UNOPENABLE);
  const { storage, dispose } = opened;
  try {
    // Any refusal, unreadable or not a book, is the one reason the window
    // gives.
    const properties = await readCheckedProperties(storage, ref).catch(() => {
      throw new Error(EXPORT_UNOPENABLE);
    });

    const parsed = parseStructure(
      await readOrNull(storage, ref, STRUCTURE_FILE),
    );
    if (!parsed.ok) throw new Error(EXPORT_UNOPENABLE);
    const catalogue = readCatalogue(
      await readOrNull(storage, ref, SNAPSHOTS_CATALOGUE_FILE),
    );
    if (!catalogue.ok) throw new Error(EXPORT_UNOPENABLE);
    const reconciled = reconcileRecords(
      parsed.structure,
      catalogue.catalogue.snapshots,
      properties.summaries,
    );
    if (!reconciled.ok) throw new Error(EXPORT_UNOPENABLE);

    return {
      storage,
      structure: reconciled.structure,
      properties,
      dispose,
    };
  } catch (reason) {
    dispose();
    throw reason;
  }
}

/** A missing file is `null`, as the editor's pipeline reads it. */
async function readOrNull(
  provider: StorageProvider,
  ref: ProjectRef,
  path: string,
): Promise<string | null> {
  try {
    return await provider.readFile(ref, path);
  } catch {
    return null;
  }
}
