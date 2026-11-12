// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The merged document, the inline diff's display surface: one continuous
// document (the right side's text, with left-only text spliced back in where
// its surrounding context implies), the decoration spans that say which run
// is which, and the hunks the Accept buttons serve.
//
//   unchanged  the paragraph is identical, or the word survived.
//   deleted    text present only on the left side: spliced in, struck
//              through.
//   inserted   text present only on the right side: shown bare.
//
// The engine knows only `leftSide` and `rightSide`; the session decides what
// they are. The output is a valid `Doc`, with decorations in visible-character
// offsets into the merged paragraphs, the coordinates the view's text-node
// walk measures in.
//
// Hunks and decorations come from the same walk, so they never disagree
// about what changed. A hunk is one maximal run of touching changed segments
// on one paragraph, of any kind, so an adjacent delete and insert are one
// hunk, one Accept and one undo step; on the block paths it is a whole
// paragraph. A hunk carries three coordinate systems:
//
//   merged  the span the tint paints and the button serves;
//   left    what an accept aimed at the left side rewrites, separator-aware,
//           from the last kept word before the run to the first kept word
//           after it;
//   right   what an accept aimed at the right side rewrites, the right text
//           with its own separators and format.
//
// An empty range still carries where its side's text would land: a pure
// insert's left range is zero-length at the landing index, and a pure
// deletion's right range is zero-length at the restore point (the kept-before
// word's end, or the right side's paragraph count for blocks). The accept
// reads it when it restores. The accept re-slices the other side's own runs,
// never the merged plain-format segments.

import type { Doc, Format, Paragraph, Run } from "../../domain/model";
import type { WordToken } from "../../domain/words";
import { splitWords } from "../../domain/words";
import {
  alignBlocks,
  pairParagraphs,
  paragraphText,
  type BlockPair,
} from "./blocks";
import { diffTokens } from "./words";
import { splitSentences } from "./sentences";

export type DiffDecorationKind = "deleted" | "inserted";

/** The diff's unit of change, the writer's review lens. Word is the engine's
 * native resolution; sentence groups a paragraph at its sentence boundaries;
 * paragraph renders an edited paragraph as one whole-paragraph replace, the
 * coarse view of which paragraphs changed. */
export type DiffGranularity = "word" | "sentence" | "paragraph";

/** The side an accept aims at, the mutation target. The other side is a
 * read-only source whose runs are only sliced for insertion. */
export type DiffAim = "left" | "right";

export interface DiffDecoration {
  /** Index into the merged doc's paragraphs. */
  para: number;
  /** Visible-character offset into the paragraph's plain text. */
  from: number;
  /** One past the last visible character. */
  to: number;
  kind: DiffDecorationKind;
}

export type HunkKind = "delete" | "insert" | "replace";

export interface Hunk {
  /** Index into this recompute's hunk set: in memory only, never serialized.
   * The session refuses a hunk absent from its current set. */
  id: number;
  /** A display hint for the view. The accept derives the operation from the
   * ranges, the aim and `block`, and reads `kind` only for a textless block. */
  kind: HunkKind;
  /** A whole-paragraph change: the accept moves blocks, not text. */
  block: boolean;
  /** Index into the merged doc's paragraphs: the Accept button's anchor. */
  para: number;
  /** The merged-doc span the tint paints and the button serves. */
  merged: { from: number; to: number };
  /** The left-side range the accept rewrites when aimed at the left:
   * zero-length at the landing for a pure right-only change. */
  left: { para: number; from: number; to: number };
  /** The right-side range the accept rewrites when aimed at the right. A
   * pure left-only change carries a zero-length span at the restore point,
   * where the text would land in the right side; its paragraph is always a
   * real index, never -1. */
  right: { para: number; from: number; to: number };
}

export interface MergedDiff {
  doc: Doc;
  decorations: DiffDecoration[];
  hunks: Hunk[];
}

/** A hunk before its doc-level coordinates are stamped. The `id`, the merged
 * paragraph index and the pair's left and right indices are stamped by
 * `appendPairMerge`, the only place the pair is known. */
export type RawHunk = Omit<Hunk, "id" | "para">;

/** The format deleted text is spliced with: a left-only run has no
 * right-side format to take, and the mark carries the meaning, not the run. */
const PLAIN: Format = { bold: false, italic: false, monospace: false };

/** The token-level diff's size ceiling, per side of one paragraph pair, well
 * below the point where `lcsTable`'s `(n+1)*(m+1)` allocation can throw.
 * Only pathological input, such as a huge paste, reaches it. */
const MAX_DIFF_TOKENS = 5000;

/** The character-grain fallback's own per-side ceiling, sized for
 * characters. */
const MAX_DIFF_CHARS = 20_000;

/** The LCS table's cell-count ceiling, `n × m`, checked alongside the
 * per-side caps. Two paragraphs each just under `MAX_DIFF_TOKENS` still make
 * a 25,000,000-cell `Int32Array` of about 100MB, and every grain switch of
 * the snapshot compare and every wheel notch of the history rail can re-run
 * it. */
const MAX_DIFF_CELLS = 10_000_000;

function exceedsDiffBudget(n: number, m: number, perSideCap: number): boolean {
  return n > perSideCap || m > perSideCap || n * m > MAX_DIFF_CELLS;
}

/** The pair loop's shared state. `leftPos` counts the left-side paragraphs
 * emitted so far, the block-insert hunk's landing index in the left doc.
 * `rightPos` counts the right-side ones, a left-only paragraph's landing
 * index in the right doc, stamped into the delete hunk's empty right range.
 * The walk is in pair order, so the right paragraphs before a pair are the
 * ones before its restore point. */
interface BlockWalk {
  doc: Paragraph[];
  decorations: DiffDecoration[];
  hunks: Hunk[];
  nextId: number;
  leftPos: number;
  rightPos: number;
}

/** The block-path walk every grain shares. One-sided pairs (whole-block
 * insert or delete) and identical pairs are the same at every grain; only an
 * aligned, edited pair is the caller's, through `onEditedPair`: the token
 * merge at word and sentence grain, the whole-paragraph replace at paragraph
 * grain. The walk owns the block hunk stamping, including the restore
 * landing a delete hunk carries, so that coordinate has one definition. */
function walkBlockPairs(
  leftSide: Doc,
  rightSide: Doc,
  pairs: BlockPair[],
  onEditedPair: (walk: BlockWalk, pair: BlockPair) => void,
): MergedDiff {
  const walk: BlockWalk = {
    doc: [],
    decorations: [],
    hunks: [],
    nextId: 0,
    leftPos: 0,
    rightPos: 0,
  };

  const pushBlockHunk = (
    kind: HunkKind,
    mergedTo: number,
    leftPara: number,
    leftTo: number,
    rightPara: number,
    rightTo: number,
  ) => {
    walk.hunks.push({
      id: walk.nextId++,
      kind,
      block: true,
      para: walk.doc.length - 1,
      merged: { from: 0, to: mergedTo },
      left: { para: leftPara, from: 0, to: leftTo },
      right: { para: rightPara, from: 0, to: rightTo },
    });
  };

  for (const pair of pairs) {
    if (pair.left === -1) {
      // A whole right-only paragraph: an insertion at block scale.
      const para = rightSide[pair.right];
      const plain = paragraphText(para);
      walk.doc.push(para);
      if (plain.length > 0)
        walk.decorations.push({
          para: walk.doc.length - 1,
          from: 0,
          to: plain.length,
          kind: "inserted",
        });
      pushBlockHunk(
        "insert",
        plain.length,
        walk.leftPos,
        0,
        pair.right,
        plain.length,
      );
      walk.rightPos++;
      continue;
    }
    if (pair.right === -1) {
      // A whole left-only paragraph: spliced in, struck through, its right
      // range empty at the restore landing.
      const para = leftSide[pair.left];
      const plain = paragraphText(para);
      walk.doc.push({
        ...para,
        runs: para.runs.map((r) => ({ ...r, format: PLAIN })),
      });
      if (plain.length > 0)
        walk.decorations.push({
          para: walk.doc.length - 1,
          from: 0,
          to: plain.length,
          kind: "deleted",
        });
      pushBlockHunk(
        "delete",
        plain.length,
        pair.left,
        plain.length,
        walk.rightPos,
        0,
      );
      walk.leftPos++;
      continue;
    }
    if (pair.equal) {
      walk.doc.push(rightSide[pair.right]);
      walk.leftPos++;
      walk.rightPos++;
      continue;
    }
    onEditedPair(walk, pair);
    walk.leftPos++;
    walk.rightPos++;
  }

  return { doc: walk.doc, decorations: walk.decorations, hunks: walk.hunks };
}

export function buildMergedDoc(
  leftSide: Doc,
  rightSide: Doc,
  grain: DiffGranularity = "word",
): MergedDiff {
  if (grain === "paragraph")
    return buildParagraphMergedDoc(leftSide, rightSide);
  const pairs = alignBlocks(leftSide, rightSide);
  return walkBlockPairs(leftSide, rightSide, pairs, (walk, pair) => {
    const base = leftSide[pair.left];
    const target = rightSide[pair.right];
    const merged = mergeParagraph(base, target, grain);
    appendPairMerge(walk, pair, merged);
  });
}

/** The whole-paragraph replace: the paragraph grain's view of an aligned,
 * edited pair, and the other grains' view of a format-only change or an
 * oversized pair. The target fills the merged slot with one full-paragraph
 * `inserted` decoration and one `replace` block hunk carrying both full
 * paragraphs. The hunk's `para` fields are placeholders that
 * `appendPairMerge` stamps.
 */
function wholeParagraphReplace(
  base: Paragraph,
  target: Paragraph,
): MergedParagraph {
  const plain = paragraphText(target);
  return {
    paragraph: target,
    decorations:
      plain.length > 0 ? [{ from: 0, to: plain.length, kind: "inserted" }] : [],
    hunks: [
      {
        kind: "replace",
        block: true,
        merged: { from: 0, to: plain.length },
        left: { para: 0, from: 0, to: paragraphText(base).length },
        right: { para: 0, from: 0, to: plain.length },
      },
    ],
  };
}

/** Stamp one pair's merge into the walk: the paragraph appended, the
 * decorations and hunks given their merged position, and the hunks' left and
 * right ranges given the pair's source paragraphs. */
function appendPairMerge(
  walk: BlockWalk,
  pair: BlockPair,
  merged: MergedParagraph,
): void {
  walk.doc.push(merged.paragraph);
  for (const dec of merged.decorations)
    walk.decorations.push({ para: walk.doc.length - 1, ...dec });
  for (const h of merged.hunks)
    walk.hunks.push({
      ...h,
      id: walk.nextId++,
      para: walk.doc.length - 1,
      left: { ...h.left, para: pair.left },
      right: { ...h.right, para: pair.right },
    });
}

/** The paragraph-grain merge: every block-level difference of the pair is a
 * hunk, and an aligned, edited pair is one whole-paragraph replace. The
 * merged slot shows the right side only, marking the paragraph as changed
 * without word detail. One-sided and identical pairs behave as at word
 * grain. */
function buildParagraphMergedDoc(leftSide: Doc, rightSide: Doc): MergedDiff {
  const pairs = pairParagraphs(leftSide, rightSide);
  return walkBlockPairs(leftSide, rightSide, pairs, (walk, pair) => {
    appendPairMerge(
      walk,
      pair,
      wholeParagraphReplace(leftSide[pair.left], rightSide[pair.right]),
    );
  });
}

interface MergedParagraph {
  paragraph: Paragraph;
  decorations: Array<Omit<DiffDecoration, "para">>;
  hunks: RawHunk[];
}

/** One append of the walk, kind-aware and never format-merged. The format
 * merge crosses kind boundaries (a kept and an inserted segment share the
 * right format), and the hunk grouping must see every kind. The format-merged
 * run list is for the paragraph; this list is for the hunks. */
interface Span {
  text: string;
  format: Format;
  kind: "kept" | "inserted" | "deleted";
  mergedFrom: number;
  mergedTo: number;
  /** Base token index (kept and deleted). */
  baseIdx: number;
  /** Target token index (kept and inserted). */
  targetIdx: number;
  /** The target offset this inserted segment began at (inserted only). */
  targetFrom: number;
}

/** The character-grain fallback's tokenizer: one token per Unicode code
 * point, punctuation and whitespace included, so a token boundary never falls
 * inside a surrogate pair. The offsets stay in UTF-16 code units, like every
 * other offset in this file. */
function splitChars(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  let offset = 0;
  for (const ch of text) {
    tokens.push({ text: ch, start: offset, end: offset + ch.length });
    offset += ch.length;
  }
  return tokens;
}

/**
 * One edited pair at token level, word or sentence grain: the right
 * paragraph with the left-only tokens spliced back in, and the spans marked.
 *
 * A text-identical pair whose block face changed never reaches the token
 * walk; it becomes one whole-paragraph replace.
 *
 * The token lists cover words or sentences only, so the separators are
 * carried by the segments around them. A kept or inserted segment takes the
 * right text between the previous consumed position and the token, the right
 * paragraph's own spacing; a deleted segment takes the left text between the
 * previous left position and the token, the spacing the deleted token had.
 * Kept and inserted segments take the right paragraph's format at their
 * position; deleted segments are plain.
 *
 * A maximal run of touching insert and delete spans becomes one hunk, whose
 * ranges `groupHunks` derives.
 */
function mergeParagraph(
  base: Paragraph,
  target: Paragraph,
  grain: "word" | "sentence",
): MergedParagraph {
  const baseText = paragraphText(base);
  const targetText = paragraphText(target);
  if (
    baseText === targetText &&
    (base.blockType !== target.blockType || base.alignment !== target.alignment)
  ) {
    // A formatting-only change: the block face is a paragraph-level
    // property, so the whole paragraph is the unit of change.
    return wholeParagraphReplace(base, target);
  }
  const split = grain === "sentence" ? splitSentences : splitWords;
  let baseTokens = split(baseText);
  let targetTokens = split(targetText);
  // Past the budget the pair becomes a whole-paragraph replace: `lcsTable`
  // has no cap of its own, and past roughly 46,000 tokens per side its
  // allocation throws, uncaught, and crashes the editor session.
  if (
    exceedsDiffBudget(baseTokens.length, targetTokens.length, MAX_DIFF_TOKENS)
  ) {
    return wholeParagraphReplace(base, target);
  }
  let ops = diffTokens(
    baseTokens.map((t) => t.text),
    targetTokens.map((t) => t.text),
  );
  if (grain === "sentence") {
    // A replace whose deleted and inserted sentences carry the same words
    // changes only where the sentence boundaries fall ("A B. C D." against
    // "A B C. D."). The merged doc would mark every word struck and inserted
    // at once, so word grain takes over for that pair. A sentence replace
    // whose words differ stays at sentence grain, where marking the shared
    // words twice is the lens's design. A sentence-count mismatch alone does
    // not degrade the pair: adding one sentence regroups nothing.
    const deletedWords = new Map<string, number>();
    const insertedWords = new Map<string, number>();
    let anyDelete = false;
    let anyInsert = false;
    for (const op of ops) {
      if (op.kind === "delete") {
        anyDelete = true;
        for (const w of splitWords(baseTokens[op.base].text)) {
          deletedWords.set(w.text, (deletedWords.get(w.text) ?? 0) + 1);
        }
      } else if (op.kind === "insert") {
        anyInsert = true;
        for (const w of splitWords(targetTokens[op.target].text)) {
          insertedWords.set(w.text, (insertedWords.get(w.text) ?? 0) + 1);
        }
      }
    }
    let regroupOnly = anyDelete && anyInsert;
    if (regroupOnly) {
      if (deletedWords.size !== insertedWords.size) {
        regroupOnly = false;
      } else {
        for (const [w, n] of deletedWords) {
          if (insertedWords.get(w) !== n) {
            regroupOnly = false;
            break;
          }
        }
      }
    }
    if (regroupOnly) {
      baseTokens = splitWords(baseText);
      targetTokens = splitWords(targetText);
      // The first check counted sentence tokens, far fewer than these word
      // tokens, so an oversized paragraph can reach the limit here.
      if (
        exceedsDiffBudget(
          baseTokens.length,
          targetTokens.length,
          MAX_DIFF_TOKENS,
        )
      ) {
        return wholeParagraphReplace(base, target);
      }
      ops = diffTokens(
        baseTokens.map((t) => t.text),
        targetTokens.map((t) => t.text),
      );
    }
  }

  // A punctuation-only or whitespace-only difference. The splitters never
  // tokenize separators, so "Hello, world." against "Hello world!" yields
  // only `keep` ops and the pair would render unchanged, with no Accept
  // button. Such a pair is re-run at character grain through the same walk.
  // It must be an LCS, not a common prefix and suffix trim: trimming
  // "A B. C D." against "A B C. D." would strike ". C" and insert " C.",
  // marking the shared word "C" twice. `alignBlocks` keys on the raw text
  // and found this pair unequal, so the character walk always finds a real
  // difference.
  let charFallback = false;
  if (
    baseText !== targetText &&
    ops.length > 0 &&
    ops.every((op) => op.kind === "keep")
  ) {
    // A few very long words with no spaces pass the token guard.
    if (exceedsDiffBudget(baseText.length, targetText.length, MAX_DIFF_CHARS)) {
      return wholeParagraphReplace(base, target);
    }
    baseTokens = splitChars(baseText);
    targetTokens = splitChars(targetText);
    ops = diffTokens(
      baseTokens.map((t) => t.text),
      targetTokens.map((t) => t.text),
    );
    charFallback = true;
  }

  const formatAt = (offset: number): Format => {
    let acc = 0;
    for (const run of target.runs) {
      if (offset < acc + run.text.length) return run.format;
      acc += run.text.length;
    }
    return target.runs.length > 0
      ? target.runs[target.runs.length - 1].format
      : PLAIN;
  };

  const segments: Array<{ text: string; format: Run["format"] }> = [];
  const spans: Span[] = [];
  const decorations: Array<Omit<DiffDecoration, "para">> = [];

  const push = (run: Run) => {
    const last = segments[segments.length - 1];
    // Runs merge by format alone: the mark lives in the decorations, never
    // in the doc.
    if (
      last &&
      last.format.bold === run.format.bold &&
      last.format.italic === run.format.italic &&
      last.format.monospace === run.format.monospace
    ) {
      last.text += run.text;
      return;
    }
    segments.push({ ...run, text: run.text });
  };

  /** Push `text`, drawn from the target paragraph at `startOffset`, as one or
   * more runs split at the target's own run boundaries. A single word can
   * cross a format boundary the writer made mid-word, and `formatAt` answers
   * for one offset only, which would flatten the span to its first
   * character's run. */
  const pushTargetSpan = (text: string, startOffset: number): void => {
    if (text.length === 0) return;
    let acc = 0;
    let pos = startOffset;
    const end = startOffset + text.length;
    for (const run of target.runs) {
      const runStart = acc;
      const runEnd = acc + run.text.length;
      acc = runEnd;
      if (runEnd <= pos || runStart >= end) continue;
      const sliceStart = Math.max(pos, runStart);
      const sliceEnd = Math.min(end, runEnd);
      push({
        text: text.slice(sliceStart - startOffset, sliceEnd - startOffset),
        format: run.format,
      });
      pos = sliceEnd;
      if (pos >= end) return;
    }
    // Text sourced from the target never runs past its runs; anything that
    // does is pushed in the last run's format rather than dropped.
    push({
      text: text.slice(pos - startOffset),
      format:
        target.runs.length > 0
          ? target.runs[target.runs.length - 1].format
          : PLAIN,
    });
  };

  let targetPos = 0;
  let mergedPos = 0;
  // The left side's token cursor. A keep op carries only its target index,
  // so the walk tracks the base index in lockstep: keeps and deletes consume
  // a base token, inserts do not.
  let baseCursor = 0;

  const append = (span: Span) => {
    const from = mergedPos;
    spans.push(span);
    // Deleted text is plain and is not target text, so it has no target run
    // boundary to split at; every other kind comes from the target and
    // splits at its run boundaries.
    if (span.kind === "deleted") push({ text: span.text, format: span.format });
    else pushTargetSpan(span.text, span.targetFrom);
    mergedPos += span.text.length;
    if (span.kind !== "kept")
      decorations.push({
        from,
        to: mergedPos,
        kind: span.kind === "inserted" ? "inserted" : "deleted",
      });
  };

  for (const op of ops) {
    if (op.kind === "keep") {
      const token = targetTokens[op.target];
      // The right text since the last consumed position: the word and the
      // separator before it.
      const text = targetText.slice(targetPos, token.end);
      append({
        text,
        format: formatAt(token.start),
        kind: "kept",
        mergedFrom: mergedPos,
        mergedTo: mergedPos + text.length,
        baseIdx: baseCursor,
        targetIdx: op.target,
        targetFrom: targetPos,
      });
      targetPos = token.end;
      baseCursor++;
      continue;
    }
    if (op.kind === "insert") {
      const token = targetTokens[op.target];
      const text = targetText.slice(targetPos, token.end);
      append({
        text,
        format: formatAt(token.start),
        kind: "inserted",
        mergedFrom: mergedPos,
        mergedTo: mergedPos + text.length,
        baseIdx: -1,
        targetIdx: op.target,
        targetFrom: targetPos,
      });
      targetPos = token.end;
      continue;
    }
    const token = baseTokens[op.base];
    // The left-only word is spliced in with the separator it had in the left
    // text, between the previous base word and this one, so a deleted word
    // between kept words keeps its spacing. A deleted first base word has no
    // separator before it, so it carries the one that follows it, up to the
    // next base word's start, or the next kept word would glue onto it
    // ("Thecat sat"). At character grain (`charFallback`) tokens are
    // contiguous, so `nextStart` already equals `token.end`, and the added
    // space would be a character the text never had.
    const prevEnd = op.base > 0 ? baseTokens[op.base - 1].end : 0;
    const nextStart =
      op.base + 1 < baseTokens.length
        ? baseTokens[op.base + 1].start
        : token.end;
    // The left's tail after its last word (a period, a closing quote) is
    // never a token. When that last word is deleted and the right ends
    // differently, the tail goes with the word: the right's own tail, pushed
    // after the walk, cannot stand for it, and it would vanish from the
    // merged view ("Hello world." to "Hello there" loses the period).
    const lastBase = op.base === baseTokens.length - 1;
    const baseTail = lastBase ? baseText.slice(token.end) : "";
    const targetTail = targetText.slice(
      targetTokens.length > 0 ? targetTokens[targetTokens.length - 1].end : 0,
    );
    const tail = baseTail !== targetTail ? baseTail : "";
    const end = (prevEnd === 0 ? nextStart : token.end) + tail.length;
    const text =
      (!charFallback && prevEnd === 0 && mergedPos > 0 ? " " : "") +
      baseText.slice(prevEnd, end);
    append({
      text,
      format: PLAIN,
      kind: "deleted",
      mergedFrom: mergedPos,
      mergedTo: mergedPos + text.length,
      baseIdx: op.base,
      targetIdx: -1,
      targetFrom: 0,
    });
    baseCursor++;
  }

  // The target's tail after the last token (punctuation, a closing quote,
  // trailing whitespace) is never a token, so the loop never consumes it.
  // It goes into the merged text kept, in the target's format and with no
  // decoration, as a kept word's leading separator does; dropping it would
  // truncate every changed paragraph that ends in punctuation.
  // It bypasses `append` and `spans` because it names no base or target
  // token index: `groupHunks` reads `keptAfter.baseIdx` from `baseTokens`,
  // and a synthetic span would hand it an out-of-bounds index when the
  // target's last word is part of a changed run ("The cat." to "The dog!").
  if (targetPos < targetText.length) {
    pushTargetSpan(targetText.slice(targetPos), targetPos);
  }

  // Two empty paragraphs produce no spans, and a text block never holds zero
  // runs.
  if (segments.length === 0) {
    segments.push({ text: "", format: PLAIN });
  }

  const runs: Run[] = segments.map((s) => ({ text: s.text, format: s.format }));
  return {
    paragraph: {
      runs,
      alignment: target.alignment,
      blockType: target.blockType,
    },
    decorations,
    hunks: groupHunks(spans, baseText, baseTokens, targetText, targetTokens),
  };
}

/** Group a paragraph's changed spans into hunks, one per maximal run of
 * touching insert and delete spans, with the separator-aware left and right
 * ranges the accept rewrites. */
function groupHunks(
  spans: Span[],
  baseText: string,
  baseTokens: WordToken[],
  targetText: string,
  targetTokens: WordToken[],
): RawHunk[] {
  const hunks: RawHunk[] = [];
  let i = 0;
  while (i < spans.length) {
    if (spans[i].kind === "kept") {
      i++;
      continue;
    }
    let j = i;
    while (j < spans.length && spans[j].kind !== "kept") j++;
    const run = spans.slice(i, j);
    const keptBefore = i > 0 ? spans[i - 1] : null;
    const keptAfter = j < spans.length ? spans[j] : null;

    // The left range runs from the end of the last kept word before the run
    // to a boundary that depends on the run's kind. A run that brings right
    // text ends at the first kept word after it, so the insert's own
    // trailing separator replaces the left one ("The quick brown" to "The
    // fast brown" deletes " quick" and inserts " fast "). A delete-only run
    // ends at the last deleted word's end, so the separator before the
    // kept-after word survives ("the old house" to "the house" deletes
    // " old", never the space between "the" and "house"). At the paragraph
    // head the deleted words carry the separator that follows them, by the
    // first-word rule in `mergeParagraph`, so the run reaches the kept-after
    // word's start ("the quick brown fox" to "brown fox" deletes
    // "the quick ").
    const hasInsert = run.some((s) => s.kind === "inserted");
    const hasDelete = run.some((s) => s.kind === "deleted");
    const leftFrom = keptBefore ? baseTokens[keptBefore.baseIdx].end : 0;
    let leftTo: number;
    if (hasInsert) {
      leftTo = keptAfter
        ? baseTokens[keptAfter.baseIdx].start
        : baseText.length;
    } else if (keptBefore) {
      let lastDelete: Span | null = null;
      for (const s of run) if (s.kind === "deleted") lastDelete = s;
      leftTo = lastDelete
        ? baseTokens[lastDelete.baseIdx].end
        : baseText.length;
    } else {
      leftTo = keptAfter
        ? baseTokens[keptAfter.baseIdx].start
        : baseText.length;
    }

    // The right range runs from the first inserted span's target start, its
    // leading separator included, to the last inserted word's end plus the
    // separator after it: `next.start` when a kept word follows, or the
    // paragraph's text end. Stopping at `token.end` there would drop the
    // writer's final period, closing quote and spacing from the accepted
    // edit. `applyHunk` bounds-checks against the same runs as `targetText`;
    // a drift refuses, never clamps.
    //
    // A delete-only run's right span is empty but carries the restore point,
    // the kept-before word's end in the right paragraph or 0 at its head. An
    // accept aimed at the left side never reads it.
    let rightFrom = 0;
    let rightTo = 0;
    let lastInsert: Span | null = null;
    for (const s of run) {
      if (s.kind === "inserted") {
        if (lastInsert === null) rightFrom = s.targetFrom;
        lastInsert = s;
      }
    }
    if (lastInsert !== null) {
      const next = targetTokens[lastInsert.targetIdx + 1];
      rightTo = next ? next.start : targetText.length;
    } else if (keptBefore) {
      rightFrom = rightTo = targetTokens[keptBefore.targetIdx].end;
    }

    const kind: HunkKind =
      hasInsert && hasDelete ? "replace" : hasInsert ? "insert" : "delete";

    hunks.push({
      kind,
      block: false,
      merged: { from: run[0].mergedFrom, to: run[run.length - 1].mergedTo },
      left: { para: 0, from: leftFrom, to: leftTo },
      right: { para: 0, from: rightFrom, to: rightTo },
    });
    i = j;
  }
  return hunks;
}
