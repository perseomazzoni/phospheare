// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { stemOf } from "../domain/formats";
import {
  looksLikeTocEntry,
  matchBareNumber,
  matchHeading,
  matchMatter,
} from "../domain/patterns";
import type { Level, RuleId, TitleSource } from "../domain/plan";
import type { MatterKind } from "../domain/source";
import type { Prepared, PreparedBook } from "./prepare";
import { tidyTitle } from "./titles";

// Seven ways to find where chapters begin. Each rule reads the prepared book
// and proposes boundaries; `rank` scores them and the preview offers every
// one that found something, with its count, so the writer can see which
// reading of their file is which:
//
//   headings     the source's own heading levels (styles, `<h2>`, `##`);
//   patterns     whole lines like "Chapter 3", "CAPITOLO TERZO", "Part One",
//                "Prologue", and bare numbers, only where a number on its
//                own line cannot be a sentence (centred, bold, after a
//                break, or one of an increasing run);
//   typography   short lines set apart by look: bold and centred, large, in
//                capitals;
//   pageBreaks   every new page starts a chapter;
//   files        every file (or epub spine item) is a chapter;
//   separator    a line the writer names ("###", "CHAPTER");
//   none         the whole text is one chapter.
//
// A table of contents is found first and stepped over by every rule: three
// or more chapter-like lines with no prose between them are a list of
// chapters, not chapters.

export interface Boundary {
  /** The prepared paragraph the entry starts at. */
  index: number;
  level: Level;
  /** Paragraphs at `index` that are its title (0 when the title is made up). */
  titleSpan: number;
  /** The title as found; empty when one must be generated. */
  title: string;
  titleSource: TitleSource;
  matter: MatterKind | null;
}

export interface RuleOutput {
  boundaries: Boundary[];
  /** A paragraph that is the book's own title, not a chapter's. */
  bookTitle?: string;
}

/** Paragraphs that belong to a table of contents. */
export function tocRegion(book: PreparedBook): Set<number> {
  const region = new Set<number>();
  const { blocks } = book;
  const chapterish = (b: Prepared) =>
    !b.scene &&
    b.short &&
    (!!matchHeading(b.text) ||
      !!matchMatter(b.text) ||
      looksLikeTocEntry(b.text) ||
      b.signals.role === "toc");
  let i = 0;
  while (i < blocks.length) {
    if (!chapterish(blocks[i])) {
      i += 1;
      continue;
    }
    // Extend while the lines between chapter-like ones carry no prose.
    let j = i;
    let count = 0;
    let k = i;
    // The first entry, past a "Contents" line heading the list.
    const head = matchMatter(blocks[i].text)?.kind === "toc" ? i + 1 : i;
    let plainEntries = 0;
    while (k < blocks.length) {
      const b = blocks[k];
      // A new page ends a contents list, and a chapter-like line with prose
      // right under it is the first real chapter, not an entry. So do the
      // list's first entry coming round again, since the body has begun, and
      // a true heading after plain entries, since Markdown and plain text
      // have no page breaks to say where the list stops.
      if (k > i && b.breakBefore) break;
      // Only the first entry: titles are free, so two "Anna"s may be listed.
      const first = blocks[head];
      if (k > head && first && b.text.trim() === first.text.trim()) break;
      if (b.signals.headingLevel && plainEntries > 0) break;
      const next = blocks[k + 1];
      if (chapterish(b) && next && !next.scene && !next.short) break;
      if (chapterish(b)) {
        count += 1;
        if (!b.signals.headingLevel) plainEntries += 1;
        j = k;
        k += 1;
        continue;
      }
      if (b.short && !b.sentence && b.words <= 6) {
        k += 1;
        continue;
      }
      break;
    }
    // A "Contents" line inside the run starts the list: what came before it
    // (a facts page, a dedication) is a page of its own, not entries.
    let start = i;
    for (let n = i + 1; n <= j; n++)
      if (matchMatter(blocks[n].text)?.kind === "toc") {
        start = n;
        count = blocks.slice(n + 1, j + 1).filter((x) => chapterish(x)).length;
        break;
      }
    // Entries carrying page numbers are a TOC even when only two.
    const numbered = blocks
      .slice(start, j + 1)
      .some((b) => looksLikeTocEntry(b.text));
    if (count >= 3 || (count >= 2 && numbered)) {
      // The "Contents" line above it belongs to it.
      if (start > 0 && matchMatter(blocks[start - 1].text)?.kind === "toc")
        region.add(start - 1);
      for (let n = start; n <= j; n++) region.add(n);
    }
    i = j + 1;
  }
  // A role says so outright: a .docx TOC Heading style, an epub nav.
  blocks.forEach((b, n) => {
    if (b.signals.role === "toc") region.add(n);
  });
  return region;
}

/**
 * A short line after a bare marker that reads as its subtitle
 * ("The Beginning").
 */
function subtitleAfter(
  book: PreparedBook,
  index: number,
  toc: Set<number>,
): boolean {
  const next = book.blocks[index + 1];
  if (!next || next.scene || toc.has(index + 1) || next.breakBefore)
    return false;
  if (!next.short || next.sentence || next.words > 10) return false;
  if (matchHeading(next.text) || matchMatter(next.text)) return false;
  const here = book.blocks[index];
  return (
    !!next.signals.headingLevel ||
    next.signals.role === "subtitle" ||
    (next.centered && here.centered) ||
    (next.bold && here.bold) ||
    next.caps
  );
}

function matterOf(text: string): MatterKind | null {
  return matchMatter(text)?.kind ?? null;
}

/**
 * A boundary at a title line; a bare "Chapter One" takes the line after as
 * its name.
 */
function titled(
  book: PreparedBook,
  index: number,
  level: Level,
  source: TitleSource,
  toc: Set<number>,
  /** False when the next line is known to be a boundary of its own. */
  subtitled = true,
): Boundary {
  const text = book.blocks[index].text.trim();
  const heading = matchHeading(text);
  const bare = (heading && !heading.subtitle) || matchBareNumber(text) !== null;
  if (bare && subtitled && subtitleAfter(book, index, toc))
    return {
      index,
      level,
      titleSpan: 2,
      // The name alone: "1" over "Lev" is the Section "Lev". The number is
      // the structure panel's to draw, as it counts every Section; both
      // lines stay in the text as the writer set them.
      title: tidyTitle(book.blocks[index + 1].text),
      titleSource: source,
      matter: null,
    };
  return {
    index,
    level,
    titleSpan: 1,
    title: text,
    titleSource: source,
    matter: matterOf(text),
  };
}

function headings(book: PreparedBook, toc: Set<number>): RuleOutput {
  const { blocks } = book;
  const candidates = blocks
    .map((b, index) => ({ b, index }))
    .filter(
      ({ b, index }) =>
        !toc.has(index) &&
        !b.scene &&
        !!b.signals.headingLevel &&
        b.words <= 20,
    );
  let bookTitle: string | undefined;
  // The source's title line (a "Title" style, an HTML `p.title`) names the
  // book.
  const titleLine = blocks.findIndex((b) => b.signals.role === "title");
  if (titleLine >= 0 && titleLine < 8)
    bookTitle = blocks[titleLine].text.trim();
  const levels = [
    ...new Set(candidates.map(({ b }) => b.signals.headingLevel ?? 0)),
  ].sort((a, b) => a - b);
  let usable = levels;
  // The shallowest level used once, near the start, is the book's title.
  if (levels.length > 1) {
    const top = candidates.filter(
      ({ b }) => b.signals.headingLevel === levels[0],
    );
    // Never a matter heading: "Contents" is nobody's title.
    if (top.length === 1 && top[0].index < 8 && !matchMatter(top[0].b.text)) {
      bookTitle ??= top[0].b.text.trim();
      usable = levels.slice(1);
    }
  }
  if (!usable.length) return { boundaries: [], bookTitle };
  const count = (level: number) =>
    candidates.filter(({ b }) => b.signals.headingLevel === level).length;
  // Two levels in play: the shallower is Parts when the words say so ("Part
  // One"), or when it holds fewer story headings than the deeper one and at
  // least two. Matter headings ("Contents", "Acknowledgments") sit at the top
  // level of most books whatever their shape, so they are not counted: an
  // exported book with one Part, a contents page and three chapters would
  // otherwise read as four flat chapters. "Chapter 1" at the shallower level
  // means it is the chapter level, whatever the counts.
  let partLevel: number | null = null;
  let chapterLevel = usable[0];
  if (usable.length > 1) {
    const shallow = candidates.filter(
      ({ b }) => b.signals.headingLevel === usable[0],
    );
    const story = shallow.filter(({ b }) => !matchMatter(b.text));
    const saysChapter = shallow.some(
      ({ b }) => matchHeading(b.text)?.kind === "chapter",
    );
    const saysPart = story.some(
      ({ b }) => matchHeading(b.text)?.kind === "part",
    );
    if (
      !saysChapter &&
      (saysPart || (story.length >= 2 && story.length < count(usable[1])))
    ) {
      partLevel = usable[0];
      chapterLevel = usable[1];
    }
  }
  const boundaries: Boundary[] = [];
  for (const { b, index } of candidates) {
    const level = b.signals.headingLevel ?? 0;
    if (bookTitle !== undefined && b.text.trim() === bookTitle && index < 8)
      continue;
    if (level === partLevel)
      // "Part One" with a chapter heading right under it: the chapter is
      // the Part's first child, not its subtitle.
      boundaries.push(
        titled(
          book,
          index,
          "part",
          "heading",
          toc,
          book.blocks[index + 1]?.signals.headingLevel !== chapterLevel,
        ),
      );
    else if (level === chapterLevel) {
      const keyword = matchHeading(b.text);
      boundaries.push(
        titled(
          book,
          index,
          keyword?.kind === "part" ? "part" : "chapter",
          "heading",
          toc,
        ),
      );
    }
  }
  return { boundaries: dropConsumed(boundaries), bookTitle };
}

function patterns(book: PreparedBook, toc: Set<number>): RuleOutput {
  const { blocks } = book;
  const boundaries: Boundary[] = [];
  // Bare numbers: allowed only where the line cannot be prose, or as part of
  // an increasing run (1, 2, 3, or I, II, III).
  const bare = blocks
    .map((b, index) => ({
      index,
      value: b.scene || toc.has(index) ? null : matchBareNumber(b.text),
    }))
    .filter((x): x is { index: number; value: number } => x.value !== null);
  const inRun = new Set<number>();
  for (let i = 0; i < bare.length; i++) {
    let j = i;
    while (j + 1 < bare.length && bare[j + 1].value === bare[j].value + 1)
      j += 1;
    if (j - i + 1 >= 3) for (let k = i; k <= j; k++) inRun.add(bare[k].index);
    i = j;
  }
  blocks.forEach((b, index) => {
    if (b.scene || toc.has(index) || !b.short || b.signals.origin) return;
    const heading = matchHeading(b.text);
    if (heading) {
      boundaries.push(titled(book, index, heading.kind, "pattern", toc));
      return;
    }
    // A matter word alone on its line ("Prologue", "Notes") is a page of its
    // own. Followed by more ("NOTE: DO NOT OPEN") it is as likely a line of
    // the story, so it needs a heading's look as well; otherwise the rest
    // of a chapter falls into a "notes" page left out by default.
    const matter = matchMatter(b.text);
    const looksLikeHeading =
      !!b.signals.headingLevel || b.breakBefore || b.centered || b.bold;
    if (matter && !b.sentence && (!matter.subtitle || looksLikeHeading)) {
      boundaries.push({
        index,
        level: "chapter",
        titleSpan: 1,
        title: b.text.trim(),
        titleSource: "matter",
        matter: matter.kind,
      });
      return;
    }
    if (
      matchBareNumber(b.text) !== null &&
      (b.centered ||
        b.bold ||
        b.breakBefore ||
        inRun.has(index) ||
        !!b.signals.headingLevel)
    )
      boundaries.push(titled(book, index, "chapter", "pattern", toc));
  });
  return { boundaries: dropConsumed(boundaries) };
}

function typography(book: PreparedBook, toc: Set<number>): RuleOutput {
  const boundaries: Boundary[] = [];
  book.blocks.forEach((b, index) => {
    if (
      b.scene ||
      toc.has(index) ||
      b.signals.origin ||
      b.signals.role === "title"
    )
      return;
    if (!b.short || b.sentence || b.words === 0 || b.words > 10) return;
    const set =
      (b.bold && b.centered) || b.big || (b.caps && (b.centered || b.bold));
    if (!set) return;
    const heading = matchHeading(b.text);
    boundaries.push(
      titled(
        book,
        index,
        heading?.kind === "part" ? "part" : "chapter",
        "typography",
        toc,
      ),
    );
  });
  return { boundaries: dropConsumed(boundaries) };
}

function pageBreaks(book: PreparedBook, toc: Set<number>): RuleOutput {
  const boundaries: Boundary[] = [];
  book.blocks.forEach((b, index) => {
    if (!b.breakBefore || toc.has(index)) return;
    const titleLike = b.short && !b.sentence && b.words > 0 && b.words <= 12;
    if (titleLike) {
      const heading = matchHeading(b.text);
      boundaries.push(
        titled(
          book,
          index,
          heading?.kind === "part" ? "part" : "chapter",
          "heading",
          toc,
        ),
      );
    } else
      boundaries.push({
        index,
        level: "chapter",
        titleSpan: 0,
        title: "",
        titleSource: "generated",
        matter: null,
      });
  });
  return { boundaries: dropConsumed(boundaries) };
}

function files(book: PreparedBook, toc: Set<number>): RuleOutput {
  const boundaries: Boundary[] = [];
  const hasNav = book.flows.some((f) => f.navTitle);
  book.flows.forEach((flow, f) => {
    if (flow.start < 0) return;
    // An epub split for size spreads one chapter over several spine items;
    // only the ones the table of contents names start a chapter.
    if (hasNav && !flow.navTitle && f > 0) return;
    const first = book.blocks[flow.start];
    const firstIsTitle =
      first &&
      first.short &&
      !first.sentence &&
      first.words <= 12 &&
      (!!first.signals.headingLevel ||
        first.centered ||
        first.bold ||
        first.caps ||
        !!matchHeading(first.text));
    const matter = flow.role ?? (first ? matterOf(first.text) : null);
    if (flow.navTitle)
      boundaries.push({
        index: flow.start,
        level: "chapter",
        // The nav's title usually repeats the chapter's own heading, which
        // is then consumed.
        titleSpan:
          firstIsTitle &&
          first.text.trim().toLowerCase() === flow.navTitle.toLowerCase()
            ? 1
            : 0,
        title: flow.navTitle,
        titleSource: "nav",
        matter,
      });
    else if (firstIsTitle)
      boundaries.push({
        ...titled(book, flow.start, "chapter", "file", toc),
        matter,
      });
    else
      boundaries.push({
        index: flow.start,
        level: "chapter",
        titleSpan: 0,
        title: stemOf(flow.name).replace(/[_]+/g, " ").trim(),
        titleSource: "file",
        matter,
      });
  });
  return { boundaries };
}

function separator(
  book: PreparedBook,
  sep: string,
  toc: Set<number>,
): RuleOutput {
  const needle = sep.trim().toLowerCase();
  if (!needle) return { boundaries: [] };
  const boundaries: Boundary[] = [];
  book.blocks.forEach((b, index) => {
    if (toc.has(index)) return;
    const text = b.text.trim().toLowerCase();
    // The separator alone is consumed; the separator starting a line makes
    // that line the title ("CHAPTER — The Fall").
    if (text === needle)
      boundaries.push({
        index,
        level: "chapter",
        titleSpan: 1,
        title: "",
        titleSource: "generated",
        matter: null,
      });
    else if (
      text.startsWith(needle) &&
      /^[\s\d:.\-–—]/.test(text.slice(needle.length)) &&
      b.short
    )
      boundaries.push({
        index,
        level: "chapter",
        titleSpan: 1,
        title: b.text.trim(),
        titleSource: "separator",
        matter: null,
      });
  });
  return { boundaries };
}

/** A two-line title consumes the line after it; that line is no boundary. */
function dropConsumed(boundaries: Boundary[]): Boundary[] {
  const out: Boundary[] = [];
  let consumedUpTo = -1;
  for (const b of [...boundaries].sort((x, y) => x.index - y.index)) {
    if (b.index < consumedUpTo) continue;
    if (out.length && out[out.length - 1].index === b.index) continue;
    out.push(b);
    consumedUpTo = b.index + Math.max(1, b.titleSpan);
  }
  return out;
}

export function runRule(
  rule: RuleId,
  book: PreparedBook,
  separatorText: string,
  toc = tocRegion(book),
): RuleOutput {
  switch (rule) {
    case "headings":
      return headings(book, toc);
    case "patterns":
      return patterns(book, toc);
    case "typography":
      return typography(book, toc);
    case "pageBreaks":
      return pageBreaks(book, toc);
    case "files":
      return book.flows.filter((f) => f.start >= 0).length > 1
        ? files(book, toc)
        : { boundaries: [] };
    case "separator":
      return separator(book, separatorText, toc);
    case "none":
      return { boundaries: [] };
  }
}
