// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback } from "react";
import { RECYCLE_BIN_DIR, DOCUMENT_DIR, filePath } from "../../project/naming";
import { findNode, nodeOfFile, snapshotOf } from "../../project/structure";
import {
  addSnapshot,
  adoptSnapshot,
  deleteSnapshot,
  renameSnapshotTitle,
  restoreSnapshot,
} from "../../project/mutations";
import {
  withBinnedSnapshot,
  withoutBinnedSnapshot,
} from "../../project/snapshotCatalogue";
import { hashOf } from "../../text/hash";
import type { ProjectRef } from "../../storage";
import type { SnapshotCatalogue } from "../../project/types";
import { StorageError } from "../../storage/types";
import type { ActionHost } from "./actionHost";
import { appLog, describeError } from "../../log";

/**
 * Add, adopt, retitle, delete and restore a binned snapshot.
 *
 * The snapshot actions ride the same `commit` funnel as the structural ops:
 * files first, metadata second, rollback on a failed write. Their guards
 * read runtime state a pure mutation must not see:
 *
 *   Add copies the adopted file only after the caller's save-first gate
 *   resolves, so the snapshot captures what the writer just wrote.
 *   Adopt is a pointer swap plus a landing: the editor loads the newly
 *   adopted file with a fresh baseline, or the stale buffer would overwrite
 *   the chosen snapshot on the next save.
 *   Delete bins the file with `undo: false` and drops its journal section.
 */
export function useSnapshotActions(host: ActionHost) {
  const {
    lanes,
    provider,
    commit,
    setError,
    t,
    journals,
    journalStore,
    bufferFileRef,
    proceedTo,
  } = host;

  /** Drops a file's journal across a deletion. Never aborts the deletion. */
  const deleteJournalSection = useCallback(
    (target: ProjectRef, fileName: string) =>
      journals.remove(journalStore, target, fileName),
    [journals, journalStore],
  );

  /** Adds a snapshot: copies the adopted file to xy = max+1 and lists it,
   * titled with what the writer typed, or the default when empty. The caller
   * settles the buffer first, so the copy reads the saved text. The dock owns
   * single-flight; the pure op is synchronous, so a double fire can only race
   * on the shell side. */
  const addSnapshotAction = useCallback(
    async (id: string, title?: string): Promise<string | null> => {
      const target = lanes.owner;
      const current = lanes.structure;
      if (!target || !current) return null;
      // The node's binned snapshots count too, so no new file takes a name a
      // binned file holds in `recyclebin/`.
      const binned = lanes.catalogue?.binned[id] ?? [];
      let outcome = addSnapshot(
        current,
        id,
        new Date().toISOString(),
        title,
        undefined,
        binned,
      );
      if (!outcome) return null;

      // The derived target must not already exist on disk: a stale structure
      // must never overwrite a real file. Only `not-found` lets the copy go
      // on; a read that failed for another reason has not shown the name is
      // free.
      try {
        await provider.readFile(target, filePath(outcome.snapshot.file));
        setError(t("name.snapshotExists"));
        return null;
      } catch (err) {
        if (!(err instanceof StorageError && err.code === "not-found")) {
          appLog.warn("editor", "A new snapshot's name could not be checked.", {
            node: id,
            ...describeError(err),
          });
          setError(t("name.snapshotSourceUnreadable"));
          return null;
        }
      }

      // The adopted file is read once: the hash and the bytes `commit`'s
      // write callback copies must describe the same read, or a save landing
      // between two reads persists a hash for content the snapshot never got.
      // The callback closes over `srcContent`. A source that is gone or will
      // not read makes no snapshot: an empty one would stand for text the
      // writer never had.
      let srcContent: string;
      try {
        srcContent = await provider.readFile(
          target,
          filePath(outcome.copyFrom),
        );
      } catch (err) {
        appLog.warn("editor", "A snapshot's source could not be read.", {
          node: id,
          ...describeError(err),
        });
        setError(t("name.snapshotSourceUnreadable"));
        return null;
      }
      try {
        const srcHash = await hashOf(srcContent);
        const withHash = addSnapshot(
          current,
          id,
          outcome.snapshot.created,
          title,
          srcHash,
          binned,
        );
        if (withHash) outcome = withHash;
      } catch {
        // Best-effort: the hash is backfilled at a later open.
      }
      const committed = await commit(
        outcome.structure,
        { code: "createdSnapshot", title: outcome.snapshot.title },
        async () => {
          await provider.writeFile(
            target,
            filePath(outcome.snapshot.file),
            srcContent,
          );
        },
        () => provider.removeFile(target, filePath(outcome.snapshot.file)),
        // The snapshot record lives in the catalogue: creating one is a
        // records write and no yaml write.
        { writeStructure: false, writeRecords: true },
      );
      // A rolled-back commit made no file, so it names none.
      return committed ? outcome.snapshot.file : null;
    },
    [lanes, provider, commit, setError, t],
  );

  /** Adopts a snapshot: a yaml pointer swap, then the editor lands in the
   * newly adopted file with a fresh baseline. The caller has settled the
   * buffer. The journal is keyed by file, so the new file's own timeline
   * hydrates, or the tail-reconcile drops it if the file moved on. Nothing is
   * destroyed, so no undo arms: adopting back is the undo. `discarded` is
   * the gate's "Don't save": the outgoing timeline stays out of the journal,
   * as at the leave dialog. */
  const adoptSnapshotAction = useCallback(
    async (id: string, file: string, opts?: { discarded?: boolean }) => {
      const target = lanes.owner;
      const current = lanes.structure;
      if (!target || !current) return;
      const outcome = adoptSnapshot(current, id, file);
      if (!outcome) return;

      // The toast names the snapshot by the writer's title, not the slug.
      const snapshotTitle = snapshotOf(current, id, file)?.title ?? file;

      const committed = await commit(
        outcome.structure,
        { code: "adoptedSnapshot", title: snapshotTitle },
        undefined,
        undefined,
        { undo: false },
      );
      if (!committed) return;

      // The landing. The dock shows the open node's snapshots, so the buffer
      // is a file of this node and the open file changes. If the writer is
      // elsewhere, there is nothing to reload.
      const owner = nodeOfFile(current, bufferFileRef.current ?? "");
      if (owner && owner.id === id) {
        await proceedTo(file, { discarded: opts?.discarded });
      }
    },
    [lanes, commit, proceedTo, bufferFileRef],
  );

  /** Re-titles one snapshot, undoable like any rename. */
  const renameSnapshotTitleAction = useCallback(
    async (id: string, file: string, title: string) => {
      const current = lanes.structure;
      if (!current) return;
      const previousTitle = snapshotOf(current, id, file)?.title ?? file;
      const outcome = renameSnapshotTitle(current, id, file, title.trim());
      if (!outcome.renamed) return;
      await commit(
        outcome.structure,
        {
          code: "renamedSnapshot",
          title: previousTitle,
          newTitle: title.trim(),
        },
        undefined,
        undefined,
        // A re-title touches only the snapshot record, in the properties.
        { writeStructure: false, writeRecords: true },
      );
    },
    [lanes, commit],
  );

  /** Bins the file and drops its entry; no undo, the bin is the way back. */
  const deleteSnapshotAction = useCallback(
    async (id: string, file: string) => {
      const target = lanes.owner;
      const current = lanes.structure;
      if (!target || !current) return;
      const outcome = deleteSnapshot(current, id, file);
      if (!outcome.removed) return;

      const record = snapshotOf(current, id, file);
      const snapshotTitle = record?.title ?? file;

      const committed = await commit(
        outcome.structure,
        { code: "deletedSnapshot", title: snapshotTitle },
        // Binned, not removed: a snapshot is prose the writer set aside. As
        // with reference documents, authored material goes to the bin and
        // derived material does not.
        () => provider.moveFile(target, filePath(file), RECYCLE_BIN_DIR),
        // A failed catalogue write puts the file back where its record is.
        () =>
          provider.moveFile(target, `${RECYCLE_BIN_DIR}/${file}`, DOCUMENT_DIR),
        // Catalogue only, like the other snapshot record changes. The bin
        // row travels with the file, in the same catalogue write, because it
        // shows the writer's title.
        {
          undo: false,
          writeStructure: false,
          writeRecords: true,
          ...(record
            ? {
                binEdit: {
                  forward: (c: SnapshotCatalogue) =>
                    withBinnedSnapshot(c, id, record),
                  back: (c: SnapshotCatalogue) =>
                    withoutBinnedSnapshot(c, id, file),
                },
              }
            : {}),
        },
      );
      if (!committed) return;
      // The journal section goes although the file survives in the bin.
      // `addSnapshot` counts past the binned record, but a record this write
      // never lands, or one the bin drops, frees the name, and a successor
      // would inherit the journal. The restore refuses a reused name, so
      // nothing is lost silently.
      void deleteJournalSection(target, file);
    },
    [lanes, provider, commit, deleteJournalSection],
  );

  /**
   * Puts a binned snapshot back on its node.
   *
   * Fails closed: a node absent from the document has nothing to put this
   * back on, and a file name a successor has reused must not be overwritten,
   * since replacing a snapshot made after the deletion is the loss a recycle
   * bin exists to prevent.
   */
  const restoreBinnedSnapshot = useCallback(
    async (nodeId: string, file: string) => {
      const target = lanes.owner;
      const current = lanes.structure;
      if (!target || !current) return false;
      const node = findNode(current, nodeId);
      if (!node) return false;
      const record = lanes.catalogue?.binned[nodeId]?.find(
        (s) => s.file === file,
      );
      if (!record) return false;
      try {
        if (await provider.exists(target, filePath(file))) return false;
      } catch (err) {
        appLog.warn(
          "editor",
          "A binned snapshot's place could not be checked.",
          {
            node: nodeId,
            ...describeError(err),
          },
        );
        return false;
      }
      const next = restoreSnapshot(current, nodeId, record);
      // The move, the live record and the bin row land together, and a
      // failed catalogue write sends the file back to the bin.
      return commit(
        next,
        { code: "restoredSnapshot", title: record.title },
        () =>
          provider.moveFile(target, `${RECYCLE_BIN_DIR}/${file}`, DOCUMENT_DIR),
        () => provider.moveFile(target, filePath(file), RECYCLE_BIN_DIR),
        {
          undo: false,
          writeStructure: false,
          writeRecords: true,
          binEdit: {
            forward: (c: SnapshotCatalogue) =>
              withoutBinnedSnapshot(c, nodeId, file),
            back: (c: SnapshotCatalogue) =>
              withBinnedSnapshot(c, nodeId, record),
          },
        },
      );
    },
    [lanes, provider, commit],
  );

  return {
    addSnapshotAction,
    adoptSnapshotAction,
    renameSnapshotTitleAction,
    deleteSnapshotAction,
    restoreBinnedSnapshot,
  };
}
