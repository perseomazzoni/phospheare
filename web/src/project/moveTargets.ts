// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  canDropAll,
  canRestore,
  isMoveNoOp,
  normalizeSelection,
} from "./mutations";
import { childrenOf, walk } from "./structure";
import type { DocNode, DocumentStructure } from "./types";

// Where a node can go, said in words.
//
// The drag gesture answers with a pointer: Y picks the gap, X picks how deep
// into the tree it reaches (`dropTarget.ts`). That does not work for a finger,
// where a scroll of the panel can commit a reorder nobody asked for, so `Move…`
// names its destinations instead of aiming at them.
//
// It reaches places the drag cannot, collapsed containers included, and it is
// the keyboard's only route to reorder.

/** One landing place: a container, and a position among its children. */
export interface MoveTarget {
  /** The Part that will hold the node, or null for the document's own root. */
  containerId: string | null;
  /** Insertion position among that container's children, as they stand now. */
  index: number;
  /**
   * The sibling this position sits after, or null for the first position.
   * The dialog says "after «title»", the phrasing that stays unambiguous when
   * two Parts hold Sections of the same name.
   */
  afterTitle: string | null;
}

/** Every legal destination inside one container, in reading order. */
export interface MoveGroup {
  containerId: string | null;
  /** The container's own name, or null for the root. */
  title: string | null;
  targets: MoveTarget[];
}

/**
 * Every place `nodeId` could be moved to, grouped by container: a selection
 * of one. The legality is `mutations.ts`'s; nothing here re-implements it.
 */
export function moveTargets(
  structure: DocumentStructure,
  nodeId: string,
): MoveGroup[] {
  return selectionMoveTargets(structure, [nodeId]);
}

/**
 * Every place a selection could land as one block (`moveNodes`), grouped by
 * container. `canDropAll` is the legality.
 */
export function selectionMoveTargets(
  structure: DocumentStructure,
  ids: readonly string[],
): MoveGroup[] {
  const moving = normalizeSelection(structure, ids);
  if (moving.length === 0) return [];
  return groupsWhere(
    structure,
    (containerId) => canDropAll(structure, moving, containerId),
    moving,
  );
}

/**
 * Whether `selectionMoveTargets` would be non-empty, without building it.
 *
 * Every row of the structure panel asks this on every render, because Move…
 * is offered only where there is somewhere to go, so it stops at the first
 * legal place instead of judging every gap in the book.
 */
export function canMoveSelection(
  structure: DocumentStructure,
  ids: readonly string[],
): boolean {
  const moving = normalizeSelection(structure, ids);
  if (moving.length === 0) return false;
  return !targetsWhere(
    structure,
    (containerId) => canDropAll(structure, moving, containerId),
    moving,
  ).next().done;
}

/**
 * The same list for a node coming back out of the bin.
 *
 * A removed subtree is not in the structure, so it cannot be looked up by id
 * and `canDrop`'s two internal checks do not apply. `canRestore` is the rule
 * instead. `dropTarget.pickSlot` makes the same split with its `external`
 * flag.
 *
 * Nothing is filtered as a no-op: the node is nowhere yet, so every position
 * moves it.
 */
export function restoreTargets(
  structure: DocumentStructure,
  node: DocNode,
): MoveGroup[] {
  return groupsWhere(
    structure,
    (containerId) => canRestore(structure, node, containerId),
    [],
  );
}

/**
 * Root first, then every Part in document order, the order the tree paints
 * them, so the list reads as the document. A container with no legal position
 * is left out; an empty group would be a heading with nothing under it.
 */
function groupsWhere(
  structure: DocumentStructure,
  accepts: (containerId: string | null) => boolean,
  moving: readonly string[],
): MoveGroup[] {
  const groups: MoveGroup[] = [];
  for (const { container, target } of targetsWhere(
    structure,
    accepts,
    moving,
  )) {
    const last = groups[groups.length - 1];
    if (last && last.containerId === container.id) last.targets.push(target);
    else
      groups.push({
        containerId: container.id,
        title: container.title,
        targets: [target],
      });
  }
  return groups;
}

/**
 * Every legal landing place, one at a time, in the order the list reads.
 *
 * A generator, so `canMoveSelection` stops at the first. The whole list is
 * expensive: every gap of every container is judged, and each judgement walks
 * the tree, so a book of many Parts holds the page for seconds.
 *
 * `moving` is what is in the air, empty for a bin restore. Its nodes still
 * stand among their siblings, so two gaps separated only by moving rows land
 * the block in the same place. The first such position is kept, named after
 * the nearest sibling above it that is not moving, because a row that is
 * itself leaving names a place that will not exist. A position that changes
 * nothing (`isMoveNoOp`) is dropped.
 */
function* targetsWhere(
  structure: DocumentStructure,
  accepts: (containerId: string | null) => boolean,
  moving: readonly string[],
): Generator<{
  container: { id: string | null; title: string | null };
  target: MoveTarget;
}> {
  const containers: { id: string | null; title: string | null }[] = [
    { id: null, title: null },
  ];
  walk(structure.children, (candidate: DocNode) => {
    if (candidate.kind === "part")
      containers.push({ id: candidate.id, title: candidate.title });
  });
  const inAir = new Set(moving);

  for (const container of containers) {
    if (!accepts(container.id)) continue;

    const siblings = childrenOf(structure, container.id);
    // The nearest staying sibling above the gap, which is what decides where
    // the block lands. `undefined` until the first gap has been seen, so the
    // first position (after nothing, `null`) is never mistaken for a repeat.
    let lastAfter: DocNode | null | undefined = undefined;
    let after: DocNode | null = null;
    for (let index = 0; index <= siblings.length; index++) {
      const before = index > 0 ? siblings[index - 1] : null;
      if (before && !inAir.has(before.id)) after = before;
      if (after === lastAfter) continue;
      lastAfter = after;
      if (
        moving.length > 0 &&
        isMoveNoOp(structure, moving, container.id, index)
      )
        continue;
      yield {
        container,
        target: {
          containerId: container.id,
          index,
          afterTitle: after ? after.title : null,
        },
      };
    }
  }
}
