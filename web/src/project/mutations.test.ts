// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  addSnapshot,
  adoptSnapshot,
  canAdd,
  canDrop,
  canDropAll,
  canDropNode,
  canRestore,
  deleteSnapshot,
  defaultSnapshotTitle,
  EMPTY_CONTENT_HASH,
  insertNode,
  isMoveNoOp,
  moveNode,
  moveNodes,
  newNode,
  normalizeSelection,
  removeNode,
  removeToRemoved,
  renameNode,
  renameSnapshotTitle,
  restoreFromRemoved,
  restoreSnapshot,
  subtreeFileNames,
  type RenameNodeOutcome,
} from "./mutations";
import { childrenOf, findNode } from "./structure";
import { snapshotFileName, toSlug } from "./naming";
import { hashOf } from "../text/hash";
import type {
  DocNode,
  DocumentStructure,
  PartNode,
  SectionNode,
} from "./types";

// The Golden Rule lives in `canAdd` and `canDrop`. The panel asks one of them
// before it draws any affordance, so if these hold the interface cannot
// express a violation.

const snap = (file: string, title: string) => ({
  file,
  title,
  created: "2026-01-01T00:00:00.000Z",
});

function section(id: string, title: string): SectionNode {
  const file = snapshotFileName("section", toSlug(title), id, 0);
  return {
    kind: "section",
    id,
    title,
    adopted: file,
    snapshots: [snap(file, `${title} 1`)],
  };
}

function part(id: string, title: string, children: DocNode[] = []): PartNode {
  const file = snapshotFileName("part", toSlug(title), id, 0);
  return {
    kind: "part",
    id,
    title,
    adopted: file,
    snapshots: [snap(file, `${title} 1`)],
    children,
  };
}

function doc(children: DocNode[]): DocumentStructure {
  return { version: 1, children };
}

/** `renameNode` for a rename the test expects to go through. */
function renamed(
  structure: DocumentStructure,
  id: string,
  title: string,
): RenameNodeOutcome {
  const outcome = renameNode(structure, id, title);
  if (!outcome) throw new Error("rename refused");
  return outcome;
}

/** Child titles of a container, which is what the panel would show. */
function titlesIn(
  structure: DocumentStructure,
  containerId: string | null,
): string[] {
  return childrenOf(structure, containerId).map((c) => c.title);
}

const NESTED = doc([
  part("EL1", "act-one", [
    section("EL2", "opening"),
    section("EL3", "the-storm"),
  ]),
  part("EL4", "act-two", [section("EL5", "arrival")]),
  part("EL6", "act-three"),
]);

const FLAT = doc([
  section("EL1", "one"),
  section("EL2", "two"),
  section("EL3", "three"),
]);

describe("canAdd", () => {
  it("allows either kind in an empty container", () => {
    expect(canAdd(NESTED, "EL6", "part")).toBe(true);
    expect(canAdd(NESTED, "EL6", "section")).toBe(true);
    expect(canAdd(doc([]), null, "part")).toBe(true);
    expect(canAdd(doc([]), null, "section")).toBe(true);
  });

  it("allows only what a populated container already holds", () => {
    expect(canAdd(NESTED, null, "part")).toBe(true);
    expect(canAdd(NESTED, null, "section")).toBe(false);
    expect(canAdd(NESTED, "EL1", "section")).toBe(true);
    expect(canAdd(NESTED, "EL1", "part")).toBe(false);
  });

  it("refuses a Section as a container", () => {
    expect(canAdd(NESTED, "EL2", "section")).toBe(false);
  });
});

describe("canDrop", () => {
  it("allows a Section into a Part that holds Sections", () => {
    expect(canDrop(NESTED, "EL5", "EL1")).toBe(true);
  });

  it("allows a Section into an empty Part", () => {
    expect(canDrop(NESTED, "EL5", "EL6")).toBe(true);
  });

  it("refuses a Part into a Part that holds Sections", () => {
    expect(canDrop(NESTED, "EL4", "EL1")).toBe(false);
  });

  it("refuses a Section into a root that holds Parts", () => {
    expect(canDrop(NESTED, "EL2", null)).toBe(false);
  });

  it("still allows reordering inside the container a node already sits in", () => {
    // act-one holds Sections, and `opening` is one of them; excluding the
    // dragged node from the check keeps this legal.
    expect(canDrop(NESTED, "EL2", "EL1")).toBe(true);
  });

  it("allows the last child of a container to move back into it", () => {
    const single = doc([part("EL1", "a", [section("EL2", "only")])]);
    expect(canDrop(single, "EL2", "EL1")).toBe(true);
  });

  it("refuses a node dropped into itself", () => {
    expect(canDrop(NESTED, "EL1", "EL1")).toBe(false);
  });

  it("refuses a Part dropped inside its own subtree", () => {
    const deep = doc([
      part("EL1", "outer", [part("EL2", "inner", [section("EL3", "leaf")])]),
    ]);
    expect(canDrop(deep, "EL1", "EL2")).toBe(false);
  });

  it("refuses a Section as a destination", () => {
    expect(canDrop(NESTED, "EL5", "EL2")).toBe(false);
  });

  it("refuses a node that is not in the document", () => {
    expect(canDrop(NESTED, "EL99", null)).toBe(false);
  });
});

describe("moveNode", () => {
  it("moves a Section between Parts", () => {
    const next = moveNode(NESTED, "EL5", "EL1", 1);
    expect(titlesIn(next, "EL1")).toEqual(["opening", "arrival", "the-storm"]);
    expect(titlesIn(next, "EL4")).toEqual([]);
  });

  it("reorders within one container, downward", () => {
    // "Put `one` where index 2 is now": after removal that is index 1.
    const next = moveNode(FLAT, "EL1", null, 2);
    expect(titlesIn(next, null)).toEqual(["two", "one", "three"]);
  });

  it("reorders within one container, upward", () => {
    const next = moveNode(FLAT, "EL3", null, 0);
    expect(titlesIn(next, null)).toEqual(["three", "one", "two"]);
  });

  it("moves a Part with its whole subtree", () => {
    const next = moveNode(NESTED, "EL4", null, 0);
    expect(titlesIn(next, null)).toEqual(["act-two", "act-one", "act-three"]);
    expect(titlesIn(next, "EL4")).toEqual(["arrival"]);
  });

  it("clamps an index past the end", () => {
    const next = moveNode(FLAT, "EL1", null, 99);
    expect(titlesIn(next, null)).toEqual(["two", "three", "one"]);
  });

  it("leaves the structure alone when the node does not exist", () => {
    expect(moveNode(FLAT, "EL99", null, 0)).toEqual(FLAT);
  });

  it("does not mutate the structure it was given", () => {
    const before = JSON.stringify(NESTED);
    moveNode(NESTED, "EL5", "EL1", 0);
    expect(JSON.stringify(NESTED)).toBe(before);
  });
});

// ── Several at once ──────────────────────────────────────────────────────────
//
// Moving several ticked nodes in one act.

// Two Parts of Parts, so a ticked Part can cover another:
//   EL1 act-one          EL2 scene-a (Part, empty)   EL3 scene-b (Part, empty)
//   EL4 act-two          EL5 scene-c (Part, empty)
//   EL6 act-three (empty)
const PARTS = doc([
  part("EL1", "act-one", [part("EL2", "scene-a"), part("EL3", "scene-b")]),
  part("EL4", "act-two", [part("EL5", "scene-c")]),
  part("EL6", "act-three"),
]);

const FIVE = doc([
  section("EL1", "one"),
  section("EL2", "two"),
  section("EL3", "three"),
  section("EL4", "four"),
  section("EL5", "five"),
]);

describe("normalizeSelection", () => {
  it("reads the selection in document order, not in the order it was ticked", () => {
    expect(normalizeSelection(NESTED, ["EL5", "EL2"])).toEqual(["EL2", "EL5"]);
  });

  it("drops what a ticked Part already carries", () => {
    expect(normalizeSelection(PARTS, ["EL3", "EL1"])).toEqual(["EL1"]);
  });

  it("drops ids that are not in the document", () => {
    expect(normalizeSelection(NESTED, ["EL99", "EL3"])).toEqual(["EL3"]);
  });
});

describe("canDropAll", () => {
  it("refuses a group of mixed kinds anywhere", () => {
    for (const container of [null, "EL1", "EL4", "EL6"])
      expect(canDropAll(NESTED, ["EL2", "EL4"], container)).toBe(false);
  });

  it("judges a container with every moving node taken out", () => {
    // Lifting both of act one's Sections empties it, so it may take them back,
    // and a Part that holds Sections may take them too.
    expect(canDropAll(NESTED, ["EL2", "EL3"], "EL1")).toBe(true);
    expect(canDropAll(NESTED, ["EL2", "EL3"], "EL4")).toBe(true);
    expect(canDropAll(NESTED, ["EL2", "EL3"], "EL6")).toBe(true);
    // The root holds Parts.
    expect(canDropAll(NESTED, ["EL2", "EL3"], null)).toBe(false);
  });

  it("refuses a container inside any moving Part, or one of them", () => {
    expect(canDropAll(PARTS, ["EL1", "EL4"], "EL5")).toBe(false);
    expect(canDropAll(PARTS, ["EL1", "EL4"], "EL4")).toBe(false);
    expect(canDropAll(PARTS, ["EL1", "EL4"], "EL6")).toBe(true);
  });

  it("refuses an empty group", () => {
    expect(canDropAll(NESTED, [], null)).toBe(false);
  });
});

describe("moveNodes", () => {
  it("gathers Sections from two Parts into one, in document order", () => {
    // Ticked in the opposite order: the book's order is what lands.
    const next = moveNodes(NESTED, ["EL5", "EL2"], "EL6", 0);
    expect(titlesIn(next, "EL6")).toEqual(["opening", "arrival"]);
    expect(titlesIn(next, "EL1")).toEqual(["the-storm"]);
    expect(titlesIn(next, "EL4")).toEqual([]);
  });

  it("counts every moving sibling ahead of a downward landing", () => {
    // "after four", with one and three ahead of it: both vacate a place.
    const next = moveNodes(FIVE, ["EL1", "EL3"], null, 4);
    expect(titlesIn(next, null)).toEqual([
      "two",
      "four",
      "one",
      "three",
      "five",
    ]);
  });

  it("closes the gap in a broken run without leaving the container", () => {
    const next = moveNodes(FIVE, ["EL2", "EL4"], null, 0);
    expect(titlesIn(next, null)).toEqual([
      "two",
      "four",
      "one",
      "three",
      "five",
    ]);
  });

  it("carries a ticked Part's subtree and ignores the ids inside it", () => {
    const next = moveNodes(PARTS, ["EL1", "EL3"], "EL4", 1);
    expect(titlesIn(next, null)).toEqual(["act-two", "act-three"]);
    expect(titlesIn(next, "EL4")).toEqual(["scene-c", "act-one"]);
    expect(titlesIn(next, "EL1")).toEqual(["scene-a", "scene-b"]);
  });

  it("is moveNode for a group of one", () => {
    expect(moveNodes(FLAT, ["EL1"], null, 2)).toEqual(
      moveNode(FLAT, "EL1", null, 2),
    );
  });

  it("leaves the structure alone for an empty group", () => {
    expect(moveNodes(FLAT, ["EL99"], null, 0)).toBe(FLAT);
  });

  // An illegal landing is refused rather than rewritten: the nodes come out
  // of their container first, and a container that cannot take them would
  // drop the whole subtree.
  it("refuses a Section as the destination, keeping the subtree", () => {
    expect(moveNodes(NESTED, ["EL5"], "EL2", 0)).toBe(NESTED);
  });

  it("refuses a container that is not in the document", () => {
    expect(moveNodes(NESTED, ["EL4"], "EL99", 0)).toBe(NESTED);
  });

  it("refuses a Part landing inside its own subtree", () => {
    expect(moveNodes(PARTS, ["EL1"], "EL2", 0)).toBe(PARTS);
  });

  it("refuses a kind the container does not hold", () => {
    expect(moveNodes(NESTED, ["EL2"], null, 0)).toBe(NESTED);
  });
});

describe("isMoveNoOp", () => {
  it("is a no-op anywhere within or at the edge of an unbroken run", () => {
    for (const index of [1, 2, 3])
      expect(isMoveNoOp(FIVE, ["EL2", "EL3"], null, index)).toBe(true);
    expect(isMoveNoOp(FIVE, ["EL2", "EL3"], null, 0)).toBe(false);
    expect(isMoveNoOp(FIVE, ["EL2", "EL3"], null, 4)).toBe(false);
  });

  it("is never a no-op for a broken run: landing it closes the gap", () => {
    for (let index = 0; index <= 5; index++)
      expect(isMoveNoOp(FIVE, ["EL2", "EL4"], null, index)).toBe(false);
  });

  it("is never a no-op in a container the group is not in", () => {
    expect(isMoveNoOp(NESTED, ["EL2", "EL3"], "EL6", 0)).toBe(false);
  });
});

describe("insertNode and removeNode", () => {
  it("inserts at a position", () => {
    const next = insertNode(FLAT, section("EL9", "new"), null, 1);
    expect(titlesIn(next, null)).toEqual(["one", "new", "two", "three"]);
  });

  it("inserts into a nested Part", () => {
    const next = insertNode(NESTED, section("EL9", "new"), "EL4", 0);
    expect(titlesIn(next, "EL4")).toEqual(["new", "arrival"]);
  });

  it("removes a node from wherever it sits", () => {
    const next = removeNode(NESTED, "EL3");
    expect(titlesIn(next, "EL1")).toEqual(["opening"]);
  });

  it("removes a Part along with everything under it", () => {
    const next = removeNode(NESTED, "EL1");
    expect(titlesIn(next, null)).toEqual(["act-two", "act-three"]);
  });
});

describe("renameNode", () => {
  it("renames a node's display name and re-stems every snapshot file", () => {
    const next = renamed(NESTED, "EL2", "Overture");
    const node = childrenOf(next.structure, "EL1")[0];
    expect(node).toMatchObject({
      id: "EL2",
      title: "Overture",
      adopted: "section--overture.EL2.00.md",
    });
    // The shell consumes the file move inventory from this one place.
    expect(next.fileMoves).toEqual([
      ["section--opening.EL2.00.md", "section--overture.EL2.00.md"],
    ]);
  });

  it("re-stems every snapshot of a multi-snapshot node", () => {
    const storm = section("EL2", "the-storm");
    const base = doc([
      {
        ...storm,
        snapshots: [
          ...storm.snapshots,
          snap("section--the_storm.EL2.01.md", "The Storm 2"),
        ],
      },
    ]);
    const next = renamed(base, "EL2", "The Gale");
    expect(next.fileMoves).toEqual([
      ["section--the_storm.EL2.00.md", "section--the_gale.EL2.00.md"],
      ["section--the_storm.EL2.01.md", "section--the_gale.EL2.01.md"],
    ]);
    expect(next.structure.children[0].adopted).toBe(
      "section--the_gale.EL2.00.md",
    );
  });

  it("keeps the id — a rename is a name change, never an identity change", () => {
    const next = renamed(NESTED, "EL1", "Prologue");
    expect(next.structure.children[0].id).toBe("EL1");
  });

  it("re-stems a node whose title transliterates to an empty slug", () => {
    // "???" produces an empty slug and `part--.EL1.00.md`, a legal name (the
    // validator accepts the empty slug group). The rename re-stems it through
    // the naming module's own parser; a second parser requiring a dot body
    // would leave the file behind and write a yaml the strict validator
    // refuses on the next open.
    const emptySlugPart = part("EL1", "???");
    const next = renamed(doc([emptySlugPart]), "EL1", "Opening");
    expect(next.fileMoves).toEqual([
      ["part--.EL1.00.md", "part--opening.EL1.00.md"],
    ]);
    expect(next.structure.children[0].adopted).toBe("part--opening.EL1.00.md");
  });

  it("renames a Part without disturbing its children", () => {
    const next = renamed(NESTED, "EL1", "Prologue");
    expect(titlesIn(next.structure, "EL1")).toEqual(["opening", "the-storm"]);
  });

  it("leaves the structure alone when the title is unchanged", () => {
    const next = renamed(NESTED, "EL2", "opening");
    expect(next.fileMoves).toEqual([]);
    expect(next.structure).toEqual(NESTED);
  });

  it("gives a free counter to a snapshot that would land on another's file", () => {
    // Same counter, two slugs: a restored snapshot kept its old stem.
    const storm = section("EL2", "the-storm");
    const base = doc([
      {
        ...storm,
        snapshots: [
          ...storm.snapshots,
          snap("section--the_storm.EL2.01.md", "The Storm 2"),
          snap("section--the_gale.EL2.01.md", "The Gale 2"),
        ],
      },
    ]);
    const next = renameNode(base, "EL2", "Dawn");
    expect(next.fileMoves).toEqual([
      ["section--the_storm.EL2.00.md", "section--dawn.EL2.00.md"],
      ["section--the_storm.EL2.01.md", "section--dawn.EL2.01.md"],
      ["section--the_gale.EL2.01.md", "section--dawn.EL2.02.md"],
    ]);
    expect(
      findNode(next.structure, "EL2")?.snapshots.map((s) => s.file),
    ).toEqual([
      "section--dawn.EL2.00.md",
      "section--dawn.EL2.01.md",
      "section--dawn.EL2.02.md",
    ]);
  });

  it("counts past the binned snapshots for the free counter", () => {
    const storm = section("EL2", "the-storm");
    const base = doc([
      {
        ...storm,
        snapshots: [
          ...storm.snapshots,
          snap("section--the_storm.EL2.01.md", "The Storm 2"),
          snap("section--the_gale.EL2.01.md", "The Gale 2"),
        ],
      },
    ]);
    const binned = [snap("section--the_storm.EL2.04.md", "The Storm 5")];
    const next = renameNode(base, "EL2", "Dawn", binned);
    expect(next.fileMoves[next.fileMoves.length - 1]).toEqual([
      "section--the_gale.EL2.01.md",
      "section--dawn.EL2.05.md",
    ]);
  });

  it("keeps a file that already holds its name, and moves the other to a free counter", () => {
    const storm = section("EL2", "the-storm");
    const base = doc([
      {
        ...storm,
        snapshots: [
          ...storm.snapshots,
          snap("section--the_storm.EL2.01.md", "The Storm 2"),
          snap("section--dawn.EL2.01.md", "Dawn 2"),
        ],
      },
    ]);
    expect(renameNode(base, "EL2", "Dawn").fileMoves).toEqual([
      ["section--the_storm.EL2.00.md", "section--dawn.EL2.00.md"],
      ["section--the_storm.EL2.01.md", "section--dawn.EL2.02.md"],
    ]);
  });
});

describe("subtreeFileNames", () => {
  it("returns a lone Section's snapshot files", () => {
    expect(subtreeFileNames(NESTED, "EL2")).toEqual([
      "section--opening.EL2.00.md",
    ]);
  });

  it("returns a Part and everything beneath it", () => {
    expect(subtreeFileNames(NESTED, "EL1")).toEqual([
      "part--act_one.EL1.00.md",
      "section--opening.EL2.00.md",
      "section--the_storm.EL3.00.md",
    ]);
  });

  it("returns nothing for a node that is not there", () => {
    expect(subtreeFileNames(NESTED, "EL99")).toEqual([]);
  });

  it("lists each file of a three-level subtree once", () => {
    const deep = doc([
      part("EL1", "outer", [
        part("EL2", "inner", [part("EL3", "core", [section("EL4", "leaf")])]),
      ]),
    ]);
    expect(subtreeFileNames(deep, "EL1")).toEqual([
      "part--outer.EL1.00.md",
      "part--inner.EL2.00.md",
      "part--core.EL3.00.md",
      "section--leaf.EL4.00.md",
    ]);
  });
});

// ── The bin ──────────────────────────────────────────────────────────────────
//
// Removing a node sends its whole subtree to the `removed` list; restoring
// brings it back. The subtree survives both verbatim: children, their order,
// ids, snapshots and the bindings.

describe("removeToRemoved and restoreFromRemoved", () => {
  it("takes a Part and its whole subtree out, and keeps it in order", () => {
    const result = removeToRemoved(NESTED, "EL1");
    expect(result.removed).toMatchObject({
      kind: "part",
      id: "EL1",
      title: "act-one",
    });
    expect(titlesIn(result.structure, null)).toEqual(["act-two", "act-three"]);
    expect(result.structure.removed).toHaveLength(1);
  });

  it("leaves a lone Section alone as itself", () => {
    const result = removeToRemoved(NESTED, "EL5");
    expect(titlesIn(result.structure, "EL4")).toEqual([]);
    expect(result.structure.removed?.[0]).toMatchObject({
      kind: "section",
      id: "EL5",
    });
  });

  it("does nothing for a node that is not there", () => {
    const result = removeToRemoved(NESTED, "EL99");
    expect(result.removed).toBeNull();
    expect(result.structure).toEqual(NESTED);
  });

  it("restores a subtree to a container, structure intact", () => {
    const removed = removeToRemoved(NESTED, "EL1").structure;
    const next = restoreFromRemoved(removed, "EL1", null, 1);
    expect(titlesIn(next, null)).toEqual(["act-two", "act-one", "act-three"]);
    expect(titlesIn(next, "EL1")).toEqual(["opening", "the-storm"]);
    expect(next.removed).toEqual([]);
  });

  it("restores into a Part", () => {
    const removed = removeToRemoved(NESTED, "EL5").structure;
    const next = restoreFromRemoved(removed, "EL5", "EL6", 0);
    expect(titlesIn(next, "EL6")).toEqual(["arrival"]);
    expect(next.removed).toEqual([]);
  });

  it("restores without mutating the structure it was given", () => {
    const removed = removeToRemoved(NESTED, "EL5").structure;
    const before = JSON.stringify(removed);
    restoreFromRemoved(removed, "EL5", null, 0);
    expect(JSON.stringify(removed)).toBe(before);
  });

  it("refuses to restore a node that is not in the bin", () => {
    expect(restoreFromRemoved(NESTED, "EL99", null, 0)).toEqual(NESTED);
  });
});

describe("canDropNode", () => {
  it("allows an external Section into a container that holds Sections, or none", () => {
    expect(canDropNode(NESTED, section("EL9", "new"), "EL1")).toBe(true);
    expect(canDropNode(NESTED, section("EL9", "new"), "EL6")).toBe(true);
  });

  it("refuses an external Part into a container that holds Sections", () => {
    expect(
      canDropNode(NESTED, part("EL9", "new", [section("EL10", "x")]), "EL1"),
    ).toBe(false);
  });

  it("refuses into a Section, and accepts the root when its kind matches", () => {
    expect(canDropNode(NESTED, section("EL9", "new"), "EL2")).toBe(false);
    expect(canDropNode(NESTED, section("EL9", "new"), null)).toBe(false); // root holds Parts
  });
});

describe("canRestore", () => {
  it("allows a subtree whose ids and names are all free", () => {
    const node = part("EL9", "act-one", [section("EL10", "opening")]);
    expect(canRestore(doc([part("EL1", "act-two")]), node, null)).toBe(true);
  });

  it("refuses when an incoming id collides with a live node, at any depth", () => {
    expect(
      canRestore(
        NESTED,
        part("EL9", "new", [section("EL2", "opening")]),
        "EL6",
      ),
    ).toBe(false);
  });

  it("refuses when an incoming file collides with a live one", () => {
    // With the id in the name, only a hand-edited record can name another
    // node's file, and the check still refuses it.
    const crafted: PartNode = {
      ...part("EL9", "act-one"),
      adopted: "part--act_one.EL1.00.md",
      snapshots: [snap("part--act_one.EL1.00.md", "Act One 1")],
    };
    expect(canRestore(NESTED, crafted, null)).toBe(false);
  });

  it("restores a node whose title a live node already uses", () => {
    // Titles are free: the two files differ by their ids.
    expect(canRestore(NESTED, part("EL9", "act-one"), null)).toBe(true);
  });

  it("applies the kind rule as well as the name rule", () => {
    expect(canRestore(NESTED, section("EL9", "new"), "EL1")).toBe(true);
    expect(canRestore(NESTED, section("EL9", "new"), null)).toBe(false);
  });
});

// ── Snapshots ────────────────────────────────────────────────────────────────
//
// The snapshot ops are pure like the structural ops, a structure in and a
// structure out, with the file writes left to the shell's commit funnel.

describe("defaultSnapshotTitle", () => {
  it("numbers from one for a fresh node's second snapshot", () => {
    // The builder's `.00` snapshot already carries "<title> 1", so the next
    // default continues the count.
    expect(defaultSnapshotTitle(section("EL1", "The Storm"))).toBe(
      "The Storm 2",
    );
  });

  it("skips integers already used by sibling titles", () => {
    const node = {
      ...section("EL1", "The Storm"),
      snapshots: [
        snap("section--the_storm.EL1.00.md", "The Storm 1"),
        snap("section--the_storm.EL1.01.md", "The Storm 3"),
      ],
    };
    expect(defaultSnapshotTitle(node)).toBe("The Storm 2");
  });

  it("does not count a differently-named title as taken", () => {
    const node = {
      ...section("EL1", "The Storm"),
      snapshots: [
        snap("section--the_storm.EL1.00.md", "The Storm 1"),
        snap("section--the_storm.EL1.01.md", "Dawn"),
      ],
    };
    expect(defaultSnapshotTitle(node)).toBe("The Storm 2");
  });
});

describe("addSnapshot", () => {
  it("adds a snapshot at xy max+1, copying the adopted file", () => {
    const storm = section("EL1", "The Storm");
    const base = doc([
      {
        ...storm,
        snapshots: [
          ...storm.snapshots,
          snap("section--the_storm.EL1.01.md", "The Storm 2"),
        ],
      },
    ]);
    const result = addSnapshot(base, "EL1", "2026-02-02T00:00:00.000Z");
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.snapshot).toEqual({
      file: "section--the_storm.EL1.02.md",
      title: "The Storm 3",
      created: "2026-02-02T00:00:00.000Z",
    });
    expect(result.copyFrom).toBe("section--the_storm.EL1.00.md");
    const node = result.structure.children[0] as SectionNode;
    expect(node.snapshots.map((s) => s.file)).toEqual([
      "section--the_storm.EL1.00.md",
      "section--the_storm.EL1.01.md",
      "section--the_storm.EL1.02.md",
    ]);
  });

  it("never fills a gap left by a deleted snapshot", () => {
    const storm = section("EL1", "The Storm");
    const base = doc([
      {
        ...storm,
        snapshots: [snap("section--the_storm.EL1.00.md", "The Storm 1")],
      },
    ]);
    const result = addSnapshot(base, "EL1", "T");
    expect(result?.snapshot.file).toBe("section--the_storm.EL1.01.md");
  });

  it("does not change the adopted snapshot", () => {
    const result = addSnapshot(doc([section("EL1", "The Storm")]), "EL1", "T");
    expect(result?.structure.children[0].adopted).toBe(
      "section--the_storm.EL1.00.md",
    );
  });

  it("returns null when the node is missing", () => {
    expect(addSnapshot(doc([]), "EL99", "T")).toBeNull();
  });

  it("does not mutate the structure it was given", () => {
    const base = doc([section("EL1", "The Storm")]);
    const before = JSON.stringify(base);
    addSnapshot(base, "EL1", "T");
    expect(JSON.stringify(base)).toBe(before);
  });

  // A binned snapshot's file waits in `recyclebin/` under its own name; a
  // successor reusing that name would overwrite it when it is binned too.
  it("counts past the node's binned snapshots", () => {
    const base = doc([section("EL1", "The Storm")]);
    const binned = [snap("section--the_storm.EL1.01.md", "The Storm 2")];
    const result = addSnapshot(base, "EL1", "T", undefined, undefined, binned);
    expect(result?.snapshot.file).toBe("section--the_storm.EL1.02.md");
  });

  it("counts a binned snapshot under an older stem by its counter", () => {
    const base = doc([section("EL1", "The Storm")]);
    const binned = [snap("section--dawn.EL1.04.md", "Dawn")];
    const result = addSnapshot(base, "EL1", "T", undefined, undefined, binned);
    expect(result?.snapshot.file).toBe("section--the_storm.EL1.05.md");
  });

  // Titles are unique per node, ignoring case, or the next open is refused.
  it("numbers a typed title another snapshot of the node holds", () => {
    const base = doc([section("EL1", "The Storm")]);
    const once = addSnapshot(base, "EL1", "T", "the storm 1");
    expect(once?.snapshot.title).toBe("the storm 1 (2)");
    if (!once) return;
    const twice = addSnapshot(once.structure, "EL1", "T", "The Storm 1");
    expect(twice?.snapshot.title).toBe("The Storm 1 (3)");
  });

  it("numbers a default title a differently cased title holds", () => {
    const storm = section("EL1", "The Storm");
    const base = doc([
      {
        ...storm,
        snapshots: [
          ...storm.snapshots,
          snap("section--the_storm.EL1.01.md", "THE STORM 2"),
        ],
      },
    ]);
    const result = addSnapshot(base, "EL1", "T");
    expect(result?.snapshot.title).toBe("The Storm 2 (2)");
  });
});

describe("restoreSnapshot", () => {
  it("puts a binned record back on its node", () => {
    const base = doc([section("EL1", "The Storm")]);
    const record = snap("section--the_storm.EL1.01.md", "Dawn");
    const next = restoreSnapshot(base, "EL1", record);
    expect(next.children[0].snapshots).toEqual([
      ...base.children[0].snapshots,
      record,
    ]);
  });

  it("numbers a restored title the node already holds", () => {
    const storm = section("EL1", "The Storm");
    const base = doc([
      {
        ...storm,
        snapshots: [
          ...storm.snapshots,
          snap("section--the_storm.EL1.02.md", "the storm 2"),
        ],
      },
    ]);
    const record = snap("section--the_storm.EL1.01.md", "The Storm 2");
    const next = restoreSnapshot(base, "EL1", record);
    const titles = next.children[0].snapshots.map((s) => s.title);
    expect(titles).toEqual(["The Storm 1", "the storm 2", "The Storm 2 (2)"]);
  });

  it("is a no-op for a record whose file is already listed", () => {
    const base = doc([section("EL1", "The Storm")]);
    const record = base.children[0].snapshots[0];
    expect(restoreSnapshot(base, "EL1", record)).toEqual(base);
  });
});

describe("adoptSnapshot", () => {
  it("swaps the pointer to another snapshot, nothing else", () => {
    const storm = section("EL1", "The Storm");
    const base = doc([
      {
        ...storm,
        snapshots: [
          ...storm.snapshots,
          snap("section--the_storm.EL1.01.md", "The Storm 2"),
        ],
      },
    ]);
    const result = adoptSnapshot(base, "EL1", "section--the_storm.EL1.01.md");
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.from).toBe("section--the_storm.EL1.00.md");
    expect(result.structure.children[0].adopted).toBe(
      "section--the_storm.EL1.01.md",
    );
    // The snapshots list is untouched; only the pointer moved.
    expect(
      (result.structure.children[0] as SectionNode).snapshots.map(
        (s) => s.file,
      ),
    ).toEqual(["section--the_storm.EL1.00.md", "section--the_storm.EL1.01.md"]);
  });

  it("refuses a file that is not a snapshot of the node", () => {
    const base = doc([section("EL1", "The Storm")]);
    expect(adoptSnapshot(base, "EL1", "section--other.EL1.00.md")).toBeNull();
  });

  it("is a no-op when the file is already adopted", () => {
    const base = doc([section("EL1", "The Storm")]);
    expect(
      adoptSnapshot(base, "EL1", "section--the_storm.EL1.00.md"),
    ).toBeNull();
  });
});

describe("renameSnapshotTitle", () => {
  it("re-titles one snapshot, yaml only", () => {
    const storm = section("EL1", "The Storm");
    const base = doc([
      {
        ...storm,
        snapshots: [
          ...storm.snapshots,
          snap("section--the_storm.EL1.01.md", "The Storm 2"),
        ],
      },
    ]);
    const result = renameSnapshotTitle(
      base,
      "EL1",
      "section--the_storm.EL1.01.md",
      "Dawn",
    );
    expect(result.renamed).toBe(true);
    const node = result.structure.children[0] as SectionNode;
    expect(
      node.snapshots.find((s) => s.file === "section--the_storm.EL1.01.md")
        ?.title,
    ).toBe("Dawn");
    expect(
      node.snapshots.find((s) => s.file === "section--the_storm.EL1.00.md")
        ?.title,
    ).toBe("The Storm 1");
  });

  it("refuses a title another snapshot of the same node already has", () => {
    const storm = section("EL1", "The Storm");
    const base = doc([
      {
        ...storm,
        snapshots: [
          ...storm.snapshots,
          snap("section--the_storm.EL1.01.md", "The Storm 2"),
        ],
      },
    ]);
    const result = renameSnapshotTitle(
      base,
      "EL1",
      "section--the_storm.EL1.01.md",
      "The Storm 1",
    );
    expect(result.renamed).toBe(false);
    expect(result.structure).toEqual(base);
  });

  it("leaves the structure alone for a missing snapshot", () => {
    const base = doc([section("EL1", "The Storm")]);
    expect(
      renameSnapshotTitle(base, "EL1", "section--ghost.EL1.00.md", "x"),
    ).toEqual({ structure: base, renamed: false });
  });
});

describe("deleteSnapshot", () => {
  it("removes the entry and says it did", () => {
    const storm = section("EL1", "The Storm");
    const base = doc([
      {
        ...storm,
        snapshots: [
          ...storm.snapshots,
          snap("section--the_storm.EL1.01.md", "The Storm 2"),
        ],
      },
    ]);
    const result = deleteSnapshot(base, "EL1", "section--the_storm.EL1.01.md");
    expect(result.removed).toBe(true);
    const node = result.structure.children[0] as SectionNode;
    expect(node.snapshots.map((s) => s.file)).toEqual([
      "section--the_storm.EL1.00.md",
    ]);
  });

  it("refuses to delete the adopted snapshot", () => {
    const base = doc([section("EL1", "The Storm")]);
    const result = deleteSnapshot(base, "EL1", "section--the_storm.EL1.00.md");
    expect(result.removed).toBe(false);
    expect(result.structure).toEqual(base);
  });

  it("refuses to delete the last snapshot — a node always has at least one", () => {
    const base = doc([
      {
        ...section("EL1", "The Storm"),
        snapshots: [
          snap("section--the_storm.EL1.00.md", "The Storm 1"),
          snap("section--the_storm.EL1.01.md", "The Storm 2"),
        ],
      },
    ]);
    // The `.00` is the adopted one, so it cannot be deleted while adopted.
    const refused = deleteSnapshot(base, "EL1", "section--the_storm.EL1.00.md");
    expect(refused.removed).toBe(false);
    // Adopt the `.01`, then the `.00` becomes deletable...
    const adopted = adoptSnapshot(base, "EL1", "section--the_storm.EL1.01.md");
    if (!adopted) throw new Error("expected the swap");
    const deleted = deleteSnapshot(
      adopted.structure,
      "EL1",
      "section--the_storm.EL1.00.md",
    );
    expect(deleted.removed).toBe(true);
    // ...but the last one left is refused: a node always has at least one.
    const last = deleteSnapshot(
      deleted.structure,
      "EL1",
      "section--the_storm.EL1.01.md",
    );
    expect(last.removed).toBe(false);
  });

  it("reports false when the snapshot was not there", () => {
    const base = doc([section("EL1", "The Storm")]);
    const result = deleteSnapshot(base, "EL1", "section--ghost.EL1.00.md");
    expect(result.removed).toBe(false);
    expect(result.structure).toEqual(base);
  });
});

describe("snapshots ride the structural ops", () => {
  it("removeToRemoved carries a node's snapshots verbatim into the bin", () => {
    const storm = section("EL2", "the-storm");
    const base = doc([
      part("EL1", "act-one", [
        {
          ...storm,
          snapshots: [
            ...storm.snapshots,
            snap("section--the_storm.EL2.01.md", "The Storm 2"),
          ],
        },
      ]),
    ]);
    const result = removeToRemoved(base, "EL1");
    const removedNode = result.structure.removed?.[0] as PartNode;
    const stormNode = removedNode.children[0] as SectionNode;
    expect(stormNode.snapshots.map((s) => s.file)).toEqual([
      "section--the_storm.EL2.00.md",
      "section--the_storm.EL2.01.md",
    ]);
  });

  it("restoreFromRemoved brings the snapshots back", () => {
    const base = doc([part("EL1", "act-one", [section("EL2", "opening")])]);
    const removed = removeToRemoved(base, "EL1").structure;
    const restored = restoreFromRemoved(removed, "EL1", null, 0);
    const actOne = restored.children[0] as PartNode;
    expect(actOne.children[0].snapshots).toHaveLength(1);
    expect(actOne.id).toBe("EL1");
  });

  it("renameNode re-stems a node's snapshots but never its id", () => {
    const storm = section("EL2", "the-storm");
    const base = doc([
      part("EL1", "act-one", [
        {
          ...storm,
          snapshots: [
            ...storm.snapshots,
            snap("section--the_storm.EL2.01.md", "The Storm 2"),
          ],
        },
      ]),
    ]);
    const outcome = renamed(base, "EL2", "The Gale");
    const actOne = outcome.structure.children[0] as PartNode;
    const gale = actOne.children[0] as SectionNode;
    expect(gale.id).toBe("EL2");
    expect(gale.snapshots.map((s) => s.file)).toEqual([
      "section--the_gale.EL2.00.md",
      "section--the_gale.EL2.01.md",
    ]);
    expect(gale.adopted).toBe("section--the_gale.EL2.00.md");
  });
});

describe("newNode", () => {
  const created = "2026-01-01T00:00:00.000Z";

  it("is born with one empty snapshot, its adopted file", () => {
    const file = snapshotFileName("section", "opening", "EL7", 0);
    expect(newNode("section", "EL7", "Opening", file, created)).toEqual({
      kind: "section",
      id: "EL7",
      title: "Opening",
      adopted: file,
      snapshots: [
        {
          file,
          title: "Opening 1",
          created,
          contentHash: EMPTY_CONTENT_HASH,
        },
      ],
    });
  });

  it("gives a Part an empty list of children, and a Section none", () => {
    const part = newNode("part", "EL8", "Act", "p.md", created);
    expect(part.kind === "part" && part.children).toEqual([]);
    expect("children" in newNode("section", "EL9", "S", "s.md", created)).toBe(
      false,
    );
  });

  it("records the hash of the empty file", async () => {
    expect(EMPTY_CONTENT_HASH).toBe(await hashOf(""));
  });
});
