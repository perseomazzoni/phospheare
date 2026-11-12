// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  lastParagraph,
  openThread,
  mostRecent,
  firstOpenable,
  resumeSources,
} from "./desk";
import { paragraphText, type Paragraph } from "./engine";
import type {
  DocumentProperties,
  DocumentStructure,
  NodeStat,
} from "../project/types";

// The Desk's first and last bands. Both answer the same question — where was I
// — and both refuse to invent an answer when the file does not hold one.

/** The paragraph's prose, for the string-level assertions. */
function textOf(para: Paragraph | null): string | null {
  return para === null ? null : paragraphText(para);
}

describe("lastParagraph", () => {
  it("gives back the writer’s own last sentence", () => {
    expect(textOf(lastParagraph("One.\n\nTwo.\n\nThree."))).toBe("Three.");
  });

  // A line break inside a paragraph is not a place anyone stopped.
  it("takes the last paragraph, not the last line", () => {
    expect(textOf(lastParagraph("One.\n\nTwo,\nstill two."))).toBe(
      "Two,\nstill two.",
    );
  });

  // The writer ended on a title: the band shows it as the formatted heading
  // it is, not as the previous paragraph and not as raw marker text.
  it("shows a heading the writer ended on, with its kind", () => {
    const para = lastParagraph("The house was empty.\n\n# Chapter Two");
    expect(para?.blockType).toBe("h1");
    expect(textOf(para)).toBe("Chapter Two");
  });

  it("renders an aligned heading as its formatted self, never its markers", () => {
    const para = lastParagraph("{align:center}# Ormai siamo partiti!");
    expect(para?.blockType).toBe("h1");
    expect(para?.alignment).toBe("center");
    expect(textOf(para)).toBe("Ormai siamo partiti!");
  });

  it("skips a page break", () => {
    expect(textOf(lastParagraph("She left.\n\n{pagebreak}"))).toBe("She left.");
  });

  it("reads the prose rather than the markup, keeping the formats", () => {
    const para = lastParagraph("It was **very** *quiet*, and `still`.");
    expect(textOf(para)).toBe("It was very quiet, and still.");
    expect(para?.runs.find((r) => r.format.bold)?.text).toBe("very");
    expect(para?.runs.find((r) => r.format.italic)?.text).toBe("quiet");
    expect(para?.runs.find((r) => r.format.monospace)?.text).toBe("still");
  });

  it("unescapes what the codec escaped", () => {
    expect(textOf(lastParagraph("A literal \\*asterisk\\*."))).toBe(
      "A literal *asterisk*.",
    );
  });

  it("trims a long paragraph to its tail, and says it did", () => {
    const long = Array.from({ length: 80 }, (_, i) => `w${i}`).join(" ");
    const result = textOf(lastParagraph(long));
    if (result === null) throw new Error("lastParagraph(long) returned null");
    expect(result.startsWith("…")).toBe(true);
    expect(result.endsWith("w79")).toBe(true);
    expect(result.split(/\s+/)).toHaveLength(61);
  });

  it("cuts a long paragraph at a format boundary without splitting its word", () => {
    const para = lastParagraph(`plain **${"w".repeat(80)}** tail`);
    if (para === null) throw new Error("lastParagraph(long) returned null");
    const text = paragraphText(para);
    // The 80-letter bold word is one word, so the paragraph is three words
    // and stays whole; a cut by characters would split it.
    expect(para?.runs.find((r) => r.format.bold)?.text).toBe("w".repeat(80));
    expect(text).toBe(`plain ${"w".repeat(80)} tail`);
  });

  it("leaves a short paragraph whole", () => {
    expect(textOf(lastParagraph("Short."))).toBe("Short.");
  });

  it("has nothing to say about an empty file", () => {
    expect(lastParagraph("")).toBeNull();
    expect(lastParagraph("\n\n   \n\n")).toBeNull();
  });

  it("shows the last heading when a file ends on headings", () => {
    const para = lastParagraph("# One\n\n## Two");
    expect(para?.blockType).toBe("h2");
    expect(textOf(para)).toBe("Two");
  });
});

describe("openThread", () => {
  it("finds the marker a writer left themselves", () => {
    const found = openThread("She left.\n\nTODO: whose boat was it");
    if (found === null) throw new Error("no marker found");
    expect(found.text).toBe("TODO: whose boat was it");
    expect(found.fromEnd).toBe(0);
  });

  // The most recent one is the one they were in the middle of.
  it("takes the last marker, not the first", () => {
    const found = openThread("TODO: early\n\nprose\n\nTODO: late");
    if (found === null) throw new Error("no marker found");
    expect(found.text).toBe("TODO: late");
  });

  it("says how far back it sits, so the screen can point at it", () => {
    const found = openThread("??? whose boat\n\none\n\ntwo\n\nthree");
    if (found === null) throw new Error("no marker found");
    expect(found.fromEnd).toBe(3);
  });

  it("knows the other marks writers use", () => {
    const unclear = openThread("??? unclear");
    if (unclear === null) throw new Error("no ??? marker found");
    expect(unclear.text).toBe("??? unclear");
    const nameTk = openThread("name TK");
    if (nameTk === null) throw new Error("no TK marker found");
    expect(nameTk.text).toBe("TK");
    const fix = openThread("XXX fix the weather");
    if (fix === null) throw new Error("no XXX marker found");
    expect(fix.text).toBe("XXX fix the weather");
  });

  it("trims a marker that ran on", () => {
    const long = `TODO: ${"x".repeat(200)}`;
    const found = openThread(long);
    if (found === null) throw new Error("no marker found");
    expect(found.text.endsWith("…")).toBe(true);
    expect(found.text.length).toBeLessThanOrEqual(90);
  });

  // An absent band is honest; an invented one would be the screen guessing.
  it("says nothing when the writer left no sign", () => {
    expect(openThread("She left the car at the gate and walked.")).toBeNull();
    expect(openThread("")).toBeNull();
  });

  it("does not mistake a word inside another for a marker", () => {
    expect(openThread("He walked to the STOCKROOM.")).toBeNull();
  });
});

// A bare number or an escaped asterisk in prose reads back as written, never
// as the stripper's own bookkeeping. The resume band parses with the codec.
describe("prose that looks like the stripper’s own projectkeeping", () => {
  it("leaves a bare number alone", () => {
    expect(
      textOf(lastParagraph("She counted 3 lights on the far shore.")),
    ).toBe("She counted 3 lights on the far shore.");
  });

  it("leaves an escaped asterisk alone in a sentence full of numbers", () => {
    expect(
      textOf(lastParagraph(String.raw`Chapter 12 \*ends\* at 4 o’clock.`)),
    ).toBe("Chapter 12 *ends* at 4 o’clock.");
  });
});

// The marker has its own band. Reading it back as the writer's last sentence
// would say the same thing twice and lose the prose they actually stopped in.
describe("a marker is the thread, not the last sentence", () => {
  const file = "She counted the lights on the far shore.\n\n??? whose boat";

  it("reads past a paragraph that is only a marker", () => {
    expect(textOf(lastParagraph(file))).toBe(
      "She counted the lights on the far shore.",
    );
  });

  it("still finds it as the open thread", () => {
    const found = openThread(file);
    if (found === null) throw new Error("no marker found");
    expect(found.text).toBe("??? whose boat");
    expect(found.fromEnd).toBe(0);
  });

  // A marker at the end of a real sentence is part of that sentence, and the
  // writer wants to see the whole line.
  it("keeps a paragraph that only ends with one", () => {
    const inline = "She counted the lights. TODO: whose boat";
    expect(textOf(lastParagraph(inline))).toBe(
      "She counted the lights. TODO: whose boat",
    );
  });
});

// Where the Desk looks: the sources, and the order it reads them.

const AT = "2026-01-01T00:00:00.000Z";

const snap = (file: string) => ({ file, title: file, created: AT });

const BOOK: DocumentStructure = {
  version: 1,
  children: [
    {
      kind: "part",
      id: "EL1",
      title: "Act One",
      adopted: "part--a.EL1.00.md",
      snapshots: [snap("part--a.EL1.00.md")],
      children: [
        {
          kind: "section",
          id: "EL2",
          title: "Opening",
          adopted: "section--a.EL2.00.md",
          snapshots: [snap("section--a.EL2.00.md")],
        },
        {
          kind: "section",
          id: "EL3",
          title: "The Storm",
          adopted: "section--b.EL3.00.md",
          snapshots: [snap("section--b.EL3.00.md")],
        },
      ],
    },
    {
      kind: "part",
      id: "EL4",
      title: "Act Two",
      adopted: "part--b.EL4.00.md",
      snapshots: [snap("part--b.EL4.00.md")],
      children: [],
    },
  ],
  removed: [
    {
      kind: "section",
      id: "EL6",
      title: "Gone",
      adopted: "section--gone.EL6.00.md",
      snapshots: [snap("section--gone.EL6.00.md")],
    },
  ],
};

function props(
  over: {
    perNode?: NodeStat[];
    lastOpened?: string | null;
  } = {},
): DocumentProperties {
  return {
    schemaVersion: 1,
    document: {
      id: "p1",
      title: "Book",
      author: "",
      type: "Novel",
      structure: null,
      language: "en",
      createdAt: AT,
      updatedAt: AT,
      goal: null,
      genres: [],
      ageCategory: null,
      tropes: [],
    },
    sync: null,
    ui: {
      expanded: [],
      lastOpened: over.lastOpened ?? null,
      session: null,
      dockWidth: null,
      structureWidth: null,
      commentsHidden: null,
      snapshotSplit: null,
      proseSize: null,
      typewriter: null,
      focus: null,
      smoothCaret: null,
      autosave: null,
      autosaveDelay: null,
      henosis: null,
      henosisAfter: null,
      henosisFade: null,
      henosisPause: null,
    },
    stats: {
      words: 0,
      parts: 0,
      sections: 0,
      countedAt: AT,
      perNode: over.perNode ?? [],
    },
    snapshotHashes: {},
    summaries: {},
  };
}

describe("mostRecent", () => {
  it("names the node whose words changed most recently", () => {
    const p = props({
      perNode: [
        { nodeId: "EL1", words: 4, updatedAt: "2026-01-01T09:00:00Z" },
        { nodeId: "EL2", words: 8, updatedAt: "2026-01-02T09:00:00Z" },
      ],
    });
    expect(mostRecent(p)).toBe("EL2");
  });

  it("ignores nodes the editor never wrote — no stamp, no claim", () => {
    const p = props({
      perNode: [
        { nodeId: "EL1", words: 4, updatedAt: "" },
        { nodeId: "EL2", words: 8, updatedAt: "" },
      ],
    });
    expect(mostRecent(p)).toBeNull();
  });

  it("is null when nothing has ever been counted", () => {
    expect(mostRecent(props())).toBeNull();
    expect(mostRecent(null)).toBeNull();
  });
});

describe("firstOpenable", () => {
  it("finds the first Section in reading order", () => {
    expect(firstOpenable(BOOK)?.id).toBe("EL2");
  });

  it("falls back to the first Part when there are no Sections — a fresh project's shape", () => {
    const partsOnly: DocumentStructure = {
      version: 1,
      children: [
        {
          kind: "part",
          id: "EL1",
          title: "Act One",
          adopted: "part--a.EL1.00.md",
          snapshots: [snap("part--a.EL1.00.md")],
          children: [],
        },
        BOOK.children[1],
      ],
    };
    expect(firstOpenable(partsOnly)?.id).toBe("EL1");
  });

  it("is null for a project with no nodes at all", () => {
    expect(firstOpenable({ version: 1, children: [] })).toBeNull();
  });
});

describe("resumeSources", () => {
  it("reads what was written first, then what was opened, then the first openable", () => {
    const p = props({
      perNode: [{ nodeId: "EL2", words: 8, updatedAt: "2026-01-02T09:00:00Z" }],
      lastOpened: "EL4",
    });
    expect(resumeSources(p, BOOK).map((n) => n.id)).toEqual(["EL2", "EL4"]);
  });

  it("drops a lastOpened that names a removed node — the desk must not read the bin", () => {
    const p = props({
      perNode: [{ nodeId: "EL2", words: 8, updatedAt: "2026-01-02T09:00:00Z" }],
      lastOpened: "EL6",
    });
    expect(resumeSources(p, BOOK).map((n) => n.id)).toEqual(["EL2"]);
  });

  it("falls to lastOpened when nothing was ever written", () => {
    const p = props({ perNode: [], lastOpened: "EL4" });
    expect(resumeSources(p, BOOK).map((n) => n.id)).toEqual(["EL4", "EL2"]);
  });

  it("still offers the first openable when the writer did nothing at all", () => {
    expect(resumeSources(props(), BOOK).map((n) => n.id)).toEqual(["EL2"]);
  });

  it("never lists a source twice", () => {
    const p = props({
      perNode: [{ nodeId: "EL2", words: 8, updatedAt: "2026-01-02T09:00:00Z" }],
      lastOpened: "EL2",
    });
    expect(resumeSources(p, BOOK).map((n) => n.id)).toEqual(["EL2"]);
  });
});
