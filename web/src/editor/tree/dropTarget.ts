// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { canDropAll, canRestore, isMoveNoOp } from "../../project/mutations";
import type { DocNode, DocumentStructure, NodeKind } from "../../project/types";

// Where the insertion line goes. Kept apart from the drag gesture, which
// needs a DOM: everything here is a pure function of the flattened rows, the
// pointer and the Golden Rule, so it can be tested without one.
//
// The pointer's Y picks a gap between two visible rows, and its X picks how
// deep into the tree that gap reaches. That is the only way to tell "last
// Section of Act One" from "after Act One at the root".

/**
 * Left padding of a row at depth 0, in px. The tree's rows are indented with
 * these two (`indentFor`), so the depth the pointer's X reads is the depth the
 * writer sees.
 */
export const GUTTER = 12;
/** One level of nesting, in px. */
export const INDENT = 18;

export interface Row {
  id: string;
  kind: NodeKind;
  depth: number;
  /** The id of the containing Part, or null at the root. */
  parentId: string | null;
  /** Position among its siblings. */
  index: number;
  /** True for a Part that is currently showing its children. */
  isOpen: boolean;
}

export interface Slot {
  /** The id of the Part that will hold the node, or null for the root. */
  containerId: string | null;
  /** Insertion position within that container's children, as they stand now. */
  index: number;
  /** Nesting level of the container's children: the line's indent. */
  depth: number;
}

/** The visible rows, in the order they are painted. */
export function flattenRows(
  structure: DocumentStructure,
  expanded: Set<string>,
): Row[] {
  const rows: Row[] = [];

  const visit = (
    nodes: DocNode[],
    depth: number,
    parentId: string | null,
  ): void => {
    nodes.forEach((node, index) => {
      const isOpen = node.kind === "part" && expanded.has(node.id);
      rows.push({
        id: node.id,
        kind: node.kind,
        depth,
        parentId,
        index,
        isOpen,
      });
      if (node.kind === "part" && isOpen)
        visit(node.children, depth + 1, node.id);
    });
  };

  visit(structure.children, 0, null);
  return rows;
}

/**
 * Every slot the gap above `rows[gapIndex]` could mean. A gap at the end of
 * one or more nested lists is ambiguous (after the last Section of Act One,
 * the pointer could mean "next Section" or "next Part"), so all the readings
 * are returned, shallowest first, and the X coordinate chooses.
 */
export function slotsForGap(rows: Row[], gapIndex: number): Slot[] {
  const aboveIndex = gapIndex - 1;
  const above = aboveIndex >= 0 ? rows[aboveIndex] : null;
  const below = gapIndex < rows.length ? rows[gapIndex] : null;

  // Before the first row there is only one reading: the top of the root.
  if (!above) return [{ containerId: null, index: 0, depth: 0 }];

  const slots: Slot[] = [];

  // Directly under an open Part, the gap can mean "its first child". When the
  // Part has children this is the only reading, since they start on the next
  // row. When it is open but empty, it is one reading among several, and the
  // only way to drop anything into an empty Part.
  if (above.isOpen) {
    slots.push({
      containerId: above.id,
      index: 0,
      depth: above.depth + 1,
    });
  }

  // The gap also closes zero or more containers. Walk out from the row above,
  // one reading per level, stopping at the depth the next row sits at.
  const floor = below ? below.depth : 0;
  let current: Row | null = above;
  let currentIndex = aboveIndex;

  for (let depth = above.depth; depth >= floor && current; depth--) {
    slots.push({
      containerId: current.parentId,
      index: current.index + 1,
      depth,
    });
    if (depth === floor) break;
    const ancestor = findAncestor(rows, currentIndex);
    if (!ancestor) break;
    current = ancestor.row;
    currentIndex = ancestor.index;
  }

  return slots.sort((a, b) => a.depth - b.depth);
}

/** The row for the Part containing `rows[index]`, found by scanning back up. */
function findAncestor(
  rows: Row[],
  index: number,
): { row: Row; index: number } | null {
  const parentId = rows[index].parentId;
  if (parentId === null) return null;
  for (let i = index - 1; i >= 0; i--) {
    if (rows[i].id === parentId) return { row: rows[i], index: i };
  }
  return null;
}

/**
 * Pick the slot the writer means, given where the pointer sits horizontally
 * and what the Golden Rule allows.
 *
 * Illegal readings are dropped before the choice, so the line never appears
 * where the node cannot land. When the depth under the pointer is illegal,
 * the nearest legal one is chosen rather than nothing, so the gesture stays
 * forgiving without suggesting an impossible drop.
 *
 * `external` marks a bin restore: the dragged node is not in the structure,
 * so legality is `canRestore` instead of `canDropAll`.
 *
 * `moving` is everything a tree drag carries, and every reading must hold for
 * all of it at once, so the line never offers a slot the group could not land
 * in together.
 *
 * `null` means the gap has no legal reading: draw no line.
 */
export function pickSlot(
  structure: DocumentStructure,
  dragged: DocNode,
  candidates: Slot[],
  pointerX: number,
  external: boolean,
  moving: readonly string[] = [dragged.id],
): Slot | null {
  const legal = candidates.filter((slot) =>
    external
      ? canRestore(structure, dragged, slot.containerId)
      : canDropAll(structure, moving, slot.containerId),
  );
  if (legal.length === 0) return null;

  const wanted = Math.round((pointerX - GUTTER) / INDENT);

  let best = legal[0];
  let bestDistance = Math.abs(best.depth - wanted);
  for (const slot of legal.slice(1)) {
    const distance = Math.abs(slot.depth - wanted);
    // `<` rather than `<=` keeps the shallower reading on a tie, the safer
    // guess, since it does not bury a node inside a Part.
    if (distance < bestDistance) {
      best = slot;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * True when dropping `draggedId` (with the rest of `moving`, for a group drag)
 * at `slot` would leave the document as it is, so a no-op drag skips the
 * write and the undo toast. The test is `isMoveNoOp`, the one Move… uses, so
 * the line and the landings cannot disagree.
 */
export function isNoOp(
  structure: DocumentStructure,
  draggedId: string,
  slot: Slot,
  moving: readonly string[] = [draggedId],
): boolean {
  return isMoveNoOp(structure, moving, slot.containerId, slot.index);
}
