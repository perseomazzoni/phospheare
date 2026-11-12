// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The export document ──────────────────────────────────────────────────────
//
// The one shape every export format is written from. The assembler
// (`application/assemble.ts`) builds it once from the book as it stands at the
// moment of export; a format writer (`adapters/writers/*`) only serialises it.
// What goes in, in what order and where a page ends is decided here, once;
// how a `.docx` spells a heading is decided in the `.docx` writer alone. A
// writer that has to infer structure (where a chapter ends, which paragraph
// opens a scene) infers it differently from its seven siblings.
//
// It is richer than the manuscript dialect, whose model is paragraphs, two
// heading levels and a page break: References and Notes are general Markdown,
// with lists, quotes, code and links, and they ride in the same document.

import type { LayoutId, PageSizeId } from "./layout";

export type Align = "left" | "center" | "right" | "justify";

export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
  strike?: boolean;
  /** Only http, https or mailto; the parsers drop anything else. */
  href?: string;
}

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type Block =
  | { kind: "heading"; level: HeadingLevel; inlines: Inline[]; align: Align }
  | {
      kind: "paragraph";
      inlines: Inline[];
      align: Align;
      /**
       * The first paragraph of a chapter, or after a heading, a break or a
       * blank line. Book typography sets it flush, with no first-line indent;
       * the manuscript layouts indent it anyway. Only the assembler marks it
       * (`tidy` in `application/assemble.ts`).
       */
      opener?: boolean;
      /**
       * A blank line the writer left between two paragraphs, kept as the pause
       * it is but never indented and never a scene break. `tidy` marks it too.
       */
      blank?: boolean;
    }
  | { kind: "list"; ordered: boolean; start: number; items: Block[][] }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "code"; text: string }
  /** A visible scene break, never an empty paragraph, which readers swallow. */
  | { kind: "sceneBreak" }
  /** A page break the writer put inside the text (`{pagebreak}`). */
  | { kind: "pageBreak" }
  /** The tech page's label/value rows. */
  | { kind: "facts"; rows: [label: string, value: string][] };

export type ChapterKind =
  | "tech"
  | "title"
  | "toc"
  | "part"
  | "section"
  | "group"
  | "reference"
  | "note";

/**
 * The standard manuscript format's first-page furniture: the contact block
 * top-left, the approximate word count top-right, then the title and byline.
 * A novel carries it on a title page of its own (`kind: "title"`), a story on
 * the first page of its text.
 */
export interface Opening {
  contact: string[];
  wordCount: string;
  title: string;
  byline: string;
}

export interface Chapter {
  /** `c1`, `c2` and on; anchors and file names derive from this unique id. */
  id: string;
  kind: ChapterKind;
  /** The heading, or `null` when it carries none, as a merged story scene. */
  title: string | null;
  /** The heading level of `title`, and its depth in a table of contents. */
  level: 1 | 2;
  opening?: Opening;
  /**
   * False for the pages before the text (the tech page, a title page, the
   * contents), which a manuscript does not number and no running head marks.
   */
  numbered: boolean;
  blocks: Block[];
}

export interface ExportMeta {
  /** The book's stable id, from which an EPUB's `dc:identifier` derives. */
  id: string;
  title: string;
  author: string;
  /** BCP-47 base code, such as `en` or `it`. */
  language: string;
  /** Short free-text subject, the genres, for document properties. */
  subject: string;
  /** When the export was made, ISO 8601. */
  exportedAt: string;
  /**
   * The EPUB's schema.org accessibility summary, in the book's language.
   * Reading apps show it in a book's details, so it is a sentence for the
   * book's readers, not for this app's.
   */
  accessibilitySummary: string;
}

// ── Chapter page breaks ──────────────────────────────────────────────────────
//
// Each chapter ends on a page break, except the last. The break is not
// written into `blocks`, where a writer could emit it twice or forget it; it
// is the chapter boundary itself, and every writer turns the boundary into its
// own format's break (a `\page`, a `w:br`, a form feed, a new XHTML file). The
// last chapter has none, because a trailing break is a trailing blank page,
// the most common complaint about export tools.

export interface ExportDocument {
  meta: ExportMeta;
  layout: LayoutId;
  page: PageSizeId;
  /** The "Surname / Title" a running head carries before the page number. */
  runningHeader: string;
  /** The words the page furniture prints, in the writer's language. */
  furniture: {
    /** The review copy's footer lead: "Draft · 1 October 2026". */
    draft: string;
    /** "page {page} of {pages}"; each writer puts its fields in the slots. */
    pageOf: string;
  };
  chapters: Chapter[];
}

/** The plain text of a run of inlines. */
export function plainText(inlines: readonly Inline[]): string {
  return inlines.map((inline) => inline.text).join("");
}

export interface TocEntry {
  id: string;
  title: string;
  level: 1 | 2;
}

/**
 * What a table of contents lists: every chapter of the book's own content
 * that carries a heading. The pages before the text (tech, title, contents)
 * are not entries, because a contents page listing itself is noise.
 */
export function tocEntries(doc: Pick<ExportDocument, "chapters">): TocEntry[] {
  return doc.chapters
    .filter(
      (chapter) =>
        chapter.title !== null &&
        chapter.kind !== "tech" &&
        chapter.kind !== "title" &&
        chapter.kind !== "toc",
    )
    .map((chapter) => ({
      id: chapter.id,
      title: chapter.title ?? "",
      level: chapter.level,
    }));
}
