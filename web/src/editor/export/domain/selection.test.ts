// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ReferenceEntry } from "./book";
import {
  groupPickId,
  manuscriptForest,
  notesForest,
  referenceForest,
  selectableIds,
  tickCount,
  tickState,
  toggle,
  toggleAll,
  type PickNode,
} from "./selection";

const leaf = (id: string): PickNode => ({
  id,
  title: id,
  own: true,
  children: [],
});

// A Part with text of its own over two Sections, a loose Section, and a
// heading-only group over two documents: the three shapes the window draws.
const FOREST: PickNode[] = [
  { id: "p1", title: "Part", own: true, children: [leaf("s1"), leaf("s2")] },
  leaf("s3"),
  { id: "g", title: "Group", own: false, children: [leaf("r1"), leaf("r2")] },
];

describe("a tick tree's state", () => {
  it("selects only nodes with content of their own", () => {
    expect([...selectableIds(FOREST)]).toEqual([
      "p1",
      "s1",
      "s2",
      "s3",
      "r1",
      "r2",
    ]);
  });

  it("is on, off or mixed by what is under it", () => {
    expect(tickState(FOREST, selectableIds(FOREST))).toBe("on");
    expect(tickState(FOREST, new Set())).toBe("off");
    expect(tickState(FOREST, new Set(["s1"]))).toBe("mixed");
    // A heading's tick is its children's.
    expect(tickState([FOREST[2]], new Set(["r1", "r2"]))).toBe("on");
  });

  it("counts the ticked documents under a tree, headings never among them", () => {
    expect(tickCount(FOREST, new Set(["s1", "r2"]))).toEqual({ on: 2, all: 6 });
    // An id the tree does not hold is not counted.
    expect(tickCount([FOREST[2]], new Set(["r1", "s1"]))).toEqual({
      on: 1,
      all: 2,
    });
  });

  it("is off for an empty tree, never on", () => {
    expect(tickState([], new Set())).toBe("off");
  });
});

describe("clicking a tick", () => {
  it("turns a whole subtree on, mixed resolving upward", () => {
    const next = toggle(FOREST, new Set(["s1"]), "p1");
    expect([...next].sort()).toEqual(["p1", "s1", "s2"]);
  });

  it("turns a fully ticked subtree off", () => {
    const next = toggle(FOREST, new Set(["p1", "s1", "s2", "s3"]), "p1");
    expect([...next]).toEqual(["s3"]);
  });

  it("ticks the Part above a Section, so no Section leaves without its heading", () => {
    expect([...toggle(FOREST, new Set(), "s2")].sort()).toEqual(["p1", "s2"]);
  });

  it("ticks a heading's documents and never the heading itself", () => {
    expect([...toggle(FOREST, new Set(), "g")].sort()).toEqual(["r1", "r2"]);
  });

  it("leaves the selection as it was for an id the tree does not hold", () => {
    expect([...toggle(FOREST, new Set(["s3"]), "gone")]).toEqual(["s3"]);
  });

  it("selects all or nothing for a whole area", () => {
    expect(toggleAll(FOREST, new Set(["s1"])).size).toBe(6);
    expect(toggleAll(FOREST, selectableIds(FOREST)).size).toBe(0);
  });
});

describe("the three trees", () => {
  it("draws Parts over their Sections, every node selectable", () => {
    const forest = manuscriptForest([
      {
        id: "p",
        kind: "part",
        title: "One",
        children: [{ id: "s", kind: "section", title: "A", children: [] }],
      },
      { id: "t", kind: "section", title: "B", children: [] },
    ]);
    expect(
      forest.map((node) => [node.id, node.own, node.children.length]),
    ).toEqual([
      ["p", true, 1],
      ["t", true, 0],
    ]);
  });

  const entries: ReferenceEntry[] = [
    { fileName: "guidebook--logline.md", group: "guidebook", title: "Logline" },
    { fileName: "character--ada.md", group: "characters", title: "Ada" },
    { fileName: "arc--ada.md", group: "arcs", title: "Ada's arc" },
    { fileName: "character--bo.md", group: "characters", title: "Bo" },
    { fileName: "summary--p.md", group: "summaries", title: "One" },
    { fileName: "note--idea.md", group: "notes", title: "Idea" },
  ];

  it("groups references in reading order, each arc under its character", () => {
    const forest = referenceForest(entries, (group) => group.toUpperCase());
    expect(forest.map((node) => [node.id, node.title, node.own])).toEqual([
      [groupPickId("guidebook"), "GUIDEBOOK", false],
      [groupPickId("characters"), "CHARACTERS", false],
      [groupPickId("summaries"), "SUMMARIES", false],
    ]);
    const characters = forest[1].children;
    expect(characters.map((node) => node.id)).toEqual([
      "character--ada.md",
      "character--bo.md",
    ]);
    expect(characters[0].children.map((node) => node.id)).toEqual([
      "arc--ada.md",
    ]);
    // Notes are their own area, never a reference group.
    expect(selectableIds(forest).has("note--idea.md")).toBe(false);
  });

  it("drops an arc with no character before it rather than inventing one", () => {
    const forest = referenceForest(
      [{ fileName: "arc--x.md", group: "arcs", title: "X's arc" }],
      String,
    );
    expect(forest).toEqual([]);
  });

  it("lists notes flat", () => {
    expect(notesForest(entries).map((node) => node.id)).toEqual([
      "note--idea.md",
    ]);
  });

  it("never lets a group heading's id be a file name", () => {
    expect(groupPickId("world")).toContain(":");
  });
});
