// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// `snapshots-catalogue.json`: which files are snapshots, and of which node.
//
// The file holds the snapshot records and nothing else, so it changes only
// when a snapshot does, and the sync compares it like the files it lists
// rather than leaving it last-write-wins like the properties file. A
// record's `contentHash` is not here: a save changes it, and two devices
// writing different Sections would then always conflict over this file. The
// hashes stay in the properties file (`snapshotHashes`), keyed by file name,
// and are joined to the records at open. A project without it is refused,
// never read as having no snapshots: an empty catalogue over a `document/`
// folder full of prose would orphan every file.

import { recordsOf } from "./structure";
import type {
  DocumentStructure,
  Snapshot,
  SnapshotCatalogue,
  StructureError,
} from "./types";

/** A new project's catalogue: no node, so no record. */
export function emptyCatalogue(): SnapshotCatalogue {
  return { snapshots: {}, binned: {} };
}

/**
 * Lenient read of one records block: malformed entries are dropped, never
 * thrown. The strict judgement is `reconcileRecords`'; one bad row does not
 * refuse an open here. A `contentHash` in a row is not read.
 */
function parseRecords(value: unknown): Record<string, Snapshot[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, Snapshot[]> = {};
  for (const [id, list] of Object.entries(value)) {
    if (!Array.isArray(list)) continue;
    const snaps: Snapshot[] = [];
    for (const entry of list) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const row = entry as Record<string, unknown>;
      if (typeof row.file !== "string" || row.file.length === 0) continue;
      if (typeof row.title !== "string" || row.title.length === 0) continue;
      if (typeof row.created !== "string" || row.created.length === 0) continue;
      snaps.push({ file: row.file, title: row.title, created: row.created });
    }
    if (snaps.length > 0) out[id] = snaps;
  }
  return out;
}

/** A block that is there but is not a map of node ids. */
const notAMap = (value: unknown) =>
  value !== undefined &&
  (!value || typeof value !== "object" || Array.isArray(value));

/**
 * The catalogue in `raw`, or the reason the project cannot be opened with
 * it: no file, a file that is not JSON, or blocks that are not maps. Rows
 * inside a valid file are read leniently.
 */
export function readCatalogue(
  raw: string | null,
):
  | { ok: true; catalogue: SnapshotCatalogue }
  | { ok: false; error: StructureError } {
  if (raw === null) return { ok: false, error: { code: "missingCatalogue" } };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: { code: "catalogueParse" } };
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    return { ok: false, error: { code: "catalogueParse" } };
  const file = data as Record<string, unknown>;
  if (notAMap(file.snapshots) || notAMap(file.binned))
    return { ok: false, error: { code: "catalogueParse" } };
  return {
    ok: true,
    catalogue: {
      snapshots: parseRecords(file.snapshots),
      binned: parseRecords(file.binned),
    },
  };
}

export function serializeCatalogue(catalogue: SnapshotCatalogue): string {
  // Trailing newline and two-space indent: the file lives in the writer's
  // folder and may end up in their git history.
  return `${JSON.stringify(
    { snapshots: catalogue.snapshots, binned: catalogue.binned },
    null,
    2,
  )}\n`;
}

// ── Edits ────────────────────────────────────────────────────────────────────

/** A record as the catalogue keeps it: no hash. */
const recordOf = ({ file, title, created }: Snapshot): Snapshot => ({
  file,
  title,
  created,
});

const recordsWithoutHashes = (
  records: Record<string, Snapshot[]>,
): Record<string, Snapshot[]> =>
  Object.fromEntries(
    Object.entries(records).map(([id, list]) => [id, list.map(recordOf)]),
  );

/** The live records as `structure` holds them, the bin kept as it is. */
export function withRecords(
  catalogue: SnapshotCatalogue,
  structure: DocumentStructure,
): SnapshotCatalogue {
  return {
    ...catalogue,
    snapshots: recordsWithoutHashes(recordsOf(structure).snapshots),
  };
}

// ── The hashes ───────────────────────────────────────────────────────────────

/** The catalogue's records with each file's stored hash joined on. */
export function withHashes(
  records: Record<string, Snapshot[]>,
  hashes: Record<string, string>,
): Record<string, Snapshot[]> {
  return Object.fromEntries(
    Object.entries(records).map(([id, list]) => [
      id,
      list.map((snap) =>
        hashes[snap.file] ? { ...snap, contentHash: hashes[snap.file] } : snap,
      ),
    ]),
  );
}

/**
 * The hashes the properties file keeps after a structural change: one per
 * snapshot file `structure` names, and no other. A hash `latest` holds wins
 * over the structure's, which is as old as the open or the snapshot's
 * creation while a save updates `latest`; the structure's fills a new file.
 */
export function hashesFor(
  latest: Record<string, string>,
  structure: DocumentStructure,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const list of Object.values(recordsOf(structure).snapshots)) {
    for (const snap of list) {
      const hash = latest[snap.file] ?? snap.contentHash;
      if (hash) out[snap.file] = hash;
    }
  }
  return out;
}

/** Keeps a deleted snapshot's record with its node, for the bin to show. */
export function withBinnedSnapshot(
  catalogue: SnapshotCatalogue,
  nodeId: string,
  record: Snapshot,
): SnapshotCatalogue {
  return {
    ...catalogue,
    binned: {
      ...catalogue.binned,
      // A record already there for the file is replaced, so a rollback that
      // puts one back twice leaves one row.
      [nodeId]: [
        ...(catalogue.binned[nodeId] ?? []).filter(
          (s) => s.file !== record.file,
        ),
        record,
      ],
    },
  };
}

/** Drops a binned snapshot's record, and its node's entry once empty. */
export function withoutBinnedSnapshot(
  catalogue: SnapshotCatalogue,
  nodeId: string,
  file: string,
): SnapshotCatalogue {
  const left = (catalogue.binned[nodeId] ?? []).filter((s) => s.file !== file);
  const rest = { ...catalogue.binned };
  if (left.length > 0) rest[nodeId] = left;
  else delete rest[nodeId];
  return { ...catalogue, binned: rest };
}
