// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  MAP_NODES_MAX,
  type MapNode,
  type MapArc,
  type MapPassages,
} from "../../ai/domain/types";
import {
  FREYTAG_HEIGHT,
  HERO_BOX,
  MIN_FIELD_SHARE,
  figureOf,
  freytagLayout,
  heroAngle,
  heroLayout,
  kishotenketsuLayout,
  pct,
  RULER_CLUSTER,
  RULER_HEIGHT,
  RULER_HEIGHT_FIELD,
  rulerLayout,
  safeWords,
  threeActsLayout,
  wordShares,
} from "./mapLayout";

// The figures' geometry, pure: every coordinate a finite percentage
// inside the figure, each shape drawn to its locked design.

function node(over: Partial<MapNode> & { sourceId: string }): MapNode {
  return { kind: "part", title: over.sourceId, ...over };
}

/**
 * The mode a run would have stored for this shape and scope (`planMap`),
 * since the block keeps it: positional where the nodes carry the
 * beat they stand in, named otherwise, and never positional on a Part.
 */
function modeFor(
  shape: MapArc["shape"],
  nodes: readonly MapNode[],
  scope: MapArc["scope"],
): MapArc["mode"] {
  if (shape === null) return "reading";
  if (shape === "herosjourney") return "hero";
  return scope.kind === "structure" && nodes.some((one) => one.standsIn)
    ? "positional"
    : "named";
}

function map(
  shape: MapArc["shape"],
  nodes: MapNode[],
  over: Partial<MapArc> = {},
): MapArc {
  return {
    kind: "arc",
    mode: modeFor(shape, nodes, over.scope ?? { kind: "structure" }),
    shapeFrom: "declared",
    shape,
    scope: { kind: "structure" },
    structureRevision: "rev",
    nodes,
    coverage: { intended: 1, inspected: 1, skipped: [], complete: true },
    ...over,
  };
}

const finite = (value: number) =>
  Number.isFinite(value) && value >= 0 && value <= 100;

describe("the gates every number passes", () => {
  it("clamps a percentage and refuses NaN", () => {
    expect([pct(-5), pct(50), pct(150), pct(NaN), pct(Infinity)]).toEqual([
      0, 50, 100, 0, 0,
    ]);
  });

  it("reads a replayed word count as a safe whole number", () => {
    expect([
      safeWords(undefined),
      safeWords(-3),
      safeWords(12.7),
      safeWords(Infinity),
      safeWords(1e30),
    ]).toEqual([0, 0, 12, 0, Number.MAX_SAFE_INTEGER]);
  });
});

describe("the word shares", () => {
  it("shares out 100 in proportion, in order", () => {
    const shares = wordShares([100, 300]) as number[];
    expect(shares[0]).toBeCloseTo(25);
    expect(shares[1]).toBeCloseTo(75);
  });

  it("keeps a 0-word field visible, and the whole still 100", () => {
    const shares = wordShares([0, 500, 500]) as number[];
    expect(shares[0]).toBeCloseTo(MIN_FIELD_SHARE);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100);
  });

  it("draws no bar with nothing to share out", () => {
    expect(wordShares([0, 0])).toBeNull();
    expect(wordShares([])).toBeNull();
  });

  it("stays finite at absurd counts and at the node cap", () => {
    const huge = wordShares([Number.MAX_SAFE_INTEGER, 1e300, 5]) as number[];
    expect(huge.every(finite)).toBe(true);
    const many = wordShares(
      Array.from({ length: MAP_NODES_MAX }, (_, i) => i),
    ) as number[];
    expect(many.every(finite)).toBe(true);
    expect(many.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
  });
});

describe("Three Acts", () => {
  const three = () =>
    map("threeact", [
      node({
        sourceId: "node:P1",
        standsIn: "setup",
        verdict: "fits",
        reason: "r",
        words: 5,
      }),
      node({
        sourceId: "node:S1",
        kind: "section",
        parentId: "node:P1",
        words: 1000,
      }),
      node({
        sourceId: "node:P2",
        standsIn: "confrontation",
        verdict: "partly",
        reason: "r",
        words: 2000,
      }),
      node({ sourceId: "node:S0", kind: "section", words: 500 }),
      node({ sourceId: "node:P3", standsIn: "resolution", words: 1000 }),
    ]);

  it("draws Field's line: two plot points at a quarter and three quarters, no midpoint", () => {
    const layout = threeActsLayout(three());
    expect(layout.ticks).toEqual([0, 25, 75, 100]);
    expect(layout.plotPoints.map((one) => one.x)).toEqual([25, 75]);
    expect(layout.ticks).not.toContain(50);
    expect(layout.beats.map((one) => [one.id, one.labelAt])).toEqual([
      ["setup", 0],
      ["confrontation", 50],
      ["resolution", 100],
    ]);
  });

  it("gives each top-level node its words and its Sections', in book order", () => {
    const { fields } = threeActsLayout(three());
    // A Part of five words over a Section of a thousand is a 1005-word Part.
    expect(fields?.map((one) => one.sourceId)).toEqual([
      "node:P1",
      "node:P2",
      "node:S0",
      "node:P3",
    ]);
    expect(fields?.[0].width).toBeCloseTo((1005 / 4505) * 100);
    // Cumulative, touching, and the whole width.
    for (let i = 1; i < (fields?.length ?? 0); i += 1)
      expect(fields?.[i].x).toBeCloseTo(
        (fields?.[i - 1].x ?? 0) + (fields?.[i - 1].width ?? 0),
      );
    expect(fields?.map((one) => one.loose)).toEqual([
      false,
      false,
      true,
      false,
    ]);
  });

  it("labels the Parts, not a loose Section, each at its field with its mark", () => {
    const { labels, fields } = threeActsLayout(three());
    expect(labels.map((one) => [one.ordinal, one.mark])).toEqual([
      ["01", "full"],
      ["02", "partly"],
      // Drawn, never placed: a number and no disc.
      ["03", null],
    ]);
    expect(labels[1].x).toBe(fields?.[1].x);
  });

  it("draws no bar when any Section inside a unit has no count", () => {
    // Unknown is not zero: a Part whose Section has no count is not a Part
    // of its heading's words, and one unit of unknown size makes every share
    // a guess.
    const layout = threeActsLayout(
      map("threeact", [
        node({ sourceId: "node:P1", standsIn: "setup", words: 5 }),
        node({ sourceId: "node:S1", kind: "section", parentId: "node:P1" }),
        node({ sourceId: "node:P2", standsIn: "confrontation", words: 2000 }),
      ]),
    );
    expect(layout.fields).toBeNull();
  });

  it("puts the marks on Field's line by act when no Part has a count", () => {
    const layout = threeActsLayout(
      map("threeact", [
        node({
          sourceId: "node:A",
          beat: "confrontation",
          verdict: "fits",
          reason: "r",
        }),
        node({
          sourceId: "node:B",
          beat: "confrontation",
          verdict: "no",
          reason: "r",
        }),
        node({ sourceId: "node:C", verdict: "no", reason: "r" }),
      ]),
    );
    expect(layout.fields).toBeNull();
    // Two on the middle act spread across it; the beatless `no` on none.
    expect(layout.labels.map((one) => [one.ordinal, one.x])).toEqual([
      ["01", 37.5],
      ["02", 62.5],
    ]);
  });

  it("ends a parentId walk that loops, and draws the rest", () => {
    // The codec refuses a cycle; the walk is bounded without it: two
    // Sections naming each other still give a finite figure.
    const layout = threeActsLayout(
      map("threeact", [
        node({ sourceId: "node:P1", standsIn: "setup", words: 10 }),
        node({
          sourceId: "node:S1",
          kind: "section",
          parentId: "node:S2",
          words: 5,
        }),
        node({
          sourceId: "node:S2",
          kind: "section",
          parentId: "node:S1",
          words: 5,
        }),
      ]),
    );
    expect(layout.fields?.map((one) => one.sourceId)).toEqual(["node:P1"]);
    expect(layout.fields?.[0].width).toBe(100);
  });

  it("stays inside the figure at the node cap", () => {
    const nodes = Array.from({ length: MAP_NODES_MAX }, (_, i) =>
      node({ sourceId: `node:P${i}`, standsIn: "setup", words: i * 7 }),
    );
    const layout = threeActsLayout(map("threeact", nodes));
    expect(
      (layout.fields ?? []).every((one) => finite(one.x) && finite(one.width)),
    ).toBe(true);
    expect(layout.labels.every((one) => finite(one.x))).toBe(true);
  });
});

describe("Kishōtenketsu", () => {
  it("draws four equal stations whatever the words, each Part on its beat", () => {
    const nodes = [
      node({
        sourceId: "node:A",
        standsIn: "ki",
        verdict: "fits",
        reason: "r",
        words: 10,
      }),
      node({
        sourceId: "node:B",
        standsIn: "ten",
        verdict: "no",
        reason: "r",
        words: 9000,
      }),
      node({
        sourceId: "node:C",
        standsIn: "ten",
        verdict: "partly",
        reason: "r",
      }),
      node({ sourceId: "node:D", standsIn: "ketsu" }),
    ];
    const layout = kishotenketsuLayout(map("kishotenketsu", nodes));
    expect(layout.stations.map((one) => one.x)).toEqual([
      12.5, 37.5, 62.5, 87.5,
    ]);
    expect(
      layout.groups.map((group) => [group.x, group.marks.map((m) => m.mark)]),
    ).toEqual([
      [12.5, ["full"]],
      [62.5, ["none", "partly"]],
    ]);
    // Words do not move a station.
    const other = kishotenketsuLayout(
      map(
        "kishotenketsu",
        nodes.map((one) => ({ ...one, words: 1 })),
      ),
    );
    expect(other).toEqual(layout);
  });
});

describe("Freytag's pyramid", () => {
  const layout = freytagLayout(
    map("freytagspyramid", [
      node({
        sourceId: "node:A",
        beat: "climax",
        verdict: "fits",
        reason: "r",
      }),
      node({
        sourceId: "node:B",
        beat: "climax",
        verdict: "partly",
        reason: "r",
      }),
      node({ sourceId: "node:C", verdict: "no", reason: "r" }),
    ]),
  );

  it("puts five parts on the triangle, the climax at the apex", () => {
    expect(layout.stations.map((one) => one.x)).toEqual([0, 25, 50, 75, 100]);
    const apex = layout.stations[2];
    expect(apex.id).toBe("climax");
    expect(apex.y).toBe(Math.min(...layout.stations.map((one) => one.y)));
    expect(layout.stations[0].y).toBe(FREYTAG_HEIGHT);
  });

  it("ticks the three forces in their intervals, only the first necessary", () => {
    const [exciting, tragic, suspense] = layout.forces;
    expect(exciting).toMatchObject({ kind: "exciting", necessary: true });
    expect(exciting.x).toBeGreaterThan(0);
    expect(exciting.x).toBeLessThan(25);
    expect(tragic).toMatchObject({ kind: "tragic", necessary: false });
    expect(tragic.x).toBeGreaterThan(50);
    expect(tragic.x).toBeLessThan(75);
    expect(suspense).toMatchObject({ kind: "suspense", necessary: false });
    expect(suspense.x).toBeGreaterThan(75);
    expect(suspense.x).toBeLessThan(100);
    // Each tick sits on the line.
    for (const force of layout.forces) {
      const rise = force.x <= 50 ? force.x / 50 : (100 - force.x) / 50;
      expect(force.y).toBeCloseTo(FREYTAG_HEIGHT * (1 - rise));
    }
  });

  it("gathers the Parts on one beat together, and a beatless no on none", () => {
    expect(layout.groups).toEqual([
      {
        x: 50,
        marks: [
          { sourceId: "node:A", mark: "full" },
          { sourceId: "node:B", mark: "partly" },
        ],
      },
    ]);
  });
});

describe("the Hero's Journey", () => {
  const centre = 50;

  it("runs Campbell's circle counter-clockwise: 2 at the top, 5 at nine o'clock, 8 at six, 11 at three", () => {
    const { numbers } = heroLayout(map("herosjourney", []));
    const at = (n: number) => numbers[n - 1];
    expect(at(2).x).toBeCloseTo(centre);
    expect(at(2).y).toBeLessThan(centre);
    expect(at(5).y).toBeCloseTo(centre);
    expect(at(5).x).toBeLessThan(centre);
    expect(at(8).x).toBeCloseTo(centre);
    expect(at(8).y).toBeGreaterThan(centre);
    expect(at(11).y).toBeCloseTo(centre);
    expect(at(11).x).toBeGreaterThan(centre);
    // Stage 1 just right of the top; the known world above the threshold
    // (1-4), the unknown below it (6-10).
    expect(at(1).x).toBeGreaterThan(centre);
    for (const n of [1, 2, 3, 4]) expect(at(n).y).toBeLessThan(centre);
    for (const n of [6, 7, 8, 9, 10]) expect(at(n).y).toBeGreaterThan(centre);
    // Strictly increasing angles, one turn short of a full circle.
    const angles = numbers.map((one) => heroAngle(one.n));
    for (let i = 1; i < angles.length; i += 1)
      expect(angles[i]).toBeGreaterThan(angles[i - 1]);
    expect(angles[11] - angles[0]).toBeLessThan(360);
    expect(numbers.every((one) => finite(one.x) && finite(one.y))).toBe(true);
  });

  it("stacks a stage's Sections inward, three, then says how many more", () => {
    const sections = Array.from({ length: 5 }, (_, i) =>
      node({
        sourceId: `node:S${i}`,
        kind: "section",
        stage: "ordeal",
        verdict: "fits",
        reason: "r",
      }),
    );
    const layout = heroLayout(
      map("herosjourney", [
        ...sections,
        // Enacting no stage: on no stage.
        node({ sourceId: "node:X", kind: "section", reason: "none" }),
      ]),
    );
    expect(layout.marks.map((one) => one.sourceId)).toEqual([
      "node:S0",
      "node:S1",
      "node:S2",
    ]);
    // Straight down from the centre, each nearer it than the last.
    const ys = layout.marks.map((one) => one.y);
    expect(ys[0]).toBeGreaterThan(ys[1]);
    expect(ys[1]).toBeGreaterThan(ys[2]);
    expect(layout.marks.every((one) => Math.abs(one.x - centre) < 0.01)).toBe(
      true,
    );
    expect(layout.more).toEqual([expect.objectContaining({ n: 2 })]);
  });

  it("draws its one arrowhead as a finite path inside the box", () => {
    const { arrow } = heroLayout(map("herosjourney", []));
    const numbers = arrow.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    expect(numbers).toHaveLength(6);
    expect(numbers.every((n) => n >= 0 && n <= HERO_BOX)).toBe(true);
  });
});

describe("which figure a map draws", () => {
  const placed = node({
    sourceId: "node:P1",
    standsIn: "setup",
    verdict: "fits",
    reason: "r",
  });
  it("draws the declared shape of the whole Structure with something placed", () => {
    expect(figureOf(map("threeact", [placed]))).toBe("threeact");
  });
  // A map of one Part is its own mini-arc, drawn on the same four figures
  // rooted at the Part.
  it("draws a map of one Part too, rooted at it", () => {
    const child = node({
      sourceId: "node:S1",
      kind: "section",
      parentId: "node:P1",
      beat: "setup",
      verdict: "fits",
      reason: "r",
    });
    expect(
      figureOf(
        map("threeact", [node({ sourceId: "node:P1" }), child], {
          scope: { kind: "node", nodeId: "P1" },
        }),
      ),
    ).toBe("threeact");
  });
  it("draws none for a reading, or nothing placed", () => {
    expect(figureOf(map(null, [{ ...placed, verdict: undefined }]))).toBeNull();
    expect(
      figureOf(
        map("threeact", [node({ sourceId: "node:P1", standsIn: "setup" })]),
      ),
    ).toBeNull();
  });
});

// A Section's beats on one line, from its first word to its last.
describe("the ruler of a Section map", () => {
  const found = (beat: string, at: number, outOfOrder = false) => ({
    beat,
    state: "found" as const,
    at,
    anchor: { sourceId: "node:S1", quote: "A start.", revision: "r1" },
    reason: "Here.",
    ...(outOfOrder ? { outOfOrder: true as const } : {}),
  });
  const ruler = (
    shape: MapPassages["shape"],
    passages: MapPassages["passages"],
  ) =>
    rulerLayout({
      kind: "passages",
      shape,
      shapeFrom: "typed",
      scope: { kind: "node", nodeId: "S1" },
      sectionRevision: "r1",
      nodes: [{ sourceId: "node:S1", kind: "section", title: "Morning" }],
      passages,
      coverage: { intended: 1, inspected: 1, skipped: [], complete: true },
    });

  it("draws only verified starts, numbered in beat order among those drawn", () => {
    const layout = ruler("threeact", [
      { beat: "setup", state: "unanswered" },
      found("confrontation", 0.3),
      found("resolution", 0.9),
    ]);
    expect(layout.starts).toEqual([
      { beat: "confrontation", n: 1, x: 30 },
      { beat: "resolution", n: 2, x: 90 },
    ]);
    expect(layout.labels).toEqual([
      { text: "1", x: 30 },
      { text: "2", x: 90 },
    ]);
  });

  it("joins the numbers of starts too close to read apart, at the first", () => {
    const layout = ruler("kishotenketsu", [
      found("ki", 0),
      found("sho", 0.5),
      found("ten", 0.5 + (RULER_CLUSTER - 1) / 100),
      found("ketsu", 1),
    ]);
    expect(layout.labels).toEqual([
      { text: "1", x: 0 },
      { text: "2·3", x: 50 },
      { text: "4", x: 100 },
    ]);
  });

  it("sets an out-of-order beat where it begins, keeping its number", () => {
    const layout = ruler("threeact", [
      found("setup", 0.1),
      found("confrontation", 0.8),
      found("resolution", 0.4, true),
    ]);
    expect(layout.labels.map((one) => one.text)).toEqual(["1", "3", "2"]);
  });

  it("marks Field's quarters on Three Acts only, and is taller for them", () => {
    const three = ruler("threeact", [found("setup", 0)]);
    expect(three.field).toEqual([25, 75]);
    expect(three.height).toBe(RULER_HEIGHT_FIELD);
    const freytag = ruler("freytagspyramid", [found("exposition", 0)]);
    expect(freytag.field).toEqual([]);
    expect(freytag.height).toBe(RULER_HEIGHT);
  });

  it("draws a hostile position at an edge, never off the figure", () => {
    const layout = ruler("threeact", [
      found("setup", -3),
      found("confrontation", 7),
      { beat: "resolution", state: "missing", reason: "No." },
    ]);
    expect(layout.starts.map((one) => one.x)).toEqual([0, 100]);
  });
});
