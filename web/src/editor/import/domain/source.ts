// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { FormatId } from "./formats";

// The general internal structure: what every reader produces, whatever it
// read. Everything after the readers (detection, the preview, the tree, the
// project) reads only this shape, so a new format costs one reader, and the
// write into the app is one piece of code no format knows about.
//
// The shape is richer than the app's prose model. The engine has
// paragraphs, two heading levels and a page break, with bold, italic and
// monospace runs; a reader records more than that (the source's heading
// level, its style name, its font size, whether a paragraph began on a new
// page) because those are the evidence chapter detection runs on. What the
// project cannot hold is folded away later, in one place (`draft`), and
// counted in the report so the writer is told.
//
// Comments are modelled here in full, replies and resolved state included:
// they become the editor's threads in each chapter's margin (`host/seed.ts`).
// They are the margin's comments, never the writer's own notes in the dock.
// Footnotes and endnotes are not modelled at all: the project has no place
// for them, so a reader counts them and keeps them out of the text.

export type Align = "left" | "center" | "right" | "justify";

/**
 * A run of text with its formatting. Underline is kept for the option that
 * reads it as italic.
 */
export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
  underline?: boolean;
}

/**
 * The front and back matter a book carries. A few are pages the app makes
 * for itself and are not imported (`DROPPED_MATTER`); every other one is
 * the writer's text and becomes a Section like any chapter.
 */
export type MatterKind =
  | "titlePage"
  /**
   * The app's own export's first page ("Technical details"): facts, not
   * prose.
   */
  | "techPage"
  | "copyright"
  | "toc"
  | "alsoBy"
  | "dedication"
  | "epigraph"
  | "foreword"
  | "preface"
  | "introduction"
  | "prologue"
  | "epilogue"
  | "afterword"
  | "acknowledgments"
  | "about"
  | "appendix"
  | "glossary"
  | "bibliography"
  | "notes"
  | "index";

/**
 * Pages the project already is, so importing them would duplicate it: the
 * title page (the title and author become the project's own), the contents
 * list (the structure is the contents), the app's own export's facts page
 * and an index whose page numbers point nowhere. Book formatters read a title
 * page the same way and build their own contents.
 */
export const DROPPED_MATTER: ReadonlySet<MatterKind> = new Set<MatterKind>([
  "titlePage",
  "techPage",
  "toc",
  "index",
]);

/** Matter that belongs before the story when it appears at all. */
export const FRONT_MATTER: ReadonlySet<MatterKind> = new Set<MatterKind>([
  "titlePage",
  "techPage",
  "copyright",
  "toc",
  "alsoBy",
  "dedication",
  "epigraph",
  "foreword",
  "preface",
  "introduction",
  "prologue",
]);

/**
 * What a paragraph's source said about it, beyond its text. Evidence, not
 * orders.
 */
export interface Signals {
  /** 1–6 from a real heading (a heading style, `<h2>`, `text:h`, `##`). */
  headingLevel?: number;
  /** The source's own style name ("Heading 1", "Chapter Title", "Emphasis"). */
  styleName?: string;
  /** The book's title or subtitle line, a contents entry, or matter. */
  role?: "title" | "subtitle" | "toc" | MatterKind;
  /** The paragraph begins on a new page. */
  breakBefore?: boolean;
  /** The paragraph's font size in points, when the source says. */
  fontSizePt?: number;
  /** Set in capitals by the source's formatting (not by the letters typed). */
  allCaps?: boolean;
  /** What the paragraph was before the move flattened it. */
  origin?: "list" | "quote" | "table" | "code";
}

export type SourceBlock =
  | { kind: "para"; inlines: Inline[]; align: Align; signals: Signals }
  /** An explicit page break standing between paragraphs. */
  | { kind: "pageBreak" }
  /** A structural thematic break: `<hr>`, Markdown's `---`. */
  | { kind: "rule" };

export type ParaBlock = Extract<SourceBlock, { kind: "para" }>;

/** One file, or one spine item of an epub, in reading order. */
export interface SourceFlow {
  /** The file's or spine item's name, for the report and the files rule. */
  name: string;
  /** The title an epub nav gives this flow, when it has one. */
  navTitle?: string;
  /** What the package says this flow is (epub `epub:type`). */
  role?: MatterKind;
  /** False for an epub spine item marked `linear="no"`, left out by default. */
  linear?: boolean;
  blocks: SourceBlock[];
}

/** A place in a flow: the block, and a character offset into its text. */
export interface BlockPoint {
  block: number;
  offset: number;
}

export interface ImportedCommentAnchor {
  flow: number;
  start: BlockPoint;
  end: BlockPoint;
}

/**
 * A comment and its replies, as the source wrote them. The anchor is a range
 * in the source so it can span paragraphs; `draft` remaps it onto the final
 * text as a quote with its context, and the seed finds that quote again in
 * the chapter as the editor shows it and writes the chapter's comments file.
 */
export interface ImportedComment {
  /** The source's own id, so replies can find their thread. */
  sourceId: string;
  /** Null when the comment's place is not found (a dangling reference). */
  anchor: ImportedCommentAnchor | null;
  /** One entry per paragraph of the comment. */
  body: Inline[][];
  author?: string;
  initials?: string;
  date?: string;
  /** The comment this one answers. */
  parentId?: string;
  resolved?: boolean;
}

/** Everything a reader counts on the way through, for the report. */
export type ReportKey =
  | "italic"
  | "bold"
  | "underline"
  | "footnotes"
  | "endnotes"
  | "comments"
  | "replies"
  | "trackedChanges"
  | "images"
  | "tables"
  | "lists"
  | "quotes"
  | "links"
  | "strike"
  | "textBoxes"
  | "hiddenText";

export type ReadReport = Partial<Record<ReportKey, number>>;

/** Adds `n` to a counter. Readers count as they go, nothing twice. */
export function bump(report: ReadReport, key: ReportKey, n = 1): void {
  if (n > 0) report[key] = (report[key] ?? 0) + n;
}

/** Two reports, summed: one per file of a multi-file import. */
export function mergeReports(into: ReadReport, from: ReadReport): ReadReport {
  for (const [key, n] of Object.entries(from) as [ReportKey, number][])
    bump(into, key, n);
  return into;
}

export interface SourceMeta {
  title?: string;
  author?: string;
  /** A BCP 47 tag as the source states it ("en-GB", "it"). */
  language?: string;
}

export interface SourceDocument {
  formats: FormatId[];
  meta: SourceMeta;
  flows: SourceFlow[];
  comments: ImportedComment[];
  report: ReadReport;
}

/**
 * A paragraph's text, its runs joined: what offsets and counts are measured
 * on.
 */
export function blockText(block: SourceBlock): string {
  return block.kind === "para"
    ? block.inlines.map((inline) => inline.text).join("")
    : "";
}

/** A paragraph with the given text and nothing else said about it. */
export function plainPara(
  text: string,
  signals: Signals = {},
  align: Align = "left",
): ParaBlock {
  return { kind: "para", inlines: text ? [{ text }] : [], align, signals };
}

/** An empty document a reader fills in. */
export function emptySource(format: FormatId): SourceDocument {
  return { formats: [format], meta: {}, flows: [], comments: [], report: {} };
}
