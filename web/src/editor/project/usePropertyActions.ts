// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback } from "react";
import type { ProjectRef } from "../../storage";
import type { MetadataLanes } from "./application/metadataLanes";
import { nodeOfFile } from "../../project/structure";
import { withSummary, withUi, withoutSummary } from "../../project/properties";
import type {
  DocumentProperties,
  DocumentUiState,
  WritingPrefs,
} from "../../project/types";

/**
 * The actions that write only the open project's properties: the `ui`
 * block and the summary bindings. Each one goes through the properties lane,
 * so two quick writes cannot drop one another.
 */
export function usePropertyActions({
  lanes,
  enqueuePropsWrite,
  bufferFileRef,
}: {
  lanes: MetadataLanes<ProjectRef>;
  /** Queues a job on the properties lane, built on the latest properties. */
  enqueuePropsWrite: (
    target: ProjectRef,
    job: (
      latest: DocumentProperties,
    ) => DocumentProperties | null | Promise<DocumentProperties | null>,
  ) => Promise<void>;
  /** The file the engine's buffer came from, which `lastOpened` names. */
  bufferFileRef: React.RefObject<string | null>;
}) {
  /**
   * Drops a node's summary binding, the reverse of `bindSummary`. A binding
   * that outlives its file still tells the shelf and the assistant that a
   * summary exists.
   */
  const clearSummary = useCallback(
    async (nodeId: string) => {
      const target = lanes.owner;
      if (!target) return;
      await enqueuePropsWrite(target, (latest) =>
        withoutSummary(latest, nodeId),
      );
    },
    [lanes, enqueuePropsWrite],
  );

  /**
   * Persists which Parts are open. Fire-and-forget: a lost expansion state is
   * not worth an error message, and the panel must not wait on a disk write
   * to animate a chevron.
   *
   * The rest of `ui` is kept (`withUi`).
   */
  const saveUi = useCallback(
    (expanded: string[]) => {
      const target = lanes.owner;
      if (!target) return;
      void enqueuePropsWrite(target, (latest) =>
        withUi(latest, {
          expanded,
          // `lastOpened` is the node's id, which survives renames and
          // adoptions, so the Desk resolves it to the current adopted file.
          lastOpened:
            (bufferFileRef.current &&
              lanes.structure &&
              nodeOfFile(lanes.structure, bufferFileRef.current)?.id) ??
            latest.ui.lastOpened,
        }),
      ).catch(() => {});
    },
    [lanes, enqueuePropsWrite, bufferFileRef],
  );

  /**
   * Merges a few fields into the project's `ui` block and writes it,
   * fire-and-forget like `saveUi`: the surface restyles the moment the
   * writer's hand moves, and a lost properties write is not worth an error
   * message. `saveUi` does not use it, because it computes `lastOpened`
   * rather than merging what it is handed.
   */
  const patchUi = useCallback(
    (next: Partial<DocumentUiState>) => {
      const target = lanes.owner;
      if (!target) return;
      void enqueuePropsWrite(target, (latest) => withUi(latest, next)).catch(
        () => {},
      );
    },
    [lanes, enqueuePropsWrite],
  );

  /** Changes the project's writing preferences. */
  const setPrefs = useCallback(
    (next: Partial<WritingPrefs>) => patchUi(next),
    [patchUi],
  );

  const bindSummary = useCallback(
    async (nodeId: string, fileName: string) => {
      const target = lanes.owner;
      if (!target) return;
      await enqueuePropsWrite(target, (latest) =>
        withSummary(latest, nodeId, fileName),
      );
    },
    [lanes, enqueuePropsWrite],
  );

  /**
   * Remembers how wide the dock was left. The drag holds the width in
   * `Workspace` state so the surface re-centres live; this is the one write,
   * when the drag ends.
   */
  const setDockWidth = useCallback(
    (dockWidth: number) => patchUi({ dockWidth }),
    [patchUi],
  );

  /** Hides the margin's comments, or shows them again. */
  const setCommentsHidden = useCallback(
    (commentsHidden: boolean) => patchUi({ commentsHidden }),
    [patchUi],
  );

  /**
   * Remembers how wide the structure panel was left: one write per drag end,
   * as for the dock.
   */
  const setStructureWidth = useCallback(
    (structureWidth: number) => patchUi({ structureWidth }),
    [patchUi],
  );

  /**
   * Remembers where the snapshot tab's divider was left: one write per drag
   * end, as `setDockWidth`.
   */
  const setSnapshotSplit = useCallback(
    (fraction: number) => patchUi({ snapshotSplit: fraction }),
    [patchUi],
  );

  return {
    saveUi,
    setPrefs,
    bindSummary,
    clearSummary,
    setDockWidth,
    setStructureWidth,
    setCommentsHidden,
    setSnapshotSplit,
  };
}
