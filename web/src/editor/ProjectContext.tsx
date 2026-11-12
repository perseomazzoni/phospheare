// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import LeaveDialog from "./components/LeaveDialog";
import Toast from "./components/Toast";
import type { EditorEngine } from "./views/engine";
import { useEditorServices } from "./services/context";
import type { ProjectRef, StorageProvider } from "../storage";
import { storageErrorMessage } from "../storage/messages";
import { MetadataLanes } from "./project/application/metadataLanes";
import { StatsKeeper } from "./project/application/statsKeeper";
import { usePropertyActions } from "./project/usePropertyActions";
import { useStampedProvider } from "./project/useStampedProvider";
import { useUndoToast } from "./project/useUndoToast";
import { useBuffer } from "./project/useBuffer";
import { useProjectOpen } from "./project/useProjectOpen";
import { useStructureActions } from "./project/useStructureActions";
import { useSnapshotActions } from "./project/useSnapshotActions";
import type { ActionHost } from "./project/actionHost";
import { providerMetadata } from "./project/storageStores";
import { nodeOfFile } from "../project/structure";
import type {
  DocumentProperties,
  DocumentStructure,
  NodeKind,
  SnapshotCatalogue,
  StructureError,
  WritingPrefs,
} from "../project/types";

// ── Project state ────────────────────────────────────────────────────────────
//
// Owns which document is open, what shape it is, and which node is being
// edited. The editor engine knows none of it: this layer hands it markdown and
// takes markdown back.
//
//   Opening is strict. A folder is a project only if it holds a valid
//   `document-properties.json` and a valid `document-structure.yaml` that
//   agrees with what is in `document/`. Anything else is refused with a
//   reason.
//
//   Structure is saved immediately. Every add, rename, move and remove writes
//   the yaml at once, so unsaved changes means one thing: the open editor
//   buffer. The cost is an undo, which is `lastAction`.
//
//   Context is split. State (what is open and its shape), actions (the
//   callbacks, every one stable), the toast (the undo bar) and the last write
//   are separate contexts, so a new undo or a status flip re-renders only the
//   tree panel, never the writing surface that hosts it.
//
// The shell decides which project is open: the route resolves a provider and
// a key and hands them down, and the editor cannot change the project it is
// given.

export type ProjectStatus =
  | "idle"
  | "loading"
  | "ready"
  /** The folder is a project, but a damaged one. */
  | "invalid"
  | "error";

/** A structural change that can be taken back, offered by the undo toast. */
export interface UndoableAction {
  /** i18n key for the toast: 'moved', 'renamed', 'added', 'removed'. */
  code: string;
  /** The writer's own name for the thing the toast speaks about: a display
   * title, never a file name. */
  title: string;
  /** The second name of a rename toast ('Renamed "A" to "B"'). */
  newTitle?: string;
  /** How many nodes the change touched, for a toast that counts them ('Moved
   * 3 sections'). Absent when the toast names its one node instead. */
  count?: number;
  /** How to take the change back. Absent for the undo-less class (adoption,
   * snapshot deletion): the toast speaks and offers no undo. */
  undo?: () => Promise<void>;
}

/** What is open and what shape it is in. Changes on open, reload and edits. */
export interface ProjectState {
  ref: ProjectRef | null;
  structure: DocumentStructure | null;
  props: DocumentProperties | null;
  /** The snapshot records, the bin's among them. */
  catalogue: SnapshotCatalogue | null;
  /** File name of the node open in the editor. */
  activeFile: string | null;
  status: ProjectStatus;
  error: string | null;
  /** Why the folder was refused, when status is 'invalid'. */
  validation: StructureError[];
  /** A project awaiting a click to re-grant permission. */
  pendingRef: ProjectRef | null;
  provider: StorageProvider;
  isSupported: boolean;
  /**
   * The outcome of the most recent `saveActiveFile()`, whoever called it. The
   * bar's save status is built from this rather than a private copy, because
   * a write can land from the leave dialog or the `beforeunload` guard as
   * well as the bar's debounce, and all must show the same "Saved · …".
   */
  lastSave: { ok: boolean; at: number; error: string | null } | null;
  /**
   * Nodes whose on-disk bytes do not equal the stored `contentHash`.
   * Warn-only: a mismatch never refuses the open, it only marks the node. A
   * missing hash is not yet computed, not corrupt; backfill fills it.
   *
   * The hash is over canonicalized text (CRLF to LF, BOM stripped), so line
   * ending churn on Windows does not flag. The next save or backfill persists
   * the fresh hash and clears the entry.
   */
  outOfBand: Set<string>;
}

/** The callbacks. Every one is stable, so consumers never re-render for it. */
export interface ProjectActions {
  reconnect: () => Promise<void>;
  reload: () => Promise<void>;
  openFile: (
    fileName: string,
    opts?: { caret?: "start" | "end" },
  ) => Promise<void>;
  /** Closes the file and returns to the Desk, writing pending work first. */
  closeFile: () => Promise<void>;
  saveActiveFile: () => Promise<boolean>;
  /** Whether the editor holds edits that a reload would discard. */
  hasUnsavedChanges: () => boolean;

  addNode: (
    kind: NodeKind,
    containerId: string | null,
    title: string,
  ) => Promise<void>;
  renameNodeTo: (id: string, title: string) => Promise<void>;
  removeNodeAt: (id: string) => Promise<void>;
  /** Moves one node, or a selection as one block: one write, one undo. */
  moveNodesTo: (
    ids: readonly string[],
    containerId: string | null,
    index: number,
  ) => Promise<void>;
  /** Puts a bin item back at the slot the writer dropped it on. */
  restoreFromBin: (
    id: string,
    containerId: string | null,
    index: number,
  ) => Promise<void>;

  /**
   * Adds a snapshot of the node's adopted file (xy = max+1), titled with what
   * the writer typed, or the default when empty. The caller has settled the
   * buffer first, so the copy reads the adopted file after that save and
   * captures what the writer kept. Resolves to the new snapshot's file, or
   * null when the add was refused or failed.
   */
  addSnapshot: (id: string, title?: string) => Promise<string | null>;
  /**
   * Adopts a snapshot: a yaml pointer swap, then the editor lands in the newly
   * adopted file with a fresh baseline. The caller has settled the buffer, so
   * the post-adopt buffer is the new file, never a stale one that would
   * overwrite it on the next save.
   */
  adoptSnapshot: (
    id: string,
    file: string,
    opts?: { discarded?: boolean },
  ) => Promise<void>;
  /** Re-titles one snapshot: yaml only, undoable. */
  renameSnapshotTitle: (
    id: string,
    file: string,
    title: string,
  ) => Promise<void>;
  /** Bins the file and drops its entry, with no undo. Refused while adopted. */
  deleteSnapshot: (id: string, file: string) => Promise<void>;
  /**
   * Puts a binned snapshot back on its node. False when it cannot go back:
   * the node is gone, or a successor has taken its file name.
   */
  restoreBinnedSnapshot: (nodeId: string, file: string) => Promise<boolean>;

  saveUi: (expanded: string[]) => void;
  /** Changes the project's writing settings (prose size, toggles). */
  setPrefs: (next: Partial<WritingPrefs>) => void;
  bindSummary: (nodeId: string, fileName: string) => Promise<void>;
  /** Drops a node's summary binding. */
  clearSummary: (nodeId: string) => Promise<void>;
  /** Remembers the dock's width: one write per drag, not per frame. */
  setDockWidth: (dockWidth: number) => void;
  setStructureWidth: (structureWidth: number) => void;
  /** Hides the margin's comments, or shows them again. */
  setCommentsHidden: (hidden: boolean) => void;
  /** Remembers the snapshot tab's divider position: one write per drag. */
  setSnapshotSplit: (fraction: number) => void;
  /**
   * Arms a plain feedback toast with no undo, such as the override notice
   * ("Smooth caret is off for this project only."). Structural toasts come
   * from the funnel; this is the one other way to arm one.
   */
  notify: (code: string, title: string, newTitle?: string) => void;
}

/**
 * The undo toast. Its own slice because every structural change arms it, the
 * most volatile state in the provider, and only the tree panel reads it.
 */
interface ProjectToast {
  lastAction: UndoableAction | null;
  undoLast: () => Promise<void>;
  dismissUndo: () => void;
}

/**
 * Every file this editor wrote, each with the stamp of its latest write.
 *
 * Observed at the port rather than reported by each writer: body text,
 * reference documents, conversations and notes write from different call
 * sites, and a signal each must remember to raise stops being raised. The
 * path lets a reader ignore writes it does not care about: the structure
 * panel's search should not re-read a book because the undo journal flushed.
 *
 * Stamps come from one counter that only grows, so writes that land in one
 * render batch or one millisecond each leave their own mark. Its own context,
 * because a save writes several files, and a state change per write would
 * redraw everything that reads the project once per file.
 */
export type WriteStamps = ReadonlyMap<string, number>;

const NO_WRITES: WriteStamps = new Map();

const ProjectStateContext = createContext<ProjectState | null>(null);
const ProjectWriteContext = createContext<WriteStamps>(NO_WRITES);
const ProjectActionsContext = createContext<ProjectActions | null>(null);
const ProjectToastContext = createContext<ProjectToast | null>(null);

export function ProjectProvider({
  engine,
  provider: base,
  projectKey,
  children,
}: {
  engine: EditorEngine;
  /** Resolved by the route, so this layer never sees an unknown id. */
  provider: StorageProvider;
  projectKey: string;
  children: React.ReactNode;
}) {
  const { holdOpenWork, connectionFor, pullUnfinished } = useEditorServices();
  const { provider, writes } = useStampedProvider(base);

  // It takes the name `provider`, so everything below goes through it with no
  // site knowing: this layer's own writes, and the object handed out through
  // `stateValue` that the dock, the reader and the notes panel write through.
  const [structure, setStructure] = useState<DocumentStructure | null>(null);
  const [props, setProps] = useState<DocumentProperties | null>(null);
  const [catalogue, setCatalogue] = useState<SnapshotCatalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();

  const isSupported = provider.isAvailable();

  // The open project, its structure and its properties, ahead of the render
  // that shows them, and the two lanes that write their files. The callbacks
  // read the current document here, so they stay stable as it changes.
  // `structure` and `props` are what the screen draws, and only the lanes set
  // them.
  const [lanes] = useState(
    () =>
      new MetadataLanes<ProjectRef>({
        structure: setStructure,
        properties: setProps,
        catalogue: setCatalogue,
      }),
  );
  const metadata = useMemo(() => providerMetadata(provider), [provider]);

  const message = useCallback(
    (err: unknown): string => storageErrorMessage(err, t, t("storage.io")),
    [t],
  );

  const { lastAction, commit, undoLast, dismissUndo, notify } = useUndoToast({
    lanes,
    metadata,
    message,
    t,
    setError,
  });

  // ── Stats ──────────────────────────────────────────────────────────────────
  //
  // The keeper holds the count, the hash, both backfills and the session
  // baseline. The provider adds when each one runs: a save, the open, the
  // project settling, and the exit.

  const [stats] = useState(() => new StatsKeeper<ProjectRef>(lanes));

  // Two writer classes can collide in one tick on the properties file: a
  // save's stats, stamp and hash, and a settings change. The lane builds each
  // job on the latest properties; the catalogue's lane does the same for the
  // snapshot records.
  const enqueuePropsWrite = useCallback(
    (
      target: ProjectRef,
      job: (
        latest: DocumentProperties,
      ) => DocumentProperties | null | Promise<DocumentProperties | null>,
    ): Promise<void> => lanes.writeProperties(metadata, target, job),
    [lanes, metadata],
  );

  // Fire-and-forget and silent: a lost stamp is a lost convenience, never a
  // lost manuscript, and it must never block unload.
  const settleSessionExit = useCallback(() => {
    void stats.settleExit(metadata);
  }, [stats, metadata]);

  // Routing back to the Library ends the visit, and only this hook sees it,
  // because the provider unmounts with the route. Declared here, beside the
  // callbacks it orders, because the journal's pagehide effect shares it and
  // a dependency array cannot reference a const in its temporal dead zone.
  useEffect(() => {
    return () => {
      settleSessionExit();
    };
  }, [settleSessionExit]);

  // ── Editing one file ───────────────────────────────────────────────────────

  // The buffer is called before the opener it reaches, so these two read the
  // opener through a ref set on every render: stable, and the buffer never
  // sees the opener's records.
  const opener = useRef<{
    clearOutOfBand: (nodeId: string) => void;
    forgetRestore: () => void;
  } | null>(null);
  const clearOutOfBand = useCallback(
    (nodeId: string) => opener.current?.clearOutOfBand(nodeId),
    [],
  );
  const forgetRestore = useCallback(() => opener.current?.forgetRestore(), []);

  // Called after the exit settle, which its pagehide effect shares, and
  // before the settle and open effects below: React runs a component's
  // effects in call order.
  const {
    activeFile,
    lastSave,
    discardPending,
    bufferFileRef,
    inBufferLane,
    journals,
    journalStore,
    journalNotice,
    flushJournal,
    openInto,
    proceedTo,
    openFile,
    saveActiveFile,
    letGoOfBuffer,
    retarget,
    closeFile,
    hasUnsavedChanges,
    leave,
  } = useBuffer({
    engine,
    lanes,
    provider,
    metadata,
    stats,
    message,
    setError,
    holdOpenWork,
    settleSessionExit,
    clearOutOfBand,
    forgetRestore,
  });

  const {
    saveUi,
    setPrefs,
    bindSummary,
    clearSummary,
    setDockWidth,
    setStructureWidth,
    setCommentsHidden,
    setSnapshotSplit,
  } = usePropertyActions({ lanes, enqueuePropsWrite, bufferFileRef });

  // ── Opening ────────────────────────────────────────────────────────────────

  const {
    ref,
    status,
    validation,
    pendingRef,
    outOfBand,
    reconnect,
    reload,
    ...openerHooks
  } = useProjectOpen({
    provider,
    isSupported,
    projectKey,
    lanes,
    engine,
    stats,
    metadata,
    message,
    setError,
    t,
    connectionFor,
    pullUnfinished,
    openInto,
    letGoOfBuffer,
    bufferFileRef,
    dismissUndo,
  });
  opener.current = openerHooks;

  // ── Structural changes ─────────────────────────────────────────────────────

  // The structural and snapshot actions live in `project/`, and reach the
  // provider's state, its funnel and its buffer through this one object.
  const host: ActionHost = {
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
    proceedTo,
    letGoOfBuffer,
    retarget,
  };
  const { addNode, renameNodeTo, removeNodeAt, restoreFromBin, moveNodesTo } =
    useStructureActions(host);

  const {
    addSnapshotAction,
    adoptSnapshotAction,
    renameSnapshotTitleAction,
    deleteSnapshotAction,
    restoreBinnedSnapshot,
  } = useSnapshotActions(host);

  /**
   * Settles this sitting's baseline, once per open.
   *
   * Here rather than on the Desk because it is a fact about the document,
   * and the Desk is not always on screen, so a session started there might
   * never start. `deskLedger.ts` holds where a session's boundary falls.
   */
  useEffect(() => {
    const target = lanes.owner;
    if (!target || !props || status !== "ready") return;
    void stats.settle(metadata, target, props);
  }, [lanes, stats, metadata, props, status]);

  const stateValue = useMemo<ProjectState>(
    () => ({
      ref,
      structure,
      props,
      catalogue,
      activeFile,
      status,
      error,
      validation,
      pendingRef,
      provider,
      isSupported,
      lastSave,
      outOfBand,
    }),
    [
      ref,
      structure,
      props,
      catalogue,
      activeFile,
      status,
      error,
      validation,
      pendingRef,
      provider,
      isSupported,
      lastSave,
      outOfBand,
    ],
  );

  const actionsValue = useMemo<ProjectActions>(
    () => ({
      reconnect,
      reload,
      openFile,
      closeFile,
      saveActiveFile,
      hasUnsavedChanges,
      addNode,
      renameNodeTo,
      removeNodeAt,
      moveNodesTo,
      restoreFromBin,
      addSnapshot: addSnapshotAction,
      adoptSnapshot: adoptSnapshotAction,
      renameSnapshotTitle: renameSnapshotTitleAction,
      deleteSnapshot: deleteSnapshotAction,
      restoreBinnedSnapshot,
      saveUi,
      setPrefs,
      bindSummary,
      clearSummary,
      setDockWidth,
      setStructureWidth,
      setCommentsHidden,
      setSnapshotSplit,
      notify,
    }),
    [
      reconnect,
      reload,
      openFile,
      closeFile,
      saveActiveFile,
      hasUnsavedChanges,
      addNode,
      renameNodeTo,
      removeNodeAt,
      moveNodesTo,
      restoreFromBin,
      addSnapshotAction,
      adoptSnapshotAction,
      renameSnapshotTitleAction,
      deleteSnapshotAction,
      restoreBinnedSnapshot,
      saveUi,
      setPrefs,
      bindSummary,
      clearSummary,
      setDockWidth,
      setStructureWidth,
      setCommentsHidden,
      setSnapshotSplit,
      notify,
    ],
  );

  const toastValue = useMemo<ProjectToast>(
    () => ({ lastAction, undoLast, dismissUndo }),
    [lastAction, undoLast, dismissUndo],
  );

  return (
    <ProjectStateContext.Provider value={stateValue}>
      <ProjectActionsContext.Provider value={actionsValue}>
        <ProjectToastContext.Provider value={toastValue}>
          <ProjectWriteContext.Provider value={writes}>
            {children}
          </ProjectWriteContext.Provider>
          {discardPending && (
            <LeaveDialog
              title={t("leave.title")}
              body={t("leave.body", {
                title: activeFile
                  ? ((lanes.structure
                      ? nodeOfFile(lanes.structure, activeFile)?.title
                      : null) ?? activeFile)
                  : "",
              })}
              onSave={leave.save}
              onStay={leave.stay}
              onSkip={leave.skip}
            />
          )}
          {journalNotice && (
            <div className="rev-notice" role="status">
              {t("history.journalCleared")}
            </div>
          )}
          {/* The undo toast is page-centred, so it renders here and not in
              the tree: that panel's backdrop-filter makes it a containing
              block for fixed positioning and its overflow clips anything
              fixed. */}
          {lastAction && (
            <Toast
              action={lastAction}
              onUndo={() => void undoLast()}
              onDismiss={dismissUndo}
            />
          )}
        </ProjectToastContext.Provider>
      </ProjectActionsContext.Provider>
    </ProjectStateContext.Provider>
  );
}

export function useProjectState(): ProjectState {
  const ctx = useContext(ProjectStateContext);
  if (!ctx)
    throw new Error("useProjectState must be used inside a ProjectProvider");
  return ctx;
}

/** Every file this editor wrote, with the stamp of its latest write. */
export function useWriteStamps(): WriteStamps {
  return useContext(ProjectWriteContext);
}

export function useProjectActions(): ProjectActions {
  const ctx = useContext(ProjectActionsContext);
  if (!ctx)
    throw new Error("useProjectActions must be used inside a ProjectProvider");
  return ctx;
}

export function useProjectToast(): ProjectToast {
  const ctx = useContext(ProjectToastContext);
  if (!ctx)
    throw new Error("useProjectToast must be used inside a ProjectProvider");
  return ctx;
}
