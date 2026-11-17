// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { EvidenceTargets } from "./assistant/evidenceOpener";
import { useBarredSources } from "./assistant/barredSources";
import EditorBar from "./components/EditorBar";
import FindPanel from "./components/FindPanel";
import CharsPanel from "./components/CharsPanel";
import SaveGutter from "./components/SaveGutter";
import RevisionRail from "./components/RevisionRail";
import Desk, { type DeskProps } from "./components/Desk";
import Dock from "./components/Dock";
import DocumentTree from "./tree/DocumentTree";
import {
  EditorSkeleton,
  Scrim,
  StatusNotice,
  ToastHost,
  useToasts,
} from "../ui";
import { EditorEngine } from "./views/engine";
import { viewFor } from "./views/view/registry";
import { useViewHost } from "./viewHost";
import { logEngineFaults } from "./engineLog";
import { selectionFor } from "./searchArrival";
import type { WritingViewHandle } from "./views/view/port";
import {
  ProjectProvider,
  useProjectActions,
  useProjectState,
  type ProjectStatus,
} from "./ProjectContext";
import { filePath } from "../project/naming";
import type { DocumentStructure } from "../project/types";
import { useDesk } from "./useDesk";
import { useDockOver } from "./useDockOver";
import { sessionFor } from "./deskLedger";
import SelectionBubble from "./components/SelectionBubble";
import SelectionBars from "./components/SelectionBars";
import ContextMenu from "./components/ContextMenu";
import CommandBoard from "./components/CommandBoard";
import ShortcutSheet from "./components/ShortcutSheet";
import {
  forPlane,
  loadGlobalEditorSettings,
  settingsOf,
  type ResolvedPrefs,
} from "./writingPreferences";
import { useDecorations, FRAME_GEOMETRY } from "../theme/editor";
import { CropMarks } from "./decorations/presentation/CropMarks";
import { Folio, RunningHead } from "./decorations/presentation/RunningHead";
import { runningHeadOf } from "./decorations/domain/runningHead";
import { useNarrow, usePhone } from "./useNarrow";
import { useHenosis } from "./henosis/useHenosis";
import { useBackCloses } from "../ui/overlay/useBackCloses";
import { OverlayBackgroundProvider } from "../ui/overlay/background";
import type { ProjectRef, StorageProvider } from "../storage";
import { Assistant } from "../ai";
import { appLog, describeError } from "../log";
import { useEditorServices } from "./services/context";
import { useEditorAssistant } from "./workspace/useEditorAssistant";
import { useSearchArrival } from "./workspace/useSearchArrival";
import { useMarginComments } from "./workspace/useMarginComments";
import { useReferenceSession } from "./workspace/useReferenceSession";
import { useWorkspaceSave } from "./workspace/useWorkspaceSave";
import { useWorkspaceKeys } from "./workspace/useWorkspaceKeys";
import { useEditorCommands } from "./workspace/useEditorCommands";
import { useSelectionSurfaces } from "./workspace/useSelectionSurfaces";
import { useComparison } from "./workspace/useComparison";
import { useDock, useDockNavigation } from "./workspace/useDock";
import { useWorkspaceLayout } from "./workspace/useWorkspaceLayout";
import { useBarPin } from "./workspace/useBarPin";
import { useOpenNode } from "./workspace/useOpenNode";
import { useBarPanels } from "./workspace/useBarPanels";
import { useShellRedraw } from "./workspace/useShellRedraw";
import {
  WorkspaceTitlebar,
  type OpenMark,
} from "./workspace/WorkspaceTitlebar";
import { ComparingChrome } from "./workspace/ComparingChrome";
import { LeaveGuard } from "./workspace/LeaveGuard";
import { ReferenceLeaveDialog } from "./workspace/ReferenceLeaveDialog";
import { CommentsProvider, useProjectComments } from "./comments/host/comments";
import Margin from "./comments/presentation/Margin";

/**
 * Whether the open pipeline has settled far enough for the editor chrome to
 * stand. Entering a project shows nothing interactive until it is loaded, and
 * the prose stays out of reach until a Section or Part is opened; the Desk
 * owns that state once loaded. So only `loading` and `idle` hold the chrome
 * back, and every settled status renders, because `invalid` speaks through
 * the tree's own state card.
 */
export function editorBooted(status: ProjectStatus): boolean {
  return status !== "loading" && status !== "idle";
}

/**
 * The editor, for one project. Takes a resolved provider rather than an id,
 * so a URL naming a backend that does not exist is settled before anything
 * mounts and the layers below never see one.
 */
export function EditorScreen({
  provider,
  projectKey,
}: {
  provider: StorageProvider;
  projectKey: string;
}) {
  const engineRef = useRef(new EditorEngine());
  useEffect(() => logEngineFaults(engineRef.current), []);

  return (
    <ProjectProvider
      engine={engineRef.current}
      provider={provider}
      projectKey={projectKey}
    >
      <EditorBoot engine={engineRef.current} />
    </ProjectProvider>
  );
}

/**
 * Holds the workspace behind the skeleton until the project has loaded.
 * Without this gate the prose mounts over an empty engine during the open
 * pipeline, an editable blank page that loses keystrokes until the real
 * content arrives underneath them.
 */
function EditorBoot({ engine }: { engine: EditorEngine }) {
  const { status, pendingRef } = useProjectState();
  // A lapsed permission parks the project in `pendingRef` at `idle`. That is a
  // question to answer, not a hold, and its card lives in the tree, so the
  // chrome renders for it.
  if (!editorBooted(status) && !pendingRef) return <EditorSkeleton />;
  return <WorkspaceBridge engine={engine} />;
}

/**
 * The thin reader between the provider and `Workspace`: the only component
 * in the editor that subscribes to project state, so `Workspace` does not.
 * Every prop it hands down keeps its identity until an input changes, so
 * `Workspace` re-renders on the state it is given and not on the rest: a
 * status flip, an error or an out-of-band mark passes it by. A properties
 * write still reaches it, through the Desk's `props`.
 */
function WorkspaceBridge({ engine }: { engine: EditorEngine }) {
  // The route's services decide who the editor acts for. The demo route
  // keeps every real model out: its wiring answers from the static demo
  // model, even for a signed-in visitor.
  const services = useEditorServices();
  const { ref, activeFile, structure, props, provider, lastSave } =
    useProjectState();
  const {
    saveActiveFile,
    openFile,
    closeFile,
    setDockWidth,
    setStructureWidth,
    setCommentsHidden,
    bindSummary,
    clearSummary,
  } = useProjectActions();
  // Bound here, where the project store is read: `Workspace` never
  // subscribes to it.
  const goToDesk = useCallback(() => void closeFile(), [closeFile]);
  const desk = useDesk(provider, ref, structure, props, activeFile);

  // The settings panel and the prose are siblings, so the resolved project
  // settings travel down from here. `props` changes on every write, but the
  // memo keeps the settings identity stable unless a field changed. The
  // writer's global Editor Settings are the defaults a project with no
  // override inherits.
  const phone = usePhone();
  const settings = useMemo(
    // `forPlane` has the last word: two preferences are ignored on a phone
    // without touching the stored value, so the writer's desk is unaffected
    // and the panel still shows what they chose.
    () => forPlane(settingsOf(props, loadGlobalEditorSettings()), phone),
    // The globals live in the prefs cache, and a change in Settings is picked
    // up on the next visit like every other preference; reading them fresh on
    // each props change would re-resolve on every keystroke for nothing.
    [props, phone],
  );

  const { activeNode, openedSavedAt, openMark, openTitle } = useOpenNode(
    structure,
    props,
    activeFile,
  );

  // The margin's comments: one service per open project, read for the live
  // nodes only. Built here and handed down by context, so the margin, the
  // structure panel and the assistant share one instance; harnesses that
  // render `Workspace` bare get none and draw no margin.
  const comments = useProjectComments(provider, ref, structure);

  // The sources the writer barred from the assistant: the dock draws the
  // list and toggles it, and the assistant reads the file through the same
  // service.
  const { service: barredSources, ids: barredSourceIds } = useBarredSources(
    provider,
    ref,
    structure,
  );
  const setSourceBarred = useCallback(
    (sourceId: string, barred: boolean) =>
      void barredSources?.setBarred(sourceId, barred).catch((err: unknown) =>
        appLog.error("ai", "A source could not be barred or let back in.", {
          barred,
          ...describeError(err),
        }),
      ),
    [barredSources],
  );

  // ── The AI composition root ────────────────────────────────────────────────
  const { assistant, registerEvidence } = useEditorAssistant({
    engine,
    provider,
    projectRef: ref,
    structure,
    props,
    activeFile,
    activeNode,
    openFile,
    bindSummary,
    comments,
    barredSources,
    services,
  });

  // Every prop below keeps its identity until an input it is built from
  // changes, or `Workspace`'s memo never holds.
  const onSummaryDeleted = useCallback(
    (nodeId: string) => void clearSummary(nodeId),
    [clearSummary],
  );
  const deskProps = useMemo<DeskProps | null>(
    () =>
      structure && props
        ? {
            structure,
            props,
            ...desk,
            // Settled and persisted by the provider on open; the same
            // arithmetic against the same clock, so a Desk that renders
            // before the write lands still shows the right sitting.
            session: sessionFor(props.ui.session, props.stats, Date.now()),
            onOpen: (fileName: string, resume?: boolean) =>
              openFile(fileName, { caret: resume ? "end" : "start" }),
          }
        : null,
    [structure, props, desk, openFile],
  );
  const language = props?.document.language ?? null;
  const dockProps = useMemo(
    () => ({
      provider,
      assistant,
      activeNode,
      structure,
      barredSourceIds,
      onBarSource: setSourceBarred,
      // The project's language, not the UI's: new reference documents are
      // seeded in the language the manuscript is written in.
      language,
    }),
    [
      provider,
      assistant,
      activeNode,
      structure,
      barredSourceIds,
      setSourceBarred,
      language,
    ],
  );

  return (
    <CommentsProvider service={comments}>
      <Workspace
        engine={engine}
        projectRef={ref}
        activeFile={activeFile}
        saveActiveFile={saveActiveFile}
        onGoToDesk={goToDesk}
        lastSave={lastSave}
        openedSavedAt={openedSavedAt}
        openTitle={openTitle}
        openMark={openMark}
        settings={settings}
        dockWidth={props?.ui.dockWidth ?? null}
        onDockResize={setDockWidth}
        structureWidth={props?.ui.structureWidth ?? null}
        onStructureResize={setStructureWidth}
        commentsHidden={props?.ui.commentsHidden ?? false}
        onCommentsHidden={setCommentsHidden}
        registerEvidence={registerEvidence}
        onSummaryDeleted={onSummaryDeleted}
        desk={deskProps}
        dock={dockProps}
      />
    </CommentsProvider>
  );
}

export const Workspace = memo(function Workspace({
  engine,
  projectRef,
  activeFile,
  saveActiveFile,
  lastSave = null,
  openedSavedAt = null,
  openTitle = null,
  openMark = null,
  onGoToDesk,
  desk,
  dock,
  settings,
  dockWidth: dockWidthProp = null,
  onDockResize,
  structureWidth: structureWidthProp = null,
  onStructureResize,
  commentsHidden: commentsHiddenProp = false,
  onCommentsHidden,
  registerEvidence,
  onSummaryDeleted,
}: {
  engine: EditorEngine;
  projectRef: ProjectRef | null;
  activeFile: string | null;
  saveActiveFile: () => Promise<boolean>;
  /**
   * Closes the open file and lands on the Desk: what the crumb's project name
   * does when pressed. Absent, the crumb still draws and goes nowhere.
   */
  onGoToDesk?: () => void;
  /**
   * The outcome of the most recent `saveActiveFile()` from anywhere: the
   * leave dialogs, the snapshot gate and a sign-out call it directly,
   * bypassing this component's `runSave`.
   */
  lastSave?: { ok: boolean; at: number; error: string | null } | null;
  /**
   * When this file was last written (`stats.perNode`). Seeds the bar's
   * "Saved · …" when a section opens, autosave on or off.
   */
  openedSavedAt?: string | null;
  /**
   * The open file's node display name, resolved by the bridge: the titlebar
   * and the leaving dialog speak the writer's words, never a file name.
   */
  openTitle?: string | null;
  /**
   * What the structure panel draws before the open node's name, the page
   * glyph and the number, so the crumb names it as the panel does.
   */
  openMark?: OpenMark | null;
  settings: ResolvedPrefs;
  /** Drawn instead of the prose when no file is open. */
  desk?: DeskProps | null;
  /** What the dock needs that only the project layer holds. */
  dock?: {
    provider: StorageProvider;
    assistant?: Assistant | null;
    activeNode?: { id: string; title: string } | null;
    structure?: DocumentStructure | null;
    /** The project's `document.language`, for seeding reference templates. */
    language?: string | null;
    /**
     * The project's standing list of sources the assistant may not read, and
     * the way to change it. A rule about the book, so it travels with the
     * project rather than a chat (`DocumentProperties.assistant`).
     */
    barredSourceIds?: readonly string[];
    onBarSource?: (sourceId: string, barred: boolean) => void;
  } | null;
  /**
   * The dock's width as this project last left it, or null before the project
   * is read. Clamped into the dock's limits when adopted.
   */
  dockWidth?: number | null;
  /** Persists a finished dock resize, once per drag. */
  onDockResize?: (width: number) => void;
  /** Whether this project's comments are hidden (`ui.commentsHidden`). */
  commentsHidden?: boolean;
  /** Persists the writer hiding the comments or showing them again. */
  onCommentsHidden?: (hidden: boolean) => void;
  /**
   * The structure panel's width as this project last left it, or null before
   * the project is read. Clamped into the panel's limits when adopted, as the
   * dock's is.
   */
  structureWidth?: number | null;
  /** Persists a finished panel resize, once per drag. */
  onStructureResize?: (width: number) => void;
  /**
   * The evidence entry points, registered by this surface because it owns the
   * arrival state and the reference face. The AI composition root supplies
   * the other half, opening a manuscript file, through the same object.
   */
  registerEvidence?: (targets: EvidenceTargets) => void;
  /**
   * A summary the writer removed from the reference shelf. Its binding in the
   * properties goes too, or the project still claims a summary exists.
   */
  onSummaryDeleted?: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const services = useEditorServices();
  // Who is signed in, for the titlebar's face and the margin's writer, and
  // the account's key verdicts, for the dock's renewal warning. The route's
  // services decide whose they are (`services/port.ts`).
  const user = services.useFace();
  const remoteProviders = services.useRemoteProviders();
  // The way back leads to the Library, or home from the demo.
  const home = services.exit === "landing";

  // The project's writing view, resolved by name as storage resolves a
  // provider id. The view owns its surface: prose size, `data-desk` and the
  // scroller live in the adapter, so the shell holds no DOM of its own.
  const View = viewFor(settings.typewriter ? "typewriter" : "scroll");
  // Two things change the surface element itself: which view is mounted, and
  // whether the Desk stands in for the prose. Everything else restyles in
  // place; only these two re-bind the surface listeners. Hoisted above the
  // effects, because the selection-bubble effect keys on it.
  const viewKey = `${settings.typewriter ? "tw" : "sc"}:${!activeFile && desk ? "desk" : "prose"}`;

  // The mounted view's handle: the search arrival and the selection's
  // surfaces reach the prose through it.
  const viewRef = useRef<WritingViewHandle>(null);

  // ── The account face ───────────────────────────────────────────────────────
  //
  // The face says who is signed in and does nothing else. It is not a button,
  // takes no focus and answers no press: a control that looks pressable and
  // opens nothing is worse than none. Account and storage are shelf concerns.

  // Whether there is an Assistant at all. The bridge builds none for the demo,
  // and every way into it keys on this being null, never on the route.
  const assistant = dock?.assistant ?? null;

  // ── The margin's comments ──────────────────────────────────────────────────
  const {
    commentNodeId,
    commentsHidden,
    marginRoom,
    handleComments,
    marginWalk,
    walkable,
    previousComment,
    nextComment,
    commentDraft,
    setCommentDraft,
    commentOnSelection,
    personaFaces,
    marginAnswers,
  } = useMarginComments({
    engine,
    activeFile,
    activeNodeId: dock?.activeNode?.id ?? null,
    storedHidden: commentsHiddenProp,
    onCommentsHidden,
    assistant,
  });

  const decorations = useDecorations();
  const narrow = useNarrow();
  // The open page's running head and folio, where the theme prints them.
  const heads =
    decorations.pageHead === "running" || decorations.pageFoot === "folio";
  // The Desk is the book's half-title: its head names the book alone.
  const pageHead = useMemo(
    () =>
      !heads
        ? null
        : !activeFile
          ? { book: projectRef?.name ?? "", part: null, folio: null }
          : dock?.structure && dock.activeNode
            ? runningHeadOf(
                dock.structure,
                dock.activeNode.id,
                projectRef?.name ?? "",
              )
            : null,
    [heads, activeFile, dock?.structure, dock?.activeNode, projectRef],
  );
  // Narrow moves a column over the others; phone takes the chrome off the
  // top of the window. Both are published on the shell so the stylesheet
  // answers either without a second copy of the media query.
  const phone = usePhone();
  // ── The frame ──────────────────────────────────────────────────────────────
  // The keyboard inset, both panel widths, the structure panel's fold and
  // peek, and the dock's cap and detent against the window.
  const {
    keyboard,
    dockW,
    panelW,
    panelCollapsed,
    peek,
    rail,
    setPeekWanted,
    dockCap,
    dockDetent,
    dockWidth,
    toggleCollapse,
    openStructure,
    collapsePanel,
  } = useWorkspaceLayout({
    narrow,
    phone,
    dockWidth: dockWidthProp,
    structureWidth: structureWidthProp,
    onDockResize,
    onStructureResize,
  });
  const viewHost = useViewHost(phone, keyboard);

  // On Android, back is the universal dismiss; unanswered, a back press over
  // the structure sheet leaves the project. Each overlay holds one history
  // entry while open, popped whichever way it closes. The command board and
  // the shortcut sheet need the same, since their Scrim backdrop and Escape
  // are not the platform's back gesture.
  useBackCloses(phone && !panelCollapsed, collapsePanel);

  // ── The dock ───────────────────────────────────────────────────────────────
  // Called here so its back-gesture hold keeps its place among the others:
  // the history entries stack in the order the holds are taken.
  const dockState = useDock({ assistant, phone });
  const {
    dockOpen,
    setDockOpen,
    setDockFace,
    face,
    askRuns,
    closeDock,
    refCards,
    handleRefCards,
    quote,
    setQuote,
    aiDraftsRef,
    handleAiDrafts,
  } = dockState;

  // ── The bar's panels ───────────────────────────────────────────────────────
  // After the dock, for the same order of history entries.
  const {
    find,
    findOpen,
    findFocused,
    charsOpen,
    sheetOpen,
    palette,
    openFind,
    toggleFind,
    openCharacters,
    toggleCharacters,
    openSheet,
    closeSheet,
    openPalette,
    closePalette,
    reportFindOpen,
    reportFindFocus,
  } = useBarPanels();

  // The documents the reader faces hold and the reference edit session.
  const {
    referenceFile,
    noteFile,
    refEdit,
    refDirty,
    refLeave,
    openNotesTab,
    closeDeletedNote,
    draftRefEdit,
    cancelRefEdit,
    saveRefEdit,
    writeDraftForExit,
    restoreOnLeave,
    requestOpenReference,
    requestOpenNote,
    requestStartRefEdit,
    requestWriteSection,
    requestFace,
    confirmLeave,
    cancelLeave,
  } = useReferenceSession({
    provider: dock?.provider,
    projectRef,
    onSummaryDeleted,
    setDockFace,
    setDockOpen,
    holdOpenWork: services.holdOpenWork,
  });

  const {
    askCalls,
    handleAsk,
    askAbout,
    onDockFace,
    openChatAt,
    openReferenceTab,
    toggleSnapshot,
  } = useDockNavigation({ dock: dockState, assistant, requestFace });

  // ── The bar pin ────────────────────────────────────────────────────────────
  const { foldEngaged, barStack, barPin, pinBar, onFoldEngaged } = useBarPin();

  const shell = useRef<HTMLDivElement>(null);
  const dockOver = useDockOver(shell);

  // ── The review modes ───────────────────────────────────────────────────────
  // The snapshot comparison and the history rail, which never stand together.
  const {
    railOpen,
    closeRail,
    toggleRail,
    compareInfo,
    compareExits,
    handleCompare,
  } = useComparison({
    engine,
    projectRef,
    provider: dock?.provider,
    activeFile,
    dockOpen,
    face,
    setDockOpen,
  });

  // Henosis: the writer's opt-in, published on the shell as
  // `data-henosis` for `editor.css`. It stands down for anything open that it
  // must not hide (find, the shortcut sheet, the palette, a running answer,
  // either review mode) and holds the caret's line only in the scroll view,
  // since typewriter already holds it. `settings.henosis` is off on the phone
  // plane (`forPlane`).
  useHenosis(shell, {
    enabled: settings.henosis,
    afterS: settings.henosisAfter,
    fadeS: settings.henosisFade,
    pauseS: settings.henosisPause,
    standDown:
      findOpen ||
      sheetOpen ||
      palette !== null ||
      askRuns ||
      engine.isInDiff ||
      railOpen,
    holdCaret: !settings.typewriter,
    said: { full: t("henosis.full"), back: t("henosis.back") },
  });

  // ── The search arrival ─────────────────────────────────────────────────────
  // The find's query and options, an arrival from the project search or the
  // assistant's evidence, and the marks the writing surface paints for them.
  const {
    arrival,
    handleFindInText,
    endFind,
    marks,
    searchQuery,
    setSearchQuery,
    handleSearchResult,
    handleSearchOptionsChange,
  } = useSearchArrival({
    engine,
    viewRef,
    activeFile,
    findOpen,
    registerEvidence,
    requestOpenReference,
  });

  // ── The selection's surfaces ───────────────────────────────────────────────
  // The repetition highlight, the bubble's anchor and the prose context menu.
  const {
    selected,
    setSelected,
    contextMenu,
    closeContextMenu,
    selectionHighlightText,
    selectionExactText,
    showRepetitions,
    handleClearHighlights,
    dismissClipboardSurfaces,
    notePointer,
    handleContextMenu,
    getSurface,
    contextMenuItems,
  } = useSelectionSurfaces({ engine, viewRef, viewKey, findOpen });

  // The transient half of a failed write, on the shell's generic toast host,
  // not the editor's own `Toast`, which says what a structural change did. A
  // failed save is neither structural nor undoable.
  const toasts = useToasts();
  // `useToasts` returns a fresh object each render, so depending on it would
  // rebuild every callback below each render. `post` is stable, and the only
  // part needed.
  const { post: postToast } = toasts;

  // Which of this project's files still owe the remote something. Per path,
  // not per project: `isPending` would show `cached` on the open Section
  // whenever anything in the book was queued, true of the project and false
  // of the sentence the writer reads. The account-wide fact is
  // `DeviceNotice`'s, which stays quiet unless the writer can act on it.
  const queuedPaths = services.usePendingPaths(projectRef);
  const queued = activeFile ? queuedPaths.has(filePath(activeFile)) : false;

  // ── Saving ─────────────────────────────────────────────────────────────────
  // The save chip, autosave, the exit saves and the lost-path restore.
  const { save, saveState, runSave } = useWorkspaceSave({
    engine,
    projectRef,
    activeFile,
    saveActiveFile,
    lastSave,
    openedSavedAt,
    autosave: settings.autosave,
    autosaveDelay: settings.autosaveDelay,
    queued,
    postToast,
    writeDraftForExit,
    services,
  });

  useShellRedraw({
    engine,
    find,
    clearHighlights: handleClearHighlights,
    postToast,
  });

  // ── The keyboard ───────────────────────────────────────────────────────────
  useWorkspaceKeys({
    engine,
    runSave,
    toggleSnapshot,
    toggleFind,
    openSheet,
    openPalette,
  });

  const openTitleShown = activeFile ? openTitle : null;

  // The way-back control uses one string three times in the titlebar (the
  // link's aria-label, its tooltip, and the nudge), so the locale never
  // diverges within the bar. When the way back leads home, the target is "/"
  // and the label is "Back".
  const backToLibraryLabel = t(
    home ? "titlebar.back" : "titlebar.backToLibrary",
  );

  // ── Where the dock stands ──────────────────────────────────────────────────
  //
  // One element, two homes. On a desk it is a column sharing the width, or a
  // sheet over the prose below `NARROW_AT`; either way a sibling of the
  // manuscript, mounted while shut so it can animate closed, which
  // conditional rendering cannot.
  //
  // On the phone plane it is a full screen on the shared scrim, as the
  // structure panel is: at 375px a 340px panel lies over the prose.
  // It gives up the closing morph there, since the scrim unmounts, and gains
  // the focus trap, the inert manuscript, Escape, the backdrop and the back
  // gesture.

  // The host behind a provider id, such as openrouter.ai, for the sentences
  // that name where the writer's credit lives.
  const hostOf = (id: string) => remoteProviders?.[id]?.upstreamHost ?? id;
  const dockPanel = dock ? (
    <Dock
      remoteProviders={remoteProviders}
      onNotify={postToast}
      open={dockOpen}
      face={face}
      onFace={onDockFace}
      askWaiting={askCalls}
      askRunning={askRuns}
      onClose={closeDock}
      provider={dock.provider}
      projectRef={projectRef}
      structure={dock.structure ?? null}
      language={dock.language ?? null}
      reference={face === "notes" ? noteFile : referenceFile}
      activeFile={activeFile}
      activeNode={dock.activeNode ?? null}
      quote={quote}
      onQuote={setQuote}
      assistant={assistant}
      queuedPaths={queuedPaths}
      aiDrafts={aiDraftsRef.current}
      onAiDrafts={handleAiDrafts}
      onCompare={handleCompare}
      compareExits={compareExits}
      editing={refEdit}
      onStartEdit={requestStartRefEdit}
      onWriteSection={requestWriteSection}
      onDraft={draftRefEdit}
      onCancelEdit={cancelRefEdit}
      onSaveEdit={saveRefEdit}
      width={dockWidth}
      maxWidth={dockCap}
      detent={dockDetent}
      onResize={dockW.onResize}
      onResizeEnd={dockW.onResizeEnd}
      onResizeCancel={dockW.onResizeCancel}
      onOpenReference={requestOpenReference}
      onOpenNote={requestOpenNote}
      onDeletedNote={closeDeletedNote}
      onDeletedReference={closeDeletedNote}
      barredSourceIds={dock.barredSourceIds}
      onBarSource={dock.onBarSource}
      expandedCards={refCards}
      onExpandedCardsChange={handleRefCards}
    />
  ) : null;

  // What the structure panel takes on either plane: the phone's sheet and
  // the desk's column differ only in how they fold, size and lead back.
  const treeProps = {
    hostOf,
    onOpenReference: requestOpenReference,
    onOpenNotesTab: openNotesTab,
    onOpenReferenceTab: openReferenceTab,
    onOpenChat: openChatAt,
    assistant,
    onFindInText: handleFindInText,
    arrival,
    onEndFind: endFind,
    save: save.state,
    pendingPaths: queuedPaths,
  };

  const commands = useEditorCommands(engine, {
    onFind: () => openFind(),
    onChars: openCharacters,
    onShortcuts: openSheet,
    onSave: () => {
      void runSave();
    },
    canSave: !!activeFile,
    // The places the bar opens are in the palette too, five with an
    // Assistant and four without: the phone's six-slot bar carries none of
    // them, and the palette is where everything else goes.
    onAsk: handleAsk,
    askWaiting: askCalls,
    onSnapshots: toggleSnapshot,
    onComments: handleComments,
    commentsHidden,
    onPreviousComment: walkable ? previousComment : undefined,
    onNextComment: walkable ? nextComment : undefined,
    onHistory: toggleRail,
    onNotes: openNotesTab,
    onReference: openReferenceTab,
  });

  return (
    // ── Out of reach behind a modal ──────────────────────────────────────────
    //
    // The shell is registered as the overlay background, so a dialog makes
    // the manuscript inert rather than only dimming it: not tabbable, not
    // clickable through gaps, and not read by a screen reader. The shell is
    // the right element: every overlay is portalled to `<body>` outside it,
    // and the toast, rendered by the provider above it, stays reachable,
    // since an undo is often why a sheet was opened.
    <OverlayBackgroundProvider value={shell}>
      <div
        ref={shell}
        className="editor-shell"
        data-dock={dockOpen ? "1" : "0"}
        data-dock-over={dockOver.over ? "1" : "0"}
        data-dock-settled={dockOver.settled ? "1" : "0"}
        data-margin={marginRoom ? "1" : "0"}
        data-narrow={narrow ? "1" : "0"}
        data-phone={phone ? "1" : "0"}
        data-rail={rail ? "1" : "0"}
        data-peek={peek ? "1" : "0"}
        data-fold-engaged={foldEngaged ? "1" : "0"}
        data-resizing-dock={dockW.resizing ? "1" : "0"}
        data-resizing-panel={panelW.resizing ? "1" : "0"}
        style={
          {
            "--dock-w": `${dockWidth}px`,
            // The panel's width, emitted whole, the rail's 52 included: an
            // inline custom property beats a rule, so with the writer's width
            // from JS the rail's cannot stay in the stylesheet.
            //
            // The fold's number, not the face's: a peek draws the panel wide
            // over the prose and must not move the column it floats over.
            "--panel-w": `${panelCollapsed ? FRAME_GEOMETRY.railPanelW : panelW.width}px`,
            // A peek draws the panel at the writer's own width, as it would
            // look pinned open.
            "--panel-open-w": `${panelW.width}px`,
          } as CSSProperties
        }
        onPointerDownCapture={notePointer}
        onContextMenu={handleContextMenu}
      >
        {/* Henosis's polite line, written by the hook on the way into full
            and back. A permanent region outside everything Henosis
            hides: a hidden region is out of the accessibility tree, and a
            region mounted with its first words is unreliably heard. */}
        <span
          className="ui-visually-hidden"
          aria-live="polite"
          data-henosis-live
        />
        {decorations.pageCorners === "crop" && <CropMarks />}
        <View
          ref={viewRef}
          engine={engine}
          host={viewHost}
          proseSize={settings.proseSize}
          focus={settings.focus}
          smoothCaret={settings.smoothCaret}
          search={marks}
          selection={selectionFor(
            {
              text: selectionHighlightText,
              exactText: selectionExactText,
              showRepetitions,
            },
            marks,
          )}
          searchOpen={findOpen}
          onClearHighlights={handleClearHighlights}
          gutter={(editorEl, surfaceEl) => (
            <>
              <SaveGutter
                engine={engine}
                editor={editorEl}
                surface={surfaceEl}
                failed={saveState === "failed"}
              />
              {!commentsHidden && (
                <Margin
                  engine={engine}
                  editor={editorEl}
                  surface={surfaceEl}
                  nodeId={commentNodeId}
                  personas={personaFaces}
                  writer={
                    user ? { name: user.name, avatarUrl: user.avatarUrl } : null
                  }
                  // The open dock lies over the surface's right on the wide
                  // plane (`.ed-dock`: `--panel-left` in from the edge,
                  // `--dock-w` wide); narrow and phone draw it as a sheet.
                  covered={
                    dockOpen && !narrow
                      ? dockWidth + FRAME_GEOMETRY.panelLeft
                      : 0
                  }
                  draft={commentDraft}
                  onDraftDone={() => setCommentDraft(null)}
                  onWriterEntry={marginAnswers.onWriterEntry}
                  replyState={marginAnswers.replyState}
                  walk={marginWalk}
                />
              )}
            </>
          )}
          frame={
            // A stand-in with no Desk to build has no book to head.
            pageHead && (activeFile || desk)
              ? {
                  head:
                    decorations.pageHead === "running" ? (
                      <RunningHead head={pageHead} />
                    ) : undefined,
                  foot:
                    decorations.pageFoot === "folio" ? (
                      <Folio head={pageHead} />
                    ) : undefined,
                }
              : undefined
          }
          desk={
            !activeFile ? (
              desk ? (
                <Desk
                  {...desk}
                  spineStyle={decorations.spine}
                  onBrowse={panelCollapsed ? openStructure : undefined}
                />
              ) : (
                // Settled with no Desk to build: permission parked in
                // `pendingRef`, or a refused folder. The prose must not face
                // the writer here either, an editable blank page over an
                // empty engine. A bare stand-in puts the surface
                // in desk mode (`data-desk` hides the paper), and the tree's
                // state card carries the words.
                <div className="ed-boot-standin" aria-hidden="true" />
              )
            ) : undefined
          }
        />

        {/* The snapshot diff's chrome: the two lenses at the command bar's
          level, and below them the legend card. Text over live marks needs
          a ground the marks cannot bleed through, so the legend is a card.
          Only the snapshot comparison shows it: the rail's walk never takes the
          lenses. */}
        {engine.inSnapshotDiff && compareInfo && (
          <ComparingChrome engine={engine} />
        )}

        {/* Document structure, on the same plane as the bar.

          On the phone plane it is a modal sheet: a 248px panel over a 375px
          screen covers the prose rather than standing beside it, so it takes
          a scrim, a focus trap, an inert manuscript behind, and Escape, the
          backdrop and the back gesture to close it.

          It veils rather than slides: `base.css` refuses arrival from
          off-screen, since an element flying in from outside the window comes
          from nowhere the writer was looking, and a sheet is no exception. */}
        {phone ? (
          <Scrim
            open={!panelCollapsed}
            place="start"
            className="doc-tree-sheet"
            label={t("tree.panelLabel")}
            onClose={collapsePanel}
          >
            <DocumentTree
              {...treeProps}
              onToggleCollapse={collapsePanel}
              sheet
              backTo={home ? "/" : "/app"}
              backLabel={backToLibraryLabel}
            />
          </Scrim>
        ) : (
          <DocumentTree
            {...treeProps}
            rail={rail}
            peek={peek}
            onPeek={setPeekWanted}
            onToggleCollapse={toggleCollapse}
            width={panelW.width}
            onResize={panelW.onResize}
            onResizeEnd={panelW.onResizeEnd}
            onResizeCancel={panelW.onResizeCancel}
          />
        )}

        {/* The revision rail: no chrome until the history button or
          Ctrl+Shift+H asks for it. Its state lives here so the bar's button
          presses with it. */}
        <RevisionRail
          engine={engine}
          activeFile={activeFile}
          shellRef={shell}
          open={railOpen}
          onToggle={toggleRail}
          onClose={closeRail}
        />

        {/* Floating chrome: a fixed, transparent overlay whose children
          manage their own pointer events. */}
        <div className="chrome">
          <WorkspaceTitlebar
            home={home}
            backLabel={backToLibraryLabel}
            projectName={projectRef ? projectRef.name : null}
            onGoToDesk={onGoToDesk}
            openTitle={openTitleShown}
            openMark={openMark}
            onShortcuts={openSheet}
            onPalette={openPalette}
            user={user}
          />

          {/* The bar formats a selection in an open document, so it mounts
            once a Section is open, the Desk's own boundary. It stands down
            while either review mode owns the screen: the snapshot comparison
            and the history walk are read-only, the walk's row button carries
            its one command, and a comparison's edits are clicks on marks.
            `isInDiff` is true in both modes; `railOpen` covers the one
            render before its effect. */}
          {activeFile && !engine.isInDiff && !railOpen && (
            <FindPanel
              engine={engine}
              ref={find}
              initialQuery={searchQuery ?? ""}
              fieldInPanel={phone}
              onQueryChange={setSearchQuery}
              onResult={handleSearchResult}
              onOptionsChange={handleSearchOptionsChange}
              onOpenChange={reportFindOpen}
              onFocusChange={reportFindFocus}
            >
              {({ segment, panel }) => (
                <div
                  className="bar-row"
                  style={
                    barPin === null
                      ? undefined
                      : ({ "--bar-pin": `${barPin}px` } as CSSProperties)
                  }
                >
                  <div
                    className="bar-stack"
                    ref={barStack}
                    data-pinned={barPin === null ? undefined : "1"}
                    onPointerEnter={pinBar}
                  >
                    <EditorBar
                      engine={engine}
                      find={segment}
                      panelOpen={findOpen || charsOpen}
                      findOpen={findOpen}
                      findFocused={findFocused}
                      charsOpen={charsOpen}
                      // The phone bar's first and fifth slots. The desktop
                      // bar never renders them: the panel carries its own
                      // toggle and the palette has the titlebar's button.
                      onOpenStructure={openStructure}
                      onOpenPalette={() => openPalette("board")}
                      onToggleChars={toggleCharacters}
                      askOpen={dockOpen && face === "ask"}
                      askWaiting={askCalls}
                      onToggleAsk={handleAsk}
                      snapshotOpen={dockOpen && face === "snapshot"}
                      onToggleSnapshot={toggleSnapshot}
                      commentsShown={!commentsHidden}
                      onToggleComments={handleComments}
                      onPreviousComment={walkable ? previousComment : undefined}
                      onNextComment={walkable ? nextComment : undefined}
                      historyOpen={railOpen}
                      onToggleHistory={toggleRail}
                      save={save}
                      onFoldEngaged={onFoldEngaged}
                    />

                    {/* A failed write says so in words, which the chip cannot:
                        below the narrow breakpoint `.ed-save-label` is hidden
                        and the chip is a dot, and `failed` shares its ember
                        with `dirty`. The phone bar has six slots
                        and the word does not fit there, so it goes to the
                        notice column `DeviceNotice` also uses, and the two
                        facts stack rather than overlap.

                        The fact only. Why it failed goes to a toast when it
                        happens: the cause matters for the next few seconds,
                        while the file not being on disk stays true until a
                        write lands. */}
                    {saveState === "failed" && (
                      <StatusNotice tone="alert">
                        {t("toolbar.notSaved")}
                      </StatusNotice>
                    )}

                    {/* A bar subpanel declares itself with `data-bar-panel`:
                      while its `data-open` is set the bar stays expanded and
                      lifted, so the bar and its panels act as one unit. */}
                    <div
                      className="ed-drop"
                      data-bar-panel
                      data-open={charsOpen ? "1" : "0"}
                      aria-hidden={!charsOpen}
                    >
                      <div className="ed-drop-inner">
                        <CharsPanel engine={engine} />
                      </div>
                    </div>

                    <div
                      className="ed-drop"
                      data-bar-panel
                      data-open={findOpen ? "1" : "0"}
                      aria-hidden={!findOpen}
                    >
                      <div className="ed-drop-inner">{panel}</div>
                    </div>
                  </div>
                </div>
              )}
            </FindPanel>
          )}
        </div>

        {phone
          ? dockOpen && (
              <Scrim
                open
                place="end"
                className="ed-dock-sheet"
                label={t("dock.label")}
                onClose={closeDock}
              >
                {dockPanel}
              </Scrim>
            )
          : dockPanel}

        {/* The toasts, at the foot of the window. Mounted in the editor, the
            only half with a file to fail to write, but outside the command
            bar's open-Section gate: the dock posts here too (an edited
            question's Undo) and is open on the front page and during a review,
            where the bar is not. `.ui-toasts` is fixed, so where it mounts
            moves nothing. */}
        <ToastHost toasts={toasts.toasts} dismiss={toasts.dismiss} />

        {/* No AI settings sheet here: it is mounted once, in the app's
            settings (`webapp/shell/SettingsSheet.tsx`), and the chat bar's
            model button only lists the models that can answer. */}

        {/* Last in the shell, so it lies over the prose it points at with no
          z-index argument with the chrome. */}
        {/* The selection bars bracket the live selection; visual only. */}
        <SelectionBars key={viewKey} getSurface={getSurface} />

        <SelectionBubble
          engine={engine}
          rect={selected?.rect ?? null}
          host={shell.current}
          text={selected?.text ?? ""}
          onFindEvery={(text) => {
            // The seed and the vacate are one commit: `setSelected(null)`
            // only dismisses the bubble, and the register vacates through the
            // `selectionFor` gate, keyed on the query this call seeds. The
            // effect at `findOpen` would clear it one paint late.
            setSelected(null);
            openFind(text);
          }}
          onAsk={askAbout}
          onComment={commentOnSelection}
          onDismiss={dismissClipboardSurfaces}
        />

        {/* The prose context menu, last so it lies over what it points at. */}
        <ContextMenu
          open={contextMenu !== null}
          point={contextMenu}
          label={t("bubble.label")}
          items={contextMenuItems}
          onClose={closeContextMenu}
        />

        <ShortcutSheet open={sheetOpen} onClose={closeSheet} />
        {palette && (
          <CommandBoard
            open
            commands={commands}
            live={palette}
            onClose={closePalette}
          />
        )}
        <LeaveGuard
          engine={engine}
          openTitle={activeFile ? (openTitle ?? "") : ""}
          saveSection={saveActiveFile}
          refDirty={refDirty}
          refEditFile={refEdit?.fileName ?? null}
          saveRefEdit={saveRefEdit}
          restoreOnLeave={restoreOnLeave}
        />
        <ReferenceLeaveDialog
          refLeave={refLeave}
          refEditFile={refEdit?.fileName ?? null}
          onConfirm={confirmLeave}
          onCancel={cancelLeave}
        />
      </div>
    </OverlayBackgroundProvider>
  );
});
