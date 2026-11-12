// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { titleProblem } from "../../project/naming";
import { countWords } from "../../project/stats";
import { TYPE_GOAL_DEFAULTS, typeForWords } from "../../project/types";
import type { FormatId as ExportFormat } from "../export/domain/formats";
import type { Block, Chapter, ExportDocument } from "../export/domain/model";
import { loadWriter } from "../export/adapters/writers";
import { manuscriptText } from "./adapters/manuscriptText";
import { loadReader } from "./adapters/readers";
import { probeZip } from "./adapters/zip";
import { readFile } from "./application/readFiles";
import { prepare } from "./application/prepare";
import { detect } from "./application/detect";
import { buildDraft } from "./application/draft";
import { preorder, type DraftParagraph } from "./domain/draft";
import { DEFAULT_OPTIONS } from "./domain/plan";
import type { ProjectRules, TitleWords } from "./ports";

// Pins export against import. A book written by every export writer and read
// back by the import comes home with its Parts and chapters in order and
// titled as they were, its paragraphs word for word, and its italics and bold
// where they stood. Exporting a draft and importing the edited file back is
// the commonest import, and it must never lose a chapter.
//
// The book is shaped as the assembler shapes a real export: a technical page
// and a contents page first (matter the import leaves out), then a Part with
// its own epigraph, then its chapters, two of them called "Anna" because
// titles are free, and a closing chapter outside any Part's text.

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

const SENTENCES = [
  "The rain had not stopped since the ferry left the harbour at dawn.",
  "Nobody on the quay remembered her name, and she did not offer it.",
  "By noon the town had closed its shutters against the coming storm.",
  "She counted the lamps along the sea wall and lost the count twice.",
];

const para = (text: string, opener = false): Block => ({
  kind: "paragraph",
  inlines: [{ text }],
  align: "left",
  ...(opener ? { opener } : {}),
});

const RICH: Block = {
  kind: "paragraph",
  align: "left",
  inlines: [
    { text: "She whispered " },
    { text: "never again", italic: true },
    { text: " and meant it with her " },
    { text: "whole heart", bold: true },
    { text: "." },
  ],
};

/** A chapter of a few hundred words: the rich paragraph, then plain prose. */
const chapterBody = (seed: number): Block[] => [
  para(SENTENCES[seed % 4], true),
  RICH,
  ...Array.from({ length: 24 }, (_, i) => para(SENTENCES[(seed + i) % 4])),
];

const CHAPTERS: [title: string, kind: "part" | "section"][] = [
  ["Part One", "part"],
  ["Anna", "section"],
  ["Chapter 1: The Storm", "section"],
  ["Anna", "section"],
];

function book(): ExportDocument {
  const chapters: Omit<Chapter, "id">[] = [
    {
      kind: "tech",
      title: "Technical details",
      level: 1,
      numbered: false,
      blocks: [
        {
          kind: "facts",
          rows: [
            ["Title", "The Harbour"],
            ["Words", "1,600"],
          ],
        },
      ],
    },
    { kind: "toc", title: "Contents", level: 1, numbered: false, blocks: [] },
    ...CHAPTERS.map(([title, kind], index): Omit<Chapter, "id"> =>
      kind === "part"
        ? {
            kind,
            title,
            level: 1,
            numbered: true,
            blocks: [para("For the ones who stayed.", true)],
          }
        : {
            kind,
            title,
            level: 2,
            numbered: true,
            blocks: chapterBody(index),
          },
    ),
  ];
  return {
    meta: {
      id: "3F2504E0-4F89-11D3-9A0C-0305E82C3301",
      title: "The Harbour",
      author: "Ann Writer",
      language: "en",
      subject: "",
      exportedAt: "2026-10-04T10:00:00.000Z",
      accessibilitySummary: "Text only.",
    },
    layout: "book",
    page: "a4",
    runningHeader: "Writer / The Harbour",
    furniture: { draft: "Draft", pageOf: "page {page} of {pages}" },
    chapters: chapters.map((chapter, index) => ({
      ...chapter,
      id: `c${index + 1}`,
    })),
  };
}

const ctx = { yield: async () => undefined };
const noFont = async () => new Uint8Array();

async function roundTrip(format: ExportFormat) {
  const writer = await loadWriter(format, noFont);
  const bytes = await writer.write(book());
  const name = `the-harbour.${format}`;
  const result = await readFile(
    { name, size: bytes.length, bytes: async () => bytes },
    { load: loadReader, probe: probeZip },
    ctx,
  );
  if (result.status !== "ok")
    throw new Error(`${format}: refused (${result.reason})`);
  const prepared = prepare(result.doc, manuscriptText, rules);
  const { plan } = detect(prepared, "auto", DEFAULT_OPTIONS, words);
  return { draft: buildDraft(prepared, plan, words), plan };
}

const textOf = (p: DraftParagraph) => p.runs.map((run) => run.text).join("");

const FORMATS: ExportFormat[] = [
  "docx",
  "odt",
  "rtf",
  "epub",
  "html",
  "md",
  "txt",
];

describe("export → import, through every writer", () => {
  it.each(FORMATS)(
    "%s comes home with its chapters, text and emphasis",
    async (format) => {
      const { draft } = await roundTrip(format);
      const nodes = preorder(draft.roots);

      // The chapters, in order, titled as they were, both "Anna"s included.
      expect(nodes.map((node) => node.title)).toEqual(
        CHAPTERS.map(([title]) => title),
      );
      expect(draft.roots).toHaveLength(1);
      expect(draft.roots[0].kind).toBe("part");

      // The Part's own text: its heading line, kept as the writer's file
      // has it (nothing the import reads is left out), then its epigraph.
      expect(nodes[0].paragraphs.map(textOf)).toEqual([
        "Part One",
        "For the ones who stayed.",
      ]);

      // Every chapter's paragraphs, word for word.
      CHAPTERS.forEach(([, kind], index) => {
        if (kind !== "section") return;
        const expected = [
          CHAPTERS[index][0],
          ...chapterBody(index).map((block) =>
            block.kind === "paragraph"
              ? block.inlines.map((inline) => inline.text).join("")
              : "",
          ),
        ];
        expect(nodes[index].paragraphs.map(textOf)).toEqual(expected);
      });

      // Emphasis where it stood (plain text carries none of its own).
      if (format === "txt") return;
      const rich = nodes[1].paragraphs[2].runs;
      expect(rich.find((run) => run.text === "never again")).toMatchObject({
        italic: true,
      });
      expect(rich.find((run) => run.text === "whole heart")).toMatchObject({
        bold: true,
      });
    },
  );
});
