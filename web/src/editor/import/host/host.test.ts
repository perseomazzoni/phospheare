// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { hashOf } from "../../../text/hash";
import { parseStructure, serializeStructure } from "../../../project/structure";
import { TYPE_GOAL_DEFAULTS } from "../../../project/types";
import { manuscriptText } from "../adapters/manuscriptText";
import type { Draft, DraftNode, DraftParagraph } from "../domain/draft";
import { projectRules, titleWords } from "./projectRules";
import { seedFrom } from "./seed";
import { readComments } from "../../comments/domain/codec";
import type { CommentsFile } from "../../comments/domain/model";

const para = (text: string): DraftParagraph => ({
  blockType: "paragraph",
  alignment: "left",
  runs: [{ text, bold: false, italic: false, monospace: false }],
});
const section = (title: string, text: string): DraftNode => ({
  kind: "section",
  title,
  paragraphs: [para(text)],
  children: [],
});

const facts = {
  title: "Once Dark",
  author: "Ada",
  language: "it",
  type: "Novel",
  goal: 90_000,
  genres: ["fantasy" as const],
  ageCategory: null,
  tropes: ["found family"],
};

describe("seedFrom", () => {
  it("makes a project the app's own parser opens: free titles, ids in every file", async () => {
    const draft: Draft = {
      roots: [
        {
          kind: "part",
          title: "Chapter 1: The Storm",
          paragraphs: [para("The part's own words.")],
          children: [
            section("Anna", "She ran."),
            section("Anna", "She ran again, far."),
          ],
        },
      ],
      comments: [],
    };
    const seed = await seedFrom(
      draft,
      facts,
      "local",
      "once-dark",
      manuscriptText,
      projectRules,
      "2026-10-04T00:00:00.000Z",
    );
    expect(seed.destination).toBe("local");
    expect(seed.folderName).toBe("once-dark");
    const shape = seed.init.shape;
    if (!shape) throw new Error("no shape");
    const names = shape.files.map((f) => f.fileName);
    expect(names).toEqual([
      "part--chapter_1_the_storm.EL1.00.md",
      "section--anna.EL2.00.md",
      "section--anna.EL3.00.md",
    ]);
    // The project's own reader accepts it: two "Anna"s, a colon, every node
    // adopting the file written for it. Snapshots live in the properties
    // file; the round-trip suite opens the whole project.
    const parsed = parseStructure(serializeStructure(shape.structure));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const adopted: string[] = [];
    const walk = (nodes: typeof parsed.structure.children) => {
      for (const n of nodes) {
        adopted.push(n.adopted);
        if (n.kind === "part") walk(n.children);
      }
    };
    walk(parsed.structure.children);
    expect(adopted).toEqual(names);
    expect(seed.init.stats).toEqual([
      { nodeId: "EL1", words: 4 },
      { nodeId: "EL2", words: 2 },
      { nodeId: "EL3", words: 4 },
    ]);
    const first = shape.structure.children[0];
    expect(first.snapshots[0]).toEqual({
      file: "part--chapter_1_the_storm.EL1.00.md",
      title: "Chapter 1: The Storm 1",
      created: "2026-10-04T00:00:00.000Z",
      contentHash: await hashOf("The part's own words."),
    });
    expect(seed.init.document).toEqual({ ...facts, structure: null });
  });
});

describe("seedFrom, the editors' comments", () => {
  const body = (text: string) => [[{ text }]];
  const draft: Draft = {
    roots: [
      {
        kind: "part",
        title: "One",
        paragraphs: [para("The part's own words.")],
        children: [
          section("Anna", "She ran."),
          {
            kind: "section",
            title: "Far",
            paragraphs: [para("She ran again."), para("Far away.")],
            children: [],
          },
        ],
      },
    ],
    comments: [
      {
        sourceId: "1",
        author: "Maria",
        date: "2026-01-01T00:00:00Z",
        body: body("Too short?"),
        anchor: {
          node: 1,
          start: { paragraph: 0, offset: 4 },
          end: { paragraph: 0, offset: 7 },
          quote: { exact: "ran", prefix: "She ", suffix: "." },
        },
      },
      {
        sourceId: "2",
        parentId: "1",
        author: "Ada",
        date: "2026-01-02T00:00:00Z",
        body: body("Deliberate."),
        anchor: null,
      },
      {
        sourceId: "3",
        author: "Maria",
        resolved: true,
        body: body("Two paragraphs, one thought."),
        anchor: {
          node: 2,
          start: { paragraph: 0, offset: 8 },
          end: { paragraph: 1, offset: 3 },
          quote: { exact: "again.\nFar", prefix: "She ran ", suffix: " away." },
        },
      },
      { sourceId: "4", body: body("Where was this?"), anchor: null },
      {
        sourceId: "5",
        parentId: "gone",
        author: "Lee",
        body: body("Answering nothing."),
        anchor: null,
      },
    ],
  };

  async function files() {
    const seed = await seedFrom(
      draft,
      facts,
      "local",
      "once-dark",
      manuscriptText,
      projectRules,
      "2026-10-05T00:00:00.000Z",
    );
    const out = new Map<string, CommentsFile>();
    for (const one of seed.init.comments ?? []) {
      const read = readComments(one.content);
      if (!read.ok) throw new Error(`damaged ${one.nodeId}`);
      out.set(one.nodeId, read.file);
    }
    return out;
  }

  it("writes each chapter's file, a reply in the thread it answers, editors by name", async () => {
    const byNode = await files();
    expect([...byNode.keys()].sort()).toEqual(["EL1", "EL2", "EL3"]);
    const [thread] = byNode.get("EL2")?.threads ?? [];
    expect(thread.state).toBe("open");
    expect(thread.anchor).toEqual({
      quote: "ran",
      prefix: "She ",
      suffix: ".",
    });
    expect(thread.entries.map((e) => [e.author, e.body, e.at])).toEqual([
      [{ kind: "editor", name: "Maria" }, "Too short?", "2026-01-01T00:00:00Z"],
      [{ kind: "editor", name: "Ada" }, "Deliberate.", "2026-01-02T00:00:00Z"],
    ]);
  });

  // A passage that runs across paragraphs is kept whole, not cut at its first
  // paragraph.
  it("keeps a resolved thread resolved, and a passage that ran across paragraphs whole", async () => {
    const [thread] = (await files()).get("EL3")?.threads ?? [];
    expect(thread.state).toBe("resolved");
    expect(thread.anchor?.quote.startsWith("again.\nFar")).toBe(true);
  });

  it("puts a comment whose place was lost on the first chapter, unanchored — and a reply to nothing is its own thread", async () => {
    const threads = (await files()).get("EL1")?.threads ?? [];
    expect(threads.map((t) => [t.anchor, t.entries[0].body])).toEqual([
      [null, "Where was this?"],
      [null, "Answering nothing."],
    ]);
    // A comment with no author is still an editor's, by no name; the time
    // the source did not give is the import's.
    expect(threads[0].entries[0].author).toEqual({ kind: "editor", name: "" });
    expect(threads[0].entries[0].at).toBe("2026-10-05T00:00:00.000Z");
  });

  it("writes no comments at all for a book that had none", async () => {
    const seed = await seedFrom(
      { roots: draft.roots, comments: [] },
      facts,
      "local",
      "once-dark",
      manuscriptText,
      projectRules,
    );
    expect(seed.init.comments).toBeUndefined();
  });
});

describe("the project's rules for the import", () => {
  it("are the project's own", () => {
    expect(projectRules.countWords("She *ran*.")).toBe(2);
    expect(projectRules.titleProblem("")).toBe("empty");
    expect(projectRules.titleProblem("Chapter 1: The Storm")).toBeNull();
    expect(projectRules.typeForWords(500)).toBe("Flash Fiction");
    expect(projectRules.typeGoal("Novel")).toBe(TYPE_GOAL_DEFAULTS.Novel);
  });

  it("write generated titles in the book's language", () => {
    const t = (key: string, vars?: Record<string, string | number>) =>
      `${key}|${vars?.n ?? ""}`;
    const words = titleWords(t);
    expect(words.untitled).toBe("import.title.untitled|");
    expect(words.matter("toc")).toBe("import.title.matter.toc|");
    expect(words.scene("LEV", 2)).toBe("import.title.scene|2");
    expect(words.split("LEV", 3)).toBe("import.title.split|3");
    expect(words.shared("Anna", 2)).toBe("import.title.shared|2");
  });
});
