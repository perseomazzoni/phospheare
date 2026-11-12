// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── Assembling the book for export ───────────────────────────────────────────
//
// The one piece of the export every format shares: it reads the book
// as its files hold it now and lays it out as chapters. Everything a reader of
// the file notices about order and pages is decided here, once:
//
//   1. the tech page, when ticked, always first;
//   2. a manuscript title page, for a novel in standard manuscript format;
//   3. the contents, when ticked, and always in an EPUB;
//   4. the ticked Parts and Sections, in the structure's order;
//   5. the ticked references, by group;
//   6. the ticked notes.
//
// Every chapter ends on a page break except the last (`model.ts`). The one
// exception the writer can ask for: a story in a manuscript layout with the
// `shunn` separator runs its scenes on with a centred `#` between them, as
// standard manuscript format sets a story.

import {
  REFERENCE_GROUP_ORDER,
  exportGroupOf,
  type BookFacts,
  type ReferenceEntry,
} from "../domain/book";
import { FORMATS, tocRequired, type FormatId } from "../domain/formats";
import {
  LAYOUTS,
  manuscriptVariant,
  roundWordCount,
  type LayoutId,
  type PageSizeId,
} from "../domain/layout";
import {
  plainText,
  tocEntries,
  type Block,
  type Chapter,
  type HeadingLevel,
  type ExportDocument,
  type Opening,
} from "../domain/model";
import type { ExportLabels, ExportSource, Parsers } from "../ports";

export type StorySeparator = "shunn" | "pageBreak";

export interface Selection {
  /** Part and Section ids. */
  manuscript: ReadonlySet<string>;
  /** Reference file names. */
  references: ReadonlySet<string>;
  /** Note file names. */
  notes: ReadonlySet<string>;
}

export interface ExportRequest {
  format: FormatId;
  /** Read only for a paged format; a reflowing one is always set as a book. */
  layout: LayoutId;
  page: PageSizeId;
  techPage: boolean;
  toc: boolean;
  selection: Selection;
  author: string;
  /** The manuscript's contact block, one line per line. */
  contact: string;
  runningHeader: string;
  storySeparator: StorySeparator;
}

export async function assembleExport(
  source: ExportSource,
  parsers: Parsers,
  request: ExportRequest,
  labels: ExportLabels,
  now: Date,
): Promise<ExportDocument> {
  const book = source.book();
  const author = request.author.trim();
  const layoutId: LayoutId = FORMATS[request.format].paged
    ? request.layout
    : "book";
  const layout = LAYOUTS[layoutId];

  // The book's own content first, and only then the pages about it: the tech
  // page says what went in, which is what assembled. A ticked template that
  // turned out empty is not "References" on the tech page.
  const manuscript = await manuscriptChapters(
    source,
    parsers,
    request,
    layout.manuscript && manuscriptVariant(book.type) === "story"
      ? request.storySeparator
      : "pageBreak",
  );

  const entries =
    request.selection.references.size + request.selection.notes.size > 0
      ? await source.references()
      : [];
  const references: Chapter[] = [];
  for (const group of REFERENCE_GROUP_ORDER)
    references.push(
      ...(await referenceChapters(
        source,
        parsers,
        entries.filter(
          (entry) =>
            exportGroupOf(entry.group) === group &&
            request.selection.references.has(entry.fileName),
        ),
        "reference",
        // The shelf's own words for its groups, so an export's headings say
        // what the shelf says.
        labels.t(`reference.group.${group}`),
      )),
    );
  const notes = await referenceChapters(
    source,
    parsers,
    entries.filter(
      (entry) =>
        entry.group === "notes" && request.selection.notes.has(entry.fileName),
    ),
    "note",
    labels.t("reference.group.notes"),
  );

  const front: Chapter[] = [];
  if (request.techPage)
    front.push({
      id: "",
      kind: "tech",
      title: labels.t("export.tech.heading"),
      level: 1,
      numbered: false,
      blocks: [
        {
          kind: "facts",
          rows: techRows(
            book,
            author,
            manuscript,
            { references: references.length > 0, notes: notes.length > 0 },
            request,
            layoutId,
            labels,
            now,
          ),
        },
      ],
    });

  // The manuscript's first page. A novel gets it on a page of its own and its
  // text starts on the next; a story carries it above its own first lines.
  if (layout.manuscript && manuscript.chapters.length > 0) {
    const opening = openingOf(
      book,
      author,
      request.contact,
      manuscript.words,
      labels,
    );
    if (manuscriptVariant(book.type) === "novel")
      front.push({
        id: "",
        kind: "title",
        title: null,
        level: 1,
        numbered: false,
        opening,
        blocks: [],
      });
    else manuscript.chapters[0].opening = opening;
    // Standard manuscript format closes the text with a centred end line.
    manuscript.chapters[manuscript.chapters.length - 1].blocks.push({
      kind: "paragraph",
      inlines: [{ text: labels.t("export.manuscript.end") }],
      align: "center",
    });
  }

  const body = [...manuscript.chapters, ...references, ...notes];
  // A contents page with nothing on it is a blank page with a heading, as for
  // a story run on under the `shunn` separator, which has no titled chapters.
  // Paged formats drop it then. An EPUB keeps its contents, which its reading
  // system needs and which falls back to the book's own title.
  const toc =
    tocRequired(request.format) ||
    (request.toc && tocEntries({ chapters: body }).length > 0);
  if (toc)
    front.push({
      id: "",
      kind: "toc",
      title: labels.t("export.toc.heading"),
      level: 1,
      numbered: false,
      blocks: [],
    });

  const chapters = [...front, ...body];
  chapters.forEach((chapter, index) => {
    // Numbered in reading order, once everything is in place.
    chapter.id = `c${index + 1}`;
    chapter.blocks = tidy(nestHeadings(chapter.blocks, chapter.level));
  });

  return {
    meta: {
      id: book.id,
      title: book.title,
      author,
      language: book.language,
      subject: book.genres.join(", "),
      exportedAt: now.toISOString(),
      accessibilitySummary: labels.t("export.epub.accessibilitySummary"),
    },
    layout: layoutId,
    page: request.page,
    runningHeader: request.runningHeader.trim(),
    furniture: {
      draft: labels.t("export.furniture.draft", {
        date: labels.date(now.toISOString()),
      }),
      // The slots stay literal: each writer fills them with its own fields.
      pageOf: labels.t("export.furniture.pageOf", {
        page: "{page}",
        pages: "{pages}",
      }),
    },
    chapters,
  };
}

// ── The manuscript ───────────────────────────────────────────────────────────

interface Manuscript {
  chapters: Chapter[];
  words: number;
  parts: number;
  sections: number;
}

async function manuscriptChapters(
  source: ExportSource,
  parsers: Parsers,
  request: ExportRequest,
  separator: StorySeparator,
): Promise<Manuscript> {
  const out: Manuscript = { chapters: [], words: 0, parts: 0, sections: 0 };
  const picked = request.selection.manuscript;

  const read = async (id: string, title: string) => {
    const { text, words } = await source.readNode(id);
    out.words += words;
    return withoutEchoedTitle(parsers.manuscript.parse(text), title);
  };

  const visit = async (
    nodes: ReturnType<ExportSource["manuscript"]>,
    underPart: boolean,
  ): Promise<void> => {
    // The chapter consecutive scenes run on into, under the `shunn`
    // separator. A Part closes it, because a Part always begins a page.
    let running: Chapter | null = null;
    for (const node of nodes) {
      if (node.kind === "part") {
        running = null;
        const included = picked.has(node.id);
        if (included) {
          out.parts += 1;
          out.chapters.push({
            id: "",
            kind: "part",
            title: node.title,
            level: 1,
            numbered: true,
            blocks: await read(node.id, node.title),
          });
        }
        await visit(node.children, included);
        continue;
      }
      if (!picked.has(node.id)) continue;
      out.sections += 1;
      const blocks = await read(node.id, node.title);
      if (separator === "shunn") {
        if (running) running.blocks.push({ kind: "sceneBreak" }, ...blocks);
        else {
          // A story's scenes carry no headings of their own in standard
          // manuscript format; the story's title is on its first page.
          running = {
            id: "",
            kind: "section",
            title: null,
            level: underPart ? 2 : 1,
            numbered: true,
            blocks,
          };
          out.chapters.push(running);
        }
        continue;
      }
      out.chapters.push({
        id: "",
        kind: "section",
        title: node.title,
        level: underPart ? 2 : 1,
        numbered: true,
        blocks,
      });
    }
  };

  await visit(source.manuscript(), false);
  return out;
}

/**
 * Drops the chapter's first heading when it says what the node's title says.
 * A writer who typed the title as the first line would otherwise see it twice,
 * once as the export's heading and once as their own.
 */
function withoutEchoedTitle(blocks: Block[], title: string): Block[] {
  const first = blocks[0];
  if (
    first?.kind === "heading" &&
    normalise(plainText(first.inlines)) === normalise(title)
  )
    return blocks.slice(1);
  return blocks;
}

const normalise = (text: string) => text.trim().toLocaleLowerCase();

// ── References and notes ─────────────────────────────────────────────────────

async function referenceChapters(
  source: ExportSource,
  parsers: Parsers,
  entries: readonly ReferenceEntry[],
  kind: "reference" | "note",
  groupTitle: string,
): Promise<Chapter[]> {
  const docs: Chapter[] = [];
  for (const entry of entries) {
    const blocks = parsers.markdown.parse(
      await source.readReference(entry.fileName),
    );
    // A document the template made and the writer never filled has nothing
    // left once its hints and questions are gone, and an empty page is not a
    // reference.
    if (!blocks.some(hasContent)) continue;
    // Templates open with their own `# Title`. It becomes the chapter's
    // heading rather than a second one under it; the document's other
    // headings nest under it (`nestHeadings`).
    const first = blocks[0];
    const lifted = first.kind === "heading" && first.level === 1;
    docs.push({
      id: "",
      kind,
      title: lifted ? plainText(first.inlines) : entry.title,
      level: 2,
      numbered: true,
      blocks: lifted ? blocks.slice(1) : blocks,
    });
  }
  if (docs.length === 0) return [];
  return [
    {
      id: "",
      kind: "group",
      title: groupTitle,
      level: 1,
      numbered: true,
      blocks: [],
    },
    ...docs,
  ];
}

function hasContent(block: Block): boolean {
  switch (block.kind) {
    case "heading":
    case "paragraph":
      return plainText(block.inlines).trim() !== "";
    case "list":
      return block.items.some((item) => item.some(hasContent));
    case "quote":
      return block.blocks.some(hasContent);
    case "code":
      return block.text.trim() !== "";
    case "facts":
      return block.rows.length > 0;
    case "sceneBreak":
    case "pageBreak":
      return false;
  }
}

/**
 * Nests a chapter's own headings under its title: the shallowest becomes one
 * level below the chapter heading and the rest keep their distance from it,
 * capped at six. Otherwise a Section titled at level 2 whose text opens with
 * an `h1` puts a level-1 heading inside a level-2 chapter, which a table of
 * contents, a screen reader and an EPUB's outline all read as a new chapter.
 */
export function nestHeadings(blocks: Block[], chapterLevel: number): Block[] {
  let shallowest = Infinity;
  const scan = (list: Block[]) => {
    for (const block of list) {
      if (block.kind === "heading")
        shallowest = Math.min(shallowest, block.level);
      else if (block.kind === "quote") scan(block.blocks);
      else if (block.kind === "list") block.items.forEach(scan);
    }
  };
  scan(blocks);
  const shift = shallowest === Infinity ? 0 : chapterLevel + 1 - shallowest;
  if (shift <= 0) return blocks;
  const nest = (list: Block[]): Block[] =>
    list.map((block) => {
      if (block.kind === "heading")
        return {
          ...block,
          level: Math.min(6, block.level + shift) as HeadingLevel,
        };
      if (block.kind === "quote")
        return { ...block, blocks: nest(block.blocks) };
      if (block.kind === "list")
        return { ...block, items: block.items.map(nest) };
      return block;
    });
  return nest(blocks);
}

// ── The tidy every chapter gets ──────────────────────────────────────────────

/**
 * Drops whitespace at a chapter's edges, because the chapter boundary is
 * already a page break and a second one is a blank page, and collapses runs
 * to one. That covers the writer's own page and scene breaks and their empty
 * paragraphs alike: an empty paragraph is kept between two others, as the
 * blank line the writer left, but never doubled and never beside a break.
 *
 * Then it marks the paragraphs, so no writer decides either thing again: the
 * blank lines kept (`blank`), and the openers, which book typography sets
 * flush: the chapter's first paragraph and the first after a heading, a break
 * or a blank line.
 */
function tidy(blocks: Block[]): Block[] {
  const isBreak = (block: Block) =>
    block.kind === "pageBreak" || block.kind === "sceneBreak";
  const isBlank = (block: Block) =>
    block.kind === "paragraph" && plainText(block.inlines).trim() === "";
  const isSpace = (block: Block) => isBreak(block) || isBlank(block);
  const kept: Block[] = [];
  for (const block of blocks) {
    if (isSpace(block)) {
      if (kept.length === 0) continue;
      const last = kept[kept.length - 1];
      if (isSpace(last)) {
        // The stronger of two neighbours wins: a page break over a scene
        // break over a blank line.
        if (rank(block) > rank(last)) kept[kept.length - 1] = block;
        continue;
      }
    }
    kept.push(block);
  }
  while (kept.length > 0 && isSpace(kept[kept.length - 1])) kept.pop();

  let opens = true;
  return kept.map((block) => {
    if (block.kind === "paragraph" && isBlank(block)) {
      opens = true;
      return { ...block, blank: true };
    }
    if (block.kind === "paragraph") {
      const marked = opens ? { ...block, opener: true } : block;
      opens = false;
      return marked;
    }
    opens = block.kind === "heading" || isSpace(block);
    return block;
  });
}

function rank(block: Block): number {
  return block.kind === "pageBreak" ? 3 : block.kind === "sceneBreak" ? 2 : 1;
}

// ── Tech page and first page ─────────────────────────────────────────────────

function techRows(
  book: BookFacts,
  author: string,
  manuscript: Manuscript,
  assembled: { references: boolean; notes: boolean },
  request: ExportRequest,
  layout: LayoutId,
  labels: ExportLabels,
  now: Date,
): [string, string][] {
  const { t } = labels;
  const hasText = manuscript.chapters.length > 0;
  // What the file holds, not what was ticked.
  const contents = [
    hasText ? t("export.include.manuscript") : "",
    assembled.references ? t("export.include.references") : "",
    assembled.notes ? t("export.include.notes") : "",
  ].filter(Boolean);
  const rows: [string, string][] = [
    [t("export.tech.title"), book.title],
    [t("export.tech.author"), author],
    [t("export.tech.type"), book.type],
    [t("export.tech.genres"), book.genres.join(", ")],
    [t("export.tech.ageCategory"), book.ageCategory ?? ""],
    [t("export.tech.tropes"), book.tropes.join(", ")],
    [t("export.tech.language"), book.languageLabel],
    [t("export.tech.structure"), book.structure ?? ""],
    [t("export.tech.words"), hasText ? labels.number(manuscript.words) : ""],
    [t("export.tech.parts"), hasText ? labels.number(manuscript.parts) : ""],
    [
      t("export.tech.sections"),
      hasText ? labels.number(manuscript.sections) : "",
    ],
    [
      t("export.tech.created"),
      book.createdAt ? labels.date(book.createdAt) : "",
    ],
    [
      t("export.tech.updated"),
      book.updatedAt ? labels.date(book.updatedAt) : "",
    ],
    [t("export.tech.exported"), labels.date(now.toISOString())],
    [t("export.tech.contents"), contents.join(", ")],
    [t("export.tech.format"), t(`export.format.${request.format}.name`)],
    [
      t("export.tech.layout"),
      FORMATS[request.format].paged ? t(`export.layout.${layout}.name`) : "",
    ],
  ];
  // A fact the book does not have is left out, never printed as a blank.
  return rows.filter(([, value]) => value.trim() !== "");
}

function openingOf(
  book: BookFacts,
  author: string,
  contact: string,
  words: number,
  labels: ExportLabels,
): Opening {
  const lines = contact
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    // The contact block opens with the writer's name; with nothing typed,
    // the author's name is the least it can say.
    contact: lines.length > 0 ? lines : author ? [author] : [],
    // Nothing to count says nothing: "about 0 words" on a cover page is a
    // number no writer wrote.
    wordCount:
      words > 0
        ? labels.t("export.manuscript.about", {
            count: labels.number(roundWordCount(words, book.type)),
          })
        : "",
    title: book.title,
    byline: author ? labels.t("export.manuscript.byline", { author }) : "",
  };
}
