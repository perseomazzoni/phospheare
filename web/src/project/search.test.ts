// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { excerptAt, prepareSource, searchProject, sourcesFor } from "./search";
import type { SearchExcerpt } from "./search";
import type { DocNode, DocumentStructure } from "./types";
// The editor's matcher, imported here and only here. Nothing under `project/`
// imports from `editor/`, or the engine would land in the bundle a homepage
// visitor downloads, so the production caller passes the compiled regex in.
// These rows pin the panel to the engine's regex rather than to a matcher
// nobody ships.
import { regexSearch } from "../editor/engine/adapters/regex";

// The search is pure so that it can be tested apart from the tree component.

/** The call the panel makes, with the regex built as the panel builds it. */
function find(
  structure: DocumentStructure | null,
  referenceFiles: readonly string[],
  query: string,
  bodies?: ReadonlyMap<string, string>,
  chats?: Parameters<typeof searchProject>[0]["chats"],
) {
  return searchProject({
    structure,
    referenceFiles,
    query,
    regex: regexSearch.buildRegex(query.trim(), {
      caseSensitive: false,
      wholeWord: false,
    }),
    bodies,
    chats,
  });
}

const section = (id: string, title: string): DocNode => ({
  kind: "section",
  id,
  title,
  adopted: `section--${id}.00.md`,
  snapshots: [],
});

const part = (id: string, title: string, children: DocNode[]): DocNode => ({
  kind: "part",
  id,
  title,
  adopted: `part--${id}.00.md`,
  snapshots: [],
  children,
});

const structure = (removed: DocNode[] = []): DocumentStructure => ({
  version: 1,
  children: [
    part("EL1", "Act One", [
      section("EL2", "The Storm"),
      section("EL3", "Opening"),
    ]),
    part("EL4", "Act Two", [section("EL5", "Storm's End")]),
  ],
  removed,
});

const files = [
  "character--vera.md",
  "character--storm_petrel.md",
  "world--economy.md",
  "notes--stormy_ideas.md",
  "summary--EL2.md",
  "guidebook--view.md",
  "loose_file.md",
  "notes--reading.txt",
];

describe("searchProject", () => {
  it("answers an empty query with nothing, not with everything", () => {
    // The caller swaps the panel's body on this, and "no query" is not "no
    // matches": the two states say different things to the writer.
    expect(find(structure(), files, "")).toEqual({
      groups: [],
      total: 0,
    });
    expect(find(structure(), files, "   ").total).toBe(0);
  });

  it("has nothing to say about a project that is not open", () => {
    expect(find(null, files, "storm").total).toBe(0);
  });

  it("names the Part a Section sits in, and leaves a Part's own place blank", () => {
    const { groups } = find(structure(), [], "storm");
    const nodes = groups.find((g) => g.head === "structure")?.results ?? [];
    expect(nodes.map((r) => r.title)).toEqual(["The Storm", "Storm's End"]);
    expect(nodes.map((r) => (r.kind === "node" ? r.within : null))).toEqual([
      "Act One",
      "Act Two",
    ]);

    const parts = find(structure(), [], "act");
    const hits = parts.groups[0]?.results ?? [];
    expect(hits.map((r) => (r.kind === "node" ? r.within : "?"))).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("does not leak one branch's ancestor into the next", () => {
    // The depth-indexed trail is truncated before it is written, so a finished
    // branch cannot follow the walk into its sibling.
    const { groups } = find(structure(), [], "storm's end");
    const hit = groups[0]?.results[0];
    expect(hit?.kind === "node" && hit.within).toBe("Act Two");
  });

  it("searches the bin at the bin's own grain — whole entries only", () => {
    // A subtree goes to the bin whole and comes back whole. A nested node
    // would be a row that accepts a destination and does nothing, so the walk
    // stops at the top level.
    const removed = [part("EL9", "Act Zero", [section("EL10", "Storm Cut")])];
    const { groups } = find(structure(removed), [], "storm");
    const bin = groups.find((g) => g.head === "bin");
    expect(bin).toBeUndefined();

    const whole = find(structure(removed), [], "act zero");
    expect(whole.groups.find((g) => g.head === "bin")?.results).toEqual([
      { kind: "removed", id: "EL9", title: "Act Zero", nodeKind: "part" },
    ]);
  });

  it("never matches a summary by NAME, whose name is a node id", () => {
    // `referenceTitle("summary--EL2.md")` is "EL2", which matches nothing a
    // writer would type and names the node instead of the summary, already a
    // result of its own. Its text is searched like any other reference
    // document's.
    const { groups } = find(structure(), files, "EL2");
    expect(groups.some((g) => g.head === "summaries")).toBe(false);
    expect(groups).toEqual([]);
  });

  it("reads the reference folder through its own grouping, not the raw listing", () => {
    // `groupReference` drops non-markdown and files declaring no group. The
    // reference panel does not draw those either, so a result opening one
    // would lead somewhere the writer cannot otherwise go.
    const { groups } = find(structure(), files, "o");
    const titles = groups.flatMap((g) =>
      g.results.filter((r) => r.kind === "reference").map((r) => r.title),
    );
    expect(titles).not.toContain("loose_file");
    expect(titles.some((t) => t.includes("reading"))).toBe(false);
  });

  it("keeps the groups in their fixed order, and never draws an empty one", () => {
    // The world document answers through its text, because a catalogue
    // section's name is its English id and "storm" is not one of them.
    const { groups } = find(
      structure(),
      files,
      "storm",
      new Map([["ref:world--economy.md", "The storm coast trade routes.\n"]]),
    );
    expect(groups.map((g) => g.head)).toEqual([
      "structure",
      "characters",
      "world",
      "notes",
    ]);
  });

  it("counts every hit it returns", () => {
    const result = find(structure(), files, "storm");
    expect(result.total).toBe(
      result.groups.reduce((n, g) => n + g.results.length, 0),
    );
    expect(result.total).toBeGreaterThan(0);
  });

  it("folds case, because the writer is recalling a name rather than typing it", () => {
    expect(find(structure(), [], "THE STORM").total).toBe(1);
    expect(find(structure(), [], "the storm").total).toBe(1);
  });

  it("treats a query's regex metacharacters as the writer's own characters", () => {
    // The matcher is the engine's, not an `includes`: a writer searching for
    // "(the" gets no syntax error, and one searching for "st.rm" is not shown
    // "storm". `buildRegex` escapes, and this row fails if a second matcher is
    // built here.
    const dotted = structure();
    dotted.children.push(section("EL8", "st.rm"));
    expect(find(dotted, [], "st.rm").total).toBe(1);
    expect(find(dotted, [], "st.rm").groups[0].results[0].title).toBe("st.rm");
  });
});

/** The index's map, keyed the way `sourcesFor` keys it. */
const bodies = (entries: Record<string, string>) =>
  new Map(Object.entries(entries).map(([id, text]) => [`node:${id}`, text]));

describe("searching the body text", () => {
  it("finds the writer's words, and says which node they are in", () => {
    const { groups } = find(
      structure(),
      [],
      "petrichor",
      bodies({ EL3: "# Opening\n\nThe petrichor rose off the road.\n" }),
    );
    const body = groups.find((g) => g.head === "body");
    expect(body?.results).toEqual([
      {
        kind: "body",
        id: "EL3",
        title: "Opening",
        nodeKind: "section",
        within: "Act One",
        excerpts: [
          {
            text: "The petrichor rose off the road.",
            at: 4,
            length: 9,
          },
        ],
      },
    ]);
  });

  it("is one hit per node, carrying every occurrence inside it", () => {
    // One hit per node, because the panel groups by the file the words are
    // in, but the hit holds all four, because the panel draws a line for each.
    const { groups } = find(
      structure(),
      [],
      "storm",
      bodies({ EL3: "storm storm storm storm" }),
    );
    const results = groups.find((g) => g.head === "body")?.results;
    expect(results).toHaveLength(1);
    const hit = results?.[0];
    expect(hit?.kind === "body" && hit.excerpts).toHaveLength(4);
  });

  it("lists a runaway node's occurrences too, all of them", () => {
    // No cap: the global search finds every occurrence, because a list that
    // silently stops looks like a book that says the word fewer times. This
    // row fails if a cap is added.
    const { groups } = find(
      structure(),
      [],
      "a",
      bodies({ EL3: "a ".repeat(400) }),
    );
    const hit = groups.find((g) => g.head === "body")?.results[0];
    expect(hit?.kind === "body" && hit.excerpts).toHaveLength(400);
  });

  it("counts occurrences, not rows, in the tally it speaks", () => {
    // A Section holding the word four times draws four quotations, and "1
    // match" over them would contradict what the writer can count on screen.
    const { total } = find(
      structure(),
      [],
      "storm",
      bodies({ EL3: "storm storm storm storm" }),
    );
    // Four in the prose, plus the two nodes whose names match "storm".
    expect(total).toBe(6);
  });

  it("says what a node is called AND where its prose says it", () => {
    // "The Storm" matches by name and in its own prose, and both answers are
    // given: "the Section is called Storm" and "the word storm is in
    // its prose, here" are two different answers.
    const { groups } = find(
      structure(),
      [],
      "storm",
      bodies({ EL2: "the storm broke", EL3: "the storm broke" }),
    );
    expect(
      groups
        .find((g) => g.head === "structure")
        ?.results.map((r) => ("id" in r ? r.id : r.title)),
    ).toEqual(["EL2", "EL5"]);
    expect(
      groups
        .find((g) => g.head === "body")
        ?.results.map((r) => ("id" in r ? r.id : r.title)),
    ).toEqual(["EL2", "EL3"]);
  });

  it("reads the book in the order it was written", () => {
    const { groups } = find(
      structure(),
      [],
      "rain",
      bodies({ EL5: "rain", EL3: "rain", EL1: "rain" }),
    );
    expect(
      groups
        .find((g) => g.head === "body")
        ?.results.map((r) => ("id" in r ? r.id : r.title)),
    ).toEqual(["EL1", "EL3", "EL5"]);
  });

  it("is exactly the slice-2 name search when nothing has been read yet", () => {
    // The index fills in the background, and an empty one is a normal state,
    // not an error: every file that lands adds rows to a list already on
    // screen.
    const cold = find(structure(), [], "storm");
    const warm = find(structure(), [], "storm", new Map());
    expect(warm).toEqual(cold);
  });
});

describe("the other destinations", () => {
  it("puts the book's own matter first, then the chats", () => {
    // Fixed order, never scored: things stay where they are in the panel.
    // The chat arrives as the Assistant's document.
    const { groups } = find(
      structure(),
      files,
      "storm",
      new Map([
        ["node:EL3", "the storm broke"],
        ["ref:world--economy.md", "The storm coast trade routes.\n"],
      ]),
      [
        {
          chatId: "chat-1",
          turnId: "turn-1",
          title: "Weather talk",
          kind: "general",
          speaker: "you",
          text: "about the storm",
        },
      ],
    );
    expect(groups.map((g) => g.head)).toEqual([
      "structure",
      "body",
      "characters",
      "world",
      "notes",
      "chat",
    ]);
  });

  const refs = (entries: Record<string, string>) =>
    new Map(Object.entries(entries).map(([f, text]) => [`ref:${f}`, text]));

  it("reads a reference document's contents, not only its name", () => {
    const { groups } = find(
      structure(),
      files,
      "seabird",
      refs({ "character--vera.md": "Vera keeps a seabird's patience.\n" }),
    );
    const hit = groups.find((g) => g.head === "characters")?.results[0];
    expect(hit?.kind === "reference" && hit.title).toBe("vera");
    expect(hit?.kind === "reference" && hit.excerpt?.text).toBe(
      "Vera keeps a seabird's patience.",
    );
  });

  it("gives a reference document one row, name hit or text hit", () => {
    // A node gets a name row and a prose row, because "the chapter called
    // Storm" and "the chapter that mentions storms" are two answers; for a
    // character sheet they are one.
    const { groups } = find(
      structure(),
      files,
      "vera",
      refs({ "character--vera.md": "Vera keeps a seabird's patience.\n" }),
    );
    const hits = groups.find((g) => g.head === "characters")?.results ?? [];
    expect(hits).toHaveLength(1);
    // The name answered, so no excerpt is drawn: it would quote prose to
    // explain a match the title already explains.
    expect(hits[0].kind === "reference" && hits[0].excerpt).toBeUndefined();
  });

  it("searches a summary's text even though its name is unsearchable", () => {
    const { groups } = find(
      structure(),
      files,
      "unravels",
      refs({ "summary--EL2.md": "The weather unravels the crossing.\n" }),
    );
    expect(groups.find((g) => g.head === "summaries")?.results).toHaveLength(1);
  });
});

describe("sourcesFor", () => {
  it("asks for the adopted file of every node, keyed by the node", () => {
    const sources = sourcesFor(structure(), []);
    expect(sources.map((source) => source.key)).toEqual([
      "node:EL1",
      "node:EL2",
      "node:EL3",
      "node:EL4",
      "node:EL5",
    ]);
    expect(sources[1].path).toBe("/document/section--EL2.00.md");
  });

  it("names a file and nothing else — no version, for anything", () => {
    // A source is a key and a path, with no version. When a file is
    // re-read is the index's business, and it re-reads everything per search,
    // so a writer's saved edits never go missing from their own search.
    const sources = sourcesFor(structure(), files);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources)
      expect(Object.keys(source).sort()).toEqual(["key", "path"]);
  });

  it("asks for nothing at all when no project is open", () => {
    expect(sourcesFor(null, files)).toEqual([]);
  });
});

describe("excerptAt", () => {
  /** The panel's own regex, with a throw rather than a `!`: an empty query
   *  reaching here is a bug in this file, not a value to assert on. */
  function rx(query: string): RegExp {
    const regex = regexSearch.buildRegex(query, {
      caseSensitive: false,
      wholeWord: false,
    });
    if (!regex) throw new Error(`no regex for ${query}`);
    return regex;
  }

  /** An excerpt that must exist. Every row below is about what was found. */
  function found(text: string, query: string): SearchExcerpt {
    const excerpt = excerptAt(text, rx(query));
    if (!excerpt) throw new Error(`expected ${query}`);
    return excerpt;
  }

  it("answers nothing when the words are not there", () => {
    expect(excerptAt("the storm broke", rx("petrichor"))).toBeNull();
  });

  it("keeps the line, not a slice across the paragraph above", () => {
    // An excerpt beginning mid-sentence in the paragraph before reads as a
    // mistake rather than a quotation.
    const excerpt = excerptAt("first line\nsecond line\nthird", rx("second"));
    expect(excerpt?.text).toBe("second line");
    expect(excerpt?.at).toBe(0);
  });

  it("locates the match inside the text it returns, not in the file", () => {
    const excerpt = found("a\nb\nthe storm broke", "storm");
    expect(excerpt.text.slice(excerpt.at, excerpt.at + excerpt.length)).toBe(
      "storm",
    );
  });

  it("accounts for the indent it trims away", () => {
    const excerpt = found("    the storm broke", "storm");
    expect(excerpt.text).toBe("the storm broke");
    expect(excerpt.text.slice(excerpt.at, excerpt.at + excerpt.length)).toBe(
      "storm",
    );
  });

  it("windows a paragraph around the match, with the offsets still true", () => {
    // A markdown paragraph is one line, so the line unit alone is not enough:
    // without a window a hit 4000 characters in would return 4000 characters.
    const line = `${"x ".repeat(400)}petrichor${" y".repeat(400)}`;
    const excerpt = found(line, "petrichor");
    expect(excerpt.text.length).toBeLessThan(line.length);
    expect(excerpt.text.startsWith("\u2026")).toBe(true);
    expect(excerpt.text.endsWith("\u2026")).toBe(true);
    expect(excerpt.text.slice(excerpt.at, excerpt.at + excerpt.length)).toBe(
      "petrichor",
    );
  });

  it("shows the words after a match that sits at the very end", () => {
    // Clamped rather than "start 32 back and take a window", which for a hit
    // in the last few characters would run off the end and waste half its
    // room.
    const line = `${"x ".repeat(400)}petrichor`;
    const excerpt = found(line, "petrichor");
    expect(excerpt.text.endsWith("petrichor")).toBe(true);
    expect(excerpt.text.slice(excerpt.at, excerpt.at + excerpt.length)).toBe(
      "petrichor",
    );
  });

  it("quotes the window it is given, with its lead-in before the match", () => {
    const line = `${"x ".repeat(400)}petrichor${" y".repeat(400)}`;
    const excerpt = excerptAt(line, rx("petrichor"), { width: 60, before: 30 });
    if (!excerpt) throw new Error("expected petrichor");
    // The window and one ellipsis either side.
    expect(excerpt.text.length).toBe(62);
    expect(excerpt.at).toBe(31);
    expect(excerpt.text.slice(excerpt.at, excerpt.at + excerpt.length)).toBe(
      "petrichor",
    );
  });

  it("windows a search's body text by the window it is given", () => {
    const line = `${"x ".repeat(400)}petrichor${" y".repeat(400)}`;
    const quoted = (window?: { width: number; before: number }) => {
      const { groups } = searchProject({
        structure: structure(),
        referenceFiles: [],
        query: "petrichor",
        regex: rx("petrichor"),
        bodies: bodies({ EL3: line }),
        window,
      });
      const hit = groups.find((g) => g.head === "body")?.results[0];
      return hit?.kind === "body" ? hit.excerpts[0]?.text.length : undefined;
    };
    expect(quoted()).toBe(112);
    expect(quoted({ width: 60, before: 30 })).toBe(62);
  });

  it("finds the first match even when the regex has already been used", () => {
    // The caller shares one `g`-flagged regex across every row. Without the
    // `lastIndex` reset every second row misses, which reads as a flaky
    // search and cannot be reproduced from a single row.
    const regex = rx("storm");
    expect(excerptAt("the storm broke", regex)?.at).toBe(4);
    expect(excerptAt("the storm broke", regex)?.at).toBe(4);
  });
});

describe("the words the writer wrote, without the file's punctuation", () => {
  it("takes the codec's block directives off a line", () => {
    // "{align:center}" is how `commonmark.ts` writes an alignment, not a word
    // in anyone's book, so it never appears inside a quotation.
    expect(prepareSource("{align:center}The storm broke.")).toBe(
      "The storm broke.",
    );
    expect(prepareSource("## The Storm")).toBe("The Storm");
    expect(prepareSource("{pagebreak}")).toBe("");
  });

  it("takes the emphasis and monospace delimiters off, and unescapes", () => {
    expect(prepareSource("the **storm** broke")).toBe("the storm broke");
    expect(prepareSource("a `literal` word")).toBe("a literal word");
    // The serializer escapes a writer's own asterisk, so it survives where
    // the codec's markers do not; the escape is the only thing that tells the
    // two apart.
    expect(prepareSource("five \\* three")).toBe("five * three");
    // An escaped directive is literal text the writer typed.
    expect(prepareSource("\\{align:center} is a directive")).toBe(
      "{align:center} is a directive",
    );
  });

  it("keeps every line, so an excerpt's window still lands", () => {
    // `{pagebreak}` empties rather than disappears: the window in
    // `windowAround` walks newlines, and a dropped line would shift every
    // offset after it.
    expect(prepareSource("one\n{pagebreak}\ntwo")).toBe("one\n\ntwo");
  });

  it("finds a phrase the codec had split with a marker", () => {
    // "the storm" is on the screen, so it is in the book, though the file
    // says "the **storm**"; without the strip the panel would tell the writer
    // their own sentence is not there.
    const { groups } = find(
      structure(),
      [],
      "the storm broke",
      bodies({ EL3: prepareSource("the **storm** broke") }),
    );
    const hit = groups.find((g) => g.head === "body")?.results[0];
    expect(hit?.kind === "body" && hit.excerpts[0].text).toBe(
      "the storm broke",
    );
  });

  it("searches project chats from neutral documents and carries their turn ids", () => {
    const { groups, total } = find(structure(), [], "petrichor", undefined, [
      {
        chatId: "chat-1",
        turnId: "turn-2",
        title: "Weather talk",
        kind: "general",
        speaker: "assistant",
        text: "The petrichor carries further than you think.",
      },
      {
        chatId: "chat-1",
        turnId: "turn-3",
        title: "Weather talk",
        kind: "general",
        speaker: "you",
        text: "Nothing here.",
      },
    ]);
    const chatGroup = groups.find((group) => group.head === "chat");
    expect(total).toBe(1);
    expect(chatGroup?.results[0]).toMatchObject({
      kind: "chat",
      chatId: "chat-1",
      turnId: "turn-2",
      speaker: "assistant",
      title: "Weather talk",
    });
  });
});

describe("searchProject — namesakes (free titles)", () => {
  const namesakes = (): DocumentStructure => ({
    version: 1,
    children: [
      part("EL1", "Part One", [
        section("EL2", "Anna"),
        section("EL3", "Marco"),
        section("EL4", "Anna"),
      ]),
      part("EL5", "Part Two", [section("EL6", "Anna")]),
    ],
    removed: [],
  });

  it("numbers two Sections of one title in one Part, in reading order, and leaves a lone one alone", () => {
    const rows = find(namesakes(), [], "anna").groups.flatMap((g) => g.results);
    expect(
      rows.map((r) => (r.kind === "node" ? [r.id, r.within, r.nth] : null)),
    ).toEqual([
      ["EL2", "Part One", 1],
      ["EL4", "Part One", 2],
      ["EL6", "Part Two", undefined],
    ]);
  });

  it("numbers the prose rows the same way", () => {
    const bodies = new Map([
      ["node:EL2", "Anna ran."],
      ["node:EL4", "Anna stopped."],
    ]);
    const rows = find(namesakes(), [], "ran", bodies).groups.flatMap(
      (g) => g.results,
    );
    expect(rows).toMatchObject([{ kind: "body", id: "EL2", nth: 1 }]);
  });
});
