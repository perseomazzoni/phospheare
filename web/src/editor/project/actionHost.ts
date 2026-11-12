// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { StructuralChange } from "./application/commitFunnel";
import type { TFunction } from "i18next";
import type { ProjectRef, StorageProvider } from "../../storage";
import type {
  DocumentProperties,
  DocumentStructure,
} from "../../project/types";
import type { EditorEngine } from "../views/engine";
import type { UndoableAction } from "../ProjectContext";
import type { JournalKeeper } from "./application/journalKeeper";
import type { MetadataLanes } from "./application/metadataLanes";
import type { JournalStore } from "./application/stores";

/**
 * What the provider gives the actions that change the book: the open
 * project and its writes, the toast's funnel, and the buffer. The actions
 * read every member at call time, so the provider's state stays the one
 * truth.
 */
export interface ActionHost {
  lanes: MetadataLanes<ProjectRef>;
  provider: StorageProvider;
  /**
   * Lands a structural change: files first, metadata second, rollback on
   * a failed write, then the error or the toast. Resolves to whether it
   * landed.
   */
  commit: (
    next: DocumentStructure,
    action: Omit<UndoableAction, "undo">,
    applyFiles?: () => Promise<void>,
    revertFiles?: () => Promise<void>,
    options?: {
      undo?: boolean;
      writeStructure?: boolean;
      writeRecords?: boolean;
      binEdit?: StructuralChange["binEdit"];
    },
  ) => Promise<boolean>;
  /** Queues a job on the properties lane, built on the latest properties. */
  enqueuePropsWrite: (
    target: ProjectRef,
    job: (
      latest: DocumentProperties,
    ) => DocumentProperties | null | Promise<DocumentProperties | null>,
  ) => Promise<void>;
  /** Drops a node's summary binding. */
  clearSummary: (nodeId: string) => Promise<void>;
  setError: (error: string | null) => void;
  t: TFunction;
  journals: JournalKeeper<ProjectRef>;
  journalStore: JournalStore<ProjectRef>;

  // The buffer, which stays in the provider with the engine.
  engine: EditorEngine;
  /** The file the engine's buffer came from. */
  bufferFileRef: React.RefObject<string | null>;
  /** Runs a job after the buffer's save and file moves, one at a time. */
  inBufferLane: <T>(job: () => Promise<T>) => Promise<T>;
  saveActiveFile: () => Promise<boolean>;
  flushJournal: () => Promise<void>;
  /** Opens a file, behind the leave dialog when the buffer has edits. */
  openFile: (
    fileName: string,
    opts?: { caret?: "start" | "end" },
  ) => Promise<void>;
  /** Opens a file, discarding what the buffer holds. */
  proceedTo: (
    fileName: string,
    opts?: { caret?: "start" | "end"; discarded?: boolean },
  ) => Promise<void>;
  /** The buffer lets go of its file: nothing is open. */
  letGoOfBuffer: () => void;
  /** The open file follows a rename. */
  retarget: (from: string, to: string) => void;
}
