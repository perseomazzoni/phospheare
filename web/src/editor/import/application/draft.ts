// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  assertHomogeneous,
  preorder,
  type Draft,
  type DraftNode,
  type DraftComment,
  type DraftParagraph,
} from "../domain/draft";
import type { ImportPlan, Level, PlanEntry } from "../domain/plan";
import type { TitleWords } from "../ports";
import { toDraftParagraph, type Prepared, type PreparedBook } from "./prepare";

// Folds the plan into the book. This is the one place the Golden Rule is
// applied (every children list, the root's included, is all Parts or all
// Sections), in `layout`, which the list reads too, so the window never draws
// a tree the project will not hold.
//
// Nothing the writer typed is left out of the text; a line may title a node
// in the tree, but it stays in the text. A title line names its node and
// stays its first line, heading style included; a separator line stays where
// it was; every ornament stays as typed; every blank line comes across as an
// empty paragraph where it stood (`prepare`), the ones after the last
// paragraph at the end of the last node. What the import leaves out is a row
// the writer unticks; a title page or the contents start unticked.
//
// Text is converted once, here, to the engine's shape: headings inside a
// chapter become h1/h2, a page break inside a chapter is kept as one, and
// comments are anchored on the final text with a W3C TextQuote (the quoted
// words and 32 characters either side), so they can be found again after the
// prose changes. A comment placed at a point rather than on a range is
// anchored on the word before it.

const QUOTE_CONTEXT = 32;

interface Located {
  node: DraftNode;
  paragraph: number;
}

/**
 * One node the import makes: the entry that starts it, and every paragraph
 * it holds, its own with the title line first and the whole of each entry
 * after it that the writer joined to it.
 */
export interface Unit {
  entry: PlanEntry;
  body: number[];
}

const span = (from: number, to: number): number[] =>
  Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);

/**
 * The plan as the nodes it will make. A row left out makes nothing; a row
 * joined to the one above becomes the end of that row's Section, and one
 * with nothing above it joins the first that starts below. Every row joined
 * is the whole text as one chapter: the same book, unsplit.
 *
 * A join reaches the row directly above and no further: a row left out
 * between the two breaks it, and the row below starts a Section of its own.
 * The list draws a join as a line between two beads, and a line through a
 * row that is not coming in would say its text joins too.
 */
export function unitsOf(plan: ImportPlan, words: TitleWords): Unit[] {
  const units: Unit[] = [];
  let waiting: number[] = [];
  let first: PlanEntry | null = null;
  let previous: PlanEntry | null = null;
  for (const entry of plan.entries) {
    const before = previous;
    previous = entry;
    if (!entry.included) continue;
    first ??= entry;
    if (!entry.starts && (before === null || before.included)) {
      const above = units[units.length - 1];
      if (above) above.body.push(...span(entry.start, entry.end));
      else waiting.push(...span(entry.start, entry.end));
      continue;
    }
    units.push({
      entry,
      body: [...waiting, ...span(entry.start, entry.end)],
    });
    waiting = [];
  }
  if (first && !units.length)
    units.push({
      entry: {
        ...first,
        level: "chapter",
        titleSpan: 0,
        title: words.untitled,
        titleSource: "generated",
        matter: null,
        starts: true,
      },
      body: waiting,
    });
  return units;
}

export type NodeKind = "part" | "section";

/** A node as the project will hold it: what it is, and where. */
export interface Placed extends Unit {
  kind: NodeKind;
  /** 0 at the root. */
  depth: number;
  /** The index of its parent in the same list; -1 at the root. */
  parent: number;
}

/**
 * Each node the plan makes, in reading order, with its kind and its place.
 *
 *   - A Part of the book stands at the root and holds the chapters after it.
 *   - A chapter goes into the book Part above it; matter outside every Part
 *     stays at the root. It is a Section, unless it must be a Part: at a
 *     root of Parts, or beside a chapter that holds scenes (siblings are all
 *     Parts or all Sections), or because it holds scenes itself.
 *   - A scene goes into the chapter above it, as a Section. A scene with no
 *     chapter above it in its Part stands as a chapter.
 */
export function layout(units: readonly Unit[]): Placed[] {
  const levels: Level[] = [];
  let chapterOpen = false;
  for (const { entry } of units) {
    let level = entry.level;
    if (level === "scene" && !chapterOpen) level = "chapter";
    if (level === "part") chapterOpen = false;
    if (level === "chapter") chapterOpen = true;
    levels.push(level);
  }
  const hasParts = levels.includes("part");
  // The book Part each chapter goes into; -1 is the root.
  const containerOf: number[] = [];
  let part = -1;
  levels.forEach((level, i) => {
    if (level === "part") part = i;
    containerOf.push(part >= 0 && !units[i].entry.matter ? part : -1);
  });
  // The containers whose chapters are Parts, because one of them holds scenes.
  const scenic = new Set<number>();
  levels.forEach((level, i) => {
    if (level === "chapter" && levels[i + 1] === "scene")
      scenic.add(containerOf[i]);
  });
  const placed: Placed[] = [];
  let chapter = -1;
  levels.forEach((level, i) => {
    const unit = units[i];
    if (level === "part") {
      placed.push({ ...unit, kind: "part", depth: 0, parent: -1 });
    } else if (level === "chapter") {
      const container = containerOf[i];
      const parts = scenic.has(container) || (container === -1 && hasParts);
      chapter = i;
      placed.push({
        ...unit,
        kind: parts ? "part" : "section",
        depth: container === -1 ? 0 : 1,
        parent: container,
      });
    } else {
      placed.push({
        ...unit,
        kind: "section",
        depth: placed[chapter].depth + 1,
        parent: chapter,
      });
    }
  });
  return placed;
}

/** How a draft is written, beyond the plan: the window's ticks. */
export interface DraftOptions {
  /** Underlined words become italic, the manuscript convention; else plain. */
  underlineItalic: boolean;
  /** The file's comments go into each chapter's margin; else none come. */
  comments: boolean;
}

export const DEFAULT_DRAFT_OPTIONS: DraftOptions = {
  underlineItalic: true,
  comments: true,
};

/**
 * How much of a row its preview holds: the modal clamps to ten lines, and ten
 * paragraphs always fill ten lines.
 */
export const EXCERPT_PARAGRAPHS = 10;

/**
 * The first paragraphs a row stands for, so the writer can see whether it is
 * where a chapter starts: what its Section opens with, title line first.
 * Ticked or not, it is the same text, only named or joined.
 */
export function excerpt(
  book: PreparedBook,
  entry: PlanEntry,
  limit = EXCERPT_PARAGRAPHS,
): Prepared[] {
  return book.blocks.slice(
    entry.start,
    Math.min(entry.end, entry.start + limit),
  );
}

/**
 * The words a node will hold, counted as the project counts them: its whole
 * text, title line included, without scene ornaments. The
 * window shows this, and the goal is proposed from it.
 */
export function unitWords(book: PreparedBook, unit: Unit): number {
  return unit.body.reduce(
    (sum, n) => sum + (book.blocks[n].scene ? 0 : book.blocks[n].words),
    0,
  );
}

export function buildDraft(
  book: PreparedBook,
  plan: ImportPlan,
  words: TitleWords,
  options: DraftOptions = DEFAULT_DRAFT_OPTIONS,
): Draft {
  const located = new Map<number, Located>();
  const units = unitsOf(plan, words);

  // Of the headings inside chapters, a joined entry's title among them, the
  // shallowest level found becomes h1 and the rest h2.
  let shallowest = Infinity;
  for (const { body } of units)
    for (const n of body) {
      const level = book.blocks[n].signals.headingLevel;
      if (level) shallowest = Math.min(shallowest, level);
    }

  const paragraphOf = (block: Prepared): DraftParagraph => {
    const para = toDraftParagraph(
      block.inlines,
      block.align,
      block.signals.origin === "code",
      options.underlineItalic,
    );
    const level = block.signals.headingLevel;
    if (level) para.blockType = level === shallowest ? "h1" : "h2";
    return para;
  };

  /** `count` of the writer's blank lines, as empty paragraphs. */
  const blank = (node: DraftNode, count = 0) => {
    for (let b = 0; b < count; b++)
      node.paragraphs.push({
        blockType: "paragraph",
        alignment: "left",
        runs: [],
      });
  };

  /** Fills a node with prepared paragraphs, recording where each landed. */
  const fill = (node: DraftNode, indices: number[]) => {
    indices.forEach((n, i) => {
      const block = book.blocks[n];
      blank(node, block.blankBefore);
      if (block.breakBefore && !block.inferredBreak && i > 0)
        node.paragraphs.push({
          blockType: "pagebreak",
          alignment: "left",
          runs: [],
        });
      located.set(n, { node, paragraph: node.paragraphs.length });
      node.paragraphs.push(paragraphOf(block));
    });
  };

  const node = (kind: DraftNode["kind"], title: string): DraftNode => ({
    kind,
    title,
    paragraphs: [],
    children: [],
  });

  const roots: DraftNode[] = [];
  const made: DraftNode[] = [];
  for (const { entry, body, kind, parent } of layout(units)) {
    const one = node(kind, entry.title);
    fill(one, body);
    made.push(one);
    (parent < 0 ? roots : made[parent].children).push(one);
  }
  // The blank lines after the book's last paragraph are the last node's.
  const last = made[made.length - 1] as DraftNode | undefined;
  if (last) blank(last, book.blankAfter);
  // A Part holds only Sections or only Parts: `layout` makes every list
  // homogeneous by construction, and this checks it.
  assertHomogeneous(roots);
  return {
    roots,
    comments: options.comments ? remapComments(book, roots, located) : [],
  };
}

function nodeText(node: DraftNode): { text: string; starts: number[] } {
  const starts: number[] = [];
  let text = "";
  node.paragraphs.forEach((para, i) => {
    if (i > 0) text += "\n";
    starts.push(text.length);
    text += para.runs.map((run) => run.text).join("");
  });
  return { text, starts };
}

function remapComments(
  book: PreparedBook,
  roots: DraftNode[],
  located: Map<number, Located>,
): DraftComment[] {
  const indexOf = new Map<string, number>();
  book.blocks.forEach((block, n) => {
    if (!block.scene) indexOf.set(`${block.flow}:${block.block}`, n);
  });
  const order = new Map(preorder(roots).map((node, i) => [node, i]));
  const texts = new Map<DraftNode, ReturnType<typeof nodeText>>();
  const textOf = (node: DraftNode) => {
    let t = texts.get(node);
    if (!t) {
      t = nodeText(node);
      texts.set(node, t);
    }
    return t;
  };

  // A comment on text the writer left out goes with it: its passage is not
  // in the book, and landing it on the first chapter as an orphan would put
  // an editor's words about a title page beside the opening scene. `null`
  // marks one; a comment the source itself never placed is kept.
  const remapped = book.comments.map((comment): DraftComment | null => {
    const base: DraftComment = {
      anchor: null,
      body: comment.body,
      sourceId: comment.sourceId,
      ...(comment.author ? { author: comment.author } : {}),
      ...(comment.date ? { date: comment.date } : {}),
      ...(comment.parentId ? { parentId: comment.parentId } : {}),
      ...(comment.resolved ? { resolved: true } : {}),
    };
    if (!comment.anchor) return base;
    const startIndex = indexOf.get(
      `${comment.anchor.flow}:${comment.anchor.start.block}`,
    );
    const startAt =
      startIndex !== undefined ? located.get(startIndex) : undefined;
    if (startIndex !== undefined && !startAt) return null;
    if (!startAt) return base;
    const endIndex = indexOf.get(
      `${comment.anchor.flow}:${comment.anchor.end.block}`,
    );
    let endAt = endIndex !== undefined ? located.get(endIndex) : undefined;
    let endOffset = comment.anchor.end.offset;
    const { text, starts } = textOf(startAt.node);
    const paraLength = (p: number) =>
      (p + 1 < starts.length ? starts[p + 1] - 1 : text.length) - starts[p];
    if (!endAt || endAt.node !== startAt.node) {
      endAt = startAt;
      endOffset = paraLength(startAt.paragraph);
    }
    let start =
      starts[startAt.paragraph] +
      Math.min(comment.anchor.start.offset, paraLength(startAt.paragraph));
    const end =
      starts[endAt.paragraph] +
      Math.min(endOffset, paraLength(endAt.paragraph));
    // A comment placed at a point anchors on the word before it.
    if (end === start) {
      let s = start;
      while (s > starts[startAt.paragraph] && /\s/.test(text[s - 1])) s -= 1;
      while (s > starts[startAt.paragraph] && /[^\s]/.test(text[s - 1])) s -= 1;
      start = s;
    }
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    const at = (absolute: number) => {
      let p = 0;
      while (p + 1 < starts.length && starts[p + 1] <= absolute) p += 1;
      return { paragraph: p, offset: absolute - starts[p] };
    };
    return {
      ...base,
      anchor: {
        node: order.get(startAt.node) ?? 0,
        start: at(lo),
        end: at(hi),
        quote: {
          exact: text.slice(lo, hi),
          prefix: text.slice(Math.max(0, lo - QUOTE_CONTEXT), lo),
          suffix: text.slice(hi, hi + QUOTE_CONTEXT),
        },
      },
    };
  });

  // A reply goes with the thread it answers: one whose chain reaches a
  // comment left out would otherwise arrive as a thread of its own, an
  // answer with no question. A chain that loops ends where it loops.
  const parentOf = new Map(
    book.comments.map((comment) => [comment.sourceId, comment.parentId]),
  );
  const leftOut = new Set(
    book.comments
      .filter((_, i) => remapped[i] === null)
      .map((comment) => comment.sourceId),
  );
  const answersLeftOut = (id: string | undefined): boolean => {
    const seen = new Set<string>();
    for (
      let at = id;
      at !== undefined && !seen.has(at);
      at = parentOf.get(at)
    ) {
      if (leftOut.has(at)) return true;
      seen.add(at);
    }
    return false;
  };
  return remapped.filter(
    (comment): comment is DraftComment =>
      comment !== null && !answersLeftOut(comment.parentId),
  );
}
