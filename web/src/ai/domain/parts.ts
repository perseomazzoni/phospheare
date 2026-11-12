// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { SourceDescriptor } from "./types";

// ── Parts as the catalogue sees them ─────────────────────────────────────────
//
// The listing is flat and in reading order. `partId` says what the
// order cannot: the Part a node sits in, by node id (`SourceDescriptor`). A
// `part` review needs two answers from it: which Part the writer means, and
// which Sections are in it.
//
// `partId` is read from a listing the adapter builds from the Structure, a
// file in the writer's folder, and a hand-edited one could make a Part its
// own ancestor. The walk up a chain stops after `PART_DEPTH_MAX` steps, which
// ends a cycle. Going round one again only revisits what was already
// compared, so for these walks the bound alone is exact and a "seen" set
// could never change an answer; `partWords` sums as it climbs,
// and so does keep one. A real Structure is a handful of levels deep; the
// bound is for a file that is not.

/** How far up a `partId` chain the walk goes before it gives up. */
export const PART_DEPTH_MAX = 32;

/**
 * The Part a `part` review of `nodeId` reads: the node itself when it is a
 * Part, else the immediate Part it sits in, since a nested Part counts as its
 * own Part. `null` for a Section at the top of the Structure, and for a node
 * the catalogue does not hold.
 */
export function partFor(
  catalog: readonly SourceDescriptor[],
  nodeId: string,
): string | null {
  const node = catalog.find((one) => one.nodeId === nodeId);
  if (!node) return null;
  if (node.nodeKind === "part") return node.nodeId ?? null;
  const parent = node.partId;
  return parent !== undefined &&
    catalog.some((one) => one.nodeId === parent && one.nodeKind === "part")
    ? parent
    : null;
}

/**
 * Whether `partNodeId` names a Part in the catalogue. A `node` scope is
 * checked against it at run time, because a title typed a minute ago may
 * name a node deleted or turned into something else since.
 */
export function isPart(
  catalog: readonly SourceDescriptor[],
  partNodeId: string,
): boolean {
  return catalog.some(
    (one) => one.nodeId === partNodeId && one.nodeKind === "part",
  );
}

/**
 * The Sections inside a Part, by source id, in reading order: every Section
 * whose `partId` chain reaches it, so a Part's sub-Parts come along. Sections
 * only, because a Part's own file is its heading, the same line `/where`
 * draws.
 */
export function sectionsInPart(
  catalog: readonly SourceDescriptor[],
  partNodeId: string,
): string[] {
  const parentOf = new Map<string, string | undefined>();
  for (const one of catalog)
    if (one.nodeId !== undefined) parentOf.set(one.nodeId, one.partId);
  const reaches = (start: string | undefined): boolean => {
    let at = start;
    for (let step = 0; at !== undefined && step < PART_DEPTH_MAX; step += 1) {
      if (at === partNodeId) return true;
      at = parentOf.get(at);
    }
    return false;
  };
  return catalog
    .filter(
      (one) =>
        one.kind === "manuscript" &&
        one.nodeKind === "section" &&
        reaches(one.partId),
    )
    .sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) -
        (b.order ?? Number.MAX_SAFE_INTEGER),
    )
    .map((one) => one.id);
}

/**
 * The top-level Part a node sits in, or the node itself when it is one. That
 * is what stands in a beat of the declared structure: the scaffold makes one
 * top-level Part per beat, and a nested Part subdivides its top-level one.
 * `null` for a Section at the top of the Structure, for a node the
 * catalogue does not hold, and for a chain longer than `PART_DEPTH_MAX`,
 * which is a cycle and not a Structure.
 */
export function topPartOf(
  catalog: readonly SourceDescriptor[],
  nodeId: string,
): string | null {
  const byId = new Map<string, SourceDescriptor>();
  for (const one of catalog)
    if (one.nodeId !== undefined) byId.set(one.nodeId, one);
  const start = byId.get(nodeId);
  if (!start) return null;
  let at: SourceDescriptor = start;
  let top = at.nodeKind === "part" ? nodeId : null;
  for (let step = 0; step < PART_DEPTH_MAX; step += 1) {
    const parent: SourceDescriptor | undefined =
      at.partId === undefined ? undefined : byId.get(at.partId);
    if (!parent || parent.nodeKind !== "part" || parent.nodeId === undefined)
      return top;
    top = parent.nodeId;
    at = parent;
  }
  return null;
}

// ── How many words a Part holds ──────────────────────────────────────────────
//
// A Part's own count is only the few words of its heading's file, so a Part
// of five words over three Sections of a thousand is a 3005-word Part, and
// anything that says how long a Part is must add its subtree. This is that
// sum, computed once: every figure and prompt that prints a length reads it,
// so no figure and no model is told two different lengths.
//
// The input is flat and generic, `{id, parentId?, words?}`, because its
// callers hold different shapes.

/** One node, as `partWords` reads it. */
export interface WordNode {
  id: string;
  parentId?: string;
  words?: number;
}

/**
 * A count as a safe whole number (finite, whole, ≥ 0, never past
 * `Number.MAX_SAFE_INTEGER`), or `undefined` when it is no number. Counts
 * come from the project's stats and, replayed, from a chat file the writer can
 * edit, so neither is trusted to be a count.
 */
export function countedWords(words: unknown): number | undefined {
  return typeof words === "number" && Number.isFinite(words)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(words)))
    : undefined;
}

/**
 * Every node's words with its whole subtree's, by id. A node is absent when
 * anything in its subtree has no count: unknown is not zero, and a Part
 * printed as its counted half would be a length the writer never wrote. The
 * walk up from each node stops after `PART_DEPTH_MAX` steps and at a node it
 * has already passed.
 */
export function partWords(
  nodes: readonly WordNode[],
): ReadonlyMap<string, number> {
  const parentOf = new Map(nodes.map((one) => [one.id, one.parentId]));
  const totals = new Map<string, number>();
  const unknown = new Set<string>();
  for (const one of nodes) {
    const words = countedWords(one.words);
    const passed = new Set<string>();
    let at: string | undefined = one.id;
    for (
      let step = 0;
      at !== undefined && step <= PART_DEPTH_MAX && !passed.has(at);
      step += 1
    ) {
      passed.add(at);
      if (words === undefined) unknown.add(at);
      else
        totals.set(
          at,
          Math.min(Number.MAX_SAFE_INTEGER, (totals.get(at) ?? 0) + words),
        );
      at = parentOf.get(at);
    }
  }
  for (const id of unknown) totals.delete(id);
  return totals;
}
