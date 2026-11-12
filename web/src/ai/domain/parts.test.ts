// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { SourceDescriptor } from "./types";
import {
  PART_DEPTH_MAX,
  countedWords,
  isPart,
  partFor,
  partWords,
  sectionsInPart,
  topPartOf,
} from "./parts";

const node = (
  nodeId: string,
  order: number,
  nodeKind: "part" | "section",
  partId?: string,
): SourceDescriptor => ({
  id: `node:${nodeId}`,
  kind: "manuscript",
  title: nodeId,
  path: `document/${nodeId}.md`,
  nodeId,
  nodeKind,
  order,
  authority: "manuscript",
  ...(partId ? { partId } : {}),
});

// `P1` holds `S1` and a nested Part `P2` (which holds `S2`); `S3` sits at the
// top.
const CATALOG = [
  node("P1", 0, "part"),
  node("S1", 1, "section", "P1"),
  node("P2", 2, "part", "P1"),
  node("S2", 3, "section", "P2"),
  node("S3", 4, "section"),
];

describe("the Part a review reads", () => {
  it("is the open Part itself, else the Part the open Section sits in", () => {
    expect(partFor(CATALOG, "P1")).toBe("P1");
    expect(partFor(CATALOG, "S1")).toBe("P1");
    // A nested Part counts as its own Part.
    expect(partFor(CATALOG, "S2")).toBe("P2");
  });

  it("is nothing for a Section at the top, an unknown node, or a parent that is not a Part", () => {
    expect(partFor(CATALOG, "S3")).toBeNull();
    expect(partFor(CATALOG, "gone")).toBeNull();
    expect(partFor([...CATALOG, node("S4", 5, "section", "S3")], "S4")).toBe(
      null,
    );
    expect(isPart(CATALOG, "P2")).toBe(true);
    expect(isPart(CATALOG, "S1")).toBe(false);
  });

  it("holds every Section down its sub-Parts, in reading order, and no Part's own file", () => {
    expect(sectionsInPart(CATALOG, "P1")).toEqual(["node:S1", "node:S2"]);
    expect(sectionsInPart(CATALOG, "P2")).toEqual(["node:S2"]);
    expect(sectionsInPart(CATALOG, "S3")).toEqual([]);
  });

  it("ends on a planted cycle, and stops at the depth bound", () => {
    // A hand-edited Structure where two Parts hold each other. The walk ends
    // and reaches no Part outside the loop. This row pins that it terminates,
    // not how; the depth bound is what stops a cycle.
    const cycle = [
      node("A", 0, "part", "B"),
      node("B", 1, "part", "A"),
      node("S", 2, "section", "A"),
    ];
    expect(sectionsInPart(cycle, "Z")).toEqual([]);
    // Inside the loop the walk still finds what it passes on the way round.
    expect(sectionsInPart(cycle, "B")).toEqual(["node:S"]);

    // A chain deeper than the bound: the top Part is out of reach.
    const deep: SourceDescriptor[] = [node("D0", 0, "part")];
    for (let level = 1; level <= PART_DEPTH_MAX + 1; level += 1)
      deep.push(node(`D${level}`, level, "part", `D${level - 1}`));
    deep.push(node("Deep", 99, "section", `D${PART_DEPTH_MAX + 1}`));
    expect(sectionsInPart(deep, "D0")).toEqual([]);
    expect(sectionsInPart(deep, `D${PART_DEPTH_MAX}`)).toEqual(["node:Deep"]);
  });
});

// The top-level Part is what stands in a beat of the declared structure,
// so the walk goes all the way up, under the same bound.
describe("the top-level Part a node sits in", () => {
  it("is the top of the chain, the node itself for a top-level Part", () => {
    expect(topPartOf(CATALOG, "P1")).toBe("P1");
    expect(topPartOf(CATALOG, "S1")).toBe("P1");
    expect(topPartOf(CATALOG, "P2")).toBe("P1");
    expect(topPartOf(CATALOG, "S2")).toBe("P1");
  });

  it("is nothing for a Section at the top or a node the catalogue lacks", () => {
    expect(topPartOf(CATALOG, "S3")).toBeNull();
    expect(topPartOf(CATALOG, "gone")).toBeNull();
  });

  it("gives up on a planted cycle rather than walking it forever", () => {
    const looped = [
      node("A", 0, "part", "B"),
      node("B", 1, "part", "A"),
      node("S", 2, "section", "A"),
    ];
    expect(topPartOf(looped, "S")).toBeNull();
  });
});

describe("the words a Part holds", () => {
  it("is a Part's own opening and every Section down its sub-Parts", () => {
    // A Part's own count is only its heading's few words: five over three
    // Sections of a thousand is a 3005-word Part, never a five-word one.
    const totals = partWords([
      { id: "P1", words: 5 },
      { id: "S1", parentId: "P1", words: 1000 },
      { id: "P2", parentId: "P1", words: 0 },
      { id: "S2", parentId: "P2", words: 1000 },
      { id: "S3", parentId: "P2", words: 1000 },
      { id: "S4", words: 400 },
    ]);
    expect(totals.get("P1")).toBe(3005);
    expect(totals.get("P2")).toBe(2000);
    expect(totals.get("S1")).toBe(1000);
    expect(totals.get("S4")).toBe(400);
  });

  it("omits a total any uncounted node would make a guess, never reading it as 0", () => {
    const totals = partWords([
      { id: "P1", words: 5 },
      { id: "P2", parentId: "P1", words: 5 },
      { id: "S1", parentId: "P2" },
      { id: "S2", parentId: "P1", words: 1000 },
      { id: "S3", words: 10 },
    ]);
    // The unknown reaches up through every Part that holds it…
    expect(totals.has("S1")).toBe(false);
    expect(totals.has("P2")).toBe(false);
    expect(totals.has("P1")).toBe(false);
    // …and no further.
    expect(totals.get("S2")).toBe(1000);
    expect(totals.get("S3")).toBe(10);
  });

  it("ends on a planted cycle, counting each node once per chain", () => {
    const totals = partWords([
      { id: "A", parentId: "B", words: 3 },
      { id: "B", parentId: "A", words: 4 },
      { id: "S", parentId: "A", words: 10 },
    ]);
    expect(totals.get("A")).toBe(17);
    expect(totals.get("B")).toBe(17);
    expect(totals.get("S")).toBe(10);
  });

  it("stops at the depth bound, as every walk here does", () => {
    const chain = Array.from({ length: PART_DEPTH_MAX + 5 }, (_, i) => ({
      id: `P${i}`,
      ...(i > 0 ? { parentId: `P${i - 1}` } : {}),
      words: 1,
    }));
    const totals = partWords(chain);
    // The deepest node reaches only `PART_DEPTH_MAX` Parts up.
    expect(totals.get(`P${PART_DEPTH_MAX + 4}`)).toBe(1);
    expect(totals.get("P4")).toBe(PART_DEPTH_MAX + 1);
  });

  it("reads a count as a safe whole number, and a non-number as no count", () => {
    expect([
      countedWords(12.7),
      countedWords(-3),
      countedWords(1e30),
      countedWords(undefined),
      countedWords(Number.NaN),
      countedWords(Infinity),
    ]).toEqual([
      12,
      0,
      Number.MAX_SAFE_INTEGER,
      undefined,
      undefined,
      undefined,
    ]);
    const totals = partWords([
      { id: "P", words: Number.MAX_SAFE_INTEGER },
      { id: "S", parentId: "P", words: Number.MAX_SAFE_INTEGER },
    ]);
    expect(totals.get("P")).toBe(Number.MAX_SAFE_INTEGER);
  });
});
