// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { Fragment, memo, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import NameInput from "../components/NameInput";
import { GUTTER, INDENT } from "./dropTarget";
import { Icon, Menu, Tick, useMenuAnchor, type MenuItem } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import { canAdd } from "../../project/mutations";
import { canMoveSelection, type MoveTarget } from "../../project/moveTargets";
import { filePath } from "../../project/naming";
// The same table the bar's save chip reads. Two surfaces answering "where
// are my words" must not answer it differently.
import { markGlyph, type SaveState } from "../saveMark";
import type { DocNode, DocumentStructure, NodeKind } from "../../project/types";
import type { CommentCounts } from "../comments/domain/counts";
import { walk } from "../../project/structure";
import type { PersonaFace } from "../comments/presentation/faces";
import CommentBubbles from "../comments/presentation/CommentBubbles";

// One row of the document. A Part and a Section are the same row with
// different parts switched on: a Part is a page that happens to have pages
// beneath it, so clicking its name opens its text as clicking a Section
// does, and the chevron beside it is the only thing that expands.
//
// Rows are keyed and compared by the node's id, never a file name: the id
// is what survives a rename, and the open file (the adopted snapshot) is
// what a label click opens.

/**
 * A gutter plus one indent step per level, the same two the drop line reads
 * the pointer by. The frame's, the same under every theme.
 */
export const indentFor = (depth: number) => ({
  paddingLeft: `${GUTTER + depth * INDENT}px`,
});

export interface RowContext {
  structure: DocumentStructure;
  expanded: Set<string>;
  /** The open node's id, resolved from the open file by the panel. */
  activeId: string | null;
  /** Every row a drag holds in the air: the grabbed one, or its group. */
  dragging: readonly string[];
  /** Id of the row showing a rename field. */
  renaming: string | null;
  /** Where a new node is being named. */
  adding: { containerId: string | null; kind: NodeKind } | null;
  /**
   * Word count per node id, for the trailing figure. Absent while the stats
   * are still being counted: the row says nothing rather than saying zero,
   * which would be a claim about the writing rather than about the count.
   */
  words: Map<string, number>;
  /**
   * What each node's comments count, by node id; absent for a node whose
   * file has not been read, which draws nothing rather than a zero.
   */
  comments: ReadonlyMap<string, CommentCounts>;
  /** The personas' faces, for the colours of their circles. */
  personas: readonly PersonaFace[];
  /** Every Section's place in the book, from 1 (`sectionNumbers`). */
  sectionNumbers: Map<string, number>;
  /** Nodes whose summary the yaml and the folder both agree on (`DocumentTree`). */
  summaries: Set<string>;
  /**
   * Where the open Section's words are: the whole state the bar's save chip
   * reads, so "still typing" and "your words did not land" never share one
   * ember dot.
   */
  save: SaveState;
  /** Every file the queue is still holding, by path, as `DocumentTree` reads it. */
  pendingPaths: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpenSummary: (id: string) => void;
  /**
   * Create or update this node's summary. Absent when there is no assistant
   * to write one, and the row then offers no summary item.
   */
  onSummarise?: (id: string) => void;
  onOpen: (fileName: string) => void;
  onStartRename: (id: string) => void;
  onCommitRename: (id: string, title: string) => void;
  /** Start naming a node of this kind inside this container, unasked. */
  onAddKind: (containerId: string | null, kind: NodeKind) => void;
  onCommitAdd: (title: string) => void;
  onCancelEdit: () => void;
  onRemove: (id: string) => void;
  /**
   * Put the panel into move mode for this node, or for the selection when
   * the node is ticked. The finger's answer to a drag.
   */
  onStartMove: (id: string) => void;
  /**
   * True while a move is running: the tree then grows a landing in every gap
   * the node could sit in. `landings` is keyed by container (`ROOT_KEY` for
   * the document itself), then by the insertion index within it, so a row
   * can ask about its own gaps without knowing the flattened tree.
   */
  placing: boolean;
  /** The tree rows in the air, quieted in place; empty for a bin restore. */
  moving: readonly string[];
  landings: ReadonlyMap<string, ReadonlyMap<number, MoveTarget>>;
  /** The ticked rows, normalized: none of them inside another. */
  selection: ReadonlySet<string>;
  /** Rows inside a ticked Part: they move with it, and their box is locked. */
  covered: ReadonlySet<string>;
  /**
   * Which rows may offer a box: `"any"` before the first tick, the selection's
   * kind after it, and null while a Move… owns the panel.
   */
  selectable: NodeKind | "any" | null;
  onToggleSelect: (id: string) => void;
  onLand: (target: MoveTarget) => void;
  onDragStart: (event: React.PointerEvent, node: DocNode) => void;
}

function IconLanding() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
      <path
        d="M1.2 5h6.2M5.2 2.6 7.9 5 5.2 7.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Where a numberless (nested) Part's box sits: in its own indent, its centre
 * 11px left of the row's first glyph, one step out, the 12px box clear of
 * both. Depth one is the shallowest a numberless Part can be, and its indent
 * (30px) holds the box with room on either side. `.dt-check` centres itself
 * on this point.
 */
const pickInGutter = (depth: number): React.CSSProperties => ({
  left: `${GUTTER + depth * INDENT - 11}px`,
});

/** The `landings` key for the document's own root, which has no id. */
export const ROOT_KEY = "";

/** A stable empty list, so an empty Part's landings do not remount. */
const EMPTY: DocNode[] = [];

/**
 * One place the moving node can land, drawn where it would land: the touch
 * answer to a drag. The indent is the container: a landing one step in from
 * the row above it means "inside that Part".
 *
 * A button rather than a drop zone, so it is reachable by tab and by a
 * screen reader, where the words the indent stands for are spoken instead.
 */
function Landing({
  containerId,
  index,
  depth,
  ctx,
}: {
  containerId: string | null;
  index: number;
  depth: number;
  ctx: RowContext;
}) {
  const { t } = useTranslation();
  if (!ctx.placing) return null;
  const target = ctx.landings.get(containerId ?? ROOT_KEY)?.get(index);
  if (!target) return null;

  // A row of one cell, both without a box (`.dt-cell`), so the landing
  // lays out as it does among the rows around it.
  return (
    <div className="dt-cell" role="row" aria-level={depth + 1}>
      <span className="dt-cell" role="gridcell">
        <button
          type="button"
          className="dt-landing"
          style={indentFor(depth)}
          aria-label={
            target.afterTitle
              ? t("tree.moveAfter", { title: target.afterTitle })
              : t("tree.moveFirst")
          }
          onClick={() => ctx.onLand(target)}
        >
          <IconLanding />
          <span className="dt-landing-rule" aria-hidden />
        </button>
      </span>
    </div>
  );
}

/**
 * A container's children with a landing in every gap that will take the node.
 *
 * Exported because the root's children are rendered by the panel rather than
 * by a row, and both lists have to interleave the same way.
 */
export function WithLandings({
  containerId,
  nodes,
  depth,
  ctx,
  numbered = false,
}: {
  containerId: string | null;
  nodes: DocNode[];
  /** The depth the rows sit at; the landings share it. */
  depth: number;
  ctx: RowContext;
  /**
   * The root's Parts carry their position in the project; nothing nested
   * does. One flag rather than two copies of the interleave, where a landing
   * could go missing in one of the two lists.
   */
  numbered?: boolean;
}) {
  return (
    <>
      {nodes.map((child, i) => (
        <Fragment key={child.id}>
          <Landing
            containerId={containerId}
            index={i}
            depth={depth}
            ctx={ctx}
          />
          <TreeRow
            node={child}
            depth={depth}
            index={numbered ? i : undefined}
            ctx={ctx}
          />
        </Fragment>
      ))}
      <Landing
        containerId={containerId}
        index={nodes.length}
        depth={depth}
        ctx={ctx}
      />
    </>
  );
}

function IconChevron() {
  return (
    <svg
      className="dt-chevron-svg"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M7 10l5 5 5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A Section's page glyph: the tree's rows, and the titlebar's crumb. */
export function IconPage() {
  return (
    <svg
      className="dt-file-icon"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M6.5 3.5H14l3.5 3.5v13.5h-11Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 3.5V7h3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 12.5h5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M9.5 16h3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface RowProps {
  node: DocNode;
  depth: number;
  /**
   * Position among the project's top-level Parts, numbered from zero. Only
   * the Parts at the root carry it; a Section's number is its place in the
   * whole book (`ctx.sectionNumbers`).
   */
  index?: number;
  ctx: RowContext;
}

/**
 * The fields of `RowContext` a row reads only about its own node, compared
 * node by node in `sameRow`. Every other field is compared whole, by
 * identity, so a new field in the context redraws every row until someone
 * decides it is per-row: the safe way round.
 */
const PER_NODE = new Set<keyof RowContext>([
  "expanded",
  "activeId",
  "dragging",
  "renaming",
  "adding",
  "words",
  "comments",
  "sectionNumbers",
  "summaries",
  "save",
  "pendingPaths",
  "moving",
  "selection",
  "covered",
]);

/**
 * Whether a row may keep what it drew last time.
 *
 * The panel hands every row one context, and nearly every change to it (a
 * comments file read, a word count, the save state) is about one node.
 * Drawn again whole, a book of 128 nodes would redraw 128 rows for each, a
 * dozen times on open. So a row compares only what it shows: its own node's
 * facts, and those of every node under it, because a Part draws its children
 * inside itself and a Part that skipped would take them with it.
 *
 * The node itself is compared by identity. The structure is rebuilt along
 * the path of every edit, so a renamed or moved node arrives as a new
 * object, and so does every Part above it. The whole structure is shared (a
 * change anywhere can give a row somewhere new to move to), so any edit
 * redraws every row; edits are rare and one at a time.
 *
 * The panel's handlers are forwarders that never change (`useForwarders`),
 * so a row that skips still acts on the panel as it is now.
 */
export function sameRow(prev: RowProps, next: RowProps): boolean {
  if (
    prev.node !== next.node ||
    prev.depth !== next.depth ||
    prev.index !== next.index
  )
    return false;
  const a = prev.ctx;
  const b = next.ctx;
  if (a === b) return true;
  const keys = Object.keys(b) as (keyof RowContext)[];
  if (keys.length !== Object.keys(a).length) return false;
  for (const key of keys)
    if (!PER_NODE.has(key) && a[key] !== b[key]) return false;
  // "Select" is offered on every row until the first tick, and none after.
  if ((a.selection.size === 0) !== (b.selection.size === 0)) return false;

  let same = true;
  const check = (node: DocNode) => {
    if (!same) return;
    const id = node.id;
    const ticked = a.selection.has(id);
    same =
      a.expanded.has(id) === b.expanded.has(id) &&
      (a.activeId === id) === (b.activeId === id) &&
      (b.activeId !== id || a.save === b.save) &&
      a.dragging.includes(id) === b.dragging.includes(id) &&
      (a.renaming === id) === (b.renaming === id) &&
      addingIn(a, id) === addingIn(b, id) &&
      a.words.get(id) === b.words.get(id) &&
      sameCounts(a.comments.get(id), b.comments.get(id)) &&
      a.sectionNumbers.get(id) === b.sectionNumbers.get(id) &&
      a.summaries.has(id) === b.summaries.has(id) &&
      a.pendingPaths.has(filePath(node.adopted)) ===
        b.pendingPaths.has(filePath(node.adopted)) &&
      a.moving.includes(id) === b.moving.includes(id) &&
      ticked === b.selection.has(id) &&
      a.covered.has(id) === b.covered.has(id) &&
      // A ticked row's Move… is judged for the whole selection.
      (!ticked || sameSet(a.selection, b.selection));
  };
  check(next.node);
  if (next.node.kind === "part") walk(next.node.children, check);
  return same;
}

/** The kind being named inside this Part, or null. */
const addingIn = (ctx: RowContext, id: string) =>
  ctx.adding?.containerId === id ? ctx.adding.kind : null;

/** Counts are rebuilt as new objects on every read, so compare by value. */
function sameCounts(
  a: CommentCounts | undefined,
  b: CommentCounts | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.others !== b.others) return false;
  const ids = Object.keys(a.personas);
  return (
    ids.length === Object.keys(b.personas).length &&
    ids.every((id) => a.personas[id] === b.personas[id])
  );
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** One row of the tree, drawn again only when `sameRow` says it must. */
const TreeRow = memo(function TreeRow({ node, depth, index, ctx }: RowProps) {
  const { t } = useTranslation();
  // Before the rename branch below, which returns early: a hook that runs on
  // some renders and not others is the one thing React refuses outright.
  const menu = useMenuAnchor();
  const more = useRef<HTMLButtonElement>(null);
  // The row is named by its title alone; its other controls are its cells.
  const labelId = useId();

  if (ctx.renaming === node.id) {
    return (
      <NameInput
        kind={node.kind}
        depth={depth}
        initial={node.title}
        onCommit={(title) => ctx.onCommitRename(node.id, title)}
        onCancel={ctx.onCancelEdit}
      />
    );
  }

  const isPart = node.kind === "part";
  const number = isPart
    ? index === undefined
      ? undefined
      : index + 1
    : ctx.sectionNumbers.get(node.id);
  // Every Part is a toggle, empty or not (`AddLabels`).
  const isOpen = isPart && ctx.expanded.has(node.id);
  const expandable = isPart;
  const isActive = node.id === ctx.activeId;
  // The row's mark has two sources and they compose in this order.
  //
  // On the open row the buffer wins: "there is something to write" and "that
  // write failed" are both more urgent than "this is on its way out", and
  // they are facts about the editor rather than about the queue. `markGlyph`
  // returns null for the states with nothing to say, so a clean open row
  // falls through to the queue like any other.
  //
  // Every other row asks the queue (`pendingPaths`).
  const buffered = isActive ? markGlyph(ctx.save) : null;
  const markState: SaveState | null = buffered
    ? ctx.save
    : ctx.pendingPaths.has(filePath(node.adopted))
      ? "cached"
      : null;
  const markHere = markState ? markGlyph(markState) : null;
  const isDragging = ctx.dragging.includes(node.id);
  const isSelected = ctx.selection.has(node.id);
  const isCovered = ctx.covered.has(node.id);
  // A ticked row's gestures carry the whole selection; anything else carries
  // the row alone, the same rule the panel's drag start applies.
  const group = isSelected ? [...ctx.selection] : [node.id];
  // A Part counts everything in it; one with no words says nothing rather
  // than 0.
  const words = ctx.words.get(node.id);
  const wordCount = isPart && words === 0 ? undefined : words;
  const commentCounts = ctx.comments.get(node.id);

  // Add lives in the labels under the Part's children, not in the menu. Move
  // is offered only where there is somewhere to go, asked as a yes or no that
  // stops at the first place found: every row asks it on every render, and
  // building the whole list held a 63-Part book for forty seconds.
  const canMove = canMoveSelection(ctx.structure, group);

  // The box that ticks the row into the selection. It stands where the row's
  // own mark is (a Section's page glyph, a top-level Part's number) and
  // takes its place when shown, so nothing in the row moves and the indent
  // still says which Part the row is in. A Part nested in another has
  // no number; at depth one or deeper the indent itself has room, so the box
  // sits there, just left of the row's first column.
  const pickable =
    ctx.selectable !== null &&
    (ctx.selectable === "any" || ctx.selectable === node.kind);
  const pick = pickable ? (
    <span
      className="dt-check"
      role="gridcell"
      style={number === undefined && isPart ? pickInGutter(depth) : undefined}
      // A press on the box is a tick, never the start of a drag.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Tick
        className="ui-tick-bare ui-tick-sm"
        checked={isSelected || isCovered}
        // Locked, not disabled: it stays reachable and says it is ticked (it
        // moves with the Part around it), but a press changes nothing.
        locked={isCovered}
        aria-label={t("tree.selectOne", { title: node.title })}
        onToggle={() => ctx.onToggleSelect(node.id)}
      />
    </span>
  ) : null;

  // Rename, move, then remove. Remove stays last and apart: a destructive
  // command at the top of a list gets hit on the way to the others. The
  // summary sits before Remove, and says "Update" once one exists.
  const onSummarise = ctx.onSummarise;
  const rowActions: MenuItem[] = [
    {
      id: "rename",
      label: t("tree.rename"),
      icon: appIcons.edit,
      onSelect: () => ctx.onStartRename(node.id),
    },
    // Select is the way in that needs no hover: a finger, or a keyboard that
    // would rather not tab to the box. Once anything is ticked every row of
    // that kind shows its box, so the item has nothing more to offer.
    ...(pickable && ctx.selection.size === 0
      ? [
          {
            id: "select",
            label: t("tree.select"),
            icon: appIcons.confirm,
            onSelect: () => ctx.onToggleSelect(node.id),
          },
        ]
      : []),
    ...(canMove
      ? [
          {
            id: "move",
            label: t("tree.move"),
            icon: appIcons.move,
            onSelect: () => ctx.onStartMove(node.id),
          },
        ]
      : []),
    ...(onSummarise
      ? [
          {
            id: "summary",
            label: t(
              ctx.summaries.has(node.id)
                ? "tree.updateSummary"
                : "tree.createSummary",
            ),
            icon: appIcons.assistant,
            onSelect: () => onSummarise(node.id),
          },
        ]
      : []),
    {
      id: "remove",
      label: t("tree.remove"),
      icon: appIcons.delete,
      danger: true,
      onSelect: () => ctx.onRemove(node.id),
    },
  ];

  return (
    <div className="dt-branch">
      <div
        data-row={node.id}
        className={[
          "dt-row",
          isPart ? "dt-part" : "dt-section",
          isOpen ? "open" : "",
          isActive ? "active" : "",
          isDragging ? "dragging" : "",
          isSelected || isCovered ? "selected" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={indentFor(depth)}
        role="row"
        aria-level={depth + 1}
        aria-labelledby={labelId}
        aria-expanded={expandable ? isOpen : undefined}
        // Selected means ticked, and is said only while a selection exists;
        // the open Section is the current row.
        aria-selected={
          ctx.selection.size > 0 ? isSelected || isCovered : undefined
        }
        aria-current={isActive ? "true" : undefined}
        onKeyDown={(e) => {
          if (e.key !== "F2" || e.target !== e.currentTarget) return;
          e.preventDefault();
          ctx.onStartRename(node.id);
        }}
        // The row in the air, so the panel can quiet it. Not hidden: it is
        // still the answer to "what am I moving", and a row that vanished
        // would shift every landing under the writer's finger.
        data-moving={ctx.moving.includes(node.id) ? "1" : undefined}
        onPointerDown={(e) => ctx.onDragStart(e, node)}
      >
        {expandable ? (
          // The chevron is a pointer's route to a folded Part's children, and
          // a cell the keyboard reaches with Right; Right and Left on the row
          // fold it too.
          <span className="dt-cell" role="gridcell">
            <button
              type="button"
              className="dt-chevron"
              data-grid="toggle"
              onClick={() => ctx.onToggle(node.id)}
              aria-label={t(isOpen ? "tree.collapse" : "tree.expand", {
                title: node.title,
              })}
            >
              <IconChevron />
            </button>
          </span>
        ) : (
          // A Section's page glyph in the chevron's column, so the rows'
          // labels stay aligned; the selection's tick takes its place. Only a
          // Section reaches here: every Part, empty or not, is a toggle.
          <span className="dt-chevron placeholder dt-host">
            <IconPage />
            {pick}
          </span>
        )}

        {/* The Part's number, padded to `01` as the Desk's spine and the
            rail's buttons draw it: one fact, drawn three ways. A Section's is
            its place in the book, in the same face. */}
        {number !== undefined && (
          <span className={isPart ? "dt-idx dt-host" : "dt-idx"}>
            <span className="dt-host-face">
              {String(number).padStart(2, "0")}
            </span>
            {isPart && pick}
          </span>
        )}
        {number === undefined && isPart && pick}

        <span className="dt-cell" role="gridcell">
          <button
            type="button"
            id={labelId}
            className="dt-label"
            data-grid="open"
            title={node.title}
            onClick={() => ctx.onOpen(node.adopted)}
            onKeyDown={(e) => {
              if (e.key !== "F2") return;
              e.preventDefault();
              ctx.onStartRename(node.id);
            }}
          >
            {node.title}
          </button>
        </span>
        {commentCounts && (
          <span className="dt-cell" role="gridcell">
            <CommentBubbles counts={commentCounts} personas={ctx.personas} />
          </span>
        )}

        {/* The contents page's leader, from the name to the count; the
            stylesheet draws it only where there is a count to lead to. */}
        <span className="dt-lead" aria-hidden />

        {/* Revealed with the panel rather than per row: a number appearing
            under the pointer on every row is a flicker. */}
        {wordCount !== undefined && (
          <span className="dt-words">{wordCount.toLocaleString()}</span>
        )}

        {/* Something written here is not where the writer keeps it yet: the
            panel's copy of the fact the bar's save chip carries. Same glyphs
            and inks as the chip, from the same table, so the two never
            disagree about the writer's words. A row that is fine says
            nothing.

            On any row, not only the open one: offline each act queues behind
            the last, so several rows can be waiting at once. */}
        {markHere && (
          <Icon
            name={markHere}
            size={11}
            className="dt-mark"
            data-state={markState}
            aria-hidden
          />
        )}

        {/* The summary link, drawn only where the structure and the folder
            agree there is something behind it. The slot is always mounted (a
            blank § otherwise) because the mark's width is part of the row's
            trailing rhythm, and a count that jumps depending on whether its
            neighbour has a summary would mislead. */}
        <span className="dt-cell" role="gridcell">
          {ctx.summaries.has(node.id) ? (
            <button
              type="button"
              className="dt-summary"
              aria-label={t("tree.openSummary", { title: node.title })}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                ctx.onOpenSummary(node.id);
              }}
            >
              §
            </button>
          ) : (
            <span className="dt-summary slot" aria-hidden>
              §
            </span>
          )}
        </span>
        {/* One control, present at rest, holding every action this row has.
            Separate icon buttons are no target on a phone, where F2 is a key
            no soft keyboard offers, and three adjacent small buttons, one of
            them destructive, invite a hit on the wrong one.

            `onPointerDown` stops here so the row's drag gesture never starts
            under this button. */}
        <span
          className="dt-actions"
          role="gridcell"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            ref={more}
            type="button"
            className="dt-more"
            data-grid="menu"
            aria-haspopup="menu"
            aria-expanded={menu.open}
            aria-label={t("tree.actionsFor", { title: node.title })}
            onClick={(e) => menu.toggle(e.currentTarget)}
          >
            <Icon name={appIcons.menu} size={15} />
          </button>
          <Menu
            open={menu.open}
            onClose={menu.close}
            anchor={menu.anchor}
            label={t("tree.actionsFor", { title: node.title })}
            items={rowActions}
          />
        </span>
      </div>

      {isPart && (
        <div className={`dt-children${isOpen ? " open" : ""}`}>
          <Children node={node} depth={depth} ctx={ctx} />
        </div>
      )}
    </div>
  );
}, sameRow);

export default TreeRow;

/** A Part's children, plus the field for a node being added to it. */
function Children({
  node,
  depth,
  ctx,
}: {
  node: DocNode & { kind: "part" };
  depth: number;
  ctx: RowContext;
}) {
  const addingHere = ctx.adding?.containerId === node.id ? ctx.adding : null;

  if (node.children.length === 0 && !addingHere) {
    // An empty Part is the one place a landing has no gap to sit in, so the
    // landing takes the labels' place while a move is running.
    if (ctx.placing) {
      return (
        <WithLandings
          containerId={node.id}
          nodes={EMPTY}
          depth={depth + 1}
          ctx={ctx}
        />
      );
    }
    return <AddLabels containerId={node.id} depth={depth + 1} ctx={ctx} />;
  }

  return (
    <>
      <WithLandings
        containerId={node.id}
        nodes={node.children}
        depth={depth + 1}
        ctx={ctx}
      />
      {addingHere ? (
        <NameInput
          kind={addingHere.kind}
          depth={depth + 1}
          onCommit={ctx.onCommitAdd}
          onCancel={ctx.onCancelEdit}
        />
      ) : (
        // Always there while the Part is open, empty or not: a writer can add
        // more than one thing in a sitting, and an affordance that exists only
        // at zero is gone when they know what they are doing.
        <AddLabels containerId={node.id} depth={depth + 1} ctx={ctx} />
      )}
    </>
  );
}

/**
 * The quiet add labels at the end of a Part's children: one pill per kind
 * the container legally accepts (the Golden Rule), Section first. A pill
 * names its kind, so a press starts the NameInput for that kind, never a
 * kind chooser; the root uses these labels too, with `partFirst`. Hidden
 * while a move is running: the landings are the useful fact then.
 *
 * The labels live inside the children's collapsing box: folding a Part,
 * empty or not, folds them with it.
 */
export function AddLabels({
  containerId,
  depth,
  ctx,
  partFirst = false,
}: {
  containerId: string | null;
  depth: number;
  ctx: RowContext;
  /** Offer Part before Section. The root's order, where the kind matters. */
  partFirst?: boolean;
}) {
  const { t } = useTranslation();
  const kinds = addableKinds(ctx.structure, containerId);
  if (kinds.length === 0 || ctx.placing) return null;
  // Written as its own order, never a `reverse()` of the other one's: the
  // dependency would be invisible at this site.
  const ordered: NodeKind[] = partFirst
    ? (["part", "section"] as NodeKind[]).filter((kind) => kinds.includes(kind))
    : kinds;
  return (
    <div
      className="dt-add-row"
      role="row"
      aria-level={depth + 1}
      style={indentFor(depth)}
    >
      {ordered.map((kind) => (
        <span key={kind} className="dt-cell" role="gridcell">
          <button
            type="button"
            className="dt-add"
            aria-label={t(kind === "part" ? "tree.addPart" : "tree.addSection")}
            onClick={() => ctx.onAddKind(containerId, kind)}
          >
            <Icon name={appIcons.add} size={11} />
            {t(kind === "part" ? "name.kindPart" : "name.kindSection")}
          </button>
        </span>
      ))}
    </div>
  );
}

/**
 * Which kinds a container will accept: an empty container takes either, a
 * populated one takes exactly what it already holds. Section comes first, as
 * the smallest unit a writer starts in.
 */
function addableKinds(
  structure: DocumentStructure,
  containerId: string | null,
): NodeKind[] {
  return (["section", "part"] as NodeKind[]).filter((kind) =>
    canAdd(structure, containerId, kind),
  );
}
