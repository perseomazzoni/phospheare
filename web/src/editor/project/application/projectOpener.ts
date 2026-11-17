// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The open's validation pipeline: from a project's folder to a verdict, the
// project loaded or refused with its reasons. Eleven checks, in order:
//
//   1-2    is this a project at all: the properties file
//   3-9    does the yaml describe a legal document
//   10-11  does the folder hold exactly what the yaml and the records name
//
// Between checks 2 and 3, the snapshot catalogue must be there, in the format
// this version reads.
//
// The editor never writes into a folder it refuses: a refused project stays
// as the writer left it.

import {
  parseProperties,
  reconcileRecords,
  validateProperties,
} from "../../../project/properties";
import { readCatalogue, withHashes } from "../../../project/snapshotCatalogue";
import { hashOf } from "../../../text/hash";
import {
  parseStructure,
  validateAgainstDisk,
  walk,
} from "../../../project/structure";
import type {
  DocNode,
  DocumentProperties,
  DocumentStructure,
  SnapshotCatalogue,
  StructureError,
} from "../../../project/types";
import type { ProjectId, ProjectReader } from "./stores";
import { appLog, describeError } from "../../../log";

export type OpenVerdict =
  | { readonly ok: false; readonly errors: StructureError[] }
  | {
      readonly ok: true;
      readonly structure: DocumentStructure;
      readonly properties: DocumentProperties;
      readonly catalogue: SnapshotCatalogue;
    };

/** Whether `document/` holds Parts or Sections a scaffold would orphan. */
async function holdsDocumentFiles<P extends ProjectId>(
  reader: ProjectReader<P>,
  project: P,
): Promise<boolean> {
  try {
    return (await reader.documentFiles(project)).length > 0;
  } catch {
    // No `document/` folder at all is the empty case.
    return false;
  }
}

/**
 * Reads `project` and gives the verdict. `title` names the document when its
 * properties carry no title. `wanted` is asked after each read: once it
 * answers false, a newer open has started, and this one reads no more and
 * answers `null`. A read that fails in a way no check covers throws.
 */
export async function readProject<P extends ProjectId>(
  reader: ProjectReader<P>,
  project: P,
  title: string,
  wanted: () => boolean = () => true,
): Promise<OpenVerdict | null> {
  const refuse = (errors: StructureError[]): OpenVerdict => ({
    ok: false,
    errors,
  });

  // Checks 1 and 2.
  const rawProps = await reader.properties(project);
  if (!wanted()) return null;
  const propErrors = validateProperties(rawProps);
  if (propErrors.length > 0) {
    // An empty folder gets "missingProperties" from `validateProperties`. A
    // half-deleted folder, prose in `document/` but no properties file, gets
    // "documentNotEmpty": the app must not write over prose the writer still
    // owns.
    if (rawProps !== null) return refuse(propErrors);
    const prose = await holdsDocumentFiles(reader, project);
    if (!wanted()) return null;
    return refuse(prose ? [{ code: "documentNotEmpty" }] : propErrors);
  }
  const properties = parseProperties(rawProps, title);

  // The snapshot records. A missing catalogue is refused, never read as one
  // with no snapshots, which would leave every file in `document/` unlisted.
  const rawCatalogue = await reader.catalogue(project);
  if (!wanted()) return null;
  const read = readCatalogue(rawCatalogue);
  if (!read.ok) return refuse([read.error]);
  const { catalogue } = read;

  // Checks 3 to 9.
  const rawStructure = await reader.structure(project);
  if (!wanted()) return null;
  const parsed = parseStructure(rawStructure);
  if (!parsed.ok) return refuse(parsed.errors);

  // The records live in the catalogue and are attached to the nodes here. A
  // snapshot is the prose, so a live node whose record is corrupt refuses
  // the open with a precise error; a bad summary warns and attaches nothing;
  // the removed list warns and drops.
  const reconciled = reconcileRecords(
    parsed.structure,
    withHashes(catalogue.snapshots, properties.snapshotHashes),
    properties.summaries,
  );
  if (!reconciled.ok) return refuse(reconciled.errors);
  const structure = reconciled.structure;

  // Checks 10 and 11. Only Parts and Sections take part; a stray `notes.txt`
  // or an images folder belongs to the writer.
  let onDisk: string[];
  try {
    onDisk = await reader.documentFiles(project);
  } catch (err) {
    if (!((err as { code?: unknown } | null)?.code === "not-found"))
      appLog.warn("editor", "The document folder could not be listed.", {
        ...describeError(err),
      });
    if (!wanted()) return null;
    return refuse([{ code: "missingDocumentDir" }]);
  }
  if (!wanted()) return null;
  const driftErrors = validateAgainstDisk(structure, onDisk);
  if (driftErrors.length > 0) {
    // Only files no record names, and a pull that stopped partway: the files
    // came down and their records did not yet. The next sync brings them.
    const onlyUnlisted = driftErrors.every((e) => e.code === "filesUnlisted");
    const unfinished = onlyUnlisted && (await reader.pullUnfinished(project));
    if (!wanted()) return null;
    return refuse(unfinished ? [{ code: "syncUnfinished" }] : driftErrors);
  }

  return { ok: true, structure, properties, catalogue };
}

/**
 * Verifies every snapshot's stored `contentHash` against the text on disk.
 * A missing hash is not yet computed, not a mismatch; the backfill fills it.
 * The hash is over canonicalized text, so providers' bytes never disagree.
 * A mismatch becomes a warning and its node's id, never a refusal.
 */
export async function verifySnapshotHashes<P extends ProjectId>(
  reader: ProjectReader<P>,
  project: P,
  structure: DocumentStructure,
): Promise<{ mismatched: Set<string>; warnings: StructureError[] }> {
  const mismatched = new Set<string>();
  const warnings: StructureError[] = [];
  const nodes: DocNode[] = [];
  walk(structure.children, (node) => nodes.push(node));
  for (const node of nodes) {
    for (const snap of node.snapshots) {
      if (!snap.contentHash) continue;
      const content = await reader.snapshot(project, snap.file);
      if (content === null) continue;
      if ((await hashOf(content)) !== snap.contentHash) {
        mismatched.add(node.id);
        warnings.push({
          code: "contentHashMismatch",
          values: { id: node.id, title: node.title, file: snap.file },
        });
        break;
      }
    }
  }
  return { mismatched, warnings };
}
