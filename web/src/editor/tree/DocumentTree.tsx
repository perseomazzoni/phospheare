// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SaveState } from "../saveMark";
import { Link } from "react-router";
import { useProjectActions, useProjectState } from "../ProjectContext";
import {
  descendantCount,
  findNode,
  isDescendant,
  nodeOfFile,
  sectionNumbers,
  walk,
} from "../../project/structure";
import { MD_EXT, SUMMARY_PREFIX } from "../../project/naming";
import type { SearchArrival } from "../searchArrival";
import type { DocNode, NodeKind } from "../../project/types";
import { AddLabels, WithLandings, indentFor, type RowContext } from "./TreeRow";
import GlobalSearch from "../components/GlobalSearch";
import NameInput from "../components/NameInput";
import ConfirmDialog from "../components/ConfirmDialog";
import { useForwarders } from "./useForwarders";
import SummaryDialog from "../assistant/SummaryDialog";
import {
  useBinnedReferenceFiles,
  useReferenceFiles,
} from "../reference/referenceShared";
import { restoreReference } from "../reference/referenceDelete";
import type { Assistant } from "../../ai";
import RecycleBin from "../components/RecycleBin";
import { useCommentCounts } from "../comments/host/comments";
import { summariesInFolder } from "../../project/reference";
import {
  MAX_PANEL_W,
  MIN_PANEL_W,
  PANEL_W,
  clampPanelWidth,
  useNarrow,
} from "../useNarrow";
import { RESIZE_KEY_STEP, useEdgeDrag } from "../components/useEdgeDrag";
import { Icon } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import { useTreeDrag } from "./useTreeDrag";
import { useTreeExpansion } from "./useTreeExpansion";
import PanelRail from "./PanelRail";
import { useTreeSelection } from "./useTreeSelection";
import { useMovePlacement } from "./useMovePlacement";
import { MovingLine, SelectedLine } from "./MoveBanners";
import { useProjectFind } from "./useProjectFind";
import PanelHead from "./PanelHead";
import PanelFoot from "./PanelFoot";
import { stateFace } from "./TreeStates";
import DockButtons from "./DockButtons";
import ProjectFacts from "./ProjectFacts";
import TreeGhost from "./TreeGhost";
import { useTreegrid } from "./useTreegrid";
import { GUTTER, INDENT, type Slot } from "./dropTarget";

/** Nothing queued: one instance, so a default cannot break memoisation. */
const EMPTY_PATHS: ReadonlySet<string> = new Set();

// ── Document panel ───────────────────────────────────────────────────────────
//
// The structural view of the project: Parts holding Parts, or Parts holding
// Sections.
//
// The Golden Rule is designed out rather than enforced: every affordance asks
// `canAdd` or `canDrop` before it draws itself, so an illegal option is never
// rendered and an illegal drop never shows a line to aim at.

/**
 * What the panel's grip points `aria-controls` at. A constant, not a
 * generated id: the editor has exactly one structure panel.
 */
export const STRUCTURE_PANEL_ID = "editor-structure";

/** Nothing in the air: one constant, so the rows' context keeps identity. */
const NO_IDS: readonly string[] = [];

/**
 * A confirmation the panel is waiting on. Removal is the only one: the panel
 * writes the structure the moment it changes, so nothing else here costs the
 * writer anything they did not just ask for.
 */
interface Pending {
  title: string;
  body?: string;
  onConfirm: () => void;
}

export default function DocumentTree({
  onOpenReference = () => {},
  onOpenNotesTab,
  onOpenReferenceTab,
  onOpenChat = () => {},
  assistant = null,
  onFindInText = () => {},
  onEndFind = () => {},
  arrival = null,
  rail = false,
  peek = false,
  onPeek,
  onToggleCollapse = () => {},
  save = "clean",
  pendingPaths = EMPTY_PATHS,
  sheet = false,
  backTo,
  backLabel,
  width = PANEL_W,
  onResize = () => {},
  onResizeEnd = () => {},
  onResizeCancel,
  hostOf,
}: {
  /** The host behind a model provider id, for the summary dialog. */
  hostOf?: (providerId: string) => string | undefined;
  /** Where a reference document goes when opened: the dock, in practice. */
  onOpenReference?: (fileName: string) => void;
  /**
   * The writer opened a hit in the prose, and the surface should land on it.
   * The query travels, never an offset (`searchArrival.ts`). The file name
   * goes too, because opening any other file ends the arrival. `at` is the
   * ordinal of the clicked occurrence in that file.
   */
  onFindInText?: (file: string, query: string, at: number) => void;
  /**
   * The project search is over: the field emptied, the query moved, or the
   * find was left via its back control or Escape.
   *
   * The marks the search left in the prose belong to the surface. Without
   * this call they would outlive their search, with nothing on screen to
   * explain or dismiss them.
   */
  onEndFind?: () => void;
  /**
   * Where the writing surface last arrived: a search hit the writer opened,
   * or a passage the assistant pointed at. The tree follows it: the Part it
   * landed in unfolds and the row comes into view.
   */
  arrival?: SearchArrival | null;
  /**
   * The writer opened something said in a conversation. The node is opened
   * here (the assistant panel binds to whatever Section is open), so the
   * shell only shows the face.
   */
  onOpenChat?: (chatId?: string, turnId?: string) => void;
  /**
   * The composed assistant, used only so project chats arrive in the search
   * as neutral documents; this module never parses a chat file.
   */
  assistant?: Assistant | null;
  /** Open the dock's notes tab (no file selected). */
  onOpenNotesTab?: () => void;
  /**
   * Open the dock's reference tab (no file selected). The shell owns the
   * dirty-draft guard, so this is a plain request, not a face switch.
   */
  onOpenReferenceTab?: () => void;
  /** The panel is drawn at its 52px width, whoever decided that. */
  rail?: boolean;
  /**
   * The writer folded the panel and the mouse has it open anyway, floating
   * over the prose: the face is the wide one (`rail` is false) while the
   * fold still holds.
   */
  peek?: boolean;
  /**
   * The mouse entered the rail (`true`) or left the panel (`false`). Absent
   * on the sheet, which has no rail to peek from.
   */
  onPeek?: (on: boolean) => void;
  /** Flip the writer's own preference for the panel's width. */
  onToggleCollapse?: () => void;
  /**
   * Where the open Section's words are. Passed in because the engine's
   * `hasUnsavedChanges` is a getter, and a panel that called it would never
   * hear about it changing.
   *
   * The whole state, not a boolean: the route computes it for the bar's save
   * chip, and a flattened `dirty || failed` would let the two surfaces
   * disagree.
   */
  save?: SaveState;
  /**
   * Every file of this project the queue is still holding, by path.
   *
   * Offline, each act queues behind the last, so several rows can be waiting
   * while only one is open. The open row's state comes from `save`, since a
   * local write that has not landed outranks one that has not been sent;
   * every other row's comes from this set.
   */
  pendingPaths?: ReadonlySet<string>;
  /**
   * The panel is a modal sheet over the manuscript rather than a column
   * beside it: the phone plane. The way back to the shelf appears in the
   * head, because the phone hides the titlebar and the writer must not be
   * shut inside the project.
   */
  sheet?: boolean;
  /** Where the way back goes. The shell decides; the demo route goes home. */
  backTo?: string;
  backLabel?: string;
  /**
   * How wide the panel is, in px. Controlled from the shell as the dock's
   * width is: the panel takes it, the surface reserves it, and both read the
   * same number.
   */
  width?: number;
  /** Every frame of a drag: the width the shell must render now. */
  onResize?: (width: number) => void;
  /** Once, when the drag or the keystroke settles. The persistence seam. */
  onResizeEnd?: (width: number) => void;
  /** The panel went away mid-drag: stop believing one is in flight. */
  onResizeCancel?: () => void;
} = {}) {
  const { t } = useTranslation();
  const {
    structure,
    props,
    catalogue,
    ref: projectRef,
    activeFile,
    status,
    error,
    validation,
    pendingRef,
    isSupported,
    provider,
  } = useProjectState();
  const {
    reconnect,
    reload,
    openFile,
    addNode,
    renameNodeTo,
    removeNodeAt,
    moveNodesTo,
    restoreFromBin,
    restoreBinnedSnapshot,
  } = useProjectActions();

  // `side: "left"`: the panel is pinned left, so it grows as the pointer moves
  // right, the mirror of the dock's sign.
  const { onPointerDown, onKeyDown, separatorProps } = useEdgeDrag({
    width,
    side: "left",
    clamp: clampPanelWidth,
    keyStep: RESIZE_KEY_STEP,
    min: MIN_PANEL_W,
    max: MAX_PANEL_W,
    controls: STRUCTURE_PANEL_ID,
    onResize,
    onResizeEnd,
    onResizeCancel,
  });

  // ── The sheet leaves what it opened ────────────────────────────────────────
  //
  // On the phone this panel is a modal cover over the manuscript. Left up, it
  // hides the words the writer landed on, and a destination that opens the
  // dock would stack a second scrim over the first. Opening anything from the
  // sheet closes it, with no search special case. `onToggleCollapse` is the
  // close on this plane, because a sheet has no width to give back.
  const leaveSheet = useCallback(() => {
    if (sheet) onToggleCollapse();
  }, [sheet, onToggleCollapse]);

  const referenceFiles = useReferenceFiles(provider, projectRef).files;
  // The reference half of the project's one recycle bin, which belongs to the
  // structure region. A second bin in the reference panel would show half of
  // what the writer deleted.
  const { files: binnedReference, reload: reloadBinned } =
    useBinnedReferenceFiles(provider, projectRef);
  const [refRestoreFailed, setRefRestoreFailed] = useState(false);
  // Read from the catalogue, because a binned snapshot has left the structure.
  const binnedSnapshots = useMemo(
    () =>
      Object.entries(catalogue?.binned ?? {}).flatMap(([nodeId, snaps]) =>
        snaps.map((snap) => ({
          nodeId,
          file: snap.file,
          title: snap.title,
        })),
      ),
    [catalogue],
  );
  const restoreBinnedReference = useCallback(
    async (fileName: string) => {
      setRefRestoreFailed(false);
      const ok = await restoreReference(provider, projectRef, fileName);
      setRefRestoreFailed(!ok);
      // One reload for both listings: the shared revision counter drives the
      // shelf and the bin together, so a restore shows on both sides.
      reloadBinned();
    },
    [provider, projectRef, reloadBinned],
  );
  // Below 1016 the panel stops being a column with a reserve beside it and
  // becomes an overlay on the prose and the command bar, which moves the
  // collapse control.
  const narrow = useNarrow();
  const panelRef = useRef<HTMLElement>(null);

  // ── The peek ───────────────────────────────────────────────────────────────
  // The rail is the way in and the whole panel is the way to stay: a mouse
  // entering `.dt-rail` opens the panel floating over the prose, and it folds
  // back when the mouse leaves the panel. The foot and the buttons under the
  // rail do not open it.
  //
  // A mouse only: a finger has no hover to leave with, so a tap-opened peek
  // could not end, and touch keeps the fold control. Not on the sheet, which
  // has no rail. The narrow plane peeks as the wide one does; its collapse is
  // `.dt-close` inside the panel, so it needs no sibling crossing.
  //
  // React's enter/leave follows the React tree, not the DOM, so the settings
  // card and the dialogs portalled from inside the aside count as inside it,
  // and using them does not fold the panel.
  const collapseRef = useRef<HTMLButtonElement>(null);
  const enterRail = (event: React.PointerEvent) => {
    if (onPeek && rail && !sheet && event.pointerType === "mouse") {
      onPeek(true);
    }
  };
  // The collapse control is a sibling of the panel, because the panel clips,
  // and it rides the floating edge during the peek, half over the panel.
  // Crossing between the two is not leaving: otherwise reaching for the
  // control would fold the panel and pull the control from under the pointer.
  const leavePeek =
    (other: React.RefObject<HTMLElement | null>) =>
    (event: React.PointerEvent) => {
      if (!peek || !onPeek) return;
      const to = event.relatedTarget;
      if (to instanceof Node && other.current?.contains(to)) return;
      onPeek(false);
    };
  const [renaming, setRenaming] = useState<string | null>(null);
  const [adding, setAdding] = useState<{
    containerId: string | null;
    kind: NodeKind;
  } | null>(null);
  const cancelEdit = useCallback(() => {
    setAdding(null);
    setRenaming(null);
  }, []);

  const [pending, setPending] = useState<Pending | null>(null);
  // The node whose summary dialog is open, by id: the dialog reads its title
  // from the live structure, so a rename while it is up is the name it shows.
  const [summarising, setSummarising] = useState<string | null>(null);
  const summarisingNode =
    summarising && structure ? findNode(structure, summarising) : null;
  const {
    selected,
    selectedSet,
    selectKind,
    covered,
    toggleSelect,
    clearSelection,
    groupFor,
  } = useTreeSelection(structure);
  const { expanded, expand, collapse, toggle } = useTreeExpansion({
    arrival,
    panelRef,
    onRestore: cancelEdit,
  });
  const { placing, setPlacing, placingGroups, landings, shownExpanded, land } =
    useMovePlacement({ structure, expanded, selectedSet, clearSelection });

  const find = useProjectFind({
    structure,
    referenceFiles,
    assistant,
    placing: placing !== null,
    onEndFind,
  });
  const { finding, deferred, results, searchPending, openedAt, setOpenedAt } =
    find;

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useTreegrid(contentRef);
  /** The counts the stats already carry, keyed by node id for the rows. A
   * Part counts everything in it. */
  const words = useMemo(() => {
    const own = new Map(
      (props?.stats.perNode ?? []).map((n) => [n.nodeId, n.words]),
    );
    if (!structure) return own;
    const totals = new Map<string, number>();
    const visit = (node: DocNode): number => {
      let sum = own.get(node.id) ?? 0;
      for (const child of "children" in node ? node.children : [])
        sum += visit(child);
      // A Section the stats do not count stays uncounted rather than 0.
      if (own.has(node.id)) totals.set(node.id, sum);
      return sum;
    };
    for (const node of structure.children) visit(node);
    return totals;
  }, [props, structure]);

  /**
   * Nodes with a summary the yaml and the folder both agree on.
   *
   * Both, not either. The structure file is the authority on the binding, but
   * a binding to a missing file is broken, and the marker would promise a
   * document that does not exist. A file named by the convention with no
   * recorded link appears on the shelf instead.
   */
  const summaries = useMemo(() => {
    if (!structure) return new Set<string>();
    const onDisk = summariesInFolder(referenceFiles);
    const bound = new Set<string>();
    walk(structure.children, (node) => {
      if (node.summary && onDisk.has(node.id)) bound.add(node.id);
    });
    return bound;
  }, [structure, referenceFiles]);

  // ── Adding ─────────────────────────────────────────────────────────────────

  const chooseKind = useCallback(
    (containerId: string | null, kind: NodeKind) => {
      setAdding({ containerId, kind });
    },
    [],
  );

  const commitAdd = useCallback(
    (title: string) => {
      if (!adding) return;
      const { containerId, kind } = adding;
      setAdding(null);
      void addNode(kind, containerId, title);
    },
    [adding, addNode],
  );

  const commitRename = useCallback(
    (id: string, title: string) => {
      setRenaming(null);
      void renameNodeTo(id, title);
    },
    [renameNodeTo],
  );

  // ── Removing ───────────────────────────────────────────────────────────────

  const requestRemove = useCallback(
    (id: string) => {
      if (!structure) return;
      const node = findNode(structure, id);
      if (!node) return;
      // Rows, not files: a snapshot is a version of a row, and counting its
      // files would say an empty Part holds items.
      const inside = descendantCount(node);

      // Every removal asks, lone node or populated Part, so a writer who aimed
      // at the wrong row can say so before anything moves to the bin. For a
      // Section, "nothing inside it" would read as "it has no text", so its
      // title names the kind instead of the count.
      setPending({
        title:
          node.kind === "section"
            ? t("tree.removeConfirmTitleSection", { title: node.title })
            : inside === 0
              ? t("tree.removeConfirmTitleEmpty", { title: node.title })
              : t("tree.removeConfirmTitle", {
                  title: node.title,
                  count: inside,
                }),
        body: t("tree.removeConfirmBody"),
        onConfirm: () => {
          setPending(null);
          void removeNodeAt(id);
        },
      });
    },
    [structure, removeNodeAt, t],
  );

  // ── Dragging ───────────────────────────────────────────────────────────────

  // A group that has landed is done with: the ticks clear, so a second
  // gesture cannot carry the same rows somewhere else by accident. A row
  // dragged alone leaves the selection as it was.
  const handleDrop = useCallback(
    (ids: string[], slot: Slot) => {
      if (ids.some((id) => selectedSet.has(id))) clearSelection();
      void moveNodesTo(ids, slot.containerId, slot.index);
    },
    [moveNodesTo, selectedSet, clearSelection],
  );

  const binRef = useRef<HTMLElement>(null);

  const { draggingId, draggingIds, ghost, indicator, binArmed, startDrag } =
    useTreeDrag({
      structure,
      expanded,
      scrollRef,
      contentRef,
      binRef,
      onExpand: expand,
      onCollapse: collapse,
      onDrop: handleDrop,
      // Dropped on the bin: an unlink, through `requestRemove`, so the bin
      // asks the same question the Remove item does.
      onBinDrop: requestRemove,
      onRestore: (id, slot) =>
        void restoreFromBin(id, slot.containerId, slot.index),
    });

  const onDragStart = useCallback(
    (event: React.PointerEvent, node: DocNode) =>
      startDrag(
        event,
        node.id,
        node.title,
        node.kind,
        "tree",
        undefined,
        groupFor(node.id),
      ),
    [startDrag, groupFor],
  );

  // Escape lets go of the selection, but only when nothing else is using it.
  // A running Move… owns Escape (it leaves the move and the ticks survive, so
  // the writer can choose again), and so does a drag (it abandons the drag).
  useEffect(() => {
    if (selected.length === 0 || placing || draggingId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      clearSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected.length, placing, draggingId, clearSelection]);

  const numbers = useMemo(
    () => (structure ? sectionNumbers(structure) : new Map<string, number>()),
    [structure],
  );
  // With no assistant (the demo), only people's threads are drawn.
  const commentCounts = useCommentCounts();
  const personas = useMemo(() => assistant?.allPersonas() ?? [], [assistant]);
  // The rows are memoised and redraw only when their own nodes change, so
  // their handlers must keep their identity: these are stable forwarders to
  // this render's handlers.
  const handlers = useForwarders({
    onToggle: toggle,
    onOpenSummary: (id: string) => {
      onOpenReference(`${SUMMARY_PREFIX}${id}${MD_EXT}`);
      leaveSheet();
    },
    onOpen: (fileName: string) => {
      void openFile(fileName);
      leaveSheet();
    },
    onCommitRename: commitRename,
    onAddKind: chooseKind,
    onCommitAdd: commitAdd,
    onCancelEdit: cancelEdit,
    onRemove: requestRemove,
    onStartMove: (id: string) =>
      setPlacing({ from: "tree", ids: groupFor(id) }),
    onToggleSelect: toggleSelect,
    onLand: land,
    onDragStart,
  });
  const ctx: RowContext | null = structure && {
    structure,
    expanded: shownExpanded,
    // The open file's node, resolved once here so the rows compare ids.
    activeId: activeFile
      ? (nodeOfFile(structure, activeFile)?.id ?? null)
      : null,
    dragging: draggingIds,
    renaming,
    adding,
    words,
    comments: commentCounts,
    personas,
    sectionNumbers: numbers,
    summaries,
    save,
    pendingPaths,
    ...handlers,
    // State setters, whose identity React already keeps stable.
    onSummarise: assistant ? setSummarising : undefined,
    onStartRename: setRenaming,
    placing: placing !== null,
    moving: placing?.from === "tree" ? placing.ids : NO_IDS,
    selection: selectedSet,
    covered,
    // Nothing is offered for ticking while a Move… owns the panel: its rows
    // are destinations then, not candidates.
    selectable: placing ? null : (selectKind ?? "any"),
    landings,
  };

  const body = () => {
    const face = stateFace({
      isSupported,
      status,
      pendingRef,
      validation,
      reconnect,
      reload,
      t,
    });
    if (face) return face;

    if (!structure || !ctx) {
      return null;
    }

    const addingAtRoot = adding?.containerId === null ? adding : null;

    return (
      <div
        className="dt-content"
        ref={contentRef}
        role="treegrid"
        aria-multiselectable={selected.length > 0 ? true : undefined}
        // Named by the word printed above it, the `.dt-region-label` this tree
        // sits under and the search face's first heading, so one word names it
        // on both faces. Not `tree.panelLabel`: that is the panel's name,
        // carried by the `aside` and by the phone's sheet, and nested repeats
        // of one name tell a screen-reader user nothing.
        aria-label={t("tree.contents")}
      >
        {structure.children.length === 0 && !addingAtRoot ? (
          <>
            <div className="dt-empty" role="row" style={indentFor(0)}>
              <span className="dt-cell" role="gridcell">
                {t("tree.emptyDocument")}
              </span>
            </div>
            {/* A new project's first act is naming a Part or a Section, and
                the labels offer both, Part first, because a book starts with
                its shape. */}
            <AddLabels containerId={null} depth={0} ctx={ctx} partFirst />
          </>
        ) : (
          <>
            <WithLandings
              containerId={null}
              nodes={structure.children}
              depth={0}
              ctx={ctx}
              numbered
            />
            {/* The root's own labels, present once something exists too: this
                is how a populated project gains another Part or Section. */}
            {!addingAtRoot && (
              <AddLabels containerId={null} depth={0} ctx={ctx} partFirst />
            )}
          </>
        )}

        {addingAtRoot && (
          <NameInput
            kind={addingAtRoot.kind}
            depth={0}
            onCommit={commitAdd}
            onCancel={cancelEdit}
          />
        )}

        {/* The drop indicator. Its indent says which container the node will
            land in; it is absent wherever the Golden Rule forbids a drop. */}
        {indicator && (
          <div
            className="dt-drop-line"
            style={{
              top: `${indicator.top}px`,
              left: `${GUTTER + indicator.depth * INDENT}px`,
            }}
            aria-hidden
          />
        )}
      </div>
    );
  };

  const parts = structure?.children.filter((c) => c.kind === "part") ?? [];
  // The open file's node: the rail's "which Part am I in" answer.
  const activeId = activeFile
    ? ((structure ? nodeOfFile(structure, activeFile)?.id : null) ?? null)
    : null;
  const holdsActive = (part: DocNode) =>
    activeId !== null &&
    structure !== null &&
    (part.id === activeId || isDescendant(structure, part.id, activeId));
  const currentPart = parts.find(holdsActive)?.id ?? null;

  return (
    <>
      <aside
        ref={panelRef}
        id={STRUCTURE_PANEL_ID}
        className={`doc-tree${draggingId ? " dragging" : ""}`}
        data-selecting={(!placing && selectKind) || undefined}
        aria-label={t("tree.panelLabel")}
        onPointerLeave={leavePeek(collapseRef)}
      >
        {/* The way back, since the phone draws no titlebar. The router's
          leaving guard sits in front of it like every other exit, so a dirty
          buffer still asks before the project closes. */}
        {sheet && backTo && (
          <Link to={backTo} viewTransition className="dt-back">
            <Icon name={appIcons.backToLibrary} size={14} />
            <span>{backLabel}</span>
          </Link>
        )}

        {structure && (
          <PanelHead
            structure={structure}
            currentPart={currentPart}
            find={find}
            placing={placing !== null}
            onEndFind={onEndFind}
            sheet={sheet}
            narrow={narrow}
            rail={rail}
            peek={peek}
            onToggleCollapse={onToggleCollapse}
          />
        )}

        {structure && (
          <PanelRail
            parts={parts}
            currentPart={currentPart}
            finding={finding}
            rail={rail}
            enterRail={enterRail}
            onToggleCollapse={onToggleCollapse}
            expand={expand}
          />
        )}

        {/* The two bodies, stacked in one box (absolute, inset 0), so the
          swap is a movement: the tree leaves to the left and the results
          arrive from the right, the direction the writer is going. Neither
          is ever `display: none`, because a body that is not laid out cannot
          animate, and one leaving the flow would pull the other into its
          place mid-slide.

          Both are always mounted. One attribute on the head decides which
          is on and the stylesheet reads it, so no React mount can disagree
          with a CSS rule. `aria-hidden` carries the same answer
          for jsdom and for a screen reader, which see no stylesheet. */}
        <div className="dt-bodies">
          <div
            className="dt-scroll dt-tree-body"
            ref={scrollRef}
            aria-hidden={finding || undefined}
          >
            {/* Only a document has a structure region. Loading, a refused
            folder or an unsupported browser fills the whole panel, and a
            structure heading over it would promise a tree that is not
            coming. */}
            {!structure ? (
              body()
            ) : (
              <Region label={t("tree.contents")}>
                {placing && (
                  <MovingLine
                    placing={placing}
                    structure={structure}
                    nowhere={placingGroups.length === 0}
                    onCancel={() => setPlacing(null)}
                  />
                )}

                {body()}
                {!placing && selected.length > 0 && (
                  <SelectedLine
                    structure={structure}
                    selected={selected}
                    selectKind={selectKind}
                    onMove={() => setPlacing({ from: "tree", ids: selected })}
                    onClear={clearSelection}
                  />
                )}

                {/* One flat row per removed top-level node; the structure is
                preserved inside the `removed:` list, and a restore shows it
                again. */}
                {structure && (
                  <RecycleBin
                    ref={binRef}
                    items={structure.removed ?? []}
                    snapItems={binnedSnapshots}
                    onRestoreSnapshot={(nodeId, file) => {
                      setRefRestoreFailed(false);
                      void restoreBinnedSnapshot(nodeId, file).then((ok) =>
                        setRefRestoreFailed(!ok),
                      );
                    }}
                    refItems={binnedReference}
                    onRestoreRef={(fileName) =>
                      void restoreBinnedReference(fileName)
                    }
                    refRestoreFailed={refRestoreFailed}
                    armed={binArmed}
                    onDragStart={(event, node) =>
                      startDrag(
                        event,
                        node.id,
                        node.title,
                        node.kind,
                        "bin",
                        node,
                      )
                    }
                    // The drag's twin, and the only route a finger has: the
                    // drag refuses a touch pointer (`useTreeDrag`), so without
                    // this a removed node could not come back on a phone.
                    onRestore={(node) => setPlacing({ from: "bin", node })}
                  />
                )}
              </Region>
            )}
          </div>

          {/* The panel's other body, mounted whenever the tree is; the head
          decides in the stylesheet which of the two is on. Every rule on
          these two hides; a rule that showed one would outrank the rail's
          and draw results inside a 52px column.

          Bound to `structure`, not `finding`, matching the head that carries
          the attribute: with no structure there is no head and no rule to
          hide this, and it would stand open over a loading panel.

          Not inside `.dt-scroll`: a body swapped inside one scroller clamps
          its `scrollTop` to 0 for good. With two scrollers the tree keeps its
          place while the writer reads results. */}
          {structure && (
            <GlobalSearch
              atRest={!finding}
              results={results}
              query={deferred}
              pending={searchPending}
              activeId={activeId}
              onOpenNode={(id) => {
                const node = structure ? findNode(structure, id) : null;
                if (!node) return;
                void openFile(node.adopted);
                leaveSheet();
              }}
              onOpenChat={(chatId, turnId) => {
                // Only the chat and its turn: a chat is project-wide, so no
                // Section opens with it.
                //
                // The sheet goes before the dock arrives: on the phone both
                // are modals on the shared scrim, and closing after the open
                // would show two scrims for a frame.
                leaveSheet();
                onOpenChat(chatId, turnId);
              }}
              activeOccurrence={
                openedAt && openedAt.id === activeId ? openedAt : null
              }
              onOpenBody={(id, hitQuery, ordinal) => {
                const node = structure ? findNode(structure, id) : null;
                if (!node) return;
                setOpenedAt({ id, ordinal });
                void openFile(node.adopted);
                // Told before the open resolves. The surface paints its marks
                // from the document it holds, so the arrival waits for its
                // file, and a writer already on this node sees the words
                // marked in the frame they clicked.
                onFindInText(node.adopted, hitQuery, ordinal);
                leaveSheet();
              }}
              onOpenReference={(fileName) => {
                leaveSheet();
                onOpenReference(fileName);
              }}
              onRestore={(id) => {
                const node = (structure?.removed ?? []).find(
                  (n) => n.id === id,
                );
                if (node) setPlacing({ from: "bin", node });
              }}
            />
          )}
        </div>

        {structure && projectRef && (
          <DockButtons
            referenceFiles={referenceFiles}
            rail={rail}
            onOpenReference={() => {
              leaveSheet();
              onOpenReferenceTab?.();
            }}
            onOpenNotes={() => {
              leaveSheet();
              onOpenNotesTab?.();
            }}
          />
        )}

        {structure && props && <ProjectFacts document={props.document} />}

        {error && <p className="dt-error">{error}</p>}

        {structure && (
          <PanelFoot panelRef={panelRef} sheet={sheet} rail={rail} />
        )}

        <TreeGhost
          ghost={ghost}
          draggingIds={draggingIds}
          structure={structure}
        />

        {assistant && summarisingNode && (
          <SummaryDialog
            assistant={assistant}
            hostOf={hostOf}
            nodeId={summarisingNode.id}
            title={summarisingNode.title}
            update={summaries.has(summarisingNode.id)}
            onClose={() => setSummarising(null)}
            onDone={(id) => {
              setSummarising(null);
              onOpenReference(`${SUMMARY_PREFIX}${id}${MD_EXT}`);
              leaveSheet();
            }}
          />
        )}
        {pending && (
          <ConfirmDialog
            title={pending.title}
            body={pending.body}
            confirmLabel={t("bin.moveTo")}
            danger
            onConfirm={pending.onConfirm}
            onCancel={() => setPending(null)}
          />
        )}
        {/* ── The grip that sets the width ────────────────────────────────
            Inside the panel at its outer edge, as the dock's `.dock-resize`
            is, so `overflow: hidden` has nothing to cut.

            Not in the rail, whose only width is the fold's, and not on the
            phone, where the panel is a sheet. Hidden on a coarse pointer,
            since a 6px target is a mouse's; that gate is CSS, because reach
            is the pointer's question and the plane is the window's. */}
        {/* Nor in a peek: the panel floats at the writer's width without
            owning it, and a drag there would set a width nothing reserves. */}
        {!sheet && !rail && !peek && structure && (
          <span
            className="panel-resize"
            {...separatorProps}
            aria-label={t("tree.resize")}
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDown}
          />
        )}
      </aside>

      {/* ── The fold control on the boundary ──────────────────────────────
          A sibling of the panel, not a child: `.doc-tree` clips with
          `overflow: hidden` (its `backdrop-filter` needs it), so a handle
          straddling its edge inside it would be cut in half. Positioned from
          the same two custom properties as the panel, so it follows the
          fold with no second source of truth.

          On the boundary because it moves the boundary, and because in the
          rail it would be the only thing left in the header.

          Not on the phone or the narrow plane: there is no gutter to
          straddle there, and the control stays in the head. */}
      {!sheet && !narrow && structure && (
        <button
          type="button"
          ref={collapseRef}
          className="dt-collapse"
          // The fold, not the face: during a peek the panel is drawn wide but
          // still folded, and pressing this pins it open, so it says and
          // points "expand".
          aria-expanded={!(rail || peek)}
          aria-label={
            rail || peek ? t("tree.expandPanel") : t("tree.collapsePanel")
          }
          onClick={onToggleCollapse}
          onPointerLeave={leavePeek(panelRef)}
        >
          <Icon name={appIcons.expand} size={14} />
        </button>
      )}
    </>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

/**
 * One region of the panel. The head is a label, not a toggle: the structure
 * region is always on, and what folds is the tree inside it, row by row. The
 * add command lives in the labels under the tree.
 */
function Region({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="dt-region">
      <div className="dt-region-head">
        <div className="dt-region-label">{label}</div>
      </div>
      {children}
    </section>
  );
}
