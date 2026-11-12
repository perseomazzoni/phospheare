// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { manuscriptParser } from "../adapters/manuscriptBlocks";
import { markdownParser } from "../adapters/markdownBlocks";
import type { BookFacts, ManuscriptNode, ReferenceEntry } from "../domain/book";
import type { Block, Chapter, ExportDocument } from "../domain/model";
import type { ExportLabels, ExportSource } from "../ports";
import { assembleExport, nestHeadings, type ExportRequest } from "./assemble";

// The fixture book: two Parts (the first with two Sections, the second with
// one) and a Section outside any Part, a guidebook page, a character with an
// arc, an unfilled template, and a note. The rows use the real parsers,
// because the assembler turns the book's two dialects into chapters and a
// stub parser would test a book nobody writes.

const BOOK: BookFacts = {
  id: "book-1",
  title: "Once Dark",
  author: "Ada Lovelace",
  type: "Novel",
  language: "en",
  languageLabel: "English",
  genres: ["Literary"],
  ageCategory: null,
  tropes: [],
  structure: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-02-01T00:00:00Z",
};

const TREE: ManuscriptNode[] = [
  {
    id: "p1",
    kind: "part",
    title: "One",
    children: [
      { id: "s1", kind: "section", title: "The Dark", children: [] },
      { id: "s2", kind: "section", title: "The Light", children: [] },
    ],
  },
  {
    id: "p2",
    kind: "part",
    title: "Two",
    children: [{ id: "s3", kind: "section", title: "After", children: [] }],
  },
  { id: "s4", kind: "section", title: "Coda", children: [] },
];

const TEXTS: Record<string, string> = {
  p1: "",
  // The title typed as the first line does not print twice.
  s1: "# The Dark\n\nOnce there was *dark*.\n\nThen more.",
  s2: "{align:center}It came back.\n\n{pagebreak}\n\nA second page.",
  p2: "An epigraph of the Part's own.",
  s3: "After it all.",
  s4: "The end of it.",
};

const WORDS = Object.values(TEXTS).reduce(
  (sum, text) => sum + text.split(/\s+/).filter(Boolean).length,
  0,
);

const ENTRIES: ReferenceEntry[] = [
  { fileName: "guidebook--logline.md", group: "guidebook", title: "Logline" },
  { fileName: "character--ada.md", group: "characters", title: "Ada" },
  { fileName: "arc--ada.md", group: "arcs", title: "Ada's arc" },
  { fileName: "world--empty.md", group: "world", title: "Places" },
  { fileName: "note--idea.md", group: "notes", title: "Idea" },
];

const DOCS: Record<string, string> = {
  "guidebook--logline.md":
    "# Logline\n\nA girl and the dark.\n\n## Why\n\nBecause.",
  "character--ada.md": "Brave.",
  "arc--ada.md": "She learns.",
  // An unfilled template: the source strips hints and questions, and
  // nothing is left.
  "world--empty.md": "\n\n",
  "note--idea.md": "- one\n- two",
};

function source(overrides: Partial<ExportSource> = {}): ExportSource & {
  referencesRead: number;
} {
  const out = {
    referencesRead: 0,
    book: () => BOOK,
    manuscript: () => TREE,
    references: async () => {
      out.referencesRead += 1;
      return ENTRIES;
    },
    readNode: async (id: string) => ({
      text: TEXTS[id] ?? "",
      words: (TEXTS[id] ?? "").split(/\s+/).filter(Boolean).length,
    }),
    readReference: async (fileName: string) => DOCS[fileName] ?? "",
    ...overrides,
  };
  return out;
}

const PARSERS = { manuscript: manuscriptParser, markdown: markdownParser };

const labels: ExportLabels = {
  t: (key, vars) => (vars ? `${key}(${Object.values(vars).join(",")})` : key),
  date: (iso) => iso.slice(0, 10),
  number: (value) => String(value),
};

const ALL_MANUSCRIPT = new Set(["p1", "s1", "s2", "p2", "s3", "s4"]);

function request(over: Partial<ExportRequest> = {}): ExportRequest {
  return {
    format: "docx",
    layout: "book",
    page: "a4",
    techPage: false,
    toc: false,
    selection: {
      manuscript: ALL_MANUSCRIPT,
      references: new Set(),
      notes: new Set(),
    },
    author: "Ada Lovelace",
    contact: "",
    runningHeader: "Lovelace / Once Dark",
    storySeparator: "shunn",
    ...over,
  };
}

const NOW = new Date("2026-10-01T12:00:00Z");

const assemble = (over: Partial<ExportRequest> = {}, src = source()) =>
  assembleExport(src, PARSERS, request(over), labels, NOW);

const outline = (doc: ExportDocument) =>
  doc.chapters.map((chapter) => `${chapter.kind}:${chapter.title ?? "-"}`);

const texts = (blocks: Block[]) =>
  blocks.flatMap((block) =>
    block.kind === "paragraph" || block.kind === "heading"
      ? [block.inlines.map((inline) => inline.text).join("")]
      : [`<${block.kind}>`],
  );

describe("the manuscript", () => {
  it("is the structure in reading order, a chapter per Part and Section", async () => {
    const doc = await assemble();
    expect(outline(doc)).toEqual([
      "part:One",
      "section:The Dark",
      "section:The Light",
      "part:Two",
      "section:After",
      "section:Coda",
    ]);
    // A Section under a Part sits one level below it; one with no Part is a
    // chapter in its own right.
    expect(doc.chapters.map((chapter) => chapter.level)).toEqual([
      1, 2, 2, 1, 2, 1,
    ]);
  });

  it("keeps only what is ticked", async () => {
    const doc = await assemble({
      selection: {
        manuscript: new Set(["p1", "s2", "s4"]),
        references: new Set(),
        notes: new Set(),
      },
    });
    expect(outline(doc)).toEqual([
      "part:One",
      "section:The Light",
      "section:Coda",
    ]);
  });

  it("does not print a title the writer already typed as the first line", async () => {
    const doc = await assemble();
    expect(texts(doc.chapters[1].blocks)).toEqual([
      "Once there was dark.",
      "Then more.",
    ]);
  });

  it("keeps the writer's alignment, italics and in-text page breaks", async () => {
    const doc = await assemble();
    const [, dark, light] = doc.chapters;
    const first = dark.blocks[0];
    expect(
      first.kind === "paragraph" &&
        first.inlines.some((inline) => inline.italic),
    ).toBe(true);
    expect(light.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "pageBreak",
      "paragraph",
    ]);
    expect(light.blocks[0]).toMatchObject({ align: "center" });
  });

  it("marks the openers book typography sets flush, and no other paragraph", async () => {
    const doc = await assemble();
    const dark = doc.chapters[1].blocks;
    expect(dark[0]).toMatchObject({ kind: "paragraph", opener: true });
    expect(dark[1]).not.toHaveProperty("opener");
    // The first paragraph after a page break opens again.
    const light = doc.chapters[2].blocks;
    expect(light[2]).toMatchObject({ opener: true });
  });

  it("reads the text from the source as it stands — the live buffer is the source's to give", async () => {
    const doc = await assemble(
      {},
      source({
        readNode: async (id) => ({
          text: id === "s4" ? "Unsaved words." : (TEXTS[id] ?? ""),
          words: 2,
        }),
      }),
    );
    expect(texts(doc.chapters[5].blocks)).toEqual(["Unsaved words."]);
  });

  it("does not read the reference shelf when no reference or note is ticked", async () => {
    const src = source();
    await assemble({}, src);
    expect(src.referencesRead).toBe(0);
  });
});

describe("the pages before the text", () => {
  it("puts the tech page first, then the contents", async () => {
    const doc = await assemble({ techPage: true, toc: true });
    expect(outline(doc).slice(0, 3)).toEqual([
      "tech:export.tech.heading",
      "toc:export.toc.heading",
      "part:One",
    ]);
    expect(doc.chapters[0].numbered).toBe(false);
    expect(doc.chapters[1].numbered).toBe(false);
  });

  it("always gives an EPUB its contents", async () => {
    const doc = await assemble({ format: "epub", toc: false });
    expect(doc.chapters.some((chapter) => chapter.kind === "toc")).toBe(true);
  });

  it("states only the facts the book has, with the words counted from the text", async () => {
    const doc = await assemble({ techPage: true });
    const facts = doc.chapters[0].blocks[0];
    if (facts.kind !== "facts") throw new Error("no facts");
    const rows = Object.fromEntries(facts.rows);
    expect(rows["export.tech.title"]).toBe("Once Dark");
    // The sum of what the source counted, node by node.
    expect(rows["export.tech.words"]).toBe(String(WORDS));
    expect(rows["export.tech.parts"]).toBe("2");
    expect(rows["export.tech.sections"]).toBe("4");
    expect(rows["export.tech.exported"]).toBe("2026-10-01");
    // No age category and no tropes: the rows are left out, never blank.
    expect(rows).not.toHaveProperty("export.tech.ageCategory");
    expect(rows).not.toHaveProperty("export.tech.tropes");
    // A reflowing format has no layout to report.
    expect(rows["export.tech.layout"]).toBe("export.layout.book.name");
    const md = (await assemble({ techPage: true, format: "md" })).chapters[0]
      .blocks[0];
    expect(
      md.kind === "facts" &&
        md.rows.some(([label]) => label === "export.tech.layout"),
    ).toBe(false);
  });

  // The tech page lists what the file holds, so a template ticked but never
  // filled does not print "References" in a file with none in it.
  it("lists what the file holds, not what was ticked", async () => {
    const doc = await assemble({
      techPage: true,
      selection: {
        manuscript: ALL_MANUSCRIPT,
        references: new Set(["world--empty.md"]),
        notes: new Set(),
      },
    });
    const facts = doc.chapters[0].blocks[0];
    if (facts.kind !== "facts") throw new Error("no facts");
    expect(Object.fromEntries(facts.rows)["export.tech.contents"]).toBe(
      "export.include.manuscript",
    );
  });

  // A story with no Parts, run on under the Shunn separator, has no titled
  // chapter, so its contents would be a heading over an empty page.
  it("drops a paged file's contents when there is nothing to list", async () => {
    const doc = await assemble(
      { layout: "manuscriptModern", toc: true },
      source({
        book: () => ({ ...BOOK, type: "Short Story" }),
        manuscript: () => TREE.filter((node) => node.kind === "section"),
      }),
    );
    expect(doc.chapters.some((chapter) => chapter.kind === "toc")).toBe(false);
    // With titled chapters the same tick keeps it.
    const novel = await assemble({ layout: "manuscriptModern", toc: true });
    expect(novel.chapters.some((chapter) => chapter.kind === "toc")).toBe(true);
  });
});

describe("references and notes", () => {
  const withEverything = (over: Partial<ExportRequest> = {}) =>
    assemble({
      selection: {
        manuscript: new Set(),
        references: new Set(
          ENTRIES.filter((e) => e.group !== "notes").map((e) => e.fileName),
        ),
        notes: new Set(["note--idea.md"]),
      },
      ...over,
    });

  it("follow the manuscript by group, an arc after its character, an empty template skipped", async () => {
    const doc = await withEverything();
    expect(outline(doc)).toEqual([
      "group:reference.group.guidebook",
      "reference:Logline",
      "group:reference.group.characters",
      "reference:Ada",
      "reference:Ada's arc",
      "group:reference.group.notes",
      "note:Idea",
    ]);
  });

  it("lift a template's own title into the chapter heading and nest its headings under it", async () => {
    const doc = await withEverything();
    const logline = doc.chapters[1];
    expect(logline.level).toBe(2);
    expect(logline.blocks[0]).toMatchObject({ kind: "paragraph" });
    expect(
      logline.blocks.find((block) => block.kind === "heading"),
    ).toMatchObject({ level: 3 });
  });

  it("leave out a group whose ticked documents are all empty", async () => {
    const doc = await assemble({
      selection: {
        manuscript: new Set(),
        references: new Set(["world--empty.md"]),
        notes: new Set(),
      },
    });
    expect(doc.chapters).toEqual([]);
  });
});

describe("the manuscript layouts (Shunn)", () => {
  const manuscript = (type: string, over: Partial<ExportRequest> = {}) =>
    assemble(
      {
        layout: "manuscriptModern",
        contact: "Ada Lovelace\n\n12 St James's Square  ",
        ...over,
      },
      source({ book: () => ({ ...BOOK, type }) }),
    );

  it("give a novel a title page of its own, unnumbered, before the text", async () => {
    const doc = await manuscript("Novel");
    const [title, first] = doc.chapters;
    expect(title).toMatchObject({
      kind: "title",
      title: null,
      numbered: false,
    });
    expect(title.opening).toEqual({
      // Blank lines and trailing spaces are not part of an address.
      contact: ["Ada Lovelace", "12 St James's Square"],
      // 29 words, under a novel's step of a thousand: rounded to the ten.
      // Under a hundred words nothing is rounded.
      wordCount: "export.manuscript.about(29)",
      title: "Once Dark",
      byline: "export.manuscript.byline(Ada Lovelace)",
    });
    expect(first.kind).toBe("part");
    expect(first.opening).toBeUndefined();
  });

  it("round the novel's count to the nearest thousand", async () => {
    const doc = await assemble(
      { layout: "manuscriptModern" },
      source({ readNode: async () => ({ text: "Words.", words: 30_600 }) }),
    );
    // Six nodes of 30,600 words each.
    expect(doc.chapters[0].opening?.wordCount).toBe(
      "export.manuscript.about(184000)",
    );
  });

  it("open a story's first page with the same furniture, and run its scenes on with #", async () => {
    const doc = await manuscript("Short Story");
    expect(doc.chapters.some((chapter) => chapter.kind === "title")).toBe(
      false,
    );
    expect(outline(doc)).toEqual([
      "part:One",
      "section:-",
      "part:Two",
      "section:-",
      "section:-",
    ]);
    expect(doc.chapters[0].opening?.title).toBe("Once Dark");
    // Two Sections of Part One are one chapter, a scene break between them.
    expect(texts(doc.chapters[1].blocks)).toEqual([
      "Once there was dark.",
      "Then more.",
      "<sceneBreak>",
      "It came back.",
      "<pageBreak>",
      "A second page.",
    ]);
  });

  it("keep a story's Sections on pages of their own when the writer chose page breaks", async () => {
    const doc = await manuscript("Flash Fiction", {
      storySeparator: "pageBreak",
    });
    expect(outline(doc)).toEqual([
      "part:One",
      "section:The Dark",
      "section:The Light",
      "part:Two",
      "section:After",
      "section:Coda",
    ]);
  });

  it("never run a novel's chapters on, whatever the separator says", async () => {
    const doc = await manuscript("Novel", { storySeparator: "shunn" });
    expect(
      doc.chapters.filter((chapter) => chapter.kind === "section"),
    ).toHaveLength(4);
    expect(
      doc.chapters.every((chapter) =>
        chapter.blocks.every((block) => block.kind !== "sceneBreak"),
      ),
    ).toBe(true);
  });

  it("end the text with END, centred", async () => {
    const doc = await manuscript("Novel");
    const blocks = doc.chapters[doc.chapters.length - 1].blocks;
    const last = blocks[blocks.length - 1];
    expect(last).toMatchObject({ kind: "paragraph", align: "center" });
    expect(texts([last as Block])).toEqual(["export.manuscript.end"]);
  });

  it("are not applied to a reflowing format, which is always set as a book", async () => {
    const doc = await manuscript("Short Story", { format: "epub" });
    expect(doc.layout).toBe("book");
    expect(doc.chapters.some((chapter) => chapter.opening)).toBe(false);
  });

  it("fall back to the author's name when no contact block was typed", async () => {
    const doc = await manuscript("Novel", { contact: "" });
    expect(doc.chapters[0].opening?.contact).toEqual(["Ada Lovelace"]);
  });
});

describe("the document", () => {
  it("carries the book's facts and the page furniture's words", async () => {
    const doc = await assemble({ layout: "review", format: "pdf" });
    expect(doc.meta).toEqual({
      accessibilitySummary: "export.epub.accessibilitySummary",
      id: "book-1",
      title: "Once Dark",
      author: "Ada Lovelace",
      language: "en",
      subject: "Literary",
      exportedAt: NOW.toISOString(),
    });
    expect(doc.furniture.draft).toBe("export.furniture.draft(2026-10-01)");
    // The slots stay literal for each writer to fill with its own fields.
    expect(doc.furniture.pageOf).toBe(
      "export.furniture.pageOf({page},{pages})",
    );
  });

  it("gives every chapter a unique id", async () => {
    const doc = await assemble({
      techPage: true,
      toc: true,
      selection: {
        manuscript: ALL_MANUSCRIPT,
        references: new Set(["character--ada.md"]),
        notes: new Set(["note--idea.md"]),
      },
    });
    const ids = doc.chapters.map((chapter: Chapter) => chapter.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Numbered once everything is in place, so the order a reader meets the
    // chapters in is the order of their ids.
    expect(ids).toEqual(ids.map((_, index) => `c${index + 1}`));
  });

  it("marks the blank line it keeps, and opens the paragraph after it", async () => {
    const doc = await assemble(
      {},
      source({
        readNode: async () => ({ text: "One.\n\n\n\nTwo.", words: 2 }),
      }),
    );
    const blocks = doc.chapters[0].blocks;
    expect(texts(blocks)).toEqual(["One.", "", "Two."]);
    expect(blocks[1]).toMatchObject({ blank: true });
    expect(blocks[1]).not.toHaveProperty("opener");
    expect(blocks[2]).toMatchObject({ opener: true });
    expect(blocks[0]).not.toHaveProperty("blank");
  });

  it("drops whitespace and breaks at a chapter's edges, where the chapter boundary already breaks", async () => {
    const doc = await assemble(
      {},
      source({
        readNode: async () => ({
          text: "{pagebreak}\n\nBody.\n\n\n\n\n\n{pagebreak}",
          words: 1,
        }),
      }),
    );
    for (const chapter of doc.chapters)
      expect(texts(chapter.blocks)).toEqual(["Body."]);
  });
});

describe("nesting a chapter's own headings", () => {
  const heading = (level: 1 | 2 | 3 | 4 | 5 | 6): Block => ({
    kind: "heading",
    level,
    inlines: [{ text: "h" }],
    align: "left",
  });

  it("puts the shallowest one level under the chapter and keeps the rest's distance", () => {
    const nested = nestHeadings([heading(1), heading(3)], 2);
    expect(
      nested.map((block) => block.kind === "heading" && block.level),
    ).toEqual([3, 5]);
  });

  it("caps at six and leaves already-nested headings alone", () => {
    expect(
      nestHeadings([heading(1), heading(6)], 2).map(
        (b) => b.kind === "heading" && b.level,
      ),
    ).toEqual([3, 6]);
    const deep = [heading(4)];
    expect(nestHeadings(deep, 1)).toBe(deep);
  });

  it("reaches headings inside quotes and lists", () => {
    const nested = nestHeadings(
      [
        { kind: "quote", blocks: [heading(1)] },
        { kind: "list", ordered: false, start: 1, items: [[heading(2)]] },
      ],
      1,
    );
    expect(nested[0]).toMatchObject({ blocks: [{ level: 2 }] });
    expect(nested[1]).toMatchObject({ items: [[{ level: 3 }]] });
  });
});
