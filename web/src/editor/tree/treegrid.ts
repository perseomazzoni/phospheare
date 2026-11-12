// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── Where a key moves focus in the structure panel's treegrid ───────────────
//
// The panel is a treegrid: rows nested by level, each row a line of controls
// (the fold chevron, the selection box, the title, the summary mark, the
// actions menu). The keys follow the treegrid pattern of the `ARIA` Authoring
// Practices:
//
//   * Up and Down move between the visible rows, Home and End to the first
//     and the last;
//   * Right opens a folded row, and otherwise steps into the row's controls
//     and along them;
//   * Left closes an open row, and otherwise steps out to the row and up to
//     its parent;
//   * Enter on a row does what pressing its title does;
//   * `Shift+F10` and the context-menu key open the row's actions.
//
// A row that is only a line of controls (the add labels, a landing, a name
// field) takes no focus itself: arriving on it lands on its first control.
//
// This module decides and the DOM adapter (`useTreegrid`) acts, so the rules
// are tested without a document.

/** One visible row, as the keys see it. */
export interface GridRow {
  /** Whether the row itself takes focus; a row of controls alone does not. */
  focusable: boolean;
  /** `true` open, `false` folded, `undefined` for a row that does not fold. */
  expanded?: boolean;
  /** The row this one sits inside, by index in the same list, or null. */
  parent: number | null;
  /** How many controls the row holds, in reading order. */
  controls: number;
}

/** A focus position: a row, or one of its controls by index. */
export interface Spot {
  row: number;
  /** Null for the row itself. */
  control: number | null;
}

/** What a key does, or null when the panel leaves the key alone. */
export type Step =
  | { kind: "focus"; to: Spot }
  | { kind: "toggle"; row: number }
  | { kind: "activate"; row: number }
  | { kind: "menu"; row: number };

/** Where focus lands on arriving at a row, or null for a row with none. */
function landing(rows: readonly GridRow[], index: number): Spot | null {
  const row = rows[index];
  if (row.focusable) return { row: index, control: null };
  return row.controls > 0 ? { row: index, control: 0 } : null;
}

/** The first reachable row from `from` in steps of `by`, or null. */
function seek(rows: readonly GridRow[], from: number, by: 1 | -1): Spot | null {
  for (let i = from; i >= 0 && i < rows.length; i += by) {
    const spot = landing(rows, i);
    if (spot) return spot;
  }
  return null;
}

const focus = (to: Spot | null): Step | null =>
  to ? { kind: "focus", to } : null;

/**
 * The step a key takes from `at`. `shift` matters for `F10` alone; any other
 * modifier is the caller's to filter out, since a chord belongs to the app.
 */
export function step(
  rows: readonly GridRow[],
  at: Spot,
  key: string,
  shift: boolean,
): Step | null {
  const row = rows[at.row];
  if (!row) return null;
  const onRow = at.control === null;

  switch (key) {
    case "ArrowDown":
      return focus(seek(rows, at.row + 1, 1));
    case "ArrowUp":
      return focus(seek(rows, at.row - 1, -1));
    case "Home":
      return focus(seek(rows, 0, 1));
    case "End":
      return focus(seek(rows, rows.length - 1, -1));
    case "ArrowRight":
      if (onRow) {
        if (row.expanded === false) return { kind: "toggle", row: at.row };
        return row.controls > 0
          ? { kind: "focus", to: { row: at.row, control: 0 } }
          : null;
      }
      return at.control !== null && at.control + 1 < row.controls
        ? { kind: "focus", to: { row: at.row, control: at.control + 1 } }
        : null;
    case "ArrowLeft":
      if (onRow) {
        if (row.expanded === true) return { kind: "toggle", row: at.row };
        return row.parent === null ? null : focus(landing(rows, row.parent));
      }
      if (at.control !== null && at.control > 0)
        return { kind: "focus", to: { row: at.row, control: at.control - 1 } };
      return row.focusable
        ? { kind: "focus", to: { row: at.row, control: null } }
        : null;
    case "Enter":
      // On a control, the control's own press answers.
      return onRow ? { kind: "activate", row: at.row } : null;
    case "ContextMenu":
      return { kind: "menu", row: at.row };
    case "F10":
      return shift ? { kind: "menu", row: at.row } : null;
    default:
      return null;
  }
}
