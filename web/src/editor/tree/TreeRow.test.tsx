// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { sameRow, type RowContext, type RowProps } from "./TreeRow";
import { filePath } from "../../project/naming";
import type { DocNode, PartNode, SectionNode } from "../../project/types";

// ── Which rows draw again ────────────────────────────────────────────────────
//
// A row is memoised on `sameRow`, and the panel hands every row
// one context that changes for one node at a time. What is pinned here is the
// contract both ways: a change about another node leaves the row alone, and a
// change about the row — or about anything a Part draws inside itself — never
// does.
// A comparison that said "same" too often would leave a stale row on screen,
// which is the worse of the two failures.

const section = (id: string): SectionNode => ({
  kind: "section",
  id,
  title: id,
  adopted: `section--${id}.${id}.00.md`,
  snapshots: [],
});

const part = (id: string, children: DocNode[]): PartNode => ({
  kind: "part",
  id,
  title: id,
  adopted: `part--${id}.${id}.00.md`,
  snapshots: [],
  children,
});

const S2 = section("S2");
const S3 = section("S3");
const P1 = part("P1", [S2]);
const P4 = part("P4", [S3]);
const structure = { version: 1, children: [P1, P4] };

const noop = () => {};

function context(): RowContext {
  return {
    structure,
    expanded: new Set(["P1"]),
    activeId: null,
    dragging: [],
    renaming: null,
    adding: null,
    words: new Map([
      ["S2", 10],
      ["S3", 20],
    ]),
    comments: new Map(),
    personas: [],
    sectionNumbers: new Map([
      ["S2", 1],
      ["S3", 2],
    ]),
    summaries: new Set(),
    save: "saved",
    pendingPaths: new Set(),
    onToggle: noop,
    onOpenSummary: noop,
    onSummarise: undefined,
    onOpen: noop,
    onStartRename: noop,
    onCommitRename: noop,
    onAddKind: noop,
    onCommitAdd: noop,
    onCancelEdit: noop,
    onRemove: noop,
    onStartMove: noop,
    placing: false,
    moving: [],
    landings: new Map(),
    selection: new Set(),
    covered: new Set(),
    selectable: "any",
    onToggleSelect: noop,
    onLand: noop,
    onDragStart: noop,
  };
}

const props = (node: DocNode, ctx: RowContext): RowProps => ({
  node,
  depth: 0,
  ctx,
});

/** Whether `node`'s row keeps its drawing across `change`. */
function keeps(node: DocNode, change: Partial<RowContext>): boolean {
  const before = context();
  return sameRow(props(node, before), props(node, { ...before, ...change }));
}

describe("sameRow", () => {
  it("keeps a row when only another node's facts changed", () => {
    expect(
      keeps(S2, {
        words: new Map([
          ["S2", 10],
          ["S3", 99],
        ]),
      }),
    ).toBe(true);
    expect(keeps(P4, { expanded: new Set() })).toBe(true);
    expect(keeps(S2, { activeId: "S3" })).toBe(true);
    expect(keeps(S2, { pendingPaths: new Set([filePath(S3.adopted)]) })).toBe(
      true,
    );
  });

  it("draws a row again when its own facts changed", () => {
    expect(
      keeps(S2, {
        words: new Map([
          ["S2", 11],
          ["S3", 20],
        ]),
      }),
    ).toBe(false);
    expect(keeps(P1, { expanded: new Set() })).toBe(false);
    expect(keeps(S2, { activeId: "S2" })).toBe(false);
    expect(keeps(S2, { renaming: "S2" })).toBe(false);
    expect(keeps(S2, { summaries: new Set(["S2"]) })).toBe(false);
    expect(keeps(S2, { pendingPaths: new Set([filePath(S2.adopted)]) })).toBe(
      false,
    );
    expect(keeps(P1, { adding: { containerId: "P1", kind: "section" } })).toBe(
      false,
    );
  });

  it("draws a Part again when something inside it changed", () => {
    // The Part draws its children inside itself: if it kept its drawing, the
    // Section's new count would never reach the screen.
    expect(
      keeps(P1, {
        words: new Map([
          ["S2", 11],
          ["S3", 20],
        ]),
      }),
    ).toBe(false);
    expect(
      keeps(P4, {
        words: new Map([
          ["S2", 11],
          ["S3", 20],
        ]),
      }),
    ).toBe(true);
  });

  it("redraws only the open row for the save state", () => {
    const open = { ...context(), activeId: "S2" };
    const saving: RowContext = { ...open, save: "dirty" };
    expect(sameRow(props(S2, open), props(S2, saving))).toBe(false);
    expect(sameRow(props(S3, open), props(S3, saving))).toBe(true);
  });

  it("compares comment counts by what they count, not by object", () => {
    const counts = () => new Map([["S2", { personas: { p: 1 }, others: 2 }]]);
    const before = { ...context(), comments: counts() };
    expect(
      sameRow(props(S2, before), props(S2, { ...before, comments: counts() })),
    ).toBe(true);
    expect(
      sameRow(
        props(S2, before),
        props(S2, {
          ...before,
          comments: new Map([["S2", { personas: { p: 2 }, others: 2 }]]),
        }),
      ),
    ).toBe(false);
  });

  it("redraws every row for what every row reads", () => {
    // The structure decides every row's Move…; a handler that changed is one
    // the row would otherwise go on calling.
    expect(keeps(S2, { structure: { ...structure } })).toBe(false);
    expect(keeps(S2, { placing: true })).toBe(false);
    expect(keeps(S2, { onOpen: () => {} })).toBe(false);
    expect(keeps(S2, { onSummarise: noop })).toBe(false);
    // "Select" leaves every row's menu with the first tick.
    expect(keeps(S3, { selection: new Set(["S2"]) })).toBe(false);
  });

  it("redraws a ticked row when the rest of the selection moves", () => {
    const ticked = { ...context(), selection: new Set(["S2"]) };
    const more = { ...ticked, selection: new Set(["S2", "S3"]) };
    expect(sameRow(props(S2, ticked), props(S2, more))).toBe(false);
  });

  it("redraws a row whose node or place changed", () => {
    const ctx = context();
    expect(sameRow(props(S2, ctx), props({ ...S2, title: "x" }, ctx))).toBe(
      false,
    );
    expect(sameRow(props(S2, ctx), { ...props(S2, ctx), depth: 1 })).toBe(
      false,
    );
  });
});
