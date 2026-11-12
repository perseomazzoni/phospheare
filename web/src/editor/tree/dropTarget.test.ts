// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  GUTTER,
  INDENT,
  flattenRows,
  isNoOp,
  pickSlot,
  slotsForGap,
  type Slot,
} from "./dropTarget";
import { indentFor } from "./TreeRow";
import { findNode } from "../../project/structure";
import { snapshotFileName, toSlug } from "../../project/naming";
import type {
  DocNode,
  DocumentStructure,
  PartNode,
  SectionNode,
} from "../../project/types";

// The insertion line is the whole interface for moving things, so where it can
// and cannot appear is worth pinning down precisely. The ambiguous case — the
// gap at the end of a nested list — is the one that earns its keep here.
//
// Rows are keyed by node id — the identity a rename cannot touch — so every
// fixture pins its ids (`EL1`…`EL6`) and lets the file names follow the
// titles through the one transliteration the app uses (`snapshotFileName` +
// `toSlug`).

function section(id: string, name: string): SectionNode {
  return {
    kind: "section",
    id,
    title: name,
    adopted: snapshotFileName("section", toSlug(name), id, 0),
    snapshots: [
      {
        file: snapshotFileName("section", toSlug(name), id, 0),
        title: name,
        created: "",
      },
    ],
  };
}

function part(id: string, name: string, children: DocNode[] = []): PartNode {
  return {
    kind: "part",
    id,
    title: name,
    adopted: snapshotFileName("part", toSlug(name), id, 0),
    snapshots: [
      {
        file: snapshotFileName("part", toSlug(name), id, 0),
        title: name,
        created: "",
      },
    ],
    children,
  };
}

function doc(children: DocNode[]): DocumentStructure {
  return { version: 1, children };
}

/** The pointer X that sits exactly on a given indent level. */
const xAtDepth = (depth: number) => GUTTER + depth * INDENT;

const NESTED = doc([
  part("EL1", "act-one", [
    section("EL2", "opening"),
    section("EL3", "the-storm"),
  ]),
  part("EL4", "act-two", [section("EL5", "arrival")]),
  part("EL6", "act-three"),
]);

const OPEN = new Set(["EL1", "EL4"]);

/** Compact view of a slot, for readable expectations. */
const shape = (slot: Slot | null) =>
  slot ? `${slot.containerId ?? "root"}@${slot.index}/d${slot.depth}` : null;

describe("flattenRows", () => {
  it("lists only what is visible", () => {
    const rows = flattenRows(NESTED, OPEN);
    expect(rows.map((r) => r.id)).toEqual([
      "EL1",
      "EL2",
      "EL3",
      "EL4",
      "EL5",
      "EL6",
    ]);
  });

  it("hides the children of a collapsed Part", () => {
    const rows = flattenRows(NESTED, new Set());
    expect(rows.map((r) => r.id)).toEqual(["EL1", "EL4", "EL6"]);
  });

  it("records depth, parent and position", () => {
    const rows = flattenRows(NESTED, OPEN);
    expect(rows[2]).toMatchObject({
      id: "EL3",
      depth: 1,
      parentId: "EL1",
      index: 1,
      isOpen: false,
    });
    expect(rows[0]).toMatchObject({
      depth: 0,
      parentId: null,
      index: 0,
      isOpen: true,
    });
  });
});

describe("slotsForGap", () => {
  const rows = flattenRows(NESTED, OPEN);

  it("reads the gap above everything as the top of the root", () => {
    expect(slotsForGap(rows, 0).map(shape)).toEqual(["root@0/d0"]);
  });

  it("reads the gap under an open Part as its first child slot", () => {
    expect(slotsForGap(rows, 1).map(shape)).toEqual(["EL1@0/d1"]);
  });

  it("reads a gap between siblings as one slot in their container", () => {
    expect(slotsForGap(rows, 2).map(shape)).toEqual(["EL1@1/d1"]);
  });

  it("offers every reading at the end of a nested list, shallowest first", () => {
    // After 'the storm', the pointer could mean a third Section of act one, or
    // a new Part after act one. Both are returned; X decides.
    expect(slotsForGap(rows, 3).map(shape)).toEqual(["root@1/d0", "EL1@2/d1"]);
  });

  it("reads the gap after the last row as the end of the root", () => {
    expect(slotsForGap(rows, rows.length).map(shape)).toEqual(["root@3/d0"]);
  });

  it("offers the inside of an open, empty Part as well as the level around it", () => {
    const withEmptyOpen = flattenRows(NESTED, new Set([...OPEN, "EL6"]));
    // Without this reading there would be no way to drop anything into an
    // empty Part at all.
    expect(slotsForGap(withEmptyOpen, withEmptyOpen.length).map(shape)).toEqual(
      ["root@3/d0", "EL6@0/d1"],
    );
  });
});

describe("pickSlot", () => {
  const rows = flattenRows(NESTED, OPEN);
  const endOfActOne = slotsForGap(rows, 3);
  /** The live node, as the tree's drag hands it over. */
  const live = (structure: DocumentStructure, id: string) => {
    const node = findNode(structure, id);
    if (!node) throw new Error(`no such node: ${id}`);
    return node;
  };

  it("drops readings the Golden Rule forbids", () => {
    // A Section cannot join a root that holds Parts, so only the deep reading
    // survives — and it survives at every X, including the shallowest.
    expect(
      shape(
        pickSlot(NESTED, live(NESTED, "EL5"), endOfActOne, xAtDepth(0), false),
      ),
    ).toBe("EL1@2/d1");
  });

  it("drops the other reading for a Part, symmetrically", () => {
    // A Part cannot join act one, which holds Sections.
    expect(
      shape(
        pickSlot(NESTED, live(NESTED, "EL4"), endOfActOne, xAtDepth(9), false),
      ),
    ).toBe("root@1/d0");
  });

  it("returns nothing when no reading in the gap is legal", () => {
    const insideActOne = slotsForGap(rows, 2);
    expect(
      pickSlot(NESTED, live(NESTED, "EL4"), insideActOne, xAtDepth(1), false),
    ).toBeNull();
  });

  describe("when both readings are legal, X chooses", () => {
    //   part--a  (open)
    //     part--b
    //   part--c
    const parts = doc([part("EL1", "a", [part("EL2", "b")]), part("EL3", "c")]);
    const partRows = flattenRows(parts, new Set(["EL1"]));
    const gap = slotsForGap(partRows, 2);
    const c = live(parts, "EL3");

    it("offers both", () => {
      expect(gap.map(shape)).toEqual(["root@1/d0", "EL1@1/d1"]);
    });

    it("lands at the root when the pointer is to the left", () => {
      expect(shape(pickSlot(parts, c, gap, xAtDepth(0), false))).toBe(
        "root@1/d0",
      );
    });

    it("lands inside the Part when the pointer is at its indent", () => {
      expect(shape(pickSlot(parts, c, gap, xAtDepth(1), false))).toBe(
        "EL1@1/d1",
      );
    });

    it("snaps to the deepest legal reading past the end of the indents", () => {
      expect(shape(pickSlot(parts, c, gap, xAtDepth(6), false))).toBe(
        "EL1@1/d1",
      );
    });

    it("snaps to the shallowest legal reading to the left of the gutter", () => {
      expect(shape(pickSlot(parts, c, gap, -40, false))).toBe("root@1/d0");
    });
  });

  // The X is read against the tree's own indent, so a pointer on a row's
  // left edge means that row's depth.
  describe("X is read against the indent the rows are drawn with", () => {
    //   part--a  (open)
    //     part--b  (open)
    //       part--c
    //   part--d
    const deep = doc([
      part("EL1", "a", [part("EL2", "b", [part("EL3", "c")])]),
      part("EL4", "d"),
    ]);
    const deepRows = flattenRows(deep, new Set(["EL1", "EL2"]));
    const gap = slotsForGap(deepRows, 3);
    const d = live(deep, "EL4");
    const edgeOf = (depth: number) => parseFloat(indentFor(depth).paddingLeft);

    it("offers a reading at every depth", () => {
      expect(gap.map(shape)).toEqual(["root@1/d0", "EL1@1/d1", "EL2@1/d2"]);
    });

    it("lands at each depth when the pointer sits on that depth's edge", () => {
      expect(shape(pickSlot(deep, d, gap, edgeOf(0), false))).toBe("root@1/d0");
      expect(shape(pickSlot(deep, d, gap, edgeOf(1), false))).toBe("EL1@1/d1");
      expect(shape(pickSlot(deep, d, gap, edgeOf(2), false))).toBe("EL2@1/d2");
    });
  });

  describe("a bin restore (external)", () => {
    it("restores a Section into a Part that holds Sections, or none", () => {
      expect(
        shape(
          pickSlot(
            NESTED,
            section("EL7", "new"),
            endOfActOne,
            xAtDepth(1),
            true,
          ),
        ),
      ).toBe("EL1@2/d1");
    });

    it("refuses a Section at a root that holds Parts", () => {
      // The gap after the last row has a single reading — the root — and a
      // Section cannot join a root of Parts.
      const afterEverything = slotsForGap(rows, rows.length);
      expect(
        pickSlot(
          NESTED,
          section("EL7", "new"),
          afterEverything,
          xAtDepth(0),
          true,
        ),
      ).toBeNull();
    });

    it("refuses a Part whose child id collides with a live node, at any depth", () => {
      // act three holds nothing, so the kind rule passes; the child id
      // (`EL2` is already live) is the only thing standing between the
      // restore and a document with two indistinguishable nodes.
      const withCollision = part("EL8", "new", [section("EL2", "opening")]);
      expect(
        pickSlot(NESTED, withCollision, endOfActOne, xAtDepth(1), true),
      ).toBeNull();
    });
  });
});

describe("isNoOp", () => {
  const flat = doc([
    section("EL1", "one"),
    section("EL2", "two"),
    section("EL3", "three"),
  ]);

  it("recognises a drop that changes nothing", () => {
    // 'two' sits at index 1; both the slot before it and the slot after it
    // leave the order as it was.
    expect(
      isNoOp(flat, "EL2", {
        containerId: null,
        index: 1,
        depth: 0,
      }),
    ).toBe(true);
    expect(
      isNoOp(flat, "EL2", {
        containerId: null,
        index: 2,
        depth: 0,
      }),
    ).toBe(true);
  });

  it("recognises a drop that does change something", () => {
    expect(
      isNoOp(flat, "EL2", {
        containerId: null,
        index: 0,
        depth: 0,
      }),
    ).toBe(false);
    expect(
      isNoOp(flat, "EL2", {
        containerId: null,
        index: 3,
        depth: 0,
      }),
    ).toBe(false);
  });

  it("is never a no-op when the container changes", () => {
    expect(
      isNoOp(NESTED, "EL5", {
        containerId: "EL1",
        index: 0,
        depth: 1,
      }),
    ).toBe(false);
  });
});

describe("a group in the air", () => {
  const rows = flattenRows(NESTED, new Set(["EL1", "EL4"]));
  const endOfActOne = slotsForGap(rows, 3);
  const arrival = findNode(NESTED, "EL5") as DocNode;

  it("offers a reading only where the whole group can land", () => {
    // Two Sections: act one takes them, the root (which holds Parts) does not.
    expect(
      shape(
        pickSlot(NESTED, arrival, endOfActOne, xAtDepth(0), false, [
          "EL5",
          "EL2",
        ]),
      ),
    ).toBe("EL1@2/d1");
  });

  it("offers nothing for a group of mixed kinds", () => {
    expect(
      // arrival sits in act two, so act one is a Part beside it, not around it.
      pickSlot(NESTED, arrival, endOfActOne, xAtDepth(1), false, [
        "EL5",
        "EL1",
      ]),
    ).toBeNull();
  });

  it("is a no-op only for an unbroken run left where it is", () => {
    const flat = doc([
      section("EL1", "one"),
      section("EL2", "two"),
      section("EL3", "three"),
    ]);
    const at = (index: number): Slot => ({
      containerId: null,
      index,
      depth: 0,
    });
    expect(isNoOp(flat, "EL1", at(1), ["EL1", "EL2"])).toBe(true);
    expect(isNoOp(flat, "EL1", at(3), ["EL1", "EL2"])).toBe(false);
    // A gap in the run: landing anywhere closes it.
    expect(isNoOp(flat, "EL1", at(1), ["EL1", "EL3"])).toBe(false);
  });
});
