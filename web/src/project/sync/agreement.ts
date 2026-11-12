// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Whether a copy of a project agrees with itself: its structure, its snapshot
// catalogue and its files say the same thing.
//
// The files of a change travel one by one, so a remote another device is
// still uploading can hold a snapshot file whose record has not arrived, or a
// structure line whose file has not. Pulled as it is, such a remote leaves a
// device's copy that the open refuses. The check asks the remote the same
// question the open asks a folder, over the scan it already made.

import {
  DOCUMENT_DIR,
  RECYCLE_BIN_DIR,
  SNAPSHOTS_CATALOGUE_FILE,
  STRUCTURE_FILE,
  kindOf,
} from "../naming";
import { reconcileRecords } from "../properties";
import { readCatalogue } from "../snapshotCatalogue";
import { parseStructure, validateAgainstDisk } from "../structure";

/**
 * Whether `path` is one the agreement covers: the structure, the catalogue,
 * or a file in `document/` or `recyclebin/`.
 */
export function holdsTheBook(path: string): boolean {
  return (
    path === STRUCTURE_FILE ||
    path === SNAPSHOTS_CATALOGUE_FILE ||
    path.startsWith(`${DOCUMENT_DIR}/`) ||
    path.startsWith(`${RECYCLE_BIN_DIR}/`)
  );
}

/**
 * Whether a copy whose structure and catalogue read as `structure` and
 * `catalogue`, and which holds the files at `paths`, would open: the live
 * tree and `document/` name the same files, and every binned record has its
 * file in `recyclebin/`.
 */
export function projectAgrees(
  structure: string | null,
  catalogue: string | null,
  paths: Iterable<string>,
): boolean {
  const parsed = parseStructure(structure);
  if (!parsed.ok) return false;
  const records = readCatalogue(catalogue);
  if (!records.ok) return false;
  const reconciled = reconcileRecords(
    parsed.structure,
    records.catalogue.snapshots,
    {},
  );
  if (!reconciled.ok) return false;
  const held = new Set(paths);
  const prefix = `${DOCUMENT_DIR}/`;
  const inDocument = [...held]
    .filter((path) => path.startsWith(prefix))
    .map((path) => path.slice(prefix.length))
    .filter((name) => !name.includes("/") && kindOf(name) !== null);
  if (validateAgainstDisk(reconciled.structure, inDocument).length > 0)
    return false;
  return Object.values(records.catalogue.binned)
    .flat()
    .every((snap) => held.has(`${RECYCLE_BIN_DIR}/${snap.file}`));
}
