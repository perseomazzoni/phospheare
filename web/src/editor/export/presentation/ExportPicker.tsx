// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { Tick, type TickChecked } from "../../../ui";
import {
  tickState,
  toggle,
  type PickNode,
  type TickState,
} from "../domain/selection";

// A tree of ticks: one component for the three trees the export window offers
// (Parts and Sections, References by group, Notes), so the three behave as
// one control. The arithmetic is `domain/selection.ts`; this draws it,
// each row the kit's `Tick`, whose `role="checkbox"` carries the third
// state a tree needs: a heading over a partial pick is `aria-checked="mixed"`.
// Depth is an inline custom property, the one number the stylesheet cannot
// know.

/** A tree's state as the kit's row draws it, the one mapping the window has. */
export function checkedOf(state: TickState): TickChecked {
  return state === "mixed" ? "mixed" : state === "on";
}

export default function ExportPicker({
  forest,
  selected,
  onChange,
  label,
}: {
  forest: readonly PickNode[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** The tree's accessible name. */
  label: string;
}) {
  const rows: React.ReactNode[] = [];
  const visit = (node: PickNode, depth: number) => {
    rows.push(
      <Tick
        key={node.id}
        checked={checkedOf(tickState([node], selected))}
        className="export-tick"
        style={{ "--export-depth": depth } as React.CSSProperties}
        onToggle={() => onChange(toggle(forest, selected, node.id))}
      >
        {node.title}
      </Tick>,
    );
    node.children.forEach((child) => visit(child, depth + 1));
  };
  forest.forEach((node) => visit(node, 0));
  return (
    <div className="export-tree ui-scroll" role="group" aria-label={label}>
      {rows}
    </div>
  );
}
