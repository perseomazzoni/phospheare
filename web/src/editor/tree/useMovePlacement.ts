// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useProjectActions } from "../ProjectContext";
import { walk } from "../../project/structure";
import {
  restoreTargets,
  selectionMoveTargets,
  type MoveGroup,
  type MoveTarget,
} from "../../project/moveTargets";
import { normalizeSelection } from "../../project/mutations";
import type { DocNode, DocumentStructure } from "../../project/types";
import { ROOT_KEY } from "./TreeRow";

/** What a Move… carries: rows of the tree by id, or one node out of the bin. */
export type Placing =
  { from: "tree"; ids: readonly string[] } | { from: "bin"; node: DocNode };

/**
 * A Move… in the structure panel: what is in the air, where it may land,
 * and the landing.
 */
export function useMovePlacement({
  structure,
  expanded,
  selectedSet,
  clearSelection,
}: {
  structure: DocumentStructure | null;
  /** The writer's open Parts, which a move opens further while it runs. */
  expanded: Set<string>;
  selectedSet: ReadonlySet<string>;
  clearSelection: () => void;
}) {
  const { moveNodesTo, restoreFromBin } = useProjectActions();
  /**
   * Whose destinations are being read out, or null.
   *
   * A node in the tree is held by id: the structure reloads under this
   * dialog whenever anything is written, and a captured node would go stale
   * while the writer reads the list. One coming out of the bin is held
   * whole, because it is not in the structure to be looked up.
   */
  const [placing, setPlacing] = useState<Placing | null>(null);

  // Nothing is placed on a structure that has gone: a reload of the folder, or
  // a second window, can take the node away while the writer is choosing.
  useEffect(() => {
    if (!placing) return;
    if (!structure) return void setPlacing(null);
    if (
      placing.from === "tree" &&
      normalizeSelection(structure, placing.ids).length === 0
    )
      setPlacing(null);
  }, [placing, structure]);

  // Escape leaves the move. A plain window listener, because this is a mode
  // inside a panel, not a layer. The overlay stack stops Escape where it is
  // spent, so a dialog opened over the panel closes itself and leaves
  // the move standing.
  useEffect(() => {
    if (!placing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setPlacing(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [placing]);

  // One enumeration, two rules: a node inside the tree is bound by `canDrop`,
  // one coming out of the bin by `canRestore`. `moveTargets.ts` owns both.
  const placingGroups: MoveGroup[] = useMemo(() => {
    if (!structure || !placing) return [];
    return placing.from === "tree"
      ? selectionMoveTargets(structure, placing.ids)
      : restoreTargets(structure, placing.node);
  }, [structure, placing]);

  /** The same list as a lookup, so a row can ask about its own gaps. */
  const landings = useMemo(() => {
    const byContainer = new Map<string, Map<number, MoveTarget>>();
    for (const group of placingGroups) {
      byContainer.set(
        group.containerId ?? ROOT_KEY,
        new Map(group.targets.map((target) => [target.index, target])),
      );
    }
    return byContainer;
  }, [placingGroups]);

  /**
   * Every Part opens while a move is running.
   *
   * A landing inside a collapsed Part would be invisible. Held apart from the
   * writer's `expanded` set: this is what the panel shows during the move, not
   * a preference, and the tree returns to the writer's shape when it ends.
   */
  const shownExpanded = useMemo(() => {
    if (!placing || !structure) return expanded;
    const all = new Set(expanded);
    walk(structure.children, (node) => {
      if (node.kind === "part") all.add(node.id);
    });
    return all;
  }, [placing, structure, expanded]);

  const land = useCallback(
    (target: MoveTarget) => {
      if (!placing) return;
      setPlacing(null);
      if (placing.from === "tree") {
        if (placing.ids.some((id) => selectedSet.has(id))) clearSelection();
        void moveNodesTo(placing.ids, target.containerId, target.index);
      } else
        void restoreFromBin(placing.node.id, target.containerId, target.index);
    },
    [placing, moveNodesTo, restoreFromBin, selectedSet, clearSelection],
  );

  return { placing, setPlacing, placingGroups, landings, shownExpanded, land };
}
