// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  buildStats,
  countWords,
  emptyStats,
  sessionDeltas,
  structureCounts,
  withNodeCount,
} from "./stats";
import type { DocumentStructure, NodeStat } from "./types";
import { STRUCTURE_VERSION } from "./types";

// A three-Part shape: one Part holding Sections, one holding a Part, and one
// empty, enough to show the walk goes all the way down. Each node carries its
// `.00` snapshot, the shape the validator expects of a real project.
const structure: DocumentStructure = {
  version: STRUCTURE_VERSION,
  children: [
    {
      kind: "part",
      id: "EL1",
      title: "act one",
      adopted: "part--act_one.EL1.00.md",
      snapshots: [
        {
          file: "part--act_one.EL1.00.md",
          title: "act one 1",
          created: "2026-01-01T00:00:00.000Z",
        },
      ],
      children: [
        {
          kind: "section",
          id: "EL2",
          title: "opening",
          adopted: "section--opening.EL2.00.md",
          snapshots: [
            {
              file: "section--opening.EL2.00.md",
              title: "opening 1",
              created: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
        {
          kind: "section",
          id: "EL3",
          title: "the storm",
          adopted: "section--the_storm.EL3.00.md",
          snapshots: [
            {
              file: "section--the_storm.EL3.00.md",
              title: "the storm 1",
              created: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
    },
    {
      kind: "part",
      id: "EL4",
      title: "act two",
      adopted: "part--act_two.EL4.00.md",
      snapshots: [
        {
          file: "part--act_two.EL4.00.md",
          title: "act two 1",
          created: "2026-01-01T00:00:00.000Z",
        },
      ],
      children: [
        {
          kind: "part",
          id: "EL5",
          title: "the crossing",
          adopted: "part--the_crossing.EL5.00.md",
          snapshots: [
            {
              file: "part--the_crossing.EL5.00.md",
              title: "the crossing 1",
              created: "2026-01-01T00:00:00.000Z",
            },
          ],
          children: [
            {
              kind: "section",
              id: "EL6",
              title: "arrival",
              adopted: "section--arrival.EL6.00.md",
              snapshots: [
                {
                  file: "section--arrival.EL6.00.md",
                  title: "arrival 1",
                  created: "2026-01-01T00:00:00.000Z",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      kind: "part",
      id: "EL7",
      title: "act three",
      adopted: "part--act_three.EL7.00.md",
      snapshots: [
        {
          file: "part--act_three.EL7.00.md",
          title: "act three 1",
          created: "2026-01-01T00:00:00.000Z",
        },
      ],
      children: [],
    },
  ],
};

describe("countWords", () => {
  it("counts plain prose", () => {
    expect(countWords("The rain had not stopped for six days.")).toBe(8);
  });

  it("treats an apostrophe or a hyphen as part of the word", () => {
    expect(countWords("don't")).toBe(1);
    expect(countWords("don’t")).toBe(1);
    expect(countWords("well-known")).toBe(1);
    expect(countWords("a well-known man didn’t stop")).toBe(5);
  });

  it("does not count punctuation standing on its own", () => {
    expect(countWords("—")).toBe(0);
    expect(countWords("…")).toBe(0);
    expect(countWords("***")).toBe(0);
    expect(countWords("one — two")).toBe(2);
  });

  it("does not count markdown structure as words", () => {
    expect(countWords("# Chapter One")).toBe(2);
    expect(countWords("- first\n- second")).toBe(2);
    expect(countWords("> quoted line")).toBe(2);
    expect(countWords("---")).toBe(0);
  });

  it("counts an emphasised or code-spanned word once", () => {
    expect(countWords("**bold**")).toBe(1);
    expect(countWords("_italic_")).toBe(1);
    expect(countWords("`literal`")).toBe(1);
    expect(countWords("a **bold** word")).toBe(3);
  });

  it("ignores fenced code entirely", () => {
    const md =
      "before\n\n```js\nconst x = compute(all, the, things)\n```\n\nafter";
    expect(countWords(md)).toBe(2);
  });

  it("ignores a fence that was never closed", () => {
    expect(countWords("before\n\n```\nnever closed and full of words")).toBe(1);
  });

  // The codec fences a monospace run one backtick longer than the longest
  // run inside it, so a paragraph can open with three backticks that close
  // on the same line: a code span, not a fence.
  it("counts the paragraphs after a line that opens with a code span", () => {
    expect(countWords("```a``b``` tail\n\nsecond paragraph words")).toBe(5);
  });

  it("closes a fence only on a run at least as long as its opening", () => {
    expect(countWords("````\ncode\n```\nstill code\n````\n\nafter")).toBe(1);
  });

  // A typed backtick is escaped by the codec, a tilde is not: `~~~` is a
  // scene break the writer typed, and the prose after it counts.
  it("counts the prose after a tilde scene break", () => {
    expect(countWords("before\n\n~~~\n\nthe rest of the chapter")).toBe(6);
  });

  it("keeps a link’s text and drops its URL", () => {
    expect(countWords("see [the manual](https://example.com/deep/path)")).toBe(
      3,
    );
  });

  it("drops an image whole, alt text included", () => {
    expect(countWords("before ![a photo of a road](road.png) after")).toBe(2);
  });

  it("ignores HTML comments", () => {
    expect(countWords("visible <!-- hidden words here --> text")).toBe(2);
  });

  // The file format's directives are not the writer's words.
  it("counts neither a page break nor an alignment, but the words they carry", () => {
    expect(countWords("one\n\n{pagebreak}\n\ntwo")).toBe(2);
    expect(countWords("{align:center}* * *")).toBe(0);
    expect(countWords("{align:right}# The End")).toBe(2);
    // Typed text has its brace escaped, so the writer's own stays a word.
    expect(countWords("\\{pagebreak}")).toBe(1);
    expect(countWords("say \\{align:center} twice")).toBe(3);
  });

  it("counts numbers as words but not bare symbols", () => {
    expect(countWords("chapter 12")).toBe(2);
    expect(countWords("$ % &")).toBe(0);
  });

  it("counts non-Latin scripts", () => {
    expect(countWords("è già tardi")).toBe(3);
  });

  it("is unmoved by whitespace", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\n\t  ")).toBe(0);
    expect(countWords("  spaced   out  ")).toBe(2);
  });
});

describe("structureCounts", () => {
  it("counts Parts and Sections at every depth", () => {
    expect(structureCounts(structure)).toEqual({ parts: 4, sections: 3 });
  });

  it("counts an empty document as empty", () => {
    expect(
      structureCounts({ version: STRUCTURE_VERSION, children: [] }),
    ).toEqual({
      parts: 0,
      sections: 0,
    });
  });
});

describe("buildStats", () => {
  const at = "2026-07-28T10:00:00.000Z";

  it("totals the per-node counts", () => {
    const stats = buildStats(
      structure,
      [
        { nodeId: "EL1", words: 40, updatedAt: at },
        { nodeId: "EL2", words: 1200, updatedAt: at },
        { nodeId: "EL3", words: 800, updatedAt: at },
      ],
      at,
    );
    expect(stats.words).toBe(2040);
    expect(stats.parts).toBe(4);
    expect(stats.sections).toBe(3);
    expect(stats.countedAt).toBe(at);
  });

  it("counts a Part’s own text, not only its Sections", () => {
    const withPartText = buildStats(
      structure,
      [{ nodeId: "EL1", words: 500, updatedAt: at }],
      at,
    );
    expect(withPartText.words).toBe(500);
  });

  it("drops entries for nodes the shape no longer holds", () => {
    const stats = buildStats(
      structure,
      [
        { nodeId: "EL2", words: 100, updatedAt: at },
        { nodeId: "EL99", words: 9999, updatedAt: at },
      ],
      at,
    );
    expect(stats.words).toBe(100);
    expect(stats.perNode.map((n) => n.nodeId)).toEqual(["EL2"]);
  });

  it("reports zero for a document nothing has been counted in", () => {
    expect(buildStats(structure, [], at).words).toBe(0);
  });
});

describe("withNodeCount", () => {
  const before = "2026-07-27T10:00:00.000Z";
  const after = "2026-07-28T10:00:00.000Z";

  const base = buildStats(
    structure,
    [
      { nodeId: "EL2", words: 1200, updatedAt: before },
      { nodeId: "EL3", words: 800, updatedAt: before },
    ],
    before,
  );

  it("replaces one node’s count and re-totals", () => {
    const next = withNodeCount(base, structure, "EL2", 1500, after);
    expect(next.words).toBe(2300);
    expect(next.perNode).toHaveLength(2);
  });

  it("adds a node that had never been counted", () => {
    const next = withNodeCount(base, structure, "EL6", 300, after);
    expect(next.words).toBe(2300);
    expect(next.perNode).toHaveLength(3);
  });

  it("leaves the other nodes’ timestamps alone", () => {
    const next = withNodeCount(base, structure, "EL2", 1500, after);
    const storm = next.perNode.find((n) => n.nodeId === "EL3");
    expect(storm?.updatedAt).toBe(before);
    const opening = next.perNode.find((n) => n.nodeId === "EL2");
    expect(opening?.updatedAt).toBe(after);
  });

  it("does not duplicate an entry when the same node is counted twice", () => {
    const once = withNodeCount(base, structure, "EL2", 1500, after);
    const twice = withNodeCount(once, structure, "EL2", 1600, after);
    expect(twice.perNode.filter((n) => n.nodeId === "EL2")).toHaveLength(1);
    expect(twice.words).toBe(2400);
  });

  it("keeps the node's last-session delta through a mid-session save", () => {
    const baseWithDelta = buildStats(
      structure,
      [
        {
          nodeId: "EL2",
          words: 1200,
          updatedAt: before,
          lastDelta: 400,
        },
      ],
      before,
    );
    const next = withNodeCount(baseWithDelta, structure, "EL2", 1500, after);
    const entry = next.perNode.find((n) => n.nodeId === "EL2");
    // The session ends at the exit diff, not at the save. Until it lands, the
    // previous session's delta stands.
    expect(entry?.lastDelta).toBe(400);
  });
});

describe("sessionDeltas", () => {
  const perNode: NodeStat[] = [
    { nodeId: "EL2", words: 1500 },
    { nodeId: "EL3", words: 800 },
    { nodeId: "EL5", words: 600 },
  ];

  it("reports what each node gained or lost since the baseline", () => {
    const baseline = new Map([
      ["EL2", 1200],
      ["EL3", 1000],
      ["EL5", 600],
    ]);
    expect(sessionDeltas(perNode, baseline)).toEqual(
      new Map([
        ["EL2", 300],
        ["EL3", -200],
      ]),
    );
  });

  it("counts a node born this sitting from zero", () => {
    const baseline = new Map([["EL3", 800]]);
    expect(sessionDeltas(perNode, baseline).get("EL2")).toBe(1500);
  });

  it("is empty when nothing moved — the virtual session writes nothing", () => {
    const baseline = new Map([
      ["EL2", 1500],
      ["EL3", 800],
      ["EL5", 600],
    ]);
    expect(sessionDeltas(perNode, baseline).size).toBe(0);
  });
});

describe("emptyStats", () => {
  it("is counted, and genuinely empty — not unknown", () => {
    const at = "2026-07-28T10:00:00.000Z";
    expect(emptyStats(at)).toEqual({
      words: 0,
      parts: 0,
      sections: 0,
      countedAt: at,
      perNode: [],
    });
  });
});
