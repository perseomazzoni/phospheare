// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { countWords } from "../../../project/stats";
import { titleProblem } from "../../../project/naming";
import { TYPE_GOAL_DEFAULTS, typeForWords } from "../../../project/types";
import { manuscriptText } from "../adapters/manuscriptText";
import { txtReader } from "../adapters/readers/txt";
import { assertHomogeneous, preorder, type DraftNode } from "../domain/draft";
import {
  DEFAULT_OPTIONS,
  type ImportOptions,
  type ImportPlan,
  type RuleId,
} from "../domain/plan";
import {
  plainPara,
  type ImportedComment,
  type SourceBlock,
  type SourceDocument,
  type SourceFlow,
} from "../domain/source";
import type { ProjectRules, TitleWords } from "../ports";
import { detect } from "./detect";
import { buildDraft, excerpt, layout, unitsOf, unitWords } from "./draft";
import {
  canBe,
  hasScenes,
  rename,
  retitle,
  sceneMarks,
  setKind,
  splitAt,
  splitScenes,
  toggleInclude,
  toggleStart,
  unsplitScenes,
} from "./edits";
import { detectLanguage } from "./language";
import { losses } from "./losses";
import { deriveFacts, readableName } from "./meta";
import { prepare, toDraftParagraph, type PreparedBook } from "./prepare";
import { tidyTitle } from "./titles";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const words: TitleWords = {
  untitled: "Untitled",
  matter: (kind) => `[${kind}]`,
  scene: (chapter, n) => `${chapter}, scene ${n}`,
  split: (row, n) => `${row} split ${n}`,
  shared: (title, n) => `${title} - ${n}`,
};

const rules: ProjectRules = {
  countWords,
  titleProblem: (title) => titleProblem(title)?.code ?? null,
  typeForWords,
  typeGoal: (type) => TYPE_GOAL_DEFAULTS[type],
};

/** Prose of about `n` words, distinct per seed so none reads as a pattern. */
const prose = (n: number, seed = 0) =>
  Array.from(
    { length: n },
    (_, i) =>
      ["she", "walked", "towards", "the", "harbour", "and", "waited", "there"][
        (i + seed) % 8
      ],
  ).join(" ") + ".";

type Spec =
  | string
  | { h: number; text: string }
  | { bold: string; center?: boolean }
  | { center: string }
  | { role: "title" | "subtitle"; text: string }
  | "<pb>"
  | "<hr>";

const block = (spec: Spec): SourceBlock => {
  if (spec === "<pb>") return { kind: "pageBreak" };
  if (spec === "<hr>") return { kind: "rule" };
  if (typeof spec === "string") return plainPara(spec);
  if ("h" in spec) return plainPara(spec.text, { headingLevel: spec.h });
  if ("bold" in spec)
    return {
      kind: "para",
      inlines: [{ text: spec.bold, bold: true }],
      align: spec.center === false ? "left" : "center",
      signals: {},
    };
  if ("role" in spec)
    return plainPara(spec.text, { role: spec.role }, "center");
  return plainPara(spec.center, {}, "center");
};

const flow = (
  name: string,
  specs: Spec[],
  extra: Partial<SourceFlow> = {},
): SourceFlow => ({
  name,
  blocks: specs.map(block),
  ...extra,
});

const source = (
  flows: SourceFlow[],
  comments: ImportedComment[] = [],
): SourceDocument => ({
  formats: ["docx"],
  meta: {},
  flows,
  comments,
  report: {},
});

const run = (
  doc: SourceDocument,
  rule: RuleId | "auto" = "auto",
  options: Partial<ImportOptions> = {},
) => {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const book = prepare(doc, manuscriptText, rules);
  const { plan, bookTitle } = detect(book, rule, opts, words);
  return { book, plan, bookTitle };
};

const titles = (plan: ImportPlan) => plan.entries.map((e) => e.title);
const textOf = (node: DraftNode) =>
  node.paragraphs.map((p) => p.runs.map((r) => r.text).join(""));
const shape = (nodes: DraftNode[]): unknown =>
  nodes.map((n) =>
    n.children.length
      ? { [`${n.kind}:${n.title}`]: shape(n.children) }
      : `${n.kind}:${n.title}`,
  );

// ── Golden detection fixtures ────────────────────────────────────────────────

describe("detection, on the files writers actually have", () => {
  it("finds chapters set as bold, centred lines", () => {
    const { plan } = run(
      source([
        flow("a", [
          { bold: "The Storm" },
          prose(300, 1),
          prose(280, 2),
          { bold: "The Calm" },
          prose(310, 3),
          prose(290, 4),
          { bold: "The End" },
          prose(305, 5),
          prose(270, 6),
        ]),
      ]),
    );
    expect(plan.rule).toBe("typography");
    expect(titles(plan)).toEqual(["The Storm", "The Calm", "The End"]);
  });

  it("names a chapter by the line under a bare marker, keeping both lines in its text", () => {
    const { book, plan } = run(
      source([
        flow("a", [
          { center: "CHAPTER ONE" },
          { center: "The Beginning" },
          prose(400),
          { center: "CHAPTER TWO" },
          { center: "The Middle" },
          prose(380, 2),
          { center: "CHAPTER THREE" },
          prose(390, 3),
        ]),
      ]),
    );
    expect(plan.rule).toBe("patterns");
    // The structure panel counts the number, not the title; a marker with no
    // name under it is its own title, in the capitals it was typed in.
    expect(titles(plan)).toEqual([
      "The Beginning",
      "The Middle",
      "CHAPTER THREE",
    ]);
    expect(plan.entries[0].titleSpan).toBe(2);
    const [one, , three] = buildDraft(book, plan, words).roots;
    expect(textOf(one).slice(0, 2)).toEqual(["CHAPTER ONE", "The Beginning"]);
    expect(textOf(three)[0]).toBe("CHAPTER THREE");
  });

  it("drops a title page and a table of contents, and does not read the contents as chapters", () => {
    const { plan, bookTitle } = run(
      source([
        flow("a", [
          { role: "title", text: "Once Dark" },
          { center: "by Ada Byron" },
          "<pb>",
          "Contents",
          "Chapter One ........ 1",
          "Chapter Two ........ 9",
          "Chapter Three ...... 17",
          "<pb>",
          { h: 1, text: "Chapter One" },
          prose(500),
          { h: 1, text: "Chapter Two" },
          prose(480, 2),
          { h: 1, text: "Chapter Three" },
          prose(470, 3),
        ]),
      ]),
    );
    expect(bookTitle).toBe("Once Dark");
    expect(plan.entries.map((e) => [e.title, e.matter, !e.included])).toEqual([
      ["[titlePage]", "titlePage", true],
      ["[toc]", "toc", true],
      ["Chapter One", null, false],
      ["Chapter Two", null, false],
      ["Chapter Three", null, false],
    ]);
  });

  it("ends the contents row with the contents: a dedication after it is a row of its own, kept", () => {
    const chapters: SourceBlock[] = [
      plainPara("Chapter One", { headingLevel: 1 }),
      plainPara(prose(400)),
      plainPara("Chapter Two", { headingLevel: 1 }),
      plainPara(prose(400, 2)),
      plainPara("Chapter Three", { headingLevel: 1 }),
      plainPara(prose(400, 3)),
    ];
    const dedication = "For my mother, who never stopped reading.";
    const rows = (blocks: SourceBlock[]) => {
      const { book, plan } = run(source([{ name: "a", blocks }]));
      return plan.entries.map((e) => [
        e.matter,
        e.included,
        book.blocks.slice(e.start, e.end).map((b) => b.text),
      ]);
    };
    // A contents heading by its style, with nothing listed under it.
    expect(
      rows([
        plainPara("The Long Night", { role: "title" }, "center"),
        plainPara("Ada Byron"),
        plainPara("Contents", { role: "toc" }),
        plainPara(dedication),
        ...chapters,
      ]).slice(0, 3),
    ).toEqual([
      ["titlePage", false, ["The Long Night", "Ada Byron"]],
      ["toc", false, ["Contents"]],
      [null, true, [dedication]],
    ]);
    // A typed list at the very top, then an epigraph.
    const epigraph =
      "All happy families are alike; each is unhappy its own way.";
    const top = rows([
      plainPara("Contents"),
      plainPara("Chapter One"),
      plainPara("Chapter Two"),
      plainPara("Chapter Three"),
      plainPara(epigraph),
      ...chapters,
    ]);
    expect(top[0]).toEqual([
      "toc",
      false,
      ["Contents", "Chapter One", "Chapter Two", "Chapter Three"],
    ]);
    expect(top[1][1]).toBe(true);
    expect(top[1][2]).toEqual([epigraph]);
  });

  it("splits a typed manuscript at its big gaps of blank lines", () => {
    const gap = Array.from({ length: 8 }, () => "");
    const { plan } = run(
      source([
        flow("a", [
          prose(400),
          prose(300, 1),
          ...gap,
          prose(420, 2),
          prose(310, 3),
          ...gap,
          prose(390, 4),
        ]),
      ]),
    );
    expect(plan.rule).toBe("pageBreaks");
    expect(plan.entries).toHaveLength(3);
    expect(titles(plan)).toEqual(["Untitled", "Untitled", "Untitled"]);
  });

  it("drops single blank lines in a double-spaced manuscript instead of reading them as breaks", () => {
    const specs: Spec[] = [];
    for (let i = 0; i < 12; i++) specs.push(prose(60, i), "");
    const { book } = run(source([flow("a", specs)]));
    expect(book.doubleSpaced).toBe(true);
    expect(book.blocks.some((b) => b.scene)).toBe(false);
  });

  it("keeps every blank line the writer typed, wherever it is", () => {
    // A dateline, a blank line, then the scene. A blank line between prose
    // stays a blank line, never rewritten as "* * *", and so does one under
    // a title at a Section's top.
    const { book, plan } = run(
      source([
        flow("a", [
          { h: 1, text: "One" },
          "",
          "28 Agosto 2048, 08:13am",
          "",
          prose(60),
          prose(60, 1),
          "",
          "",
          prose(60, 2),
        ]),
      ]),
    );
    expect(book.blocks.some((b) => b.scene)).toBe(false);
    expect(book.blocks.map((b) => b.blankBefore ?? 0)).toEqual([0, 1, 1, 0, 2]);
    const [one] = buildDraft(book, plan, words).roots;
    // The title line names the Section and stays its first line.
    expect(textOf(one)).toEqual([
      "One",
      "",
      "28 Agosto 2048, 08:13am",
      "",
      prose(60),
      prose(60, 1),
      "",
      "",
      prose(60, 2),
    ]);
  });

  it("keeps the blank lines above a title, between chapters and at the end of the book", () => {
    const { book, plan } = run(
      source([
        flow("a", [
          "",
          { h: 1, text: "One" },
          prose(60),
          "",
          "",
          { h: 1, text: "Two" },
          prose(60, 1),
          "",
        ]),
      ]),
    );
    const [one, two] = buildDraft(book, plan, words).roots;
    // Above a title, at the top of the Section it names, over its line.
    expect(textOf(one)).toEqual(["", "One", prose(60)]);
    expect(textOf(two)).toEqual(["", "", "Two", prose(60, 1), ""]);
  });

  it("keeps a long run of blank lines as blank lines, never as a page break", () => {
    const { book, plan } = run(
      source([flow("a", [prose(60), "", "", "", "", prose(60, 1)])]),
      "none",
    );
    const [whole] = buildDraft(book, plan, words).roots;
    expect(whole.paragraphs.map((p) => p.blockType)).not.toContain("pagebreak");
    expect(textOf(whole)).toEqual([prose(60), "", "", "", "", prose(60, 1)]);
  });

  it("keeps a double-spaced typescript's blank lines too", () => {
    const { book, plan } = run(
      source([
        flow("a", [
          prose(60),
          "",
          prose(60, 1),
          "",
          prose(60, 2),
          "",
          prose(60, 3),
          "",
        ]),
      ]),
      "none",
    );
    expect(book.doubleSpaced).toBe(true);
    const [whole] = buildDraft(book, plan, words).roots;
    expect(textOf(whole).filter((t) => t === "")).toHaveLength(4);
  });

  it("reads Italian chapter words", () => {
    const { plan } = run(
      source([
        flow("a", [
          "Capitolo primo",
          prose(400),
          "Capitolo secondo",
          prose(420, 1),
          "Capitolo terzo",
          prose(410, 2),
        ]),
      ]),
    );
    expect(plan.rule).toBe("patterns");
    expect(titles(plan)).toEqual([
      "Capitolo primo",
      "Capitolo secondo",
      "Capitolo terzo",
    ]);
  });

  it("tells Parts from chapters when both sit at one heading level", () => {
    const { plan } = run(
      source([
        flow("a", [
          { h: 1, text: "Part One" },
          { h: 1, text: "Chapter 1" },
          prose(400),
          { h: 1, text: "Chapter 2" },
          prose(410, 1),
          { h: 1, text: "Part Two" },
          { h: 1, text: "Chapter 3" },
          prose(420, 2),
        ]),
      ]),
    );
    expect(plan.entries.map((e) => [e.level, e.title])).toEqual([
      ["part", "Part One"],
      ["chapter", "Chapter 1"],
      ["chapter", "Chapter 2"],
      ["part", "Part Two"],
      ["chapter", "Chapter 3"],
    ]);
  });

  it("knows a page of just the author and the title for the title page, by what the file says of itself", () => {
    const doc = source([
      flow("a", [
        { center: "Perseo Mazzoni" },
        { center: "L'Abitatore del Pianeta" },
        "Capitolo 1",
        prose(400),
        "Capitolo 2",
        prose(400, 1),
        "Capitolo 3",
        prose(400, 2),
      ]),
    ]);
    const stated = run({
      ...doc,
      meta: { title: "L'Abitatore del Pianeta", author: "Perseo Mazzoni" },
    }).plan;
    expect(stated.entries.map((e) => [e.matter, !e.included])).toEqual([
      ["titlePage", true],
      [null, false],
      [null, false],
      [null, false],
    ]);
    // Without the file's word for it, two short lines are not enough.
    expect(run(doc).plan.entries[0]).toMatchObject({
      matter: null,
      included: true,
    });
  });

  it("never names an untitled page as a chapter, so it cannot pose as the book's Chapter 1", () => {
    const { plan } = run(
      source([
        flow("a", [
          "Draft 3, revised for the agent.",
          "Word count: 92,000. Do not circulate.",
          "Chapter 1",
          prose(400),
          "Chapter 2",
          prose(400, 1),
          "Chapter 3",
          prose(400, 2),
        ]),
      ]),
    );
    expect(titles(plan)).toEqual([
      "Untitled",
      "Chapter 1",
      "Chapter 2",
      "Chapter 3",
    ]);
  });

  it("never splits at a sentence that begins like a heading", () => {
    const { plan } = run(
      source([
        flow("a", [
          "Chapter 3 was her favourite.",
          prose(400),
          "Part of her wanted to stay.",
          prose(400, 2),
        ]),
      ]),
    );
    expect(plan.entries).toHaveLength(1);
  });

  it("reads a hard-wrapped Gutenberg text file end to end", async () => {
    const text = [
      "The Project Gutenberg eBook",
      "",
      "CHAPTER I.",
      "",
      `${prose(40)}\n${prose(40, 1)}`,
      "",
      `${prose(40, 2)}\n${prose(40, 3)}`,
      "",
      "CHAPTER II.",
      "",
      `${prose(40, 4)}\n${prose(40, 5)}`,
      "",
      "CHAPTER III.",
      "",
      `${prose(40, 6)}\n${prose(40, 7)}`,
    ].join("\n");
    const doc = await txtReader.read(new TextEncoder().encode(text), "pg.txt", {
      yield: async () => undefined,
    });
    const { plan } = run(doc);
    expect(plan.rule).toBe("patterns");
    expect(titles(plan).slice(-3)).toEqual([
      "CHAPTER I.",
      "CHAPTER II.",
      "CHAPTER III.",
    ]);
  });

  it("takes an epub's chapter titles from its table of contents, consuming the echoed heading", () => {
    const { plan } = run(
      source([
        flow("c1.xhtml", [{ h: 1, text: "Chapter One" }, prose(400)], {
          navTitle: "Chapter One",
        }),
        flow("c1b.xhtml", [prose(300, 1)]),
        flow("c2.xhtml", [{ h: 1, text: "Chapter Two" }, prose(400, 2)], {
          navTitle: "Chapter Two",
        }),
      ]),
      "files",
    );
    expect(plan.entries.map((e) => [e.title, e.titleSpan])).toEqual([
      ["Chapter One", 1],
      ["Chapter Two", 1],
    ]);
  });

  it("leaves an epub's extra outside the reading order out, and marks it so the row can say why", () => {
    const { plan } = run(
      source([
        flow("c1.xhtml", [{ h: 1, text: "Chapter One" }, prose(400)], {
          navTitle: "Chapter One",
        }),
        flow("map.xhtml", [{ h: 1, text: "The Map" }, prose(40, 3)], {
          navTitle: "The Map",
          linear: false,
        }),
        flow("c2.xhtml", [{ h: 1, text: "Chapter Two" }, prose(400, 2)], {
          navTitle: "Chapter Two",
        }),
      ]),
      "files",
    );
    expect(
      plan.entries.map((e) => [e.title, e.included, e.offSpine ?? false]),
    ).toEqual([
      ["Chapter One", true, false],
      ["The Map", false, true],
      ["Chapter Two", true, false],
    ]);
  });

  it("keeps an epub's extra apart from the chapter before it, whichever way divides the text", () => {
    const doc = source([
      flow("c1.xhtml", [{ h: 1, text: "Chapter 1" }, prose(400)], {
        navTitle: "Chapter 1",
      }),
      flow("map.xhtml", [prose(40, 3)], { navTitle: "The Map", linear: false }),
      // Text that runs on after the extra, with no heading of its own.
      flow("c1b.xhtml", [prose(300, 1)]),
      flow("c2.xhtml", [{ h: 1, text: "Chapter 2" }, prose(400, 2)], {
        navTitle: "Chapter 2",
      }),
    ]);
    for (const rule of ["patterns", "headings", "auto"] as const) {
      const { plan } = run(doc, rule);
      expect(
        plan.entries.map((e) => [e.title, e.included, e.offSpine ?? false]),
      ).toEqual([
        ["Chapter 1", true, false],
        ["The Map", false, true],
        ["Untitled", true, false],
        ["Chapter 2", true, false],
      ]);
    }
    // Kept whole, it is the whole file: the writer asked for one piece.
    expect(run(doc, "none").plan.entries).toHaveLength(1);
  });

  it("calls a short text one chapter", () => {
    const { plan } = run(
      source([
        flow("a", [
          { bold: "Note" },
          prose(200),
          { bold: "Later" },
          prose(150, 1),
        ]),
      ]),
    );
    expect(plan.rule).toBe("none");
    expect(plan.entries).toHaveLength(1);
  });

  it("offers every rule, and marks the empty ones unavailable", () => {
    const { plan } = run(
      source([
        flow("a", [
          { h: 1, text: "One" },
          prose(400),
          { h: 1, text: "Two" },
          prose(400, 1),
        ]),
      ]),
    );
    const byRule = Object.fromEntries(plan.candidates.map((c) => [c.rule, c]));
    expect(byRule.headings).toMatchObject({ available: true });
    expect(byRule.typography.available).toBe(false);
    expect(byRule.none.available).toBe(true);
  });

  it("splits on a separator the writer names", () => {
    const { plan } = run(
      source([
        flow("a", [prose(300), "###", prose(300, 1), "###", prose(300, 2)]),
      ]),
      "separator",
      { separator: "###" },
    );
    expect(plan.entries.map((e) => [e.title, e.titleSpan])).toEqual([
      ["Untitled", 0],
      ["Untitled", 1],
      ["Untitled", 1],
    ]);
  });

  // The three below cover a book the app exported, read back as in
  // `roundTrip.test.ts`.

  it("reads one Part over its chapters even with matter headings beside it", () => {
    const { plan } = run(
      source([
        flow("a", [
          { h: 1, text: "Technical details" },
          "Title The Harbour",
          { h: 1, text: "Contents" },
          { h: 1, text: "Part One" },
          { h: 2, text: "Anna" },
          prose(300),
          { h: 2, text: "The Storm" },
          prose(300, 1),
          { h: 2, text: "Anna" },
          prose(300, 2),
        ]),
      ]),
    );
    expect(plan.entries.map((e) => [e.level, e.title, !e.included])).toEqual([
      ["part", "Technical details", true],
      ["part", "Contents", true],
      ["part", "Part One", false],
      ["chapter", "Anna", false],
      ["chapter", "The Storm", false],
      ["chapter", "Anna", false],
    ]);
  });

  it("ends a plain contents list at the first true heading, or when its first entry comes round again", () => {
    // Markdown: no page break says where the list stops.
    const headed = run(
      source([
        flow("a", [
          { h: 1, text: "Contents" },
          "Part One",
          "Anna",
          "The Storm",
          "Anna",
          { h: 1, text: "Part One" },
          "For the ones who stayed.",
          { h: 2, text: "Anna" },
          prose(300),
          { h: 2, text: "The Storm" },
          prose(300, 1),
        ]),
      ]),
    );
    expect(titles(headed.plan)).toEqual([
      "Contents",
      "Part One",
      "Anna",
      "The Storm",
    ]);
    // Plain text: the body repeats the list's first line, and two entries
    // may share a title without ending it.
    const plain = run(
      source([
        flow("a", [
          "Contents",
          "Chapter One",
          "Chapter Two",
          "Chapter Two",
          "Chapter One",
          prose(300),
          "Chapter Two",
          prose(300, 1),
        ]),
      ]),
    );
    expect(titles(plain.plan)).toEqual(["[toc]", "Chapter One", "Chapter Two"]);
  });

  it("never takes a matter heading for the book's title", () => {
    const { bookTitle } = run(
      source([
        flow("a", [
          { h: 1, text: "Contents" },
          { h: 2, text: "Anna" },
          prose(300),
          { h: 2, text: "Ben" },
          prose(300, 1),
        ]),
      ]),
    );
    expect(bookTitle).toBeUndefined();
  });
});

// ── The draft ────────────────────────────────────────────────────────────────

const novel = () =>
  source([
    flow("a", [
      { h: 1, text: "Prologue" },
      prose(200),
      { h: 1, text: "Part One" },
      { h: 2, text: "Chapter 1" },
      prose(300),
      "* * *",
      prose(200, 1),
      { h: 2, text: "Chapter 2" },
      prose(310, 2),
      { h: 1, text: "Part Two" },
      { h: 2, text: "Chapter 3" },
      prose(320, 3),
      { h: 1, text: "Epilogue" },
      prose(150, 4),
    ]),
  ]);

describe("buildDraft", () => {
  it("puts chapters in their Parts and stands matter beside them as Parts", () => {
    const { book, plan } = run(novel());
    const draft = buildDraft(book, plan, words);
    expect(shape(draft.roots)).toEqual([
      "part:Prologue",
      { "part:Part One": ["section:Chapter 1", "section:Chapter 2"] },
      { "part:Part Two": ["section:Chapter 3"] },
      "part:Epilogue",
    ]);
    // The scene break stays as the writer set it: its glyph and its place
    // on the line (this one was typed at the margin).
    const chapter1 = draft.roots[1].children[0];
    expect(
      chapter1.paragraphs.map((p) => p.runs.map((r) => r.text).join("")),
    ).toContain("* * *");
    expect(
      chapter1.paragraphs.find((p) => p.runs[0]?.text === "* * *")?.alignment,
    ).toBe("left");
  });

  it("keeps chapters as Sections at the root when the book has no Parts", () => {
    const { book, plan } = run(
      source([
        flow("a", [
          { h: 1, text: "One" },
          prose(400),
          { h: 1, text: "Two" },
          prose(400, 1),
        ]),
      ]),
    );
    expect(shape(buildDraft(book, plan, words).roots)).toEqual([
      "section:One",
      "section:Two",
    ]);
  });

  it("keeps a page break inside a chapter, and in-body headings as h1/h2", () => {
    const { book, plan } = run(
      source([
        flow("a", [
          { h: 1, text: "One" },
          prose(300),
          { h: 3, text: "A letter" },
          prose(100, 1),
          { h: 4, text: "PS" },
          "<pb>",
          prose(200, 2),
          { h: 1, text: "Two" },
          prose(300, 3),
        ]),
      ]),
    );
    const one = buildDraft(book, plan, words).roots[0];
    // The Section's own title line is the shallowest heading in it: h1, and
    // the deeper ones h2.
    expect(one.paragraphs.map((p) => p.blockType)).toEqual([
      "h1",
      "paragraph",
      "h2",
      "paragraph",
      "h2",
      "pagebreak",
      "paragraph",
    ]);
  });

  it("makes nothing of a row left out; the contents start left out, one tick from coming in", () => {
    const { book, plan } = run(
      source([
        flow("a", [
          "Contents",
          "Chapter One ........ 1",
          "Chapter Two ........ 9",
          "Chapter Three ...... 17",
          "<pb>",
          { h: 1, text: "Chapter One" },
          prose(500),
          { h: 1, text: "Chapter Two" },
          prose(480, 2),
          { h: 1, text: "Chapter Three" },
          prose(470, 3),
        ]),
      ]),
    );
    expect(plan.entries[0].included).toBe(false);
    expect(shape(buildDraft(book, plan, words).roots)).toEqual([
      "section:Chapter One",
      "section:Chapter Two",
      "section:Chapter Three",
    ]);
    const ticked = toggleInclude(plan, plan.entries[0].key);
    expect(shape(buildDraft(book, ticked, words).roots)).toEqual([
      "section:[toc]",
      "section:Chapter One",
      "section:Chapter Two",
      "section:Chapter Three",
    ]);
    expect(textOf(buildDraft(book, ticked, words).roots[0])[0]).toBe(
      "Contents",
    );
  });

  it("anchors a comment placed at a point on the word before it, with a TextQuote", () => {
    const text = "The storm came at dawn over the harbour.";
    const comment: ImportedComment = {
      sourceId: "1",
      anchor: {
        flow: 0,
        start: { block: 1, offset: 9 },
        end: { block: 1, offset: 9 },
      },
      body: [[{ text: "Which storm?" }]],
    };
    const { book, plan } = run(
      source([flow("a", [{ h: 1, text: "One" }, text, prose(300)])], [comment]),
    );
    const [anchored] = buildDraft(book, plan, words).comments;
    // Paragraph 1: the Section's title line is its paragraph 0.
    expect(anchored.anchor).toEqual({
      node: 0,
      start: { paragraph: 1, offset: 4 },
      end: { paragraph: 1, offset: 9 },
      quote: {
        exact: "storm",
        prefix: "One\nThe ",
        suffix: " came at dawn over the harbour.\n",
      },
    });
  });

  it("keeps a comment's range, and a comment whose place the source lost as an orphan", () => {
    const comment: ImportedComment = {
      sourceId: "c",
      anchor: {
        flow: 0,
        start: { block: 1, offset: 4 },
        end: { block: 1, offset: 9 },
      },
      body: [[{ text: "Which?" }]],
      author: "Ed",
    };
    const dangling: ImportedComment = {
      sourceId: "x",
      anchor: null,
      body: [],
    };
    const { book, plan } = run(
      source(
        [flow("a", [{ h: 1, text: "One" }, "The storm came.", prose(300)])],
        [comment, dangling],
      ),
    );
    const comments = buildDraft(book, plan, words).comments;
    expect(comments[0]).toMatchObject({
      author: "Ed",
      anchor: { quote: { exact: "storm" } },
    });
    expect(comments[1].anchor).toBeNull();
  });

  it("brings no comment at all when the writer unticks them", () => {
    const comment: ImportedComment = {
      sourceId: "c",
      anchor: {
        flow: 0,
        start: { block: 1, offset: 4 },
        end: { block: 1, offset: 9 },
      },
      body: [[{ text: "Which?" }]],
    };
    const { book, plan } = run(
      source(
        [flow("a", [{ h: 1, text: "One" }, "The storm came.", prose(300)])],
        [comment, { sourceId: "x", anchor: null, body: [] }],
      ),
    );
    const draft = (comments: boolean) =>
      buildDraft(book, plan, words, { underlineItalic: true, comments });
    expect(draft(true).comments).toHaveLength(2);
    expect(draft(false).comments).toEqual([]);
  });

  it("leaves a comment on a row the writer unticks out with the row, and its replies with it", () => {
    const on = (block: number, sourceId: string): ImportedComment => ({
      sourceId,
      anchor: {
        flow: 0,
        start: { block, offset: 0 },
        end: { block, offset: 3 },
      },
      body: [[{ text: sourceId }]],
    });
    const { book, plan } = run(
      source(
        [
          flow("a", [
            { h: 1, text: "One" },
            "Her first words.",
            prose(300),
            { h: 1, text: "Two" },
            "His last words.",
            prose(300, 1),
          ]),
        ],
        [
          on(1, "kept"),
          on(4, "gone"),
          { sourceId: "reply", parentId: "gone", anchor: null, body: [] },
          { sourceId: "later", parentId: "reply", anchor: null, body: [] },
          { sourceId: "lost", anchor: null, body: [] },
        ],
      ),
    );
    const two = plan.entries.find((e) => e.title === "Two");
    if (!two) throw new Error("no Two");
    const comments = buildDraft(
      book,
      toggleInclude(plan, two.key),
      words,
    ).comments;
    // The source's own orphan still comes across; the comment on Two and
    // every reply under it do not.
    expect(comments.map((c) => c.sourceId)).toEqual(["kept", "lost"]);
    expect(comments[0].anchor?.quote.exact).toBe("Her");
  });
});

// ── Edits ────────────────────────────────────────────────────────────────────

const flat = () =>
  run(
    source([
      flow("a", [
        { h: 1, text: "One" },
        prose(300),
        "A short line",
        prose(300, 1),
        { h: 1, text: "Two" },
        prose(300, 2),
        { h: 1, text: "Three" },
        prose(300, 3),
      ]),
    ]),
  );

describe("edits", () => {
  it("joins an unticked entry, its title line included, to the Section above", () => {
    const { book, plan } = flat();
    const joined = toggleStart(plan, plan.entries[1].key);
    expect(joined.entries[1].starts).toBe(false);
    const roots = buildDraft(book, joined, words).roots;
    expect(shape(roots)).toEqual(["section:One", "section:Three"]);
    expect(textOf(roots[0])).toContain("Two");
    // Ticking it again gives the chapter back.
    expect(toggleStart(joined, plan.entries[1].key)).toEqual(plan);
  });

  it("joins an unticked first entry to the first ticked one", () => {
    const { book, plan } = flat();
    const roots = buildDraft(
      book,
      toggleStart(plan, plan.entries[0].key),
      words,
    ).roots;
    expect(shape(roots)).toEqual(["section:Two", "section:Three"]);
    expect(textOf(roots[0])[0]).toBe("One");
  });

  it("imports the whole text as one chapter when nothing is ticked", () => {
    const { book, plan } = flat();
    const none = plan.entries.reduce(
      (p, entry) => toggleStart(p, entry.key),
      plan,
    );
    const units = unitsOf(none, words);
    expect(units).toHaveLength(1);
    expect(unitWords(book, units[0])).toBe(book.words);
    expect(shape(buildDraft(book, none, words).roots)).toEqual([
      "section:Untitled",
    ]);
  });

  it("breaks a join at a row left out: the row below it starts its own Section", () => {
    const { book, plan } = flat();
    // "Three" joined to "Two", then "Two" left out: the join reached only
    // the row directly above, so "Three" stands alone rather than joining
    // "One" across a row that is not coming in.
    const joined = toggleStart(plan, plan.entries[2].key);
    expect(shape(buildDraft(book, joined, words).roots)).toEqual([
      "section:One",
      "section:Two",
    ]);
    const broken = toggleInclude(joined, plan.entries[1].key);
    expect(shape(buildDraft(book, broken, words).roots)).toEqual([
      "section:One",
      "section:Three",
    ]);
    expect(textOf(buildDraft(book, broken, words).roots[0])).not.toContain(
      "Three",
    );
  });

  it("counts a Section's words with the text that joined it, title lines in every count", () => {
    const { book, plan } = flat();
    const [one, two] = unitsOf(plan, words);
    const joined = unitsOf(toggleStart(plan, plan.entries[1].key), words)[0];
    expect(unitWords(book, two)).toBeGreaterThan(
      unitWords(book, { ...two, body: two.body.slice(1) }),
    );
    expect(unitWords(book, joined)).toBe(
      unitWords(book, one) + unitWords(book, two),
    );
  });

  it("shows a row's opening: its Section's first paragraphs, or, unticked, the text it gives away", () => {
    const { book, plan } = flat();
    expect(excerpt(book, plan.entries[0]).map((p) => p.text)).toEqual([
      "One",
      prose(300),
      "A short line",
      prose(300, 1),
    ]);
    const joined = toggleStart(plan, plan.entries[1].key).entries[1];
    expect(excerpt(book, joined)[0].text).toBe("Two");
    expect(excerpt(book, plan.entries[0], 2)).toHaveLength(2);
  });

  it("words made-up titles in the book's language, leaving real ones alone", () => {
    const { plan } = run(
      source([
        flow("a", [
          prose(300),
          "<pb>",
          prose(300, 1),
          "<pb>",
          { h: 1, text: "The End" },
          prose(300, 3),
        ]),
      ]),
      "pageBreaks",
    );
    expect(titles(plan)).toEqual(["Untitled", "Untitled", "The End"]);
    const italian: TitleWords = {
      ...words,
      untitled: "Senza titolo",
    };
    // Two Sections would share the made-up name, so each has its number.
    expect(titles(retitle(plan, italian))).toEqual([
      "Senza titolo - 1",
      "Senza titolo - 2",
      "The End",
    ]);
    // Joined, the second is a line of the first's text: one Section, no
    // number.
    const joined = toggleStart(plan, plan.entries[1].key);
    expect(titles(retitle(joined, words))).toEqual(titles(plan));
  });

  it("can never be ticked into a tree that breaks the Golden Rule, or loses a word", () => {
    // A seeded walk through random tick sequences, on books with and without
    // Parts.
    let seed = 7;
    const random = () =>
      (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let trial = 0; trial < 150; trial++) {
      const { book, plan: start } = trial % 2 === 0 ? run(novel()) : flat();
      let plan = start;
      for (let step = 0; step < 8; step++) {
        const entry = plan.entries[Math.floor(random() * plan.entries.length)];
        plan = retitle(toggleStart(plan, entry.key), words);
      }
      const draft = buildDraft(book, plan, words);
      expect(() => assertHomogeneous(draft.roots)).not.toThrow();
      // Every word lands in a text, title lines included.
      const units = unitsOf(plan, words);
      const kept = units.reduce((sum, unit) => sum + unitWords(book, unit), 0);
      expect(kept).toBe(book.words);
      for (const node of preorder(draft.roots))
        expect(rules.titleProblem(node.title)).toBeNull();
    }
  });
});

// ── Language, facts, losses ──────────────────────────────────────────────────

describe("the project's facts", () => {
  const bookOf = (text: string): PreparedBook =>
    prepare(source([flow("a", [text])]), manuscriptText, rules);

  it("takes the language the source states, else a clear vote, else the interface's", () => {
    const supported = ["en", "it", "es", "fr", "de", "pt"];
    expect(detectLanguage("it-IT", bookOf("x"), supported, "en")).toBe("it");
    expect(
      detectLanguage(
        undefined,
        bookOf(
          "Il cane che non era una volta per la casa di lei, come gli altri della via.",
        ),
        supported,
        "en",
      ),
    ).toBe("it");
    expect(detectLanguage(undefined, bookOf("Zxq vbn."), supported, "fr")).toBe(
      "fr",
    );
    expect(detectLanguage("xx", bookOf("Zxq."), supported, "de")).toBe("de");
  });

  it("proposes a title, a type by length and a goal no smaller than the book", () => {
    expect(
      deriveFacts({}, undefined, "the_long-night.docx", 92_310, rules),
    ).toEqual({
      title: "the long-night",
      author: "",
      type: "Novel",
      goal: Math.max(TYPE_GOAL_DEFAULTS.Novel, 93_000),
    });
    const facts = deriveFacts(
      { title: "Once Dark", author: " Ada " },
      "Ignored",
      "x.md",
      80_400,
      rules,
    );
    expect(facts).toMatchObject({
      title: "Once Dark",
      author: "Ada",
      type: "Novel",
    });
    expect(facts.goal).toBe(Math.max(TYPE_GOAL_DEFAULTS.Novel, 81_000));
    expect(readableName("dir/My_Book v2.txt")).toBe("My Book v2");
  });

  it("warns only of what the project cannot hold, in a fixed order — comments come across", () => {
    expect(
      losses({
        comments: 3,
        italic: 12,
        images: 2,
        underline: 1,
        footnotes: 1,
        textBoxes: 0,
      }),
    ).toEqual([
      { key: "footnotes", count: 1 },
      { key: "images", count: 2 },
    ]);
    expect(losses({ italic: 40, lists: 2, tables: 1 })).toEqual([]);
  });

  it("reads underline as italic, the manuscript convention for it", () => {
    const [run1, run2] = toDraftParagraph(
      [{ text: "She said " }, { text: "never", underline: true }],
      "left",
    ).runs;
    expect(run1.italic).toBe(false);
    expect(run2.italic).toBe(true);
  });
});

// ── Detection, edit and title defects ────────────────────────────────────────

describe("detection, edits and titles", () => {
  it('a short in-chapter line that opens like matter ("NOTE: …") is no boundary', () => {
    const { plan } = run(
      source([
        flow("a", [
          "Chapter 1",
          prose(400),
          "Chapter 2",
          prose(200, 1),
          "NOTE: DO NOT OPEN",
          prose(300, 2),
          "Chapter 3",
          prose(400, 3),
        ]),
      ]),
    );
    expect(plan.rule).toBe("patterns");
    expect(titles(plan)).toEqual(["Chapter 1", "Chapter 2", "Chapter 3"]);
    expect(plan.entries.every((entry) => entry.starts && entry.included)).toBe(
      true,
    );
  });

  it('a chapter headed "Chapter N" is never left out as matter for what its text says', () => {
    // A short chapter that mentions copyright.
    const copyright = run(
      source([
        flow("a", [
          "Chapter 1",
          prose(300),
          "Chapter 2",
          "The photograph had no copyright mark on it, she noticed at once.",
          prose(200, 1),
          "Chapter 3",
          prose(300, 2),
        ]),
      ]),
    ).plan;
    expect(copyright.entries.map((e) => [e.matter, !e.included])).toEqual([
      [null, false],
      [null, false],
      [null, false],
    ]);
    // A short first chapter with a line that begins "By …".
    const byLine = run(
      source([
        flow("a", [
          "Chapter 1",
          "By the time the rain stopped, she had already gone.",
          prose(100),
          "Chapter 2",
          prose(300, 1),
          "Chapter 3",
          prose(300, 2),
        ]),
      ]),
    ).plan;
    expect(byLine.entries[0]).toMatchObject({ matter: null, included: true });
  });

  it("unticking a Part never takes the matter that stands beside it", () => {
    const { book, plan } = run(
      source([
        flow("a", [
          "Part One",
          "Chapter 1",
          prose(400),
          "Chapter 2",
          prose(380, 1),
          "Part Two",
          "Chapter 3",
          prose(390, 2),
          "Epilogue",
          prose(200, 3),
        ]),
      ]),
    );
    expect(plan.rule).toBe("patterns");
    // The draft stands the Epilogue at the root, outside Part Two …
    expect(shape(buildDraft(book, plan, words).roots)).toEqual([
      { "part:Part One": ["section:Chapter 1", "section:Chapter 2"] },
      { "part:Part Two": ["section:Chapter 3"] },
      "part:Epilogue",
    ]);
    // … so unticking Part Two folds its chapters into Part One and leaves
    // the Epilogue standing on its own.
    const partTwo = plan.entries.find((e) => e.title === "Part Two");
    if (!partTwo) throw new Error("no Part Two");
    expect(
      shape(buildDraft(book, toggleStart(plan, partTwo.key), words).roots),
    ).toEqual([
      {
        "part:Part One": [
          "section:Chapter 1",
          "section:Chapter 2",
          "section:Chapter 3",
        ],
      },
      "part:Epilogue",
    ]);
  });

  it("a separator line after a blank line still splits", () => {
    const { plan } = run(
      source([
        flow("a", [
          prose(100),
          prose(100, 1),
          prose(100, 2),
          prose(100, 3),
          "",
          "###",
          prose(100, 4),
          prose(100, 5),
          prose(100, 6),
          prose(100, 7),
          "",
          "###",
          prose(100, 1),
          prose(100, 2),
        ]),
      ]),
      "separator",
      { separator: "###" },
    );
    expect(plan.entries).toHaveLength(3);
  });

  // A title keeps the writer's own letters: nothing of its case changes.
  it("a title in capitals keeps the writer's capitals", () => {
    expect(tidyTitle("CHAPTER 3: THE STORM")).toBe("CHAPTER 3: THE STORM");
    expect(tidyTitle("LIVE OR DIE")).toBe("LIVE OR DIE");
    expect(tidyTitle("I AM LEGEND")).toBe("I AM LEGEND");
    expect(tidyTitle("CAPITOLO PRIMO: MI CHIAMO ANNA")).toBe(
      "CAPITOLO PRIMO: MI CHIAMO ANNA",
    );
    expect(tidyTitle("DI NOTTE")).toBe("DI NOTTE");
    expect(tidyTitle("PART II")).toBe("PART II");
    // Only the spacing is tidied.
    expect(tidyTitle("  TIMO   ")).toBe("TIMO");
  });

  it("a tidied title always passes the project's title rule, whatever its characters", () => {
    const long = Array.from({ length: 70 }, () => "\u{1F600}").join(" ");
    const title = tidyTitle(long);
    expect(title.endsWith("…")).toBe(true);
    expect(rules.titleProblem(title)).toBeNull();
  });
});

// ── The writer's row edits ───────────────────────────────────────────────────

/** A book of three chapters, the second cut into scenes by "* * *". */
const scenic = () =>
  run(
    source([
      flow("a", [
        { h: 1, text: "One" },
        prose(300),
        { h: 1, text: "Two" },
        prose(200, 1),
        { center: "* * *" },
        prose(200, 2),
        { center: "* * *" },
        prose(200, 3),
        { h: 1, text: "Three" },
        prose(300, 4),
      ]),
    ]),
  );

describe("the writer's row edits", () => {
  it("renames a row to what the writer typed, and keeps the name over nothing typed", () => {
    const { book, plan } = flat();
    const key = plan.entries[1].key;
    const named = rename(plan, key, "  The   Harbour ");
    expect(named.entries[1]).toMatchObject({
      title: "The Harbour",
      titleSource: "writer",
    });
    expect(rename(named, key, "   ")).toBe(named);
    expect(shape(buildDraft(book, named, words).roots)).toEqual([
      "section:One",
      "section:The Harbour",
      "section:Three",
    ]);
    // A name the writer typed is theirs in every language.
    expect(retitle(named, { ...words, untitled: "Senza titolo" })).toEqual(
      named,
    );
  });

  it("cuts a row in two at a paragraph, named after the row and numbered in order, and joining a cut takes it away", () => {
    const { book, plan } = flat();
    const one = plan.entries[0];
    const titles = (p: typeof plan) => p.entries.map((e) => e.title);
    const at = book.blocks.findIndex((b) => b.text === "A short line");
    const cut = splitAt(plan, one.key, at + 1, words);
    expect(titles(cut)).toEqual(["One", "One split 1", "Two", "Three"]);
    expect(cut.entries[1]).toMatchObject({
      origin: "split",
      titleSource: "split",
      titleSpan: 0,
      start: at + 1,
      end: one.end,
    });
    // A cut made above another takes the first number, and a line that reads
    // as a title is not taken for one: it stays the new row's first line.
    const twice = splitAt(cut, one.key, at, words);
    expect(titles(twice)).toEqual([
      "One",
      "One split 1",
      "One split 2",
      "Two",
      "Three",
    ]);
    expect(textOf(buildDraft(book, twice, words).roots[1])[0]).toBe(
      "A short line",
    );
    // The cuts are named after the row as it is named now.
    expect(
      titles(retitle(rename(twice, one.key, "Uno"), words)).slice(0, 3),
    ).toEqual(["Uno", "Uno split 1", "Uno split 2"]);
    // Joined back, a cut is gone and the numbers close up; with both gone,
    // the plan is the one before the cuts.
    const less = retitle(toggleStart(twice, twice.entries[1].key), words);
    expect(titles(less)).toEqual(["One", "One split 1", "Two", "Three"]);
    expect(retitle(toggleStart(less, less.entries[1].key), words)).toEqual(
      plan,
    );
    // Nowhere to cut at a row's first paragraph, or outside it.
    expect(splitAt(plan, one.key, one.start, words)).toBe(plan);
    expect(splitAt(plan, one.key, one.end, words)).toBe(plan);
  });

  it("numbers a title two nodes would share, in reading order, and never the prose", () => {
    const { book, plan } = run(
      source([
        flow("a", [
          { h: 1, text: "Anna" },
          prose(300),
          { h: 1, text: "Ben" },
          prose(300, 1),
          { h: 1, text: "ANNA" },
          prose(300, 2),
          "* * *",
          prose(300, 3),
        ]),
      ]),
    );
    const named = retitle(plan, words);
    // Told apart as the writer reads them: case is no difference.
    expect(titles(named)).toEqual(["Anna - 1", "Ben", "ANNA - 2"]);
    const draft = buildDraft(book, named, words);
    expect(shape(draft.roots)).toEqual([
      "section:Anna - 1",
      "section:Ben",
      "section:ANNA - 2",
    ]);
    // The text is the book's: the numbers are on the nodes alone.
    expect(textOf(draft.roots[0]).join(" ")).not.toContain(" - 1");
    // Renamed apart, neither needs a number; the stored names stay as typed.
    const renamed = rename(plan, plan.entries[2].key, "Anna, again");
    expect(titles(retitle(renamed, words))).toEqual([
      "Anna",
      "Ben",
      "Anna, again",
    ]);
    // Joined, a row is a line of the text above, keeps its own words there,
    // and makes nobody else's title shared.
    const joined = retitle(toggleStart(plan, plan.entries[2].key), words);
    expect(titles(joined)).toEqual(["Anna", "Ben", "ANNA"]);
    const text = textOf(buildDraft(book, joined, words).roots[1]);
    expect(text).toContain("ANNA");
    // Left out, the same.
    const out = retitle(toggleInclude(plan, plan.entries[0].key), words);
    expect(titles(out)).toEqual(["Anna", "Ben", "ANNA"]);
    // Each scene is named after its numbered chapter, so it says whose it is.
    const scenes = retitle(splitScenes(plan, book, words), words);
    expect(titles(scenes)).toEqual([
      "Anna - 1",
      "Ben",
      "ANNA - 2",
      "ANNA - 2, scene 1",
      "ANNA - 2, scene 2",
    ]);
  });

  it("makes a chapter a Part, which takes the chapters after it, and a Part a Section again", () => {
    const { book, plan } = flat();
    const two = plan.entries[1].key;
    expect(canBe(plan, two, "part", words)).toBe(true);
    const parted = setKind(plan, two, "part", words);
    // A chapter before the first Part is a Part of its own (the root is all
    // Parts); "Three" goes into "Two".
    expect(shape(buildDraft(book, parted, words).roots)).toEqual([
      "part:One",
      { "part:Two": ["section:Three"] },
    ]);
    expect(setKind(parted, two, "section", words)).toEqual(plan);
    // Already what it is asked to be: nothing changes.
    expect(setKind(plan, two, "section", words)).toBe(plan);
  });

  it("refuses a kind no level gives, and says so", () => {
    const { plan } = flat();
    const one = plan.entries[0].key;
    // The first chapter as a Section is a Section: it cannot be a scene of
    // a chapter above it, because there is none.
    const parted = setKind(plan, plan.entries[1].key, "part", words);
    expect(canBe(parted, one, "section", words)).toBe(false);
    expect(setKind(parted, one, "section", words)).toBe(parted);
  });

  it("cuts each chapter at its scene breaks into scenes, and unticked gives the chapters back", () => {
    const { book, plan } = scenic();
    expect(sceneMarks(plan, book)).toEqual({ mark: "* * *", count: 3 });
    const scenes = splitScenes(plan, book, words);
    expect(hasScenes(scenes)).toBe(true);
    // The chapter with breaks is a Part holding its scenes; the others are
    // Parts beside it, holding their own text (siblings are one kind).
    expect(shape(buildDraft(book, scenes, words).roots)).toEqual([
      "part:One",
      {
        "part:Two": [
          "section:Two, scene 1",
          "section:Two, scene 2",
          "section:Two, scene 3",
        ],
      },
      "part:Three",
    ]);
    const two = buildDraft(book, scenes, words).roots[1];
    // The first scene opens on the chapter's title line; an ornament ends
    // the scene before it, so each scene opens on its prose.
    expect(textOf(two.children[0])).toEqual(["Two", prose(200, 1), "* * *"]);
    expect(textOf(two.children[1])[0]).toBe(prose(200, 2));
    expect(sceneMarks(scenes, book)).toEqual({ mark: "* * *", count: 3 });
    // A scene is named after its chapter as the chapter is named now.
    const renamed = rename(scenes, plan.entries[1].key, "Due");
    expect(
      retitle(renamed, words)
        .entries.map((e) => e.title)
        .slice(1, 5),
    ).toEqual(["Due", "Due, scene 1", "Due, scene 2", "Due, scene 3"]);
    // Leaving the chapter out leaves its scenes out with it.
    const out = toggleInclude(scenes, plan.entries[1].key);
    expect(out.entries.slice(1, 5).map((e) => e.included)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    // Unticked, the scenes go and the chapters are as they were.
    expect(unsplitScenes(scenes)).toEqual(plan);
  });

  it("reads blank lines wider than the text's spacing as scene breaks, only when no break is typed", () => {
    const blank = { kind: "para", inlines: [], align: "left", signals: {} };
    const doc = source([
      flow("a", [{ h: 1, text: "One" }, prose(300), { h: 1, text: "Two" }]),
    ]);
    doc.flows[0].blocks.splice(
      2,
      0,
      blank as SourceBlock,
      plainPara(prose(300, 1)),
    );
    doc.flows[0].blocks.push(plainPara(prose(300, 2)));
    const book = prepare(doc, manuscriptText, rules);
    const { plan } = detect(book, "headings", DEFAULT_OPTIONS, words);
    expect(sceneMarks(plan, book)).toEqual({ mark: null, count: 2 });
    const scenes = splitScenes(plan, book, words);
    expect(shape(buildDraft(book, scenes, words).roots)).toEqual([
      { "part:One": ["section:One, scene 1", "section:One, scene 2"] },
      "part:Two",
    ]);
    // The blank line stays, opening the scene it now starts.
    const second = buildDraft(book, scenes, words).roots[0].children[1];
    expect(textOf(second)).toEqual(["", prose(300, 1)]);
    // A book with nothing to cut offers no scenes.
    expect(sceneMarks(flat().plan, flat().book)).toBeNull();
  });

  it("places scenes under their chapter, a chapter under its Part, and a stray scene as a chapter", () => {
    const { book, plan } = scenic();
    const scenes = splitScenes(plan, book, words);
    const placed = layout(unitsOf(scenes, words));
    expect(placed.map((p) => [p.entry.title, p.kind, p.depth])).toEqual([
      ["One", "part", 0],
      ["Two", "part", 0],
      ["Two, scene 1", "section", 1],
      ["Two, scene 2", "section", 1],
      ["Two, scene 3", "section", 1],
      ["Three", "part", 0],
    ]);
    // A scene with no chapter above it stands as one.
    const stray = layout([
      { entry: { ...scenes.entries[2], level: "scene" }, body: [] },
    ]);
    expect(stray.map((p) => [p.kind, p.depth])).toEqual([["section", 0]]);
  });

  it("writes underlining as italic, or plain when the writer unticks it", () => {
    const doc = source([flow("a", [{ h: 1, text: "One" }, prose(300)])]);
    doc.flows[0].blocks.push({
      kind: "para",
      inlines: [{ text: "She said " }, { text: "never", underline: true }],
      align: "left",
      signals: {},
    });
    const book = prepare(doc, manuscriptText, rules);
    const { plan } = detect(book, "auto", DEFAULT_OPTIONS, words);
    const runs = (underlineItalic: boolean) => {
      const { paragraphs } = buildDraft(book, plan, words, {
        underlineItalic,
        comments: true,
      }).roots[0];
      return paragraphs[paragraphs.length - 1].runs.map((r) => r.italic);
    };
    expect(runs(true)).toEqual([false, true]);
    expect(runs(false)).toEqual([false, false]);
  });
});

// ── Any edit, in any order ───────────────────────────────────────────────────

describe("the list's edits, in any order", () => {
  // A seeded walk through every edit the window offers (the tick, the join,
  // the name, the cut, the kind and the scenes) in random order, on books
  // with Parts, with scenes and with neither. Whatever the writer does, the
  // plan stays a plan, the tree keeps the Golden Rule, no word is lost or
  // made up, and the project gets names it can hold, each once.
  it("keeps the plan whole, the tree lawful, every word and every name distinct", () => {
    let seed = 11;
    const random = () =>
      (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const pick = <T>(list: readonly T[]): T =>
      list[Math.floor(random() * list.length)];
    // Names that collide: one differs only by case, one reads as a number.
    const names = ["Anna", "anna ", "Ben", "Anna - 1", "LEV split 1"];
    const books = [() => run(novel()), flat, scenic];
    const kinds = new Map<string, number>();
    for (let trial = 0; trial < 240; trial++) {
      const { book, plan: start } = books[trial % books.length]();
      // The window's way: edits on the plan as stored, shown through `retitle`.
      let base = start;
      for (let step = 0; step < 10; step++) {
        const entry = pick(base.entries);
        const kind = pick([
          "include",
          "join",
          "rename",
          "cut",
          "part",
          "section",
          "scenes",
        ] as const);
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
        if (kind === "include") base = toggleInclude(base, entry.key);
        else if (kind === "join") base = toggleStart(base, entry.key);
        else if (kind === "rename") base = rename(base, entry.key, pick(names));
        else if (kind === "cut") {
          const at =
            entry.start + 1 + Math.floor(random() * (entry.end - entry.start));
          base = splitAt(base, entry.key, at, words);
        } else if (kind === "scenes")
          base = hasScenes(base)
            ? unsplitScenes(base)
            : splitScenes(base, book, words);
        else base = setKind(base, entry.key, kind, words);
      }
      const plan = retitle(base, words);

      // A plan: in order, each entry starting where the last ended, to the
      // end. Only a chapter cut into scenes holds nothing: its scenes, below
      // it, hold its text.
      plan.entries.forEach((entry, i) => {
        if (entry.end === entry.start)
          expect(plan.entries[i + 1]?.origin).toBe("scenes");
        else expect(entry.end).toBeGreaterThan(entry.start);
        if (i > 0) expect(entry.start).toBe(plan.entries[i - 1].end);
      });
      expect(plan.entries[plan.entries.length - 1].end).toBe(
        book.blocks.length,
      );

      // The Golden Rule.
      const draft = buildDraft(book, plan, words);
      expect(() => assertHomogeneous(draft.roots)).not.toThrow();

      // Every word of every row that comes in lands in a text, and no other.
      const wordsIn = (entry: (typeof plan.entries)[number]) => {
        let sum = 0;
        for (let n = entry.start; n < entry.end; n++)
          sum += book.blocks[n].scene ? 0 : book.blocks[n].words;
        return sum;
      };
      const kept = unitsOf(plan, words).reduce(
        (sum, unit) => sum + unitWords(book, unit),
        0,
      );
      expect(kept).toBe(
        plan.entries
          .filter((entry) => entry.included)
          .reduce((sum, entry) => sum + wordsIn(entry), 0),
      );

      // Names the project can hold, and no two alike.
      const titles = preorder(draft.roots).map((node) => node.title);
      for (const title of titles) expect(rules.titleProblem(title)).toBeNull();
      const seen = titles.map((title) => title.trim().toLocaleLowerCase());
      expect(new Set(seen).size).toBe(seen.length);
    }
    // The walk took every road.
    expect(kinds.size).toBe(7);
  });
});
