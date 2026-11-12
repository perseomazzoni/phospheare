// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { DraftParagraph } from "../domain/draft";
import {
  blockText,
  type Align,
  type ImportedComment,
  type Inline,
  type MatterKind,
  type ParaBlock,
  type Signals,
  type SourceDocument,
} from "../domain/source";
import { capsShare, isSceneGlyph, isSentenceLike } from "../domain/text";
import type { ManuscriptWriter, ProjectRules } from "../ports";

// The book as one list of paragraphs, measured. Detection reads paragraphs,
// not files, so the flows are laid end to end, page breaks fold into the
// paragraph after them (`breakBefore`), thematic breaks and ornament lines
// become scene markers, and blank paragraphs fold into the paragraph after
// them too (`blankBefore`; the ones after the last paragraph are
// `blankAfter`).
//
// Not one blank line is lost: after a dateline, before a letter, between
// scenes, between the lines of a double-spaced typescript. Reading a blank
// line between paragraphs as a scene break, as a book formatter does, and
// dropping the others is the import changing the book.
//
// Blank lines still say something to the detection, and only to it: a gap of
// three or more (four raw lines, double-spaced) is where a typed manuscript
// with no page breaks ends a chapter, so it marks the paragraph after it
// `breakBefore` for the page-break rule, with `inferredBreak` so that no page
// break is written into the project for it. The blank lines stay.
//
// They are folded rather than kept as paragraphs of their own, so the
// detection rules, which read a title's neighbours, never meet an empty line
// between "CHAPTER ONE" and its subtitle; the draft writes every one back as
// an empty paragraph, wherever it falls.
//
// Every paragraph is then measured for the rules: its words, counted the
// app's way through the engine's serialiser and `countWords` so the preview's
// numbers are the project's, and whether it is short, sentence-like, centred,
// bold, in capitals, set large.

export interface Prepared {
  /** Where it came from; comments are remapped through this. */
  flow: number;
  block: number;
  inlines: Inline[];
  align: Align;
  signals: Signals;
  text: string;
  words: number;
  /** A scene break: an ornament line or a thematic break. */
  scene: boolean;
  /** Starts a new page: an explicit break, a section break, a big gap. */
  breakBefore: boolean;
  /** The break is only read from blank lines: no page break is written. */
  inferredBreak?: boolean;
  /** The blank lines the writer left above it, every one kept. */
  blankBefore?: number;
  /** The first paragraph of its file or epub spine item. */
  flowStart: boolean;
  short: boolean;
  sentence: boolean;
  bold: boolean;
  caps: boolean;
  centered: boolean;
  /** Set at least two points above the body's size. */
  big: boolean;
}

export interface PreparedFlow {
  name: string;
  navTitle?: string;
  role?: MatterKind;
  linear: boolean;
  /** The index of its first prepared paragraph; -1 when it held none. */
  start: number;
}

export interface PreparedBook {
  blocks: Prepared[];
  flows: PreparedFlow[];
  comments: ImportedComment[];
  words: number;
  /** The body text's size in points, a median weighted by words, when known. */
  bodySize: number | null;
  doubleSpaced: boolean;
  /** The blank lines after the last paragraph, kept like every other. */
  blankAfter: number;
  /**
   * The title and author the file states about itself (a .docx's document
   * properties, an epub's metadata): the evidence that a short opening page
   * holding just those two lines is the title page.
   */
  meta: { title?: string; author?: string };
}

/**
 * The engine's shape for one paragraph, for counting and for the draft.
 *
 * Underlining becomes italic unless the writer unticks the window's tick,
 * shown when the file has any. The app has no underline, and in a manuscript
 * underlining is how italic was marked before word processors.
 */
export function toDraftParagraph(
  inlines: readonly Inline[],
  align: Align,
  mono = false,
  underlineItalic = true,
): DraftParagraph {
  return {
    blockType: "paragraph",
    alignment: align,
    runs: inlines.map((inline) => ({
      text: inline.text,
      bold: !!inline.bold,
      italic: !!inline.italic || (underlineItalic && !!inline.underline),
      monospace: mono || !!inline.mono,
    })),
  };
}

const isEmpty = (block: ParaBlock) =>
  block.inlines.every((inline) => !inline.text.trim());

export function prepare(
  source: SourceDocument,
  writer: ManuscriptWriter,
  rules: ProjectRules,
): PreparedBook {
  // Flattens, keeping each paragraph's origin. Empty paragraphs stay for now
  // as gaps; page breaks and rules become flags on what follows.
  type Raw =
    | {
        kind: "para";
        block: ParaBlock;
        flow: number;
        index: number;
        flowStart: boolean;
        breakBefore: boolean;
        scene: boolean;
      }
    | { kind: "gap"; breakBefore: boolean };
  const raw: Raw[] = [];
  const flows: PreparedFlow[] = [];
  source.flows.forEach((flow, f) => {
    flows.push({
      name: flow.name,
      ...(flow.navTitle ? { navTitle: flow.navTitle } : {}),
      ...(flow.role ? { role: flow.role } : {}),
      linear: flow.linear !== false,
      start: -1,
    });
    let first = true;
    let pendingBreak = false;
    let pendingScene = false;
    flow.blocks.forEach((block, b) => {
      if (block.kind === "pageBreak") {
        pendingBreak = true;
        return;
      }
      if (block.kind === "rule") {
        pendingScene = true;
        return;
      }
      if (isEmpty(block)) {
        raw.push({ kind: "gap", breakBefore: pendingBreak });
        pendingBreak = false;
        return;
      }
      if (pendingScene) {
        raw.push({
          kind: "para",
          block: {
            kind: "para",
            inlines: [{ text: "* * *" }],
            align: "center",
            signals: {},
          },
          flow: f,
          index: b,
          flowStart: false,
          breakBefore: false,
          scene: true,
        });
        pendingScene = false;
      }
      raw.push({
        kind: "para",
        block,
        flow: f,
        index: b,
        flowStart: first,
        breakBefore: pendingBreak || !!block.signals.breakBefore,
        scene: isSceneGlyph(blockText(block)),
      });
      first = false;
      pendingBreak = false;
    });
  });

  // Double-spaced means most text paragraphs are followed by one blank only.
  let followed = 0;
  let texts = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].kind !== "para") continue;
    texts += 1;
    if (raw[i + 1]?.kind === "gap" && raw[i + 2]?.kind !== "gap") followed += 1;
  }
  const doubleSpaced = texts >= 4 && followed / texts >= 0.6;

  const blocks: Prepared[] = [];
  let gap = 0;
  let gapBreak = false;
  const sizes: { size: number; words: number }[] = [];
  for (const item of raw) {
    if (item.kind === "gap") {
      gap += 1;
      gapBreak ||= item.breakBefore;
      continue;
    }
    const effective = doubleSpaced ? gap - 1 : gap;
    const bigGap = effective >= 3 && blocks.length > 0;
    const typedBreak = item.breakBefore || gapBreak;
    const breakHere = typedBreak || bigGap;
    const inferred = bigGap && !typedBreak;
    const blankBefore = gap;
    gap = 0;
    gapBreak = false;
    if (item.scene) {
      // The ornament as written: its glyph, its alignment, every one of them,
      // two in a row or one at a page's top. Nothing the writer typed is the
      // import's to change, so a pair is not cut to one and none is rewritten
      // as "* * *". Its text is also how a separator the writer names
      // ("###") is found.
      blocks.push({
        ...sceneMarker(item.flow, item.index, blockText(item.block).trim()),
        inlines: item.block.inlines,
        align: item.block.align,
        breakBefore: breakHere,
        ...(inferred ? { inferredBreak: true } : {}),
        ...(blankBefore ? { blankBefore } : {}),
      });
      continue;
    }
    const { block } = item;
    const text = blockText(block);
    const paragraph = toDraftParagraph(block.inlines, block.align);
    const words = rules.countWords(writer.serialize([paragraph]));
    const withText = block.inlines.filter((inline) => inline.text.trim());
    const letters = text.replace(/[^\p{L}]/gu, "").length;
    const prepared: Prepared = {
      flow: item.flow,
      block: item.index,
      inlines: block.inlines,
      align: block.align,
      signals: block.signals,
      text,
      words,
      scene: false,
      breakBefore: breakHere,
      ...(inferred ? { inferredBreak: true } : {}),
      ...(blankBefore ? { blankBefore } : {}),
      flowStart: item.flowStart,
      short: words <= 12 && text.length <= 100,
      sentence: isSentenceLike(text),
      bold: withText.length > 0 && withText.every((inline) => inline.bold),
      caps: !!block.signals.allCaps || (letters >= 3 && capsShare(text) >= 0.9),
      centered: block.align === "center",
      big: false,
    };
    if (item.flowStart && flows[item.flow].start < 0)
      flows[item.flow].start = blocks.length;
    if (block.signals.fontSizePt && !block.signals.headingLevel && words > 12)
      sizes.push({ size: block.signals.fontSizePt, words });
    blocks.push(prepared);
  }
  // A flow whose first paragraph was an ornament still starts somewhere.
  for (const flow of flows)
    if (flow.start < 0) {
      const f = flows.indexOf(flow);
      flow.start = blocks.findIndex((b) => b.flow === f);
    }
  // The blank lines after the last paragraph stay at the end of the book.
  const blankAfter = gap;

  const bodySize = weightedMedian(sizes);
  if (bodySize !== null)
    for (const block of blocks)
      block.big =
        !!block.signals.fontSizePt && block.signals.fontSizePt >= bodySize + 2;

  return {
    blocks,
    flows,
    comments: source.comments,
    words: blocks.reduce((sum, b) => sum + (b.scene ? 0 : b.words), 0),
    bodySize,
    doubleSpaced,
    blankAfter,
    meta: { title: source.meta.title, author: source.meta.author },
  };
}

function sceneMarker(flow: number, block: number, text = "* * *"): Prepared {
  return {
    flow,
    block,
    inlines: [{ text }],
    align: "center",
    signals: {},
    text,
    words: 0,
    scene: true,
    breakBefore: false,
    flowStart: false,
    short: true,
    sentence: false,
    bold: false,
    caps: false,
    centered: true,
    big: false,
  };
}

function weightedMedian(
  items: { size: number; words: number }[],
): number | null {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => a.size - b.size);
  const total = sorted.reduce((sum, item) => sum + item.words, 0);
  let seen = 0;
  for (const item of sorted) {
    seen += item.words;
    if (seen >= total / 2) return item.size;
  }
  return sorted[sorted.length - 1].size;
}
