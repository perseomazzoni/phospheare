// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useState } from "react";
import type { TFunction } from "i18next";
import type { ProjectRef } from "../../storage";
import type { DocumentStructure } from "../../project/types";
import type { UndoableAction } from "../ProjectContext";
import {
  commitChange,
  RollbackIncomplete,
  type StructuralChange,
} from "./application/commitFunnel";
import type { MetadataLanes } from "./application/metadataLanes";
import type { MetadataStore } from "./application/stores";
import { appLog, describeError } from "../../log";

/**
 * The structural funnel's outcome and the one undo it leaves. `commit` arms
 * the toast, `undoLast` consumes it, and a dismiss, a notice or a new open
 * replaces it, so exactly one undo is ever on offer.
 */
export function useUndoToast({
  lanes,
  metadata,
  message,
  t,
  setError,
}: {
  lanes: MetadataLanes<ProjectRef>;
  metadata: MetadataStore<ProjectRef>;
  /** The writer's words for a storage failure. */
  message: (err: unknown) => string;
  t: TFunction;
  setError: (error: string | null) => void;
}) {
  const [lastAction, setLastAction] = useState<UndoableAction | null>(null);

  /**
   * Applies a structural change and remembers how to take it back. Every add,
   * rename, move and remove funnels through here, which keeps the yaml always
   * current and exactly one undo always available. `commitChange` lands it;
   * this shows the error or the toast.
   *
   * `options.undo` is false for adopting a snapshot (adopting back is the
   * undo) and for deleting or restoring one (the bin is the way back). The
   * change still lands through the same funnel, and a plain toast confirms it
   * with no undo.
   */
  const commit = useCallback(
    async (
      next: DocumentStructure,
      action: Omit<UndoableAction, "undo">,
      applyFiles?: () => Promise<void>,
      revertFiles?: () => Promise<void>,
      options: {
        undo?: boolean;
        writeStructure?: boolean;
        writeRecords?: boolean;
        binEdit?: StructuralChange["binEdit"];
      } = {},
    ): Promise<boolean> => {
      const { undo = true, writeStructure, writeRecords, binEdit } = options;
      let first: unknown;
      const started = Date.now();
      const outcome = await commitChange(
        lanes,
        metadata,
        {
          next,
          applyFiles,
          revertFiles,
          writeStructure,
          writeRecords,
          binEdit,
        },
        (err) => {
          first = err;
          appLog.error("structure", "A change to the structure failed.", {
            action: action.code,
            ...describeError(err),
          });
          setError(message(err));
        },
      );
      if (!outcome?.ok) {
        // A rollback that did not fully land leaves the folder unlike what
        // is shown: the writer is told, and told to open the project again.
        if (outcome && !outcome.restored) {
          appLog.error(
            "structure",
            "A failed change could not be taken back in full.",
            { action: action.code },
          );
          setError(
            t("structure.rollbackIncomplete", { detail: message(first) }),
          );
        }
        return false;
      }
      const takeBack = outcome.undo;
      appLog.info("structure", "A change to the structure was made.", {
        action: action.code,
        undo: undo && Boolean(takeBack),
        ms: Date.now() - started,
      });
      if (!takeBack) return true;

      setError(null);
      if (!undo) {
        setLastAction({ ...action });
        return true;
      }
      setLastAction({
        ...action,
        undo: async () => {
          await takeBack();
          setLastAction(null);
        },
      });
      return true;
    },
    [lanes, metadata, message, t, setError],
  );

  const undoLast = useCallback(async () => {
    if (!lastAction?.undo) return;
    const started = Date.now();
    try {
      await lastAction.undo();
      appLog.info("structure", "A change to the structure was undone.", {
        action: lastAction.code,
        ms: Date.now() - started,
      });
    } catch (err) {
      appLog.error("structure", "An undo failed.", {
        action: lastAction.code,
        ...describeError(err),
      });
      setError(
        err instanceof RollbackIncomplete
          ? t("structure.rollbackIncomplete", { detail: message(err.cause) })
          : message(err),
      );
      setLastAction(null);
    }
  }, [lastAction, message, t, setError]);

  const dismissUndo = useCallback(() => setLastAction(null), []);

  /** `notify`, as an action, so the tree does not reach into the toast state. */
  const notify = useCallback(
    (code: string, title: string, newTitle?: string) => {
      setLastAction({ code, title, newTitle });
    },
    [],
  );

  return { lastAction, commit, undoLast, dismissUndo, notify };
}
