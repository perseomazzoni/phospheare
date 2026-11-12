// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Block alignment, the document level of the diff: which paragraph of the
// left side corresponds to which paragraph of the right side. Only aligned
// pairs get the word-level treatment; unaligned paragraphs are whole-block
// changes.
//
// Equality compares text and block face (type and alignment), so a paragraph
// whose face changed is a change, never an equal pair. Otherwise the word
// grain's token merge would see no word differ and render the new face
// unmarked. A textless block (a page break, an emptied paragraph) is the same
// block only at the same position among its side's textless blocks, and never
// pairs by similarity, so a moved break stays a delete and an insert.

import type { Doc } from "../../domain/model";
import { splitWords } from "../../domain/words";
import { lcsTable } from "./words";

/** How much word overlap makes two paragraphs the same paragraph at word
 * grain. Low enough that a heavily edited paragraph (two of seven words
 * surviving) still diffs at word level rather than as a whole block; high
 * enough that two different paragraphs are not welded together. */
const PAIR_THRESHOLD = 0.2;

export interface BlockPair {
  /** Index into the left side's doc, or -1 when the paragraph is
   * right-only. */
  left: number;
  /** Index into the right side's doc, or -1 when the paragraph is
   * left-only. */
  right: number;
  /** Whether the two paragraphs are identical in text and block face. */
  equal: boolean;
}

export function paragraphText(para: Doc[number]): string {
  return para.runs.map((r) => r.text).join("");
}

/** The one empty-or-whitespace rule the identity key and the pairing passes
 * share. */
function isEmptyText(text: string): boolean {
  return text.trim().length === 0;
}

/** The full identity of a paragraph block: its text and block face (type
 * and alignment) and, for an empty or whitespace-only block, its ordinal
 * among the empty-text blocks of its own document, from `emptyOrdinals`. An
 * empty block matches only itself at the same ordinal, because pairing two
 * identical breaks across ordinals would hide a moved break as an equal pair.
 * The raw text stays in the key, so a whitespace change at the same position
 * stays a change.
 *
 * The ordinal counts other empty blocks, not the paragraph's index in the
 * document: an absolute index would change the key of every unmoved break
 * when an ordinary paragraph is inserted before it, turning N unmoved breaks
 * into up to 2N spurious hunks. */
function paragraphKey(para: Doc[number], emptyOrdinal: number): string {
  const text = paragraphText(para);
  return isEmptyText(text)
    ? `${para.blockType}\0${para.alignment}\0${emptyOrdinal}\0${text}`
    : `${text}\0${para.blockType}\0${para.alignment}`;
}

/** For each paragraph in `side`, the count of empty-text blocks before it. */
function emptyOrdinals(side: Doc): number[] {
  const ordinals: number[] = [];
  let count = 0;
  for (const para of side) {
    ordinals.push(count);
    if (isEmptyText(paragraphText(para))) count++;
  }
  return ordinals;
}

export function alignBlocks(leftSide: Doc, rightSide: Doc): BlockPair[] {
  return pairBlocks(leftSide, rightSide, PAIR_THRESHOLD);
}

/** The paragraph-grain pairing: `pairBlocks` with the stricter
 * `PARAGRAPH_PAIR_THRESHOLD`, so a heading-to-paragraph swap or a
 * page-break-to-empty swap is a change, never an equal pair. */
export function pairParagraphs(leftSide: Doc, rightSide: Doc): BlockPair[] {
  return pairBlocks(leftSide, rightSide, PARAGRAPH_PAIR_THRESHOLD);
}

/**
 * The shared block-pairing core, three passes in cost order:
 *
 *   1. Common prefix and suffix by `paragraphKey`, in linear time.
 *   2. LCS over the middle by `paragraphKey`.
 *   3. Greedy similarity pairing for the leftovers, so an edited paragraph
 *      still diffs at word level, or replaces whole at paragraph grain,
 *      rather than appearing as a new block. An empty-text block never pairs
 *      by similarity.
 *
 * The threshold is all that separates the two grains.
 */
function pairBlocks(
  leftSide: Doc,
  rightSide: Doc,
  threshold: number,
): BlockPair[] {
  // The rail's walk at depth 0 hands back the same array on both sides; the
  // three passes would otherwise run on every wheel notch of an idle walk.
  if (leftSide === rightSide) {
    return leftSide.map((_, i) => ({ left: i, right: i, equal: true }));
  }
  const baseText = leftSide.map(paragraphText);
  const targetText = rightSide.map(paragraphText);
  const baseEmptyOrdinals = emptyOrdinals(leftSide);
  const targetEmptyOrdinals = emptyOrdinals(rightSide);
  const keyOf = (side: Doc, ordinals: number[], index: number) =>
    paragraphKey(side[index], ordinals[index]);

  // Pass 1: the common prefix and suffix by full-paragraph key, so a changed
  // face is a change.
  let lead = 0;
  while (
    lead < leftSide.length &&
    lead < rightSide.length &&
    keyOf(leftSide, baseEmptyOrdinals, lead) ===
      keyOf(rightSide, targetEmptyOrdinals, lead)
  ) {
    lead++;
  }
  let baseTail = leftSide.length;
  let targetTail = rightSide.length;
  while (
    baseTail > lead &&
    targetTail > lead &&
    keyOf(leftSide, baseEmptyOrdinals, baseTail - 1) ===
      keyOf(rightSide, targetEmptyOrdinals, targetTail - 1)
  ) {
    baseTail--;
    targetTail--;
  }

  // Passes 2 and 3 index the middle from 0, offset by `lead`.
  const midBaseText = baseText.slice(lead, baseTail);
  const midTargetText = targetText.slice(lead, targetTail);
  const midBaseKeys = leftSide
    .slice(lead, baseTail)
    .map((para, i) => paragraphKey(para, baseEmptyOrdinals[lead + i]));
  const midTargetKeys = rightSide
    .slice(lead, targetTail)
    .map((para, i) => paragraphKey(para, targetEmptyOrdinals[lead + i]));

  // Pass 2: LCS by full-paragraph equality.
  const exact = new Map<number, number>();
  for (const [b, t] of lcsEqual(midBaseKeys, midTargetKeys)) exact.set(b, t);

  // Pass 3: greedy similarity pairing for the unpaired, best first, each
  // side consumed once.
  //
  // Each paragraph's word set is tokenized once, outside the B×T loop below,
  // because `splitWords` compiles a fresh RegExp on every call.
  const wordSetOf = (text: string): Set<string> | null => {
    if (isEmptyText(text)) return null;
    const words = splitWords(text).map((t) => t.text);
    // Word-free text ("..." or "***") tokenizes to nothing, and two empty
    // sets score 0, which would stop "..." pairing with itself across a face
    // change. A pseudo-token of the trimmed text lets it match itself only.
    return new Set(words.length > 0 ? words : [text.trim()]);
  };
  const baseWordSets = midBaseText.map(wordSetOf);
  const targetWordSets = midTargetText.map(wordSetOf);

  const paired = new Map<number, number>(); // base → target
  const consumedTarget = new Set<number>(exact.values());
  const candidates: { base: number; target: number; score: number }[] = [];
  for (let b = 0; b < midBaseText.length; b++) {
    if (exact.has(b)) continue;
    const baseWords = baseWordSets[b];
    if (baseWords === null) continue;
    for (let t = 0; t < midTargetText.length; t++) {
      if (consumedTarget.has(t)) continue;
      const targetWords = targetWordSets[t];
      if (targetWords === null) continue;
      const score = overlap(baseWords, targetWords);
      if (score >= threshold) candidates.push({ base: b, target: t, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const usedBase = new Set<number>();
  const claimedTarget = new Set<number>();
  for (const cand of candidates) {
    if (usedBase.has(cand.base) || paired.has(cand.base)) continue;
    if (claimedTarget.has(cand.target)) continue;
    usedBase.add(cand.base);
    paired.set(cand.base, cand.target);
    claimedTarget.add(cand.target);
  }

  // Emit the middle in target order: each target paragraph after its aligned
  // base partner, with any unpaired base blocks before that partner emitted
  // as deletes; a target with no partner is an insert.
  const midPairs = emitMiddlePairs(
    midBaseText,
    midTargetText,
    exact,
    paired,
    lead,
    (b, t) => midBaseKeys[b] === midTargetKeys[t],
  );

  const pairs: BlockPair[] = [];
  for (let i = 0; i < lead; i++) pairs.push({ left: i, right: i, equal: true });
  pairs.push(...midPairs);
  for (let i = baseTail, j = targetTail; i < baseText.length; i++, j++)
    pairs.push({ left: i, right: j, equal: true });
  return pairs;
}

/** The target-order emission: walk the targets, emit each exact or
 * similarity-paired base before its partner, and push the unpaired targets
 * as inserts; the leftover bases fall out as deletes. */
function emitMiddlePairs(
  midBase: string[],
  midTarget: string[],
  exact: Map<number, number>,
  paired: Map<number, number>,
  lead: number,
  equalFn: (b: number, t: number) => boolean,
): BlockPair[] {
  const midPairs: BlockPair[] = [];
  let cursor = 0;
  const emitted = new Set<number>();
  const emitBase = (b: number) => {
    if (emitted.has(b)) return;
    emitted.add(b);
    const t = exact.get(b) ?? paired.get(b);
    midPairs.push(
      t === undefined
        ? { left: b + lead, right: -1, equal: false }
        : {
            left: b + lead,
            right: t + lead,
            equal: equalFn(b, t),
          },
    );
  };
  // A target is claimed by pass 2 or pass 3, never both, so one combined
  // reverse map is unambiguous.
  const byTarget = new Map<number, number>();
  for (const [b, t] of exact) byTarget.set(t, b);
  for (const [b, t] of paired) byTarget.set(t, b);
  for (let t = 0; t < midTarget.length; t++) {
    const partner = byTarget.get(t);
    if (partner !== undefined) {
      while (cursor < partner) emitBase(cursor++);
      emitBase(partner);
      cursor = partner + 1;
      continue;
    }
    midPairs.push({ left: -1, right: t + lead, equal: false });
  }
  while (cursor < midBase.length) emitBase(cursor++);
  return midPairs;
}

/** How much word overlap makes two paragraphs the same paragraph, edited, at
 * paragraph grain. The paragraph grain has no word level, so its bar is
 * stricter: a marginal overlap stays a delete and an insert, never a welded
 * replace. */
const PARAGRAPH_PAIR_THRESHOLD = 0.5;

/**
 * The word-set overlap of two paragraphs, 0 to 1: the similarity that decides
 * whether an edited paragraph is the same paragraph. It is the intersection
 * size over the union size, over sets of distinct words, so a paragraph that
 * gained a sentence still pairs with its edited self.
 */
function overlap(wa: Set<string>, wb: Set<string>): number {
  // Unguarded, `0 / 0` is `NaN`, which fails the threshold only by accident,
  // and an answer of 1 would pair two different paragraphs.
  if (wa.size === 0 && wb.size === 0) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / (wa.size + wb.size - common);
}

/**
 * The LCS of two token lists by exact equality, as (base, target) pairs in
 * target order, over the O(n·m) `lcsTable` the word diff shares.
 */
function lcsEqual(base: string[], target: string[]): Array<[number, number]> {
  const n = base.length;
  const m = target.length;
  const table = lcsTable(base, target);
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (base[i] === target[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[(i + 1) * (m + 1) + j] >= table[i * (m + 1) + (j + 1)]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}
