// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── What the writer ticked ───────────────────────────────────────────────────
//
// The export window offers the same tick tree three times (Parts and
// Sections, References by group, Notes); this is its arithmetic.
//
// A selection is a set of ids. A node may carry content of its own (a Part
// has its own text, a reference is a file) or be a heading over others (a
// reference group). Only a node with `own` content can be in the set; a
// heading's tick is read from its children.
//
// Ticking a node ticks everything under it. Ticking a Section also ticks the
// Part above it: a Section exported without its Part loses the heading that
// frames it, and a child on under a parent off is a state whose meaning the
// writer cannot see.

import {
  REFERENCE_GROUP_ORDER,
  exportGroupOf,
  type ManuscriptNode,
  type ReferenceEntry,
  type ReferenceGroupId,
} from "./book";

export interface PickNode {
  id: string;
  title: string;
  /** The node is content in its own right, so its id can be selected. */
  own: boolean;
  children: PickNode[];
}

export type TickState = "on" | "off" | "mixed";

/** Every selectable id in a forest. */
export function selectableIds(nodes: readonly PickNode[]): Set<string> {
  const ids = new Set<string>();
  const visit = (node: PickNode) => {
    if (node.own) ids.add(node.id);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return ids;
}

/** How many selectable ids at and under the nodes are ticked, of how many. */
export function tickCount(
  nodes: readonly PickNode[],
  selected: ReadonlySet<string>,
): { on: number; all: number } {
  const ids = selectableIds(nodes);
  let on = 0;
  for (const id of ids) if (selected.has(id)) on += 1;
  return { on, all: ids.size };
}

/** On when every selectable id at and under the nodes is on; off if none. */
export function tickState(
  nodes: readonly PickNode[],
  selected: ReadonlySet<string>,
): TickState {
  const { on, all } = tickCount(nodes, selected);
  if (all === 0 || on === 0) return "off";
  return on === all ? "on" : "mixed";
}

/**
 * The selection after clicking `target`. Anything not fully on turns fully
 * on, so mixed resolves upward as in every tree control; fully on turns fully
 * off. Turning a subtree on also turns its ancestors' own content on.
 */
export function toggle(
  forest: readonly PickNode[],
  selected: ReadonlySet<string>,
  target: string,
): Set<string> {
  const path = pathTo(forest, target);
  if (!path) return new Set(selected);
  const node = path[path.length - 1];
  const next = new Set(selected);
  const subtree = selectableIds([node]);
  if (tickState([node], selected) === "on") {
    for (const id of subtree) next.delete(id);
  } else {
    for (const id of subtree) next.add(id);
    for (const ancestor of path.slice(0, -1))
      if (ancestor.own) next.add(ancestor.id);
  }
  return next;
}

/** All or nothing for a whole area's tree. */
export function toggleAll(
  forest: readonly PickNode[],
  selected: ReadonlySet<string>,
): Set<string> {
  return tickState(forest, selected) === "on"
    ? new Set()
    : selectableIds(forest);
}

function pathTo(nodes: readonly PickNode[], target: string): PickNode[] | null {
  for (const node of nodes) {
    if (node.id === target) return [node];
    const below = pathTo(node.children, target);
    if (below) return [node, ...below];
  }
  return null;
}

// ── The three trees ──────────────────────────────────────────────────────────
//
// The window draws one tree component three times; these are its three
// forests. A Part has text of its own, so it is selectable and also a parent;
// a reference group is only a heading, so its tick is its documents'. A
// character's arc hangs under its character, as on the reference shelf.

/** Parts and Sections, in the structure's order. */
export function manuscriptForest(nodes: readonly ManuscriptNode[]): PickNode[] {
  return nodes.map((node) => ({
    id: node.id,
    title: node.title,
    own: true,
    children: manuscriptForest(node.children),
  }));
}

/** A group heading's id: never a file name, so never selected by mistake. */
export const groupPickId = (group: ReferenceGroupId) => `group:${group}`;

/**
 * References by group, every group that has a document. `entries` is in the
 * source's order, which puts each arc straight after its character.
 */
export function referenceForest(
  entries: readonly ReferenceEntry[],
  groupTitle: (group: ReferenceGroupId) => string,
): PickNode[] {
  const forest: PickNode[] = [];
  for (const group of REFERENCE_GROUP_ORDER) {
    const children: PickNode[] = [];
    for (const entry of entries) {
      const leaf = {
        id: entry.fileName,
        title: entry.title,
        own: true,
        children: [],
      };
      if (exportGroupOf(entry.group) !== group) continue;
      // An arc rides with the character just before it, in the tree as in
      // the file (`exportGroupOf`). One with no character before it has
      // nothing to hang from, so it is left out rather than shown as a
      // character it is not.
      if (entry.group !== "arcs") children.push(leaf);
      else if (children.length > 0)
        children[children.length - 1].children.push(leaf);
    }
    if (children.length > 0)
      forest.push({
        id: groupPickId(group),
        title: groupTitle(group),
        own: false,
        children,
      });
  }
  return forest;
}

/** Notes, flat. */
export function notesForest(entries: readonly ReferenceEntry[]): PickNode[] {
  return entries
    .filter((entry) => entry.group === "notes")
    .map((entry) => ({
      id: entry.fileName,
      title: entry.title,
      own: true,
      children: [],
    }));
}
