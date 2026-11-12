// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useMemo, useState } from "react";
import { findNode, walk } from "../../project/structure";
import { normalizeSelection } from "../../project/mutations";
import type { DocumentStructure, NodeKind } from "../../project/types";

/**
 * The structure panel's ticked rows.
 *
 * Ticked rows move together, by drag or by Move…. A selection is one
 * kind, every Section or every Part, because it lands in one container and
 * the Golden Rule gives a container one kind. The first tick decides, and
 * from then on only rows of that kind offer a box, so no tick can lead to a
 * move with nowhere to go.
 */
export function useTreeSelection(structure: DocumentStructure | null) {
  /**
   * The rows the writer has ticked, to move together.
   *
   * Stored normalized (document order, nothing covered by a ticked Part), so
   * unticking a Part never resurrects something ticked inside it before it
   * was absorbed. Read through `selected`, which normalizes again against the
   * live structure: a reload or an undo can take a ticked node away, and a
   * selection must never name a node that is gone.
   *
   * Panel-local and transient: a gesture in progress, not a preference, and
   * nothing outside this panel can act on it.
   */
  const [selection, setSelection] = useState<readonly string[]>([]);

  /** The live selection: ticked ids that still exist, in document order. */
  const selected = useMemo(
    () => (structure ? normalizeSelection(structure, selection) : []),
    [structure, selection],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectKind: NodeKind | null = useMemo(
    () =>
      structure && selected.length > 0
        ? (findNode(structure, selected[0])?.kind ?? null)
        : null,
    [structure, selected],
  );
  /**
   * Rows inside a ticked Part. They travel with it, so they carry the tint and
   * a checked box, locked: ticking or unticking a row that moves anyway would
   * say something the move cannot honour.
   */
  const covered = useMemo(() => {
    const inside = new Set<string>();
    if (!structure || selectKind !== "part") return inside;
    for (const id of selected) {
      const part = findNode(structure, id);
      if (part?.kind === "part")
        walk(part.children, (child) => inside.add(child.id));
    }
    return inside;
  }, [structure, selected, selectKind]);

  const toggleSelect = useCallback(
    (id: string) => {
      if (!structure) return;
      setSelection((current) =>
        current.includes(id)
          ? current.filter((other) => other !== id)
          : normalizeSelection(structure, [...current, id]),
      );
    },
    [structure],
  );
  const clearSelection = useCallback(() => setSelection([]), []);

  /**
   * What a gesture on `id` carries: the whole selection when the row is in
   * it, the row alone when it is not, so grabbing an unticked
   * row never drags the ticked ones along, nor drops them.
   */
  const groupFor = useCallback(
    (id: string): readonly string[] => (selectedSet.has(id) ? selected : [id]),
    [selected, selectedSet],
  );

  return {
    selected,
    selectedSet,
    selectKind,
    covered,
    toggleSelect,
    clearSelection,
    groupFor,
  };
}
