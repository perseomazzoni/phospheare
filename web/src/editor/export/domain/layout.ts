// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── Layouts and page sizes ───────────────────────────────────────────────────
//
// A layout is a table row, not a code path. Every paged writer (DOCX,
// ODT, RTF, PDF) and the HTML and EPUB stylesheets read the same row, so a
// "Book" page set in a word processor and in a PDF agree on size, spacing and
// indent because they read one number, not because two files are kept in
// step. A new layout is one more row.
//
// All lengths are in points (1in = 72pt). Each writer converts to its own
// unit (twips, half-points, inches) at the moment it writes.

export const LAYOUT_IDS = [
  "book",
  "manuscriptModern",
  "manuscriptClassic",
  "review",
] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];

export const PAGE_SIZE_IDS = ["a4", "letter", "trade", "digest"] as const;
export type PageSizeId = (typeof PAGE_SIZE_IDS)[number];

export interface PageSize {
  width: number;
  height: number;
  /**
   * A book trim size (6×9, 5×8) rather than a sheet of paper. Book pages on a
   * trim face each other, so their margins mirror: the wider one goes to the
   * spine.
   */
  trim: boolean;
}

export const PAGE_SIZES: Record<PageSizeId, PageSize> = {
  a4: { width: 595.28, height: 841.89, trim: false },
  letter: { width: 612, height: 792, trim: false },
  trade: { width: 432, height: 648, trim: true },
  digest: { width: 360, height: 576, trim: true },
};

/** Inner is the spine side; unmirrored, inner is left and outer right. */
export interface Margins {
  top: number;
  bottom: number;
  inner: number;
  outer: number;
  mirrored: boolean;
}

/**
 * The faces a layout sets its text in.
 *
 * Office documents name a font and trust the reader's machine to have it, so
 * they name one every machine has. A PDF embeds its font, so it carries an OFL
 * face whose metrics match that name (Tinos for Times New Roman, Cousine for
 * Courier New), or the app's own serif for the book.
 */
export type FontId = "newsreader" | "tinos" | "courierPrime" | "cousine";

export interface FontSpec {
  /** The family registered with the PDF writer, and the stem of its files. */
  pdf: string;
  /** The family an office document (DOCX, ODT, RTF) names. */
  office: string;
  /** A CSS font stack for HTML and EPUB. */
  css: string;
}

export const FONTS: Record<FontId, FontSpec> = {
  newsreader: {
    pdf: "Newsreader",
    office: "Georgia",
    css: `"Newsreader", Georgia, "Times New Roman", serif`,
  },
  tinos: {
    pdf: "Tinos",
    office: "Times New Roman",
    css: `"Times New Roman", Tinos, Times, serif`,
  },
  courierPrime: {
    pdf: "CourierPrime",
    office: "Courier New",
    css: `"Courier New", "Courier Prime", Courier, monospace`,
  },
  cousine: {
    pdf: "Cousine",
    office: "Courier New",
    css: `"Courier New", Cousine, Courier, monospace`,
  },
};

/** The face code and monospace runs are set in, under every layout. */
export const MONO_FONT: FontId = "cousine";

export interface LayoutSpec {
  /** The standard manuscript format's rules: title furniture, `#`, END. */
  manuscript: boolean;
  font: FontId;
  /** Body size, pt. */
  size: number;
  /** Line height as a multiple of the size: 2 is double spacing. */
  lineHeight: number;
  /** First-line indent, pt. */
  indent: number;
  /** Whether a chapter's or scene's first paragraph is indented too. */
  indentOpeners: boolean;
  /**
   * Whether a paragraph the writer justified stays justified. Standard
   * manuscript format is ragged right, so there it becomes left; centre and
   * right are the writer's meaning and always survive.
   */
  keepJustify: boolean;
  /** What a scene break prints. Never empty: an empty line is swallowed. */
  sceneGlyph: string;
  /** How far down the text block a chapter heading starts, as a fraction. */
  chapterDrop: number;
  /** A running head ("Surname / Title / n") on numbered pages. */
  runningHead: boolean;
  /** Page numbers in the footer, the review copy's draft line, or nothing. */
  footer: "page" | "draft" | "none";
  /** Line numbers in the margin, for a reader commenting by line. */
  lineNumbers: boolean;
  margins: (page: PageSize) => Margins;
}

const INCH = 72;

/** One inch all round, unmirrored: the manuscript's page on any paper. */
const inchAllRound = (): Margins => ({
  top: INCH,
  bottom: INCH,
  inner: INCH,
  outer: INCH,
  mirrored: false,
});

/**
 * A book's page. On paper it is an even inch; on a trim the spine side takes
 * the wider margin so the text clears the gutter. Print-on-demand services
 * ask for at least 0.375″ inside on a short book, and these sit above it.
 */
const bookMargins = (page: PageSize): Margins =>
  page.trim
    ? {
        top: 0.6 * INCH,
        bottom: 0.6 * INCH,
        inner: page.width <= 360 ? 0.7 * INCH : 0.75 * INCH,
        outer: page.width <= 360 ? 0.45 * INCH : 0.5 * INCH,
        mirrored: true,
      }
    : inchAllRound();

const manuscript = (font: FontId): LayoutSpec => ({
  manuscript: true,
  font,
  size: 12,
  lineHeight: 2,
  indent: 0.5 * INCH,
  indentOpeners: true,
  keepJustify: false,
  sceneGlyph: "#",
  chapterDrop: 1 / 3,
  runningHead: true,
  footer: "none",
  lineNumbers: false,
  margins: inchAllRound,
});

export const LAYOUTS: Record<LayoutId, LayoutSpec> = {
  book: {
    manuscript: false,
    font: "newsreader",
    size: 11,
    lineHeight: 1.35,
    indent: 1.5 * 11,
    indentOpeners: false,
    keepJustify: true,
    sceneGlyph: "*   *   *",
    chapterDrop: 0.2,
    runningHead: false,
    footer: "page",
    lineNumbers: false,
    margins: bookMargins,
  },
  manuscriptModern: manuscript("tinos"),
  manuscriptClassic: manuscript("courierPrime"),
  review: {
    manuscript: false,
    font: "tinos",
    size: 12,
    lineHeight: 1.5,
    indent: 0.5 * INCH,
    indentOpeners: false,
    keepJustify: false,
    sceneGlyph: "#",
    chapterDrop: 0.15,
    runningHead: false,
    footer: "draft",
    lineNumbers: true,
    // The outer margin is the reader's room to write in, on the right of
    // every page; unmirrored, so a printed stack reads the same way.
    margins: (page) => ({
      top: INCH,
      bottom: INCH,
      inner: page.trim ? 0.6 * INCH : INCH,
      outer: Math.round(page.width * 0.3),
      mirrored: false,
    }),
  },
};

// ── Story or novel ───────────────────────────────────────────────────────────
//
// Standard manuscript format's two shapes. The book's declared type decides,
// never a word count: a writer who called it a novella meant it. A novella
// goes with the stories, whose rules round its count to 500. A custom
// ("Other") type falls to the novel shape, the one that cannot lose anything:
// every chapter on its own page.

const STORY_TYPES = new Set(["Short Story", "Flash Fiction", "Novella"]);

export type ManuscriptVariant = "story" | "novel";

export function manuscriptVariant(type: string): ManuscriptVariant {
  return STORY_TYPES.has(type) ? "story" : "novel";
}

/**
 * The "about N words" a manuscript's first page carries: to the nearest 100
 * for a story, 500 for a novella, 1,000 for a novel. A count smaller than its
 * step rounds to the nearest ten instead, so a 400-word flash piece is not
 * announced as "about 1,000 words". Under a hundred words the count is the
 * count, since "about 10 words" for a four-word page is a number nobody
 * wrote. Zero is zero, and the assembler then prints no count at all.
 */
export function roundWordCount(words: number, type: string): number {
  if (words <= 0) return 0;
  if (words < 100) return words;
  const step =
    type === "Novella" ? 500 : manuscriptVariant(type) === "story" ? 100 : 1000;
  if (words < step) return Math.round(words / 10) * 10;
  return Math.round(words / step) * step;
}

/**
 * The manuscript's running head, less the page number every writer adds: the
 * author's surname, then the title, as "Lovelace / Salt Roads". The export
 * window offers it and the writer may change it.
 */
export function runningHeaderFor(author: string, title: string): string {
  const surname = author.trim().split(/\s+/).pop() ?? "";
  return [surname, title.trim()].filter(Boolean).join(" / ");
}

/** The writer's locale's likely paper: Letter where Letter is the paper. */
export function defaultPageSize(locale: string): PageSizeId {
  return /^(en-US|en-CA|es-MX|fr-CA)$/i.test(locale) ? "letter" : "a4";
}

/**
 * The alignment a paragraph is set with under a layout: the writer's own,
 * except that a layout that is ragged right by rule (the manuscripts, the
 * review copy) sets a justified paragraph left.
 */
export function alignFor(
  align: "left" | "center" | "right" | "justify",
  layout: LayoutSpec,
): "left" | "center" | "right" | "justify" {
  return align === "justify" && !layout.keepJustify ? "left" : align;
}

// ── Headings ─────────────────────────────────────────────────────────────────
//
// How each heading level is set. Every paged writer and the HTML and EPUB
// stylesheet read this, so a level-3 heading is the same size in a .docx and
// in a PDF.

/** A book's heading sizes, as multiples of the body size. */
const HEADING_SCALE = [1.8, 1.4, 1.15, 1, 1, 1] as const;

export interface HeadingStyle {
  /** The heading's size as a multiple of the body size. */
  scale: number;
  /** Levels 1 and 2 are chapter titles, and stand centred. */
  centred: boolean;
  /**
   * Levels 4 to 6 are the size of the text, so italic tells them from a
   * paragraph, in a manuscript, where every heading is text-sized, as much as
   * in a book.
   */
  italic: boolean;
}

/**
 * A manuscript's headings are its text's size and weight; a book's grow with
 * their rank.
 */
export function headingStyle(layout: LayoutSpec, level: number): HeadingStyle {
  return {
    scale: layout.manuscript ? 1 : (HEADING_SCALE[level - 1] ?? 1),
    centred: level <= 2,
    italic: level >= 4,
  };
}

/**
 * A title page's title, as a multiple of the body size: text-sized in a
 * manuscript.
 */
export function titleScale(layout: LayoutSpec): number {
  return layout.manuscript ? 1 : 2;
}

/** The text block's height on a page, pt. */
function textHeight(page: PageSize, margins: Margins): number {
  return page.height - margins.top - margins.bottom;
}

/** The text block's width on a page, pt. */
function textWidth(page: PageSize, margins: Margins): number {
  return page.width - margins.inner - margins.outer;
}

export interface Geometry {
  layout: LayoutSpec;
  page: PageSize;
  margins: Margins;
  /** Text block, pt. */
  width: number;
  height: number;
  /** One body line, pt. */
  line: number;
}

/** Everything a paged writer needs to know about the page, from one place. */
export function geometryOf(layoutId: LayoutId, pageId: PageSizeId): Geometry {
  const layout = LAYOUTS[layoutId];
  const page = PAGE_SIZES[pageId];
  const margins = layout.margins(page);
  return {
    layout,
    page,
    margins,
    width: textWidth(page, margins),
    height: textHeight(page, margins),
    line: layout.size * layout.lineHeight,
  };
}

/** One line of the single-spaced contact block, pt. */
export function contactLine(geometry: Geometry): number {
  return geometry.layout.size * 1.2;
}

/**
 * The space above a manuscript title, pt: halfway down a novel's title page,
 * a third of the way down a story's first page, less the contact block
 * already standing above it. At least one line.
 */
export function titleDrop(
  geometry: Geometry,
  contactLines: number,
  titlePage: boolean,
): number {
  const target = geometry.height * (titlePage ? 0.5 : 1 / 3);
  return Math.max(
    geometry.line,
    Math.round(target - Math.max(1, contactLines) * contactLine(geometry)),
  );
}

/** The space above a chapter heading at the top of its page, pt. */
export function chapterDrop(geometry: Geometry): number {
  return Math.round(geometry.height * geometry.layout.chapterDrop);
}
