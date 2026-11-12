// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  SPINE_WIDTH,
  describeSpine,
  layoutSpine,
  layoutSpineGoal,
  overrunPercent,
  scaleFor,
  spineFill,
  spineParts,
  type SpinePart,
} from "./spineLayout";
import {
  STRUCTURE_VERSION,
  type DocumentStats,
  type DocumentStructure,
  type NodeStat,
} from "../project/types";

const AT = (day: number) =>
  `2026-07-${String(day).padStart(2, "0")}T10:00:00.000Z`;

// Nodes carry ids and snapshot sets, and the stats key on the ids (`EL2`, not
// `section--a.EL2.00.md`), so a rename re-stems files without losing a count.
const structure: DocumentStructure = {
  version: STRUCTURE_VERSION,
  children: [
    {
      kind: "part",
      id: "EL1",
      title: "one",
      adopted: "part--one.EL1.00.md",
      snapshots: [
        { file: "part--one.EL1.00.md", title: "one 1", created: AT(1) },
      ],
      children: [
        {
          kind: "section",
          id: "EL2",
          title: "a",
          adopted: "section--a.EL2.00.md",
          snapshots: [
            { file: "section--a.EL2.00.md", title: "a 1", created: AT(1) },
          ],
        },
        {
          kind: "section",
          id: "EL3",
          title: "b",
          adopted: "section--b.EL3.00.md",
          snapshots: [
            { file: "section--b.EL3.00.md", title: "b 1", created: AT(1) },
          ],
        },
      ],
    },
    {
      kind: "part",
      id: "EL4",
      title: "two",
      adopted: "part--two.EL4.00.md",
      snapshots: [
        { file: "part--two.EL4.00.md", title: "two 1", created: AT(1) },
      ],
      children: [
        {
          kind: "section",
          id: "EL5",
          title: "c",
          adopted: "section--c.EL5.00.md",
          snapshots: [
            { file: "section--c.EL5.00.md", title: "c 1", created: AT(1) },
          ],
        },
      ],
    },
  ],
};

const stats: DocumentStats = {
  words: 3100,
  parts: 2,
  sections: 3,
  countedAt: AT(28),
  perNode: [
    { nodeId: "EL1", words: 100, updatedAt: AT(20) },
    { nodeId: "EL2", words: 1000, updatedAt: AT(21) },
    { nodeId: "EL3", words: 1000, updatedAt: AT(25) },
    { nodeId: "EL5", words: 1000, updatedAt: AT(28) },
  ],
};

const scale = scaleFor(8);

describe("scaleFor", () => {
  it("tightens the gaps on a card badge", () => {
    expect(scaleFor(8)).toMatchObject({
      gapPart: 3,
      gapSection: 1,
      radius: 1.5,
    });
  });

  it("opens them up at panel and hero size", () => {
    expect(scaleFor(22)).toMatchObject({
      gapPart: 7,
      gapSection: 2,
      radius: 2.5,
    });
    expect(scaleFor(54)).toMatchObject({
      gapPart: 7,
      gapSection: 2,
      radius: 2.5,
    });
  });
});

describe("spineParts", () => {
  it("makes one group per Part and one section per bar", () => {
    const parts = spineParts(structure, stats);
    expect(parts.map((p) => p.title)).toEqual(["one", "two"]);
    expect(parts[0].sections.map((s) => s.title)).toEqual(["a", "b"]);
  });

  // A Part is the group. Drawing its own text as a bar inside itself would
  // double it visually, so its words count toward the project but not the bars.
  it("does not draw a Part’s own text as a bar", () => {
    const parts = spineParts(structure, stats);
    expect(parts[0].sections.map((s) => s.nodeId)).not.toContain("EL1");
    expect(parts[0].words).toBe(2000);
  });

  it("reaches Sections nested under a Part inside a Part", () => {
    const deep: DocumentStructure = {
      version: STRUCTURE_VERSION,
      children: [
        {
          kind: "part",
          id: "EL1",
          title: "outer",
          adopted: "part--outer.EL1.00.md",
          snapshots: [
            { file: "part--outer.EL1.00.md", title: "outer 1", created: AT(1) },
          ],
          children: [
            {
              kind: "part",
              id: "EL2",
              title: "inner",
              adopted: "part--inner.EL2.00.md",
              snapshots: [
                {
                  file: "part--inner.EL2.00.md",
                  title: "inner 1",
                  created: AT(1),
                },
              ],
              children: [
                {
                  kind: "section",
                  id: "EL3",
                  title: "deep",
                  adopted: "section--deep.EL3.00.md",
                  snapshots: [
                    {
                      file: "section--deep.EL3.00.md",
                      title: "deep 1",
                      created: AT(1),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const parts = spineParts(deep, { ...stats, perNode: [] });
    expect(parts[0].sections.map((s) => s.title)).toEqual(["deep"]);
  });

  // What a short document looks like: Sections at the root, no Parts at all.
  it("gathers root-level Sections into one group rather than dropping them", () => {
    const flat: DocumentStructure = {
      version: STRUCTURE_VERSION,
      children: [
        {
          kind: "section",
          id: "EL1",
          title: "x",
          adopted: "section--x.EL1.00.md",
          snapshots: [
            { file: "section--x.EL1.00.md", title: "x 1", created: AT(1) },
          ],
        },
        {
          kind: "section",
          id: "EL2",
          title: "y",
          adopted: "section--y.EL2.00.md",
          snapshots: [
            { file: "section--y.EL2.00.md", title: "y 1", created: AT(1) },
          ],
        },
      ],
    };
    const parts = spineParts(flat, { ...stats, perNode: [] });
    expect(parts).toHaveLength(1);
    expect(parts[0].sections.map((s) => s.title)).toEqual(["x", "y"]);
  });

  it("treats a Section with no recorded count as empty rather than missing", () => {
    const parts = spineParts(structure, { ...stats, perNode: [] });
    expect(parts[0].sections.map((s) => s.words)).toEqual([0, 0]);
  });

  it("carries the Part's own words and the per-node session deltas", () => {
    const withDeltas: DocumentStats = {
      ...stats,
      perNode: stats.perNode.map((n) =>
        n.nodeId === "EL2" ? { ...n, lastDelta: -250 } : n,
      ),
    };
    const parts = spineParts(structure, withDeltas);
    // EL1's own text: 100 words of the Part file itself.
    expect(parts[0].ownWords).toBe(100);
    expect(parts[0].ownDelta).toBeNull();
    expect(parts[0].sections[0].delta).toBe(-250);
    expect(parts[0].sections[1].delta).toBeNull();
  });

  it("aggregates a nested Part's own delta into the outer Part's ownDelta", () => {
    const nested: DocumentStructure = {
      version: STRUCTURE_VERSION,
      children: [
        {
          kind: "part",
          id: "EL1",
          title: "outer",
          adopted: "part--outer.EL1.00.md",
          snapshots: [
            { file: "part--outer.EL1.00.md", title: "outer 1", created: AT(1) },
          ],
          children: [
            {
              kind: "part",
              id: "EL2",
              title: "inner",
              adopted: "part--inner.EL2.00.md",
              snapshots: [
                {
                  file: "part--inner.EL2.00.md",
                  title: "inner 1",
                  created: AT(1),
                },
              ],
              children: [
                {
                  kind: "section",
                  id: "EL3",
                  title: "deep",
                  adopted: "section--deep.EL3.00.md",
                  snapshots: [
                    {
                      file: "section--deep.EL3.00.md",
                      title: "deep 1",
                      created: AT(1),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const nestedStats: DocumentStats = {
      words: 600,
      parts: 2,
      sections: 1,
      countedAt: AT(1),
      perNode: [
        { nodeId: "EL1", words: 100, updatedAt: AT(1), lastDelta: 20 },
        { nodeId: "EL2", words: 200, updatedAt: AT(1), lastDelta: 50 },
        { nodeId: "EL3", words: 300, updatedAt: AT(1) },
      ],
    };
    const outer = spineParts(nested, nestedStats);
    expect(outer).toHaveLength(1);
    expect(outer[0].ownWords).toBe(300);
    expect(outer[0].ownDelta).toBe(70);
    const noDeltas: DocumentStats = {
      ...nestedStats,
      perNode: nestedStats.perNode.map((n) => ({ ...n, lastDelta: undefined })),
    };
    expect(spineParts(nested, noDeltas)[0].ownDelta).toBeNull();
  });
});

describe("recency", () => {
  it("brightens the most recently touched and dims the oldest", () => {
    const parts = spineParts(structure, stats);
    const a = parts[0].sections[0]; // 21st, oldest section
    const c = parts[1].sections[0]; // 28th, newest
    expect(c.recency).toBe(1);
    expect(a.recency).toBeLessThan(c.recency);
  });

  // A flat spine says there is no recency information. A uniformly dim one
  // would say everything is stale, which is a different and wrong claim.
  it("is full brightness when nothing distinguishes the files", () => {
    const same = {
      ...stats,
      perNode: stats.perNode.map((n) => ({ ...n, updatedAt: AT(20) })),
    };
    for (const part of spineParts(structure, same)) {
      for (const s of part.sections) expect(s.recency).toBe(1);
    }
  });

  it("is full brightness when nothing has been counted at all", () => {
    for (const part of spineParts(structure, { ...stats, perNode: [] })) {
      for (const s of part.sections) expect(s.recency).toBe(1);
    }
  });

  // Rank, not elapsed time: a project written over two years and one over a
  // fortnight both show where the recent work is.
  it("ranks rather than measuring elapsed time", () => {
    const decades: DocumentStats = {
      ...stats,
      perNode: [
        { nodeId: "EL2", words: 1, updatedAt: "2001-01-01T00:00:00.000Z" },
        { nodeId: "EL3", words: 1, updatedAt: "2002-01-01T00:00:00.000Z" },
        { nodeId: "EL5", words: 1, updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
    };
    const days: DocumentStats = {
      ...stats,
      perNode: [
        { nodeId: "EL2", words: 1, updatedAt: AT(1) },
        { nodeId: "EL3", words: 1, updatedAt: AT(2) },
        { nodeId: "EL5", words: 1, updatedAt: AT(3) },
      ],
    };
    const of = (s: DocumentStats) =>
      spineParts(structure, s).flatMap((p) => p.sections.map((x) => x.recency));
    expect(of(decades)).toEqual(of(days));
  });
});

describe("layoutSpine", () => {
  it("gives width in proportion to words", () => {
    const parts = spineParts(structure, stats);
    const layout = layoutSpine(parts, scale);
    const [a, b, c] = layout.bars;
    expect(a.width).toBeCloseTo(b.width, 5);
    expect(a.width).toBeCloseTo(c.width, 5);
  });

  it("lays bars out left to right without overlapping", () => {
    const layout = layoutSpine(spineParts(structure, stats), scale);
    for (let i = 1; i < layout.bars.length; i += 1) {
      const prev = layout.bars[i - 1];
      expect(layout.bars[i].x).toBeGreaterThanOrEqual(prev.x + prev.width);
    }
  });

  it("fits inside the drawing width, gaps included", () => {
    const layout = layoutSpine(spineParts(structure, stats), scale);
    const last = layout.bars[layout.bars.length - 1];
    expect(last.x + last.width).toBeLessThanOrEqual(SPINE_WIDTH + 0.001);
  });

  it("puts a wider gap between Parts than between Sections", () => {
    const layout = layoutSpine(spineParts(structure, stats), scale);
    const withinPart =
      layout.bars[1].x - (layout.bars[0].x + layout.bars[0].width);
    const acrossParts =
      layout.bars[2].x - (layout.bars[1].x + layout.bars[1].width);
    expect(withinPart).toBeCloseTo(scale.gapSection, 5);
    expect(acrossParts).toBeCloseTo(scale.gapPart, 5);
  });

  // A Section holding one line never renders at zero width and vanishes from
  // the writer's own project.
  it("never lets a Section disappear", () => {
    const lopsided: DocumentStats = {
      ...stats,
      perNode: [
        { nodeId: "EL2", words: 200000, updatedAt: AT(21) },
        { nodeId: "EL3", words: 3, updatedAt: AT(22) },
        { nodeId: "EL5", words: 0, updatedAt: AT(23) },
      ],
    };
    const layout = layoutSpine(spineParts(structure, lopsided), scale);
    for (const bar of layout.bars) expect(bar.width).toBeGreaterThanOrEqual(2);
  });

  it("still fits when many minimum-width bars are forced", () => {
    const many: SpinePart[] = [
      {
        nodeId: "EL1",
        title: "big",
        words: 0,
        ownWords: 0,
        ownDelta: null,
        sections: Array.from({ length: 400 }, (_, i) => ({
          nodeId: `EL${i + 2}`,
          title: String(i),
          words: 0,
          recency: 1,
          delta: null,
        })),
      },
    ];
    const layout = layoutSpine(many, scale);
    const last = layout.bars[layout.bars.length - 1];
    expect(layout.bars.every((b) => b.width >= 2)).toBe(true);
    expect(Number.isFinite(last.x + last.width)).toBe(true);
  });

  it("divides the space evenly when nothing has been counted", () => {
    const layout = layoutSpine(
      spineParts(structure, { ...stats, perNode: [] }),
      scale,
    );
    const widths = layout.bars.map((b) => b.width);
    for (const w of widths) expect(w).toBeCloseTo(widths[0], 5);
  });

  it("draws nothing for a project with no Sections", () => {
    const empty: DocumentStructure = {
      version: STRUCTURE_VERSION,
      children: [],
    };
    const layout = layoutSpine(
      spineParts(empty, { ...stats, perNode: [] }),
      scale,
    );
    expect(layout.bars).toEqual([]);
    expect(layout.parts).toEqual([]);
  });

  it("skips a Part with no Sections rather than leaving a gap for it", () => {
    const withEmpty: DocumentStructure = {
      version: STRUCTURE_VERSION,
      children: [
        ...structure.children,
        {
          kind: "part",
          id: "EL6",
          title: "three",
          adopted: "part--three.EL6.00.md",
          snapshots: [
            { file: "part--three.EL6.00.md", title: "three 1", created: AT(1) },
          ],
          children: [],
        },
      ],
    };
    const layout = layoutSpine(spineParts(withEmpty, stats), scale);
    expect(layout.parts.map((p) => p.title)).toEqual(["one", "two"]);
    const last = layout.bars[layout.bars.length - 1];
    expect(last.x + last.width).toBeLessThanOrEqual(SPINE_WIDTH + 0.001);
  });

  it("numbers Parts as the design prints them", () => {
    const layout = layoutSpine(spineParts(structure, stats), scale);
    expect(layout.parts.map((p) => p.label)).toEqual(["01", "02"]);
  });

  it("counts every Part, including ones it does not draw", () => {
    const withEmpty: DocumentStructure = {
      version: STRUCTURE_VERSION,
      children: [
        ...structure.children,
        {
          kind: "part",
          id: "EL6",
          title: "three",
          adopted: "part--three.EL6.00.md",
          snapshots: [
            { file: "part--three.EL6.00.md", title: "three 1", created: AT(1) },
          ],
          children: [],
        },
      ],
    };
    const layout = layoutSpine(spineParts(withEmpty, stats), scale);
    expect(layout.partCount).toBe(3);
    expect(layout.sectionCount).toBe(3);
  });
});

describe("describeSpine", () => {
  it("says what a screen reader needs and nothing else", () => {
    const layout = layoutSpine(spineParts(structure, stats), scale);
    expect(describeSpine(layout)).toBe("2 parts, 3 sections, 3,100 words");
  });
});

describe("spineFill", () => {
  it("gives the longest project on the shelf the whole width", () => {
    expect(spineFill(120_000, 120_000)).toBe(1);
  });

  it("draws at full width when there is no shelf to compare against", () => {
    // The landing page's example and the first-run glyph both stand alone.
    expect(spineFill(0, 0)).toBe(1);
    expect(spineFill(4200, 0)).toBe(1);
  });

  it("orders the shelf by length", () => {
    const shelf = [500, 12_000, 120_000].map((words) =>
      spineFill(words, 120_000),
    );
    expect(shelf[0]).toBeLessThan(shelf[1]);
    expect(shelf[1]).toBeLessThan(shelf[2]);
  });

  it("roots rather than scaling linearly, so the short end stays legible", () => {
    // A quarter the words is half the width, not a quarter of it.
    expect(spineFill(25_000, 100_000)).toBeCloseTo(0.5, 10);
  });

  it("never draws a project as a speck", () => {
    // Linear, a 200-word sketch beside a finished novel would be 0.17% of the
    // card, a few pixels that read as a rendering fault rather than a project.
    expect(spineFill(200, 120_000)).toBe(0.08);
  });

  it("cannot exceed the space it is given", () => {
    // A stale cached count can outrun the shelf max it was measured against.
    expect(spineFill(200_000, 120_000)).toBe(1);
  });
});

describe("layoutSpineGoal", () => {
  const goal = 10_000;
  const scale = scaleFor(54);
  const parts = () => spineParts(structure, stats);
  // Part one: 100 own + 2000 sections. Part two: 1000 sections, no own text.
  // Total 3100, against a 10000 goal.

  it("starts every Part at an equal share of the goal", () => {
    const layout = layoutSpineGoal(parts(), scale, goal);
    const [one, two] = layout.parts;
    expect(one.totalWords).toBe(2100);
    expect(two.totalWords).toBe(1000);
    // Both contents sit under the equal share, so nothing is borrowed:
    // capacity, and so width, is goal/n for each whatever the content. The
    // bar is the goal, not the content. The allocation is read through
    // `unusedWords + totalWords`, the fields renderers use.
    expect(one.unusedWords + one.totalWords).toBeCloseTo(5000, 5);
    expect(two.unusedWords + two.totalWords).toBeCloseTo(5000, 5);
    expect(one.width).toBeCloseTo(two.width, 5);
  });

  it("borrows capacity from its neighbours when content outgrows the share", () => {
    const lopsided: DocumentStats = {
      ...stats,
      perNode: [
        { nodeId: "EL1", words: 3000, updatedAt: AT(20) },
        { nodeId: "EL2", words: 3000, updatedAt: AT(21) },
        { nodeId: "EL3", words: 2000, updatedAt: AT(22) },
        { nodeId: "EL5", words: 1000, updatedAt: AT(23) },
      ],
    };
    const layout = layoutSpineGoal(
      spineParts(structure, lopsided),
      scale,
      goal,
    );
    // Part one holds 8000 words against an initial 5000: it borrows 3000
    // from Part two's unused capacity (4000), the donor giving everything
    // it is asked for, proportionally.
    const [one, two] = layout.parts;
    expect(one.unusedWords + one.totalWords).toBeCloseTo(8000, 5);
    expect(two.unusedWords + two.totalWords).toBeCloseTo(2000, 5);
    expect(one.width / two.width).toBeCloseTo(4, 5);
    // Nothing unused in the full Part; the donor keeps its sliver of air.
    expect(one.unusedWords).toBe(0);
    expect(two.unusedWords).toBeCloseTo(1000, 5);
  });

  it("ports the reference model's own example — 60 words in one of three Parts", () => {
    // Goal 100, Part A holds 60 words, B and C hold none.
    // Initial capacity 33.33 each; A borrows 26.67 from B and C, each
    // donor giving in proportion to its unused capacity (equal, so equal):
    // A 60, B 20, C 20.
    const three: DocumentStructure = {
      version: 1,
      children: ["a", "b", "c"].map((name, i) => ({
        kind: "part",
        id: `EL${i * 2 + 1}`,
        title: name,
        adopted: `part--${name}.00.md`,
        snapshots: [
          { file: `part--${name}.00.md`, title: name, created: AT(1) },
        ],
        children: [
          {
            kind: "section",
            id: `EL${i * 2 + 2}`,
            title: `${name} sec`,
            adopted: `section--${name}.00.md`,
            snapshots: [
              { file: `section--${name}.00.md`, title: name, created: AT(1) },
            ],
          },
        ],
      })),
    };
    const threeStats: DocumentStats = {
      words: 60,
      parts: 3,
      sections: 3,
      countedAt: AT(1),
      perNode: [{ nodeId: "EL2", words: 60, updatedAt: AT(1) }],
    };
    const layout = layoutSpineGoal(
      spineParts(three, threeStats),
      scaleFor(54),
      100,
    );
    expect(
      layout.parts[0].unusedWords + layout.parts[0].totalWords,
    ).toBeCloseTo(60, 10);
    expect(
      layout.parts[1].unusedWords + layout.parts[1].totalWords,
    ).toBeCloseTo(20, 10);
    expect(
      layout.parts[2].unusedWords + layout.parts[2].totalWords,
    ).toBeCloseTo(20, 10);
    expect(layout.parts[0].unusedWords).toBe(0);
    expect(layout.parts[1].unusedWords).toBeCloseTo(20, 10);
  });

  it("the sum of a Part's bars, gaps and empty region is its width", () => {
    const layout = layoutSpineGoal(parts(), scale, goal);
    const one = layout.parts[0];
    const bars = one.bars.reduce((t, b) => t + b.width, 0);
    const innerGaps = (one.bars.length - 1) * scale.gapSection;
    expect(bars + innerGaps + one.emptyWidth).toBeCloseTo(one.width, 5);
  });

  it("sections do not fill the Part — the unused capacity stays visible", () => {
    const layout = layoutSpineGoal(parts(), scale, goal);
    const one = layout.parts[0];
    // 2100 words of 5000 capacity: about 58% of the Part is hatched empty.
    expect(one.unusedWords).toBeCloseTo(2900, 5);
    expect(one.emptyWidth).toBeGreaterThan(0);
    // A full Part — content == capacity — has nothing left to hatch.
    const [lopsided] = layoutSpineGoal(
      spineParts(structure, {
        ...stats,
        perNode: [
          { nodeId: "EL1", words: 3000, updatedAt: AT(20) },
          { nodeId: "EL2", words: 3000, updatedAt: AT(21) },
          { nodeId: "EL3", words: 2000, updatedAt: AT(22) },
          { nodeId: "EL5", words: 1000, updatedAt: AT(23) },
        ],
      }),
      scale,
      goal,
    ).parts;
    expect(lopsided.emptyWidth).toBe(0);
  });

  it("draws the Part's own text as a leading slice", () => {
    const layout = layoutSpineGoal(parts(), scale, goal);
    const bars = layout.parts[0].bars;
    expect(bars[0].kind).toBe("own");
    expect(bars[0].nodeId).toBe("EL1");
    expect(bars[0].words).toBe(100);
    // Positive bars share the used budget by words, purely proportionally,
    // with no `MIN_BAR` reservation shifting either side. The own slice is a
    // tenth of the next bar.
    expect(bars[0].width / bars[1].width).toBeCloseTo(0.1, 10);
  });

  it("never collapses — every Part keeps its equal share whatever the content", () => {
    // 1600 words into a 110,000-word goal. The equal share is structural:
    // each Part draws half the bar, hatched empty, with the content a
    // sliver inside it. Nothing to floor, nothing to collapse.
    const sliver: DocumentStats = {
      ...stats,
      perNode: stats.perNode.map((n) => ({ ...n, words: 400 })),
    };
    const layout = layoutSpineGoal(
      spineParts(structure, sliver),
      scale,
      110_000,
    );
    const [one, two] = layout.parts;
    expect(one.width).toBeCloseTo(two.width, 5);
    expect(one.width).toBeGreaterThan(400);
    expect(one.unusedWords).toBeCloseTo(55_000 - 1200, 5);
  });

  it("fills the spine and reports the overrun when past the goal", () => {
    const layout = layoutSpineGoal(parts(), scale, 2000);
    // 3100 words of a 2000 goal: the capacity equals the content, the
    // drawing compresses to the full spine, and the badge carries the overrun
    // from the one formula the Desk badge shares.
    expect(overrunPercent(3100, 2000)).toBe(55);
    const last = layout.parts[layout.parts.length - 1];
    expect(last.x + last.width).toBeLessThanOrEqual(SPINE_WIDTH + 0.001);
    expect(layout.parts.every((p) => p.emptyWidth === 0)).toBe(true);
  });

  it("falls back to the project's own total when the goal is unset", () => {
    const layout = layoutSpineGoal(parts(), scale, null);
    // With no goal the capacity is the content, so widths are proportional to
    // words and the empty region never appears.
    const [one, two] = layout.parts;
    expect(one.width).toBeCloseTo(two.width * 2.1, 5);
    expect(one.emptyWidth).toBe(0);
  });

  it("gives an empty Part its equal share, hollow", () => {
    const withEmpty: DocumentStructure = {
      ...structure,
      children: [
        ...structure.children,
        {
          kind: "part",
          id: "EL6",
          title: "three",
          adopted: "part--three.EL6.00.md",
          snapshots: [
            { file: "part--three.EL6.00.md", title: "three 1", created: AT(1) },
          ],
          children: [],
        },
      ],
    };
    const layout = layoutSpineGoal(
      spineParts(withEmpty, { ...stats, perNode: [] }),
      scale,
      goal,
    );
    const empty = layout.parts[2];
    expect(empty.empty).toBe(true);
    expect(empty.width).toBeCloseTo(layout.parts[0].width, 5);
    expect(empty.unusedWords).toBeCloseTo(goal / 3, 5);
  });

  it("divides evenly when nothing is written and no goal is set", () => {
    const layout = layoutSpineGoal(
      spineParts(structure, { ...stats, perNode: [] }),
      scale,
      null,
    );
    const widths = layout.parts.map((p) => p.width);
    for (const w of widths) expect(w).toBeCloseTo(widths[0], 5);
  });

  it("carries each Section's delta onto its bar and the Part's onto the border", () => {
    const withDeltas: DocumentStats = {
      ...stats,
      perNode: stats.perNode.map((n) =>
        n.nodeId === "EL1"
          ? { ...n, lastDelta: 50 }
          : n.nodeId === "EL2"
            ? { ...n, lastDelta: -250 }
            : n,
      ),
    };
    const layout = layoutSpineGoal(
      spineParts(structure, withDeltas),
      scale,
      goal,
    );
    expect(layout.parts[0].delta).toBe(50);
    const section = layout.parts[0].bars.find(
      (b) => b.kind === "section" && b.nodeId === "EL2",
    );
    expect(section?.delta).toBe(-250);
  });

  it("carries the Part's own delta onto its own slice bar", () => {
    const withOwnDelta: DocumentStats = {
      ...stats,
      perNode: stats.perNode.map((n) =>
        n.nodeId === "EL1" ? { ...n, lastDelta: 40 } : n,
      ),
    };
    const layout = layoutSpineGoal(
      spineParts(structure, withOwnDelta),
      scale,
      goal,
    );
    const ownBar = layout.parts[0].bars.find((b) => b.kind === "own");
    expect(ownBar).toBeDefined();
    expect(ownBar?.delta).toBe(40);
    expect(layout.parts[0].delta).toBe(40);
    const nested: DocumentStructure = {
      version: STRUCTURE_VERSION,
      children: [
        {
          kind: "part",
          id: "EL1",
          title: "outer",
          adopted: "part--outer.EL1.00.md",
          snapshots: [
            { file: "part--outer.EL1.00.md", title: "outer 1", created: AT(1) },
          ],
          children: [
            {
              kind: "part",
              id: "EL2",
              title: "inner",
              adopted: "part--inner.EL2.00.md",
              snapshots: [
                {
                  file: "part--inner.EL2.00.md",
                  title: "inner 1",
                  created: AT(1),
                },
              ],
              children: [
                {
                  kind: "section",
                  id: "EL3",
                  title: "deep",
                  adopted: "section--deep.EL3.00.md",
                  snapshots: [
                    {
                      file: "section--deep.EL3.00.md",
                      title: "deep 1",
                      created: AT(1),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const nestedStats: DocumentStats = {
      words: 600,
      parts: 2,
      sections: 1,
      countedAt: AT(1),
      perNode: [
        { nodeId: "EL1", words: 100, updatedAt: AT(1), lastDelta: 10 },
        { nodeId: "EL2", words: 200, updatedAt: AT(1), lastDelta: 15 },
        { nodeId: "EL3", words: 300, updatedAt: AT(1) },
      ],
    };
    const nestedLayout = layoutSpineGoal(
      spineParts(nested, nestedStats),
      scale,
      1000,
    );
    const nestedOwn = nestedLayout.parts[0].bars.find((b) => b.kind === "own");
    expect(nestedOwn?.delta).toBe(25);
  });

  it("draws nothing for a document with no Parts at all", () => {
    const layout = layoutSpineGoal([], scale, goal);
    expect(layout.parts).toEqual([]);
    expect(layout.bars).toEqual([]);
  });

  // The capacity share is the ideal width. A Part that cannot hold its bars
  // and gaps at `MIN_BAR` takes its floor, the Parts with slack pay the
  // difference proportionally, and when even the floors cannot fit the field
  // one `fit` scales `MIN_BAR` and both gaps, so the walk never runs past the
  // viewBox.
  it("— a bar-dense Part must not push the drawing past the field", () => {
    const dense: SpinePart[] = [
      {
        nodeId: "D0",
        title: "dense",
        words: 0,
        ownWords: 0,
        ownDelta: null,
        sections: Array.from({ length: 60 }, (_, i) => ({
          nodeId: `D0S${i}`,
          title: String(i),
          words: 0,
          recency: 1,
          delta: null,
        })),
      },
      ...Array.from({ length: 11 }, (_, p) => ({
        nodeId: `D${p + 1}`,
        title: String(p + 1),
        words: 0,
        ownWords: 0,
        ownDelta: null,
        sections: [
          {
            nodeId: `D${p + 1}S0`,
            title: "s",
            words: 0,
            recency: 1,
            delta: null,
          },
        ],
      })),
    ];
    const layout = layoutSpineGoal(dense, scaleFor(54), 100_000);
    const last = layout.parts[layout.parts.length - 1];
    expect(last.x + last.width).toBeLessThanOrEqual(SPINE_WIDTH + 1e-9);
    // The floors fit: `fit` is 1, so the dense Part sits on its floor (60
    // bars and 59 gaps at `MIN_BAR` 2) and every bar stays inside its own
    // Part.
    expect(layout.parts[0].width).toBeCloseTo(60 * 2 + 59 * 2, 6);
    for (const part of layout.parts) {
      for (const bar of part.bars) {
        expect(bar.x).toBeGreaterThanOrEqual(part.x - 1e-9);
        expect(bar.x + bar.width).toBeLessThanOrEqual(
          part.x + part.width + 1e-9,
        );
      }
    }
  });

  it("— when even the minimums cannot fit, the pitch scales and the field still spans exactly", () => {
    const dense: SpinePart[] = [
      {
        nodeId: "D0",
        title: "dense",
        words: 0,
        ownWords: 0,
        ownDelta: null,
        sections: Array.from({ length: 300 }, (_, i) => ({
          nodeId: `D0S${i}`,
          title: String(i),
          words: 0,
          recency: 1,
          delta: null,
        })),
      },
      {
        nodeId: "D1",
        title: "one",
        words: 0,
        ownWords: 0,
        ownDelta: null,
        sections: [
          { nodeId: "D1S0", title: "s", words: 0, recency: 1, delta: null },
        ],
      },
    ];
    // pitch = 7 + (300*2 + 299*2) + 2 = 1207 > 1000, so `fit` < 1; the scaled
    // floors sum to `available`, and the drawing ends on the field.
    const layout = layoutSpineGoal(dense, scaleFor(54), 100_000);
    const last = layout.parts[layout.parts.length - 1];
    expect(last.x + last.width).toBeLessThanOrEqual(SPINE_WIDTH + 1e-9);
    expect(Math.abs(last.x + last.width - SPINE_WIDTH)).toBeLessThan(1e-6);
    for (const part of layout.parts) {
      expect(Number.isFinite(part.width)).toBe(true);
      expect(part.width).toBeGreaterThan(0);
    }
  });

  it("— the gap-dominated cliff stays finite, non-negative and inside the field", () => {
    // A Part whose 500 zero-word Sections' gaps alone pass the field. A naive
    // shrink yields a negative width while the end still lands on 1000, so
    // the end position alone proves nothing.
    const cliff: SpinePart[] = [
      {
        nodeId: "D0",
        title: "cliff",
        words: 0,
        ownWords: 0,
        ownDelta: null,
        sections: Array.from({ length: 500 }, (_, i) => ({
          nodeId: `D0S${i}`,
          title: String(i),
          words: 0,
          recency: 1,
          delta: null,
        })),
      },
      {
        nodeId: "D1",
        title: "one",
        words: 0,
        ownWords: 0,
        ownDelta: null,
        sections: [
          { nodeId: "D1S0", title: "s", words: 0, recency: 1, delta: null },
        ],
      },
    ];
    const layout = layoutSpineGoal(cliff, scaleFor(54), 100_000);
    const last = layout.parts[layout.parts.length - 1];
    expect(last.x + last.width).toBeLessThanOrEqual(SPINE_WIDTH + 1e-9);
    for (const part of layout.parts) {
      expect(Number.isFinite(part.width)).toBe(true);
      expect(part.width).toBeGreaterThan(0);
    }
    for (const bar of layout.bars) {
      expect(Number.isFinite(bar.width)).toBe(true);
      expect(bar.width).toBeGreaterThanOrEqual(0);
    }
  });

  it("— a Part with no bars keeps a visible field under the shrink", () => {
    // A barless Part's floor is one minimum unit, not zero; otherwise the
    // slack reduce can absorb it to width 0 and orphan its two Part gaps.
    const dense: SpinePart = {
      nodeId: "D0",
      title: "dense",
      words: 0,
      ownWords: 0,
      ownDelta: null,
      sections: Array.from({ length: 60 }, (_, i) => ({
        nodeId: `D0S${i}`,
        title: String(i),
        words: 0,
        recency: 1,
        delta: null,
      })),
    };
    const barless: SpinePart = {
      nodeId: "B0",
      title: "barless",
      words: 0,
      ownWords: 0,
      ownDelta: null,
      sections: [],
    };
    const singles: SpinePart[] = Array.from({ length: 10 }, (_, p) => ({
      nodeId: `D${p + 1}`,
      title: String(p + 1),
      words: 0,
      ownWords: 0,
      ownDelta: null,
      sections: [
        {
          nodeId: `D${p + 1}S0`,
          title: "s",
          words: 0,
          recency: 1,
          delta: null,
        },
      ],
    }));
    const layout = layoutSpineGoal(
      [dense, barless, ...singles],
      scaleFor(54),
      100_000,
    );
    const bare = layout.parts.find((p) => p.nodeId === "B0");
    expect(bare?.bars).toEqual([]);
    // MIN_BAR is 2; the floor keeps the barless Part from vanishing.
    expect(bare?.width).toBeGreaterThanOrEqual(2);
    const last = layout.parts[layout.parts.length - 1];
    expect(last.x + last.width).toBeLessThanOrEqual(SPINE_WIDTH + 1e-9);
  });

  it("— a barless Part sits on the same one-unit floor as a single-bar Part under the scale-down", () => {
    // Both Parts hold one unit of structure, so with every Part on its floor
    // (`fit < 1`) their fields are identical. A barless Part without its
    // `max(1, w.length)` floor would land below its one-Section sibling. The
    // row above cannot see that: its `fit` is 1, where a zero floor passes.
    const dense: SpinePart = {
      nodeId: "D0",
      title: "dense",
      words: 0,
      ownWords: 0,
      ownDelta: null,
      sections: Array.from({ length: 300 }, (_, i) => ({
        nodeId: `D0S${i}`,
        title: String(i),
        words: 0,
        recency: 1,
        delta: null,
      })),
    };
    const barless: SpinePart = {
      nodeId: "B0",
      title: "barless",
      words: 0,
      ownWords: 0,
      ownDelta: null,
      sections: [],
    };
    const single: SpinePart = {
      nodeId: "D1",
      title: "single",
      words: 0,
      ownWords: 0,
      ownDelta: null,
      sections: [
        { nodeId: "D1S0", title: "s", words: 0, recency: 1, delta: null },
      ],
    };
    const layout = layoutSpineGoal(
      [dense, barless, single],
      scaleFor(54),
      100_000,
    );
    const bare = layout.parts.find((p) => p.nodeId === "B0");
    const one = layout.parts.find((p) => p.nodeId === "D1");
    expect(bare?.width).toBeGreaterThan(0);
    expect(bare?.width).toBeCloseTo(one?.width ?? -1, 10);
    const last = layout.parts[layout.parts.length - 1];
    expect(last.x + last.width).toBeLessThanOrEqual(SPINE_WIDTH + 1e-9);
  });

  // A probe book with goal 107: four Parts each written to their capacity
  // (Ki 14, Sho 26, Ten 5, Ketsu 62; five own words apiece, the Sections
  // holding the rest). The gaps come out of the width budget, not on top of
  // it, so no bar crosses its Part's border.
  const probePart = (title: string, sectionWords: number[]) => ({
    kind: "part" as const,
    id: title,
    title,
    adopted: `part--${title}.00.md`,
    snapshots: [{ file: `part--${title}.00.md`, title, created: AT(1) }],
    children: sectionWords.map((_, s) => ({
      kind: "section" as const,
      id: `${title}S${s}`,
      title: `${title} ${s + 1}`,
      adopted: `section--${title}${s}.00.md`,
      snapshots: [
        {
          file: `section--${title}${s}.00.md`,
          title: `${title} ${s + 1}`,
          created: AT(1),
        },
      ],
    })),
  });
  const probeBook = (): {
    structure: DocumentStructure;
    stats: DocumentStats;
  } => {
    const sections = [
      ["Ki", [2, 7]],
      ["Sho", [5, 16]],
      ["Ten", [0, 0]],
      ["Ketsu", [57, 0]],
    ] as const;
    const perNode: NodeStat[] = sections.flatMap(([title, words]) => [
      { nodeId: title, words: 5, updatedAt: AT(1) },
      ...words.map((words, s) => ({
        nodeId: `${title}S${s}`,
        words,
        updatedAt: AT(1),
      })),
    ]);
    return {
      structure: {
        version: 1,
        children: sections.map(([title, words]) =>
          probePart(title, [...words]),
        ),
      },
      stats: {
        words: 107,
        parts: 4,
        sections: 8,
        countedAt: AT(1),
        perNode,
      },
    };
  };

  it("never lets a Section cross its Part's border in the probe book", () => {
    const { structure, stats } = probeBook();
    const layout = layoutSpineGoal(
      spineParts(structure, stats),
      scaleFor(54),
      107,
    );

    // The water-fill settles exactly onto the content (goal == total):
    // capacities [14, 26, 5, 62], read through `unusedWords + totalWords`.
    const caps = layout.parts.map((p) => p.unusedWords + p.totalWords);
    [14, 26, 5, 62].forEach((c, i) => expect(caps[i]).toBeCloseTo(c, 10));

    // The drawing spans the full width: the Parts plus the three 7-unit Part
    // gaps sum to `SPINE_WIDTH`, with the Section gaps subtracted once.
    const lastPart = layout.parts[layout.parts.length - 1];
    expect(lastPart.x + lastPart.width).toBeCloseTo(SPINE_WIDTH, 10);

    for (const part of layout.parts) {
      const right = part.x + part.width;
      for (const bar of part.bars) {
        expect(bar.x).toBeGreaterThanOrEqual(part.x - 1e-9);
        expect(bar.x + bar.width).toBeLessThanOrEqual(right + 1e-9);
      }
      // Bars, gaps and hatch sum to the field.
      const barsSum = part.bars.reduce((t, b) => t + b.width, 0);
      const innerGaps =
        Math.max(0, part.bars.length - 1) * scaleFor(54).gapSection;
      expect(barsSum + innerGaps + part.emptyWidth).toBeCloseTo(part.width, 5);
    }

    // Ki's own slice is purely proportional: its content area (width
    // 979×14/107 less the two 2-unit gaps) × 5/14, with no reservation shift.
    const ki = layout.parts[0];
    expect(ki.width).toBeCloseTo((979 * 14) / 107, 10);
    expect(ki.bars[0].width).toBeCloseTo(((979 * 14) / 107 - 4) * (5 / 14), 10);
    expect(ki.bars[2].width).toBeCloseTo(((979 * 14) / 107 - 4) * (7 / 14), 10);
    // Ten and Ketsu are full: their empty Sections leave the drawing with no
    // width and no gaps, so the visible bars end on the border with no
    // orphaned gaps at the field's edge.
    const ten = layout.parts[2];
    expect(ten.bars.filter((b) => b.empty).length).toBe(0);
    expect(ten.bars[0].x + ten.bars[0].width).toBeCloseTo(
      ten.x + ten.width,
      10,
    );
    const ketsu = layout.parts[3];
    expect(ketsu.bars.length).toBe(2);
    expect(ketsu.bars[1].x + ketsu.bars[1].width).toBeCloseTo(
      ketsu.x + ketsu.width,
      10,
    );
  });

  // One Part, two Sections — the cleanest surface for the exact-proportion
  // pins, with no Part gaps in the way.
  const soloPart = (sectionWords: number[]): DocumentStructure => ({
    version: 1,
    children: [
      {
        kind: "part",
        id: "P0",
        title: "solo",
        adopted: "part--solo.EL9.00.md",
        snapshots: [
          { file: "part--solo.EL9.00.md", title: "solo", created: AT(1) },
        ],
        children: sectionWords.map((_, s) => ({
          kind: "section" as const,
          id: `P0S${s}`,
          title: `s${s}`,
          adopted: `section--s${s}.00.md`,
          snapshots: [
            { file: `section--s${s}.00.md`, title: `s${s}`, created: AT(1) },
          ],
        })),
      },
    ],
  });
  const soloStats = (words: number[]): DocumentStats => ({
    words: words.reduce((t, w) => t + w, 0),
    parts: 1,
    sections: words.length,
    countedAt: AT(1),
    perNode: words.map((words, s) => ({
      nodeId: `P0S${s}`,
      words,
      updatedAt: AT(1),
    })),
  });

  it("draws positive bars at exactly words/capacity and caps empties to the hatch", () => {
    // 1000 words of a 5000 capacity: the written Section is exactly a
    // fifth of the content area, the empty one rides the hatch at MIN_BAR.
    const layout = layoutSpineGoal(
      spineParts(soloPart([1000, 0]), soloStats([1000, 0])),
      scaleFor(54),
      5000,
    );
    const part = layout.parts[0];
    // One Part, no Part gaps: the field is the whole 1000, the content
    // area 998 after the one 2-unit Section gap.
    expect(part.width).toBeCloseTo(1000, 5);
    expect(part.bars[0].width).toBeCloseTo(998 * 0.2, 10);
    expect(part.bars[1].empty).toBe(true);
    expect(part.bars[1].width).toBe(2);
    expect(part.emptyWidth).toBeCloseTo(998 - 199.6 - 2, 10);
    // The field holds everything: the last bar ends inside the border.
    expect(part.bars[1].x + part.bars[1].width).toBeLessThanOrEqual(
      part.x + part.width + 1e-9,
    );
  });

  it("collapses an empty Section when the hatch cannot hold it at MIN_BAR", () => {
    // 4999 of 5000 capacity: the hatch is a sliver under `MIN_BAR`, so the
    // empty Section leaves the drawing with no width and no gap, rather than
    // leaving orphaned separators at the field's edge.
    const layout = layoutSpineGoal(
      spineParts(soloPart([4999, 0]), soloStats([4999, 0])),
      scaleFor(54),
      5000,
    );
    const part = layout.parts[0];
    expect(part.bars.filter((b) => b.empty).length).toBe(0);
    expect(part.bars[0].width).toBeCloseTo(1000 * (4999 / 5000), 10);
    expect(part.emptyWidth).toBeCloseTo(0.2, 10);
    // The one gap went with the collapsed Section: bar + hatch = the field.
    expect(part.bars[0].width + part.emptyWidth).toBeCloseTo(part.width, 10);
  });

  it("keeps the legacy drawing's minima-first bars, contained too", () => {
    // The same book with no goal: the capacity is the content, the bars fill
    // the content area with the gaps reserved, and the empty Section keeps
    // `MIN_BAR`.
    const layout = layoutSpineGoal(
      spineParts(soloPart([1000, 0]), soloStats([1000, 0])),
      scaleFor(54),
      null,
    );
    const part = layout.parts[0];
    expect(part.bars[0].width).toBeCloseTo(996, 10);
    expect(part.bars[1].width).toBe(2);
    expect(part.emptyWidth).toBe(0);
  });

  it("folds a nested Part's own words into the outer Part's count", () => {
    const nested: DocumentStructure = {
      version: STRUCTURE_VERSION,
      children: [
        {
          kind: "part",
          id: "EL1",
          title: "outer",
          adopted: "part--outer.EL1.00.md",
          snapshots: [
            { file: "part--outer.EL1.00.md", title: "outer", created: AT(1) },
          ],
          children: [
            {
              kind: "part",
              id: "EL2",
              title: "inner",
              adopted: "part--inner.EL2.00.md",
              snapshots: [
                {
                  file: "part--inner.EL2.00.md",
                  title: "inner",
                  created: AT(1),
                },
              ],
              children: [
                {
                  kind: "section",
                  id: "EL3",
                  title: "deep",
                  adopted: "section--deep.EL3.00.md",
                  snapshots: [
                    {
                      file: "section--deep.EL3.00.md",
                      title: "deep",
                      created: AT(1),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const nestedStats: DocumentStats = {
      words: 600,
      parts: 2,
      sections: 1,
      countedAt: AT(1),
      perNode: [
        { nodeId: "EL1", words: 100, updatedAt: AT(1) },
        { nodeId: "EL2", words: 200, updatedAt: AT(1) },
        { nodeId: "EL3", words: 300, updatedAt: AT(1) },
      ],
    };
    const outer = spineParts(nested, nestedStats);
    expect(outer).toHaveLength(1);
    // 100 of the outer file + 200 of the nested Part's own file.
    expect(outer[0].ownWords).toBe(300);
    expect(outer[0].words).toBe(300);
    // The spine's totals agree with the project's real count.
    const layout = layoutSpineGoal(outer, scale, 1000);
    expect(layout.totalWords).toBe(600);
    expect(layout.parts[0].totalWords).toBe(600);
    expect(layout.parts[0].ownWords).toBe(300);
  });

  it("treats absurd word counts as empty rather than poisoning the geometry", () => {
    // Writer files are hostile input: a hand-edited yaml can carry 1e400,
    // which parses to `Infinity` and turns every width it touches into `NaN`.
    const hostile: DocumentStats = {
      ...stats,
      perNode: [
        { nodeId: "EL1", words: Number.POSITIVE_INFINITY, updatedAt: AT(20) },
        { nodeId: "EL2", words: Number.NaN, updatedAt: AT(21) },
        { nodeId: "EL3", words: -400, updatedAt: AT(22) },
        { nodeId: "EL5", words: 1000, updatedAt: AT(23) },
      ],
    };
    const layout = layoutSpineGoal(spineParts(structure, hostile), scale, goal);
    for (const part of layout.parts) {
      expect(Number.isFinite(part.width)).toBe(true);
      expect(Number.isFinite(part.x)).toBe(true);
      for (const bar of part.bars)
        expect(Number.isFinite(bar.width)).toBe(true);
    }
    // An absurd goal falls back to the goal-less drawing instead of `NaN`
    // widths, and an absurd delta never rides a bar.
    const infGoal = layoutSpineGoal(
      spineParts(structure, stats),
      scale,
      Number.POSITIVE_INFINITY,
    );
    for (const part of infGoal.parts) {
      expect(Number.isFinite(part.width)).toBe(true);
    }
    const infDelta: DocumentStats = {
      ...stats,
      perNode: stats.perNode.map((n) =>
        n.nodeId === "EL2" ? { ...n, lastDelta: Number.POSITIVE_INFINITY } : n,
      ),
    };
    expect(spineParts(structure, infDelta)[0].sections[0].delta).toBeNull();
  });
});

describe("overrunPercent — the one overrun formula", () => {
  it("is null at or under the goal, or with none set", () => {
    expect(overrunPercent(2000, 2000)).toBeNull();
    expect(overrunPercent(1000, 2000)).toBeNull();
    expect(overrunPercent(3100, null)).toBeNull();
    expect(overrunPercent(3100, 0)).toBeNull();
  });

  it("rounds the whole percent past the goal", () => {
    expect(overrunPercent(3100, 2000)).toBe(55);
    expect(overrunPercent(2030, 2000)).toBe(2);
    expect(overrunPercent(2001, 2000)).toBe(0);
  });
});
