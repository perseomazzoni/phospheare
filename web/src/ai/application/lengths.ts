// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { SourceDescriptor } from "../domain/types";
import { partWords, sectionsInPart } from "../domain/parts";

// How long each piece of a scope is, as a model is told it. Computed here
// once for `/map`'s rows and the wide review's `LENGTHS` block, so the review
// and the map, and the map and its figure, cannot be told two lengths for one
// Part.

/** A scope's frame: the whole Structure, or one Part's children. */
export type LengthScope =
  { kind: "structure" } | { kind: "node"; nodeId: string };

/**
 * The scope's Sections and every Part that holds one of them, in book order,
 * and the Part each hangs from, by source id, when that Part is among them.
 * Only sources the chat may read are kept, because a word count is also
 * information about the manuscript.
 */
export function scopeNodes(
  catalog: readonly SourceDescriptor[],
  allowed: ReadonlySet<string>,
  inScope: ReadonlySet<string>,
): {
  nodes: SourceDescriptor[];
  parentOf: (one: SourceDescriptor) => string | undefined;
} {
  const nodes = catalog
    .filter(
      (one) =>
        one.kind === "manuscript" &&
        allowed.has(one.id) &&
        (inScope.has(one.id) ||
          (one.nodeKind === "part" &&
            one.nodeId !== undefined &&
            sectionsInPart(catalog, one.nodeId).some((id) => inScope.has(id)))),
    )
    .sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) -
        (b.order ?? Number.MAX_SAFE_INTEGER),
    );
  const nodeIdToSource = new Map(
    nodes.flatMap((one) => (one.nodeId ? [[one.nodeId, one.id] as const] : [])),
  );
  return {
    nodes,
    parentOf: (one) =>
      one.partId !== undefined ? nodeIdToSource.get(one.partId) : undefined,
  };
}

/** A share of a whole as plain digits; `<1%` for a sliver that is not none. */
function shareOf(part: number, whole: number): string {
  const share = (part / whole) * 100;
  return part > 0 && share < 1 ? "<1%" : `${Math.round(share)}%`;
}

/** What `lengthsOf` knows about a scope. */
export interface Lengths {
  /** The frame the shares are of, in book order. */
  frame: SourceDescriptor[];
  /**
   * A node's words, on a `"row"` with its share of the frame, or null for a
   * node with anything uncounted inside it.
   */
  say: (id: string, place: "row" | "line") => string | null;
}

/**
 * How long each node is: its words with its whole subtree's
 * (`partWords`, the sum `/map`'s figure draws from), and on a row its share
 * of the frame. The frame is the top-level nodes, or on a scope of one Part
 * its children, which is the figure's own frame (`mapLayout`). A node with
 * anything uncounted inside it says nothing, and no share is given when any
 * node of the frame is uncounted: unknown is not zero. Plain digits, in
 * English like every app-written fact a step is shown.
 */
export function lengthsOf(
  nodes: readonly SourceDescriptor[],
  parentOf: (one: SourceDescriptor) => string | undefined,
  scope: LengthScope,
): Lengths {
  const totals = partWords(
    nodes.map((one) => {
      const parentId = parentOf(one);
      return {
        id: one.id,
        ...(parentId !== undefined ? { parentId } : {}),
        ...(one.words !== undefined ? { words: one.words } : {}),
      };
    }),
  );
  const root = scope.kind === "node" ? `node:${scope.nodeId}` : undefined;
  const frame = nodes.filter((one) => parentOf(one) === root);
  const counted = frame.map((one) => totals.get(one.id));
  const whole = counted.every((one) => one !== undefined)
    ? counted.reduce<number>((sum, one) => sum + (one ?? 0), 0)
    : 0;
  const of = root ? "of the Part" : "of the manuscript";
  return {
    frame,
    say: (id, place) => {
      const words = totals.get(id);
      if (words === undefined) return null;
      const count = `${words} ${words === 1 ? "word" : "words"}`;
      return place === "row" && whole > 0
        ? `${count}, ${shareOf(words, whole)} ${of}`
        : count;
    },
  };
}
