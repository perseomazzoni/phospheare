// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { step, type GridRow } from "./treegrid";

// A folded Part, an open Part with one Section, a Section at the top, and
// the root's add labels:
//
//   0  Part A        (folded)
//   1  Part B        (open)
//   2    Section b1
//   3    add labels  (two controls, no row focus)
//   4  Section c
//   5  add labels
const ROWS: GridRow[] = [
  { focusable: true, expanded: false, parent: null, controls: 3 },
  { focusable: true, expanded: true, parent: null, controls: 3 },
  { focusable: true, parent: 1, controls: 4 },
  { focusable: false, parent: 1, controls: 2 },
  { focusable: true, parent: null, controls: 3 },
  { focusable: false, parent: null, controls: 2 },
];

const row = (r: number) => ({ row: r, control: null });
const ctl = (r: number, c: number) => ({ row: r, control: c });

describe("the treegrid's keys", () => {
  it("Down and Up walk the visible rows, landing on a control row's first control", () => {
    expect(step(ROWS, row(1), "ArrowDown", false)).toEqual({
      kind: "focus",
      to: row(2),
    });
    expect(step(ROWS, row(2), "ArrowDown", false)).toEqual({
      kind: "focus",
      to: ctl(3, 0),
    });
    expect(step(ROWS, ctl(3, 1), "ArrowUp", false)).toEqual({
      kind: "focus",
      to: row(2),
    });
    // From a control, Down leaves the row for the next one.
    expect(step(ROWS, ctl(2, 2), "ArrowDown", false)).toEqual({
      kind: "focus",
      to: ctl(3, 0),
    });
  });

  it("stops at either end rather than wrapping", () => {
    expect(step(ROWS, row(0), "ArrowUp", false)).toBeNull();
    expect(step(ROWS, ctl(5, 0), "ArrowDown", false)).toBeNull();
  });

  it("Home and End reach the first and the last rows", () => {
    expect(step(ROWS, row(4), "Home", false)).toEqual({
      kind: "focus",
      to: row(0),
    });
    expect(step(ROWS, row(0), "End", false)).toEqual({
      kind: "focus",
      to: ctl(5, 0),
    });
  });

  it("skips a row that offers nothing to focus", () => {
    const rows: GridRow[] = [
      { focusable: true, parent: null, controls: 1 },
      { focusable: false, parent: null, controls: 0 },
      { focusable: true, parent: null, controls: 1 },
    ];
    expect(step(rows, row(0), "ArrowDown", false)).toEqual({
      kind: "focus",
      to: row(2),
    });
  });

  it("Right opens a folded row, and otherwise steps into and along the controls", () => {
    expect(step(ROWS, row(0), "ArrowRight", false)).toEqual({
      kind: "toggle",
      row: 0,
    });
    expect(step(ROWS, row(1), "ArrowRight", false)).toEqual({
      kind: "focus",
      to: ctl(1, 0),
    });
    expect(step(ROWS, ctl(2, 0), "ArrowRight", false)).toEqual({
      kind: "focus",
      to: ctl(2, 1),
    });
    expect(step(ROWS, ctl(2, 3), "ArrowRight", false)).toBeNull();
  });

  it("Left closes an open row, and otherwise climbs to the row and its parent", () => {
    expect(step(ROWS, row(1), "ArrowLeft", false)).toEqual({
      kind: "toggle",
      row: 1,
    });
    expect(step(ROWS, row(2), "ArrowLeft", false)).toEqual({
      kind: "focus",
      to: row(1),
    });
    expect(step(ROWS, ctl(2, 1), "ArrowLeft", false)).toEqual({
      kind: "focus",
      to: ctl(2, 0),
    });
    expect(step(ROWS, ctl(2, 0), "ArrowLeft", false)).toEqual({
      kind: "focus",
      to: row(2),
    });
    // A row of controls has no row to step out to.
    expect(step(ROWS, ctl(3, 0), "ArrowLeft", false)).toBeNull();
    // A folded row at the top has nowhere further left.
    expect(step(ROWS, row(0), "ArrowLeft", false)).toBeNull();
  });

  it("Enter activates a row, and leaves a control's own press alone", () => {
    expect(step(ROWS, row(4), "Enter", false)).toEqual({
      kind: "activate",
      row: 4,
    });
    expect(step(ROWS, ctl(4, 1), "Enter", false)).toBeNull();
  });

  it("Shift+F10 and the context-menu key open the row's actions", () => {
    expect(step(ROWS, row(2), "F10", true)).toEqual({ kind: "menu", row: 2 });
    expect(step(ROWS, ctl(2, 1), "ContextMenu", false)).toEqual({
      kind: "menu",
      row: 2,
    });
    expect(step(ROWS, row(2), "F10", false)).toBeNull();
  });

  it("leaves every other key to the page", () => {
    expect(step(ROWS, row(2), " ", false)).toBeNull();
    expect(step(ROWS, row(2), "a", false)).toBeNull();
    expect(step(ROWS, row(2), "Tab", false)).toBeNull();
  });
});
