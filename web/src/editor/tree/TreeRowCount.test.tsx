// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import TreeRow, { type RowContext } from "./TreeRow";
import type { DocNode, PartNode, SectionNode } from "../../project/types";

afterEach(cleanup);

// ── A row's count ────────────────────────────────────────────────────────────
//
// Every row shows its count at rest, and a Part counts its own words. A Part
// that holds only Sections has none of its own, and a 0 beside it would read
// as an empty Part, so it says nothing.

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

const S1 = section("S1");
const P1 = part("P1", [S1]);
const P2 = part("P2", []);
const noop = () => {};

function context(words: [string, number][]): RowContext {
  return {
    structure: { version: 1, children: [P1, P2] },
    expanded: new Set(),
    activeId: null,
    dragging: [],
    renaming: null,
    adding: null,
    words: new Map(words),
    comments: new Map(),
    personas: [],
    sectionNumbers: new Map([["S1", 1]]),
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
  } as unknown as RowContext;
}

const count = (node: DocNode, words: [string, number][]) => {
  const { container } = render(
    <div role="treegrid">
      <TreeRow node={node} depth={0} ctx={context(words)} />
    </div>,
  );
  // The row itself: a Part also draws its Sections' rows inside it.
  const row = container.querySelector(".dt-row");
  return row?.querySelector(":scope > .dt-words")?.textContent ?? null;
};

describe("a row's count", () => {
  it("says nothing beside a Part with no words of its own", () => {
    expect(
      count(P1, [
        ["P1", 0],
        ["S1", 412],
      ]),
    ).toBeNull();
  });

  it("shows a Part's own words when it has some", () => {
    expect(count(P2, [["P2", 280]])).toBe("280");
  });

  it("shows a Section's count, a 0 included", () => {
    expect(count(S1, [["S1", 0]])).toBe("0");
  });
});
