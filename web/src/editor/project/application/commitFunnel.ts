// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The one way a structural change lands in the open project: files first,
// the metadata second, and the undo that takes both back.
//
// Under strict validation no order survives a half-failure alone, since a
// file with no entry and an entry with no file are both invalid. A failed
// file move puts the moved files back; a failed metadata write puts the
// files and the metadata files back, so a document that will not open is
// never left behind. The undo writes the metadata first and moves the files
// second; a failure in either puts the metadata forward again and rejects.

import { hashesFor, withRecords } from "../../../project/snapshotCatalogue";
import { recordsOf } from "../../../project/structure";
import type {
  DocumentStructure,
  SnapshotCatalogue,
} from "../../../project/types";
import type { MetadataStore, ProjectId } from "./stores";
import type { MetadataLanes } from "./metadataLanes";

export interface StructuralChange {
  /** The structure after the change. */
  readonly next: DocumentStructure;
  /** Moves the files the change needs, before any metadata is written. */
  readonly applyFiles?: () => Promise<void>;
  /** Puts back what `applyFiles` moved: the rollback and the undo. */
  readonly revertFiles?: () => Promise<void>;
  /**
   * Default true: the yaml. Structural changes (add, rename, move, remove,
   * restore, adopt) keep it. Snapshot changes (add, retitle, delete) set it
   * false: the snapshot record lives in the catalogue.
   */
  readonly writeStructure?: boolean;
  /**
   * Default false: the node records, the snapshots in the catalogue and
   * their hashes and the summaries in the properties file. Set by any change
   * whose `next` changed a node's snapshots: adding a node, renaming one (its
   * files are re-stemmed) and the three snapshot changes. The bin's entries
   * are keyed by id, so move, remove, restore and adopt never touch the
   * records.
   */
  readonly writeRecords?: boolean;
  /**
   * A change to the bin's records that goes with the files: `forward` lands
   * in the same catalogue write as the records, and `back` in the rollback's
   * and the undo's. Set by binning a snapshot and by restoring one, whose
   * file moves between `document/` and `recyclebin/`. It implies
   * `writeRecords`.
   */
  readonly binEdit?: {
    readonly forward: (catalogue: SnapshotCatalogue) => SnapshotCatalogue;
    readonly back: (catalogue: SnapshotCatalogue) => SnapshotCatalogue;
  };
}

export type CommitOutcome =
  /**
   * The change did not land. `restored` says whether every rollback write
   * landed: when false, a file move or a metadata write back to `previous`
   * failed too, so the folder may not match what is shown, and the writer
   * is told to open the project again.
   */
  | { readonly ok: false; readonly restored: boolean }
  /**
   * The change landed. `undo` takes it back, or is null when another
   * project is open in its place: an undo there would act on a folder that
   * is not on screen.
   */
  | { readonly ok: true; readonly undo: (() => Promise<void>) | null };

/**
 * Thrown by an undo whose own failure could not be put right: the metadata
 * could not go forward again to name the files where the change left them.
 * `cause` is the undo's error.
 */
export class RollbackIncomplete extends Error {
  constructor(readonly cause: unknown) {
    super("rollback-incomplete");
    this.name = "RollbackIncomplete";
  }
}

/**
 * Runs `write` and answers whether it landed; a rollback write that fails
 * is noted, never thrown, because the first error is already the writer's.
 */
async function landed(write: () => Promise<void>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch {
    return false;
  }
}

/**
 * Lands `change` in the open project through `lanes`. Answers null when no
 * project is open, so nothing was tried. A failure reaches `failed` before
 * the rollback starts, so the writer reads the error while the files go back.
 */
export async function commitChange<P extends ProjectId>(
  lanes: MetadataLanes<P>,
  store: MetadataStore<P>,
  change: StructuralChange,
  failed: (error: unknown) => void = () => {},
): Promise<CommitOutcome | null> {
  const target = lanes.owner;
  const previous = lanes.structure;
  if (!target || !previous) return null;
  const {
    next,
    applyFiles,
    revertFiles,
    writeStructure = true,
    binEdit,
  } = change;
  const writeRecords = (change.writeRecords ?? false) || binEdit !== undefined;

  // The catalogue first: a snapshot change is the one whose open depends on
  // it, and the summaries are only annotations. `onCatalogue` hears that the
  // catalogue landed, which is when a write back of the records matters.
  const writeRecordsOf = async (
    shape: DocumentStructure,
    bin: (catalogue: SnapshotCatalogue) => SnapshotCatalogue = (c) => c,
    onCatalogue: () => void = () => {},
  ) => {
    await lanes.writeCatalogue(store, target, (latest) =>
      withRecords(bin(latest), shape),
    );
    onCatalogue();
    await lanes.writeProperties(store, target, (latest) => ({
      ...latest,
      snapshotHashes: hashesFor(latest.snapshotHashes, shape),
      summaries: recordsOf(shape).summaries,
    }));
  };

  try {
    if (applyFiles) await applyFiles();
  } catch (error) {
    failed(error);
    // A move of many files (a node rename re-stemming every snapshot) can
    // fail halfway. The metadata still names the old files, so the moved ones
    // go back, because a half-renamed document will not open.
    const restored = revertFiles ? await landed(revertFiles) : true;
    return { ok: false, restored };
  }

  // Which metadata writes landed before the failure: a write back matters
  // only for those, since a failed write leaves its file as it was.
  let yamlLanded = false;
  let catalogueLanded = false;
  try {
    // The yaml holds no snapshot records, so it is `next` as it is.
    if (writeStructure) {
      await lanes.writeStructure(store, target, next);
      yamlLanded = true;
    }
    // The records are merged onto the latest catalogue and properties at
    // dequeue, so they never overwrite a write queued in between. Both derive
    // from the model, so the files mirror the structure.
    if (writeRecords)
      await writeRecordsOf(next, binEdit?.forward, () => {
        catalogueLanded = true;
      });
  } catch (error) {
    failed(error);
    // The metadata files and the shown structure go back to `previous`, so
    // no file names what the other does not. Each write back is tried
    // whatever the one before did, and the outcome says whether every one
    // that mattered landed.
    let restored = true;
    if (revertFiles) restored = (await landed(revertFiles)) && restored;
    const yamlBack = await landed(() =>
      lanes.writeStructure(store, target, previous),
    );
    if (yamlLanded) restored = yamlBack && restored;
    const recordsBack = await landed(() =>
      writeRecordsOf(previous, binEdit?.back),
    );
    if (catalogueLanded) restored = recordsBack && restored;
    lanes.showStructure(target, previous);
    return { ok: false, restored };
  }

  if (!lanes.owns(target)) return { ok: true, undo: null };

  // A change with no yaml write shows its structure once the records
  // write lands; a yaml write showed it from the structure lane.
  if (!writeStructure) lanes.showStructure(target, next);

  return {
    ok: true,
    undo: async () => {
      // The metadata goes back before any file moves, so a failed metadata
      // write leaves every file as the writer last saved it. `applyFiles` is
      // never run again: a change that creates a file would write its first
      // bytes over the prose saved into it since.
      let yamlBack = false;
      let catalogueBack = false;
      try {
        if (writeStructure) {
          await lanes.writeStructure(store, target, previous);
          yamlBack = true;
        }
        if (writeRecords)
          await writeRecordsOf(previous, binEdit?.back, () => {
            catalogueBack = true;
          });
        if (revertFiles) await revertFiles();
      } catch (error) {
        // The metadata goes forward again to name the files where the change
        // put them, and the undo fails where the writer sees it. When a
        // write forward that mattered does not land either, the failure
        // says so.
        let forward = true;
        if (writeStructure) {
          const landedAgain = await landed(() =>
            lanes.writeStructure(store, target, next),
          );
          if (yamlBack) forward = landedAgain && forward;
        }
        if (writeRecords) {
          const landedAgain = await landed(() =>
            writeRecordsOf(next, binEdit?.forward),
          );
          if (catalogueBack) forward = landedAgain && forward;
        }
        lanes.showStructure(target, next);
        throw forward ? error : new RollbackIncomplete(error);
      }
      if (!writeStructure) lanes.showStructure(target, previous);
    },
  };
}
