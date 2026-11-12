// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { spineRules } from "./spineRules";
import {
  STRUCTURE_VERSION,
  type DocumentStats,
  type DocumentStructure,
  type DocNode,
} from "../../../project/types";

const AT = (day: number) =>
  `2026-07-${String(day).padStart(2, "0")}T10:00:00.000Z`;

const section = (id: string, title: string): DocNode => ({
  kind: "section",
  id,
  title,
  adopted: `section--${title}.${id}.00.md`,
  snapshots: [{ file: `section--${title}.${id}.00.md`, title, created: AT(1) }],
});

const part = (id: string, title: string, children: DocNode[]): DocNode => ({
  kind: "part",
  id,
  title,
  adopted: `part--${title}.${id}.00.md`,
  snapshots: [{ file: `part--${title}.${id}.00.md`, title, created: AT(1) }],
  children,
});

const structure: DocumentStructure = {
  version: STRUCTURE_VERSION,
  children: [
    part("EL1", "one", [section("EL2", "a"), section("EL3", "b")]),
    part("EL4", "two", [section("EL5", "c")]),
  ],
};

const stats: DocumentStats = {
  words: 933,
  parts: 2,
  sections: 3,
  countedAt: AT(28),
  perNode: [
    { nodeId: "EL1", words: 0 },
    { nodeId: "EL2", words: 412, updatedAt: AT(28), lastDelta: -40 },
    { nodeId: "EL3", words: 221, updatedAt: AT(27), lastDelta: 152 },
    { nodeId: "EL4", words: 0 },
    { nodeId: "EL5", words: 300, updatedAt: AT(10) },
  ],
};

describe("spineRules", () => {
  const rules = spineRules(structure, stats, 2000, "section--a.EL2.00.md");
  const [one, two] = rules.parts;

  it("gives each Part its share of the goal, numbered as the contents are", () => {
    expect(rules.parts.map((p) => p.label)).toEqual(["01", "02"]);
    expect(one.share).toBeCloseTo(0.5, 2);
    expect(two.share).toBeCloseTo(0.5, 2);
    expect(one.count).toBe("633");
    expect(two.count).toBe("300");
  });

  it("sets each Section at its words' share of its Part, the room after them", () => {
    expect(one.rules.map((r) => r.nodeId)).toEqual(["EL2", "EL3"]);
    expect(one.rules[0].share).toBeCloseTo(0.412, 3);
    expect(one.rules[1].share).toBeCloseTo(0.221, 3);
    expect(one.room).toBeCloseTo(0.367, 3);
    expect(two.rules[0].share + two.room).toBeCloseTo(1, 6);
  });

  it("pales the ink with time and marks the last sitting's work", () => {
    expect(one.rules[0].ink).toBeGreaterThan(two.rules[0].ink);
    expect(one.rules[0].ink).toBeLessThanOrEqual(1);
    expect(two.rules[0].ink).toBeGreaterThanOrEqual(0.3);
    expect(one.rules.map((r) => r.mark)).toEqual(["cut", "written"]);
    expect(two.rules[0].mark).toBeNull();
  });

  it("marks the Part the writer is in", () => {
    expect(rules.parts.map((p) => p.current)).toEqual([true, false]);
    const none = spineRules(structure, stats, 2000, null);
    expect(none.parts.every((p) => !p.current)).toBe(true);
  });

  it("tells a screen reader what the spine tells it", () => {
    expect(rules.description).toBe("2 parts, 3 sections, 933 words");
  });

  it("fills each Part with its Sections when there is no goal", () => {
    const bare = spineRules(structure, stats, null, null);
    for (const p of bare.parts) expect(p.room).toBe(0);
    const total = bare.parts[0].rules.reduce((t, r) => t + r.share, 0);
    expect(total).toBeCloseTo(1, 6);
  });
});
