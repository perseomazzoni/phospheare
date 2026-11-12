// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback } from "react";
import {
  DOCUMENT_DIR,
  RECYCLE_BIN_DIR,
  REFERENCE_DIR,
  SUMMARY_PREFIX,
  filePath,
  snapshotFileName,
  toSlug,
} from "../../project/naming";
import {
  allFileNames,
  childrenOf,
  findNode,
  nextNodeId,
  walk,
} from "../../project/structure";
import {
  canRestore,
  insertNode,
  moveNodes,
  newNode,
  nodeSubtreeFileNames,
  normalizeSelection,
  removeToRemoved,
  renameNode,
  restoreFromRemoved,
  subtreeFileNames,
} from "../../project/mutations";
import { withoutLastOpened } from "../../project/properties";
import type { DocNode, NodeKind } from "../../project/types";
import type { ProjectRef } from "../../storage";
import type { ActionHost } from "./actionHost";

/**
 * The structural actions: add, rename, remove, restore and move a node. Each
 * builds a pure change from `project/mutations.ts` and lands it through
 * `commit`, which keeps the yaml current and one undo available.
 */
export function useStructureActions(host: ActionHost) {
  const {
    lanes,
    provider,
    commit,
    enqueuePropsWrite,
    clearSummary,
    setError,
    t,
    journals,
    journalStore,
    engine,
    bufferFileRef,
    inBufferLane,
    saveActiveFile,
    flushJournal,
    openFile,
    letGoOfBuffer,
    retarget,
  } = host;

  const addNode = useCallback(
    async (kind: NodeKind, containerId: string | null, title: string) => {
      const target = lanes.owner;
      const current = lanes.structure;
      if (!target || !current) return;

      const trimmed = title.trim();
      const slug = toSlug(trimmed);
      const id = nextNodeId(current);
      const file = snapshotFileName(kind, slug, id, 0);
      const node = newNode(kind, id, trimmed, file, new Date().toISOString());

      // New nodes land at the end of their container, where the writer's eye
      // is after clicking the + on that row.
      const index = childrenOf(current, containerId).length;

      const committed = await commit(
        insertNode(current, node, containerId, index),
        { code: "added", title: node.title },
        async () => {
          await provider.writeFile(target, filePath(file), "");
        },
        () => provider.removeFile(target, filePath(file)),
        // A new node's first snapshot record lands in the properties with the
        // yaml entry; the two metadata files move together.
        { writeRecords: true },
      );

      // A new node opens for writing as soon as it exists, since the writer
      // just named it. `openFile`, not `proceedTo`, so unsaved prose stays
      // behind the discard dialog instead of being dropped. Only after a
      // successful commit: a failed write must not pull the writer out of the
      // file they are in.
      if (committed) await openFile(file);
    },
    [lanes, provider, commit, openFile],
  );

  /** Moves a file's journal across a rename. Never aborts the rename. */
  const moveJournalSection = useCallback(
    (target: ProjectRef, from: string, to: string) =>
      journals.move(journalStore, target, from, to),
    [journals, journalStore],
  );

  const renameNodeTo = useCallback(
    async (id: string, title: string) => {
      const target = lanes.owner;
      const current = lanes.structure;
      if (!target || !current) return;
      const node = findNode(current, id);
      if (!node) return;

      const trimmed = title.trim();
      if (trimmed === node.title) return;

      // The node's binned snapshots count too, so a snapshot moved to a free
      // counter takes no name a binned file holds in `recyclebin/`.
      const binned = lanes.catalogue?.binned[id] ?? [];
      const outcome = renameNode(current, id, trimmed, binned);
      // A derived target name that already exists refuses before any file
      // moves. The id is part of the name, so two nodes cannot rename
      // onto each other; the error names what it found rather than blaming
      // the title.
      const exists = new Set(allFileNames(current).map((n) => n.toLowerCase()));
      if (outcome.fileMoves.some(([, to]) => exists.has(to.toLowerCase()))) {
        setError(t("name.snapshotExists"));
        return;
      }

      // The moves that landed, in order. A rename that fails partway has
      // moved only some files, and the rollback reverses exactly those: one
      // that tried to move back a file still under its old name would stop
      // there and leave the moved ones under names no record holds.
      const moved: Array<[string, string]> = [];

      await commit(
        outcome.structure,
        { code: "renamed", title: trimmed },
        () =>
          inBufferLane(async () => {
            for (const [from, to] of outcome.fileMoves) {
              await provider.renameFile(target, filePath(from), to);
              moved.push([from, to]);
              retarget(from, to);
              // The journal is keyed by snapshot file name, each snapshot
              // owning its timeline, so every renamed file's section moves
              // with it.
              await moveJournalSection(target, from, to);
            }
          }),
        () =>
          inBufferLane(async () => {
            // Each move back is tried on its own, so one that fails does not
            // keep the others where they are; the first failure is still
            // reported to the caller.
            let failure: unknown = null;
            const stuck: Array<[string, string]> = [];
            for (const [from, to] of [...moved].reverse()) {
              try {
                await provider.renameFile(target, filePath(to), from);
                retarget(to, from);
                await moveJournalSection(target, to, from);
              } catch (err) {
                failure ??= err;
                stuck.unshift([from, to]);
              }
            }
            moved.splice(0, moved.length, ...stuck);
            if (failure !== null) throw failure;
          }),
        // The re-stem also rewrites every snapshot record's `file` in
        // `document-properties.json`; the rename spans both metadata files.
        { writeRecords: true },
      );
    },
    [
      lanes,
      provider,
      commit,
      moveJournalSection,
      setError,
      t,
      inBufferLane,
      retarget,
    ],
  );

  /** Deletes a summary: the file and the binding together. */
  const removeSummary = useCallback(
    async (nodeId: string) => {
      const target = lanes.owner;
      if (!target) return;
      await provider
        .removeFile(target, `${REFERENCE_DIR}/${SUMMARY_PREFIX}${nodeId}.md`)
        // A file already gone is the outcome asked for; the binding still goes.
        .catch(() => undefined);
      await clearSummary(nodeId);
    },
    [lanes, provider, clearSummary],
  );

  /**
   * Unlinks a node from the document without destroying prose. Every snapshot
   * of the subtree moves to `recyclebin/`, outside `document/` and so outside
   * validation, and the subtree moves to the yaml's `removed:` list, where the
   * bin renders it and a restore brings it back exactly. `commit` keeps the
   * pre-removal structure, so the undo reverses files and list together.
   */
  const removeNodeAt = useCallback(
    async (id: string) => {
      const target = lanes.owner;
      const current = lanes.structure;
      if (!target || !current) return;
      const node = findNode(current, id);
      if (!node) return;

      const files = subtreeFileNames(current, id);

      // The ids leaving the document: a `ui.lastOpened` pointing at any of
      // them would make the Desk read a node the structure does not hold.
      const removedIds = new Set<string>();
      walk([node], (n) => removedIds.add(n.id));

      // The open file leaves as `closeFile` lets go of it: its unsaved text is
      // written first, so the bin and the undo hold what the writer wrote. A
      // failed write refuses the removal, with the error on screen.
      const open = bufferFileRef.current;
      if (open && files.includes(open)) {
        if (engine.hasChanges && !(await saveActiveFile())) return;
        await flushJournal();
        letGoOfBuffer();
      }

      await commit(
        removeToRemoved(current, id).structure,
        { code: "removed", title: node.title },
        async () => {
          for (const name of files)
            await provider.moveFile(target, filePath(name), RECYCLE_BIN_DIR);
        },
        async () => {
          for (const name of files) {
            await provider.moveFile(
              target,
              `${RECYCLE_BIN_DIR}/${name}`,
              DOCUMENT_DIR,
            );
          }
        },
      );

      // Clear a `lastOpened` that named something the removal took: a removed
      // node is not a place to resume.
      if (removedIds.has(lanes.properties?.ui.lastOpened ?? "")) {
        void enqueuePropsWrite(target, (latest) =>
          withoutLastOpened(latest, removedIds),
        ).catch(() => {});
      }

      // The generated summaries go with the nodes they describe; otherwise
      // `summary--<id>.md` and its binding outlive the chapter, the shelf
      // draws a summary of something gone, and the assistant can read it.
      //
      // Removed, not binned like the node's own files: a summary is derived
      // material the assistant regenerates on demand, and a restored node's
      // summary comes back by being generated again.
      //
      // After the commit, not inside it, beside the `lastOpened` cleanup:
      // this half cannot be undone, and inside the reversible move the undo
      // path would have to answer for it.
      for (const nodeId of removedIds) void removeSummary(nodeId);
    },
    [
      lanes,
      provider,
      commit,
      engine,
      bufferFileRef,
      letGoOfBuffer,
      enqueuePropsWrite,
      removeSummary,
      saveActiveFile,
      flushJournal,
    ],
  );

  /**
   * Brings a bin item back, the reverse of `removeNodeAt`. The subtree is kept
   * verbatim in the yaml's `removed:` list, so a restore is a move: the files
   * come back from `recyclebin/`, the node goes into the container the writer
   * dropped it on, and the same `commit` makes it undoable.
   *
   * Guarded by `canRestore`, the rule the drop line is drawn against: the
   * container must accept the node's kind, and no incoming id or file name
   * may collide with a live one, since in `document/` a clash would overwrite
   * a real file and a duplicate would refuse the open.
   *
   * The unit is a top-level `removed:` entry: a subtree goes to the bin whole
   * and comes back whole, and `restoreFromRemoved` cannot split one. The
   * search face can name a nested node, and `restoreTargets` and `canRestore`
   * accept any `DocNode`, so a nested id is answered with an error rather than
   * accepting a destination and doing nothing.
   */
  const restoreFromBin = useCallback(
    async (id: string, containerId: string | null, index: number) => {
      const target = lanes.owner;
      const current = lanes.structure;
      if (!target || !current) return;
      const node = (current.removed ?? []).find((n) => n.id === id);
      if (!node) {
        setError(t("bin.restoreNotWhole"));
        return;
      }
      if (!canRestore(current, node, containerId)) {
        setError(t("bin.restoreRefused", { title: node.title }));
        return;
      }

      const files = nodeSubtreeFileNames(node);

      await commit(
        restoreFromRemoved(current, id, containerId, index),
        { code: "restored", title: node.title },
        async () => {
          for (const name of files) {
            await provider.moveFile(
              target,
              `${RECYCLE_BIN_DIR}/${name}`,
              DOCUMENT_DIR,
            );
          }
        },
        async () => {
          for (const name of files)
            await provider.moveFile(target, filePath(name), RECYCLE_BIN_DIR);
        },
      );
    },
    [lanes, provider, commit, setError, t],
  );

  /**
   * A move touches no file, because the layout is flat, so a group of any
   * size is one yaml write and one undo restores the structure from before.
   *
   * One node's toast names it; a group's counts it by kind, since a group is
   * always one kind (`canDropAll`).
   */
  const moveNodesTo = useCallback(
    async (
      ids: readonly string[],
      containerId: string | null,
      index: number,
    ) => {
      const current = lanes.structure;
      if (!current) return;
      const moving = normalizeSelection(current, ids);
      if (moving.length === 0) return;
      const first = findNode(current, moving[0]) as DocNode;
      const next = moveNodes(current, moving, containerId, index);
      // A landing the Golden Rule refuses comes back unchanged.
      if (next === current) return;
      await commit(
        next,
        moving.length === 1
          ? { code: "moved", title: first.title }
          : {
              code: first.kind === "part" ? "movedParts" : "movedSections",
              title: first.title,
              count: moving.length,
            },
      );
    },
    [lanes, commit],
  );

  return { addNode, renameNodeTo, removeNodeAt, restoreFromBin, moveNodesTo };
}
