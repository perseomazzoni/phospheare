// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  RULE_IDS,
  type ImportOptions,
  type ImportPlan,
  type PlanEntry,
  type RuleCandidate,
  type RuleId,
} from "../domain/plan";
import type { TitleWords } from "../ports";
import { classify } from "./matter";
import type { Prepared, PreparedBook } from "./prepare";
import { score } from "./rank";
import { runRule, tocRegion, type Boundary, type RuleOutput } from "./rules";
import { titleFor } from "./titles";

// Detection, from a prepared book to a plan. Every rule runs; each that found
// something becomes a candidate in the "Split by" menu, and "auto" takes the
// best score. The chosen rule's boundaries become the plan's entries:
// contiguous ranges, each with its level, title and matter verdict. Text
// before the first boundary is an entry of its own, most often a title page,
// which the matter rules then leave unticked, even with no words in it (an
// ornament or a number alone), since nothing the writer typed is the
// import's to drop.
//
// An ebook's pages outside its reading order (`linear="no"`: a map, pop-up
// notes) are rows of their own under every way of dividing but "keep it
// whole", so the matter rules can leave them out where the writer sees it.
// Under a way that looks at the text alone ("Chapter 3"), such a page would
// otherwise run on as the end of the chapter before it, and come in unseen.
//
// Choosing another rule rebuilds the plan from scratch, so the writer's
// renames and merges are reset; the window says so before it happens.

export interface Detection {
  plan: ImportPlan;
  bookTitle?: string;
}

export function detect(
  book: PreparedBook,
  choice: RuleId | "auto",
  options: ImportOptions,
  words: TitleWords,
): Detection {
  const toc = tocRegion(book);
  const outputs = Object.fromEntries(
    RULE_IDS.map((rule) => [rule, runRule(rule, book, options.separator, toc)]),
  ) as Record<RuleId, RuleOutput>;
  const candidates: RuleCandidate[] = RULE_IDS.map((rule) => {
    const { boundaries } = outputs[rule];
    const s = score(rule, book, boundaries);
    return {
      rule,
      score: s,
      available: rule === "none" || boundaries.length > 0,
    };
  });
  let rule: RuleId;
  if (choice === "auto") {
    rule = candidates
      .filter((c) => c.available && c.rule !== "separator")
      .reduce((best, c) => (c.score > best.score ? c : best)).rule;
  } else rule = choice;
  const output = outputs[rule];
  const bookTitle = output.bookTitle ?? outputs.headings.bookTitle;
  const boundaries =
    rule === "none"
      ? output.boundaries
      : offSpineApart(book, output.boundaries, outputs.files.boundaries);
  const entries = toEntries(book, boundaries, bookTitle, words, toc);
  return { plan: { rule, entries, options, candidates }, bookTitle };
}

/**
 * The chosen boundaries, with each page outside the reading order starting a
 * row and the text after it starting another, so the page takes nothing that
 * is not it. Where the rule drew no line, the line is the one the files draw
 * (the nav's title for the page), or one with a made-up title.
 */
function offSpineApart(
  book: PreparedBook,
  chosen: readonly Boundary[],
  byFile: readonly Boundary[],
): readonly Boundary[] {
  const at = new Set(chosen.map((b) => b.index));
  const fileAt = new Map(byFile.map((b) => [b.index, b]));
  const added: Boundary[] = [];
  book.flows.forEach((flow, f) => {
    if (flow.linear || flow.start < 0) return;
    const after = book.flows.slice(f + 1).find((next) => next.start >= 0);
    for (const index of [flow.start, after?.start]) {
      if (index === undefined || at.has(index)) continue;
      at.add(index);
      added.push(
        fileAt.get(index) ?? {
          index,
          level: "chapter",
          titleSpan: 0,
          title: "",
          titleSource: "generated",
          matter: null,
        },
      );
    }
  });
  return added.length ? [...chosen, ...added] : chosen;
}

function toEntries(
  book: PreparedBook,
  boundaries: readonly Boundary[],
  bookTitle: string | undefined,
  words: TitleWords,
  toc: Set<number>,
): PlanEntry[] {
  const n = book.blocks.length;
  if (!n) return [];
  // One chapter holds the whole text, never mistaken for a title page, and
  // is named for the book when the book has a name.
  if (!boundaries.length)
    return [
      {
        key: "e0",
        level: "chapter",
        start: 0,
        end: n,
        titleSpan: 0,
        title: titleFor({ title: bookTitle ?? "", matter: null }, words),
        titleSource: bookTitle ? "heading" : "generated",
        matter: null,
        starts: true,
        included: true,
      },
    ];
  const sorted = [...boundaries].sort((a, b) => a.index - b.index);
  const starts: Boundary[] = [];
  // Words before the first boundary make an entry of their own.
  const first = sorted[0]?.index ?? n;
  if (first > 0) {
    // A table of contents at the top is its own entry, not the preamble's.
    const tocStart = [...toc].filter((i) => i < first).sort((a, b) => a - b)[0];
    if (tocStart !== undefined && tocStart > 0)
      starts.push(
        {
          index: 0,
          level: "chapter",
          titleSpan: 0,
          title: "",
          titleSource: "generated",
          matter: null,
        },
        {
          index: tocStart,
          level: "chapter",
          titleSpan: 0,
          title: "",
          titleSource: "generated",
          matter: "toc",
        },
      );
    else
      starts.push({
        index: 0,
        level: "chapter",
        titleSpan: 0,
        title: "",
        titleSource: "generated",
        matter: tocStart === 0 ? "toc" : null,
      });
  }
  starts.push(...sorted);
  // A TOC in the middle of the book, after a title page that was a boundary,
  // still gets its own entry.
  const tocBlocks = [...toc].sort((a, b) => a - b);
  if (
    tocBlocks.length &&
    !starts.some((s) => s.index === tocBlocks[0]) &&
    tocBlocks[0] >= first &&
    first < n
  ) {
    starts.push({
      index: tocBlocks[0],
      level: "chapter",
      titleSpan: 0,
      title: "",
      titleSource: "generated",
      matter: "toc",
    });
    starts.sort((a, b) => a.index - b.index);
  }
  // A contents row ends with the list. What follows it before the next
  // boundary (a dedication, an epigraph, an unheaded prologue) is a row of
  // its own, since the contents start left out. Short lines that are not
  // sentences, on the list's page, still read as entries.
  for (let i = 0; i < starts.length; i++) {
    if (starts[i].matter !== "toc") continue;
    const next = i + 1 < starts.length ? starts[i + 1].index : n;
    let last = -1;
    for (const t of toc)
      if (t >= starts[i].index && t < next && t > last) last = t;
    if (last < 0) continue;
    let end = last + 1;
    while (end < next && listLine(book.blocks[end])) end += 1;
    if (end >= next) continue;
    starts.splice(i + 1, 0, {
      index: end,
      level: starts[i].level,
      titleSpan: 0,
      title: "",
      titleSource: "generated",
      matter: null,
    });
  }

  const entries: PlanEntry[] = [];
  starts.forEach((b, i) => {
    const start = b.index;
    const end = i + 1 < starts.length ? starts[i + 1].index : n;
    if (end <= start) return;
    const verdict = classify(
      book,
      start,
      end,
      b.title,
      b.matter,
      entries.length === 0,
      bookTitle,
    );
    const title = titleFor({ title: b.title, matter: verdict.matter }, words);
    entries.push({
      key: `e${start}`,
      level: b.level,
      start,
      end,
      titleSpan: b.titleSpan,
      title,
      // Untitled matter is named by its kind ("Table of contents"), a made-up
      // title like a numbered one, so `retitle` speaks it in the book's
      // language.
      titleSource: b.title ? b.titleSource : "generated",
      matter: verdict.matter,
      starts: true,
      included: !verdict.leftOut,
      ...(verdict.offSpine && { offSpine: true }),
    });
  });
  return entries;
}

/** A line a contents list may hold on its page: short, and not a sentence. */
function listLine(b: Prepared): boolean {
  return !b.breakBefore && !b.scene && b.short && !b.sentence && b.words <= 6;
}
