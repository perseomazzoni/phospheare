// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  canMoveSelection,
  moveTargets,
  selectionMoveTargets,
} from "./moveTargets";
import { moveNode, moveNodes } from "./mutations";
import { childrenOf } from "./structure";
import { snapshotFileName, toSlug } from "./naming";
import type {
  DocNode,
  DocumentStructure,
  PartNode,
  SectionNode,
} from "./types";

// This list is the only way a finger can reorder anything, so it never offers
// an illegal landing and never offers one that does nothing. Both are
// asserted against the mutation itself rather than a second copy of the rule.

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

const doc = (children: DocNode[]): DocumentStructure => ({
  version: 1,
  children,
});

const NESTED = doc([
  part("EL1", "act-one", [section("EL2", "opening"), section("EL3", "storm")]),
  part("EL4", "act-two", [section("EL5", "arrival")]),
  part("EL6", "act-three"),
]);

const FLAT = doc([
  section("S1", "one"),
  section("S2", "two"),
  section("S3", "three"),
]);

/** Every group's container id, in the order the dialog would paint them. */
const containers = (structure: DocumentStructure, id: string) =>
  moveTargets(structure, id).map((g) => g.containerId);

describe("moveTargets", () => {
  it("offers every Part to a Section, and not the root", () => {
    // The root holds Parts, so a Section cannot join them (the Golden Rule);
    // a drag to the root's own gutter draws no line either.
    expect(containers(NESTED, "EL2")).toEqual(["EL1", "EL4", "EL6"]);
  });

  it("offers a Part the root and any Part that is empty", () => {
    // act-two already holds a Section, so it cannot also hold a Part (the
    // Golden Rule). act-three holds nothing, and an empty container accepts
    // whatever arrives first, so a Part may nest inside it. That is
    // `canDrop`'s answer and the drag gesture's; the list is never stricter
    // than the gesture.
    expect(containers(NESTED, "EL1")).toEqual([null, "EL6"]);
  });

  it("names each position by the sibling above it", () => {
    const group = moveTargets(NESTED, "EL5").find(
      (g) => g.containerId === "EL1",
    );
    expect(group?.targets).toEqual([
      { containerId: "EL1", index: 0, afterTitle: null },
      { containerId: "EL1", index: 1, afterTitle: "opening" },
      { containerId: "EL1", index: 2, afterTitle: "storm" },
    ]);
  });

  it("leaves out the two positions the node already occupies", () => {
    // "storm" sits at index 1 of act-one. Both index 1 (before itself) and
    // index 2 (after itself) describe where it already is, so its own
    // container offers only the one position that moves it.
    const own = moveTargets(NESTED, "EL3").find((g) => g.containerId === "EL1");
    expect(own?.targets).toEqual([
      { containerId: "EL1", index: 0, afterTitle: null },
    ]);
  });

  it("drops a container that has nothing left to offer", () => {
    // act-two holds "arrival" alone, so every position there is a no-op and
    // the group would be empty: a heading with no rows under it, worse than
    // absent.
    expect(containers(NESTED, "EL5")).toEqual(["EL1", "EL6"]);
  });

  it("offers an empty Part exactly one position", () => {
    const group = moveTargets(NESTED, "EL2").find(
      (g) => g.containerId === "EL6",
    );
    expect(group?.targets).toEqual([
      { containerId: "EL6", index: 0, afterTitle: null },
    ]);
  });

  it("offers the root's own positions when the root holds Sections", () => {
    expect(moveTargets(FLAT, "S1")).toEqual([
      {
        containerId: null,
        title: null,
        targets: [
          { containerId: null, index: 2, afterTitle: "two" },
          { containerId: null, index: 3, afterTitle: "three" },
        ],
      },
    ]);
  });

  it("returns nothing for a node that is not in the document", () => {
    expect(moveTargets(NESTED, "NOPE")).toEqual([]);
  });

  // Checked against the mutation rather than a restatement of the rule:
  // every target offered is a move `moveNode` performs, and each one changes
  // the document.
  it("every offered target is one moveNode accepts and that changes something", () => {
    for (const id of ["EL2", "EL3", "EL5", "EL1", "EL4", "EL6"]) {
      for (const group of moveTargets(NESTED, id)) {
        for (const target of group.targets) {
          const after = moveNode(NESTED, id, target.containerId, target.index);
          const landed = childrenOf(after, target.containerId);
          expect(landed.findIndex((c) => c.id === id)).toBeGreaterThanOrEqual(
            0,
          );
          expect(JSON.stringify(after)).not.toEqual(JSON.stringify(NESTED));
        }
      }
    }
  });
});

describe("selectionMoveTargets", () => {
  const FIVE = doc([
    section("S1", "one"),
    section("S2", "two"),
    section("S3", "three"),
    section("S4", "four"),
    section("S5", "five"),
  ]);
  const flat = (ids: string[]) =>
    selectionMoveTargets(FIVE, ids)
      .flatMap((g) => g.targets)
      .map((t) => `${t.index}:${t.afterTitle ?? "-"}`);

  it("offers one landing per distinct result, named after a row that stays", () => {
    // one and three ticked. Gaps 0 and 1 both land the block first; gaps 2
    // and 3 both land it after two. Neither is named after a row in the air.
    expect(flat(["S1", "S3"])).toEqual(["0:-", "2:two", "4:four", "5:five"]);
  });

  it("drops the landings that leave an unbroken run where it is", () => {
    // two and three already sit together: before them, between them and
    // after them all describe where they are.
    expect(flat(["S2", "S3"])).toEqual(["0:-", "4:four", "5:five"]);
  });

  it("offers nothing for a group of mixed kinds", () => {
    expect(selectionMoveTargets(NESTED, ["EL2", "EL4"])).toEqual([]);
  });

  it("is moveTargets for a selection of one", () => {
    for (const id of ["EL2", "EL4", "EL5"])
      expect(selectionMoveTargets(NESTED, [id])).toEqual(
        moveTargets(NESTED, id),
      );
  });

  it("every offered target is one moveNodes performs and that changes something", () => {
    for (const ids of [
      ["EL2", "EL5"],
      ["EL2", "EL3"],
      ["EL1", "EL6"],
      ["EL4", "EL1"],
    ]) {
      const results = new Set<string>();
      for (const group of selectionMoveTargets(NESTED, ids)) {
        for (const target of group.targets) {
          const after = moveNodes(
            NESTED,
            ids,
            target.containerId,
            target.index,
          );
          const landed = childrenOf(after, target.containerId).map((c) => c.id);
          for (const id of ids) expect(landed).toContain(id);
          const shape = JSON.stringify(after);
          expect(shape).not.toEqual(JSON.stringify(NESTED));
          // One landing per result: no two offer the same document.
          expect(results.has(shape)).toBe(false);
          results.add(shape);
        }
      }
    }
  });
});

describe("canMoveSelection", () => {
  // The yes-or-no every row of the structure panel asks on every render. It
  // stops at the first landing it finds, and gives the list's own answer,
  // never a second reading of the rule.
  const LONE = doc([part("P1", "only", [section("S1", "alone")])]);
  const subsets = (ids: string[]): string[][] =>
    ids.reduce<string[][]>(
      (all, id) => [...all, ...all.map((set) => [...set, id])],
      [[]],
    );

  it("answers as the whole list does, for every selection", () => {
    for (const [structure, ids] of [
      [NESTED, ["EL1", "EL2", "EL3", "EL4", "EL5", "EL6"]],
      [FLAT, ["S1", "S2", "S3"]],
      [LONE, ["P1", "S1"]],
    ] as const)
      for (const selection of subsets([...ids]))
        expect(canMoveSelection(structure, selection)).toBe(
          selectionMoveTargets(structure, selection).length > 0,
        );
  });

  it("says no where the list is empty, and yes where it is not", () => {
    // The book's only Part, and the only Section in it, have nowhere to go.
    expect(canMoveSelection(LONE, ["P1"])).toBe(false);
    expect(canMoveSelection(LONE, ["S1"])).toBe(false);
    expect(canMoveSelection(NESTED, ["EL2"])).toBe(true);
    expect(canMoveSelection(NESTED, ["EL2", "EL4"])).toBe(false);
    expect(canMoveSelection(NESTED, ["missing"])).toBe(false);
  });
});
