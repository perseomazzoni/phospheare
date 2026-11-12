// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type {
  DocNode,
  DocumentStats,
  DocumentStructure,
  NodeStat,
} from "./types";
import { walk } from "./structure";

// Counting a document.
//
// A word count is a number the writer quotes to other people, so its rule
// must be defensible and must not drift. A word is a whitespace-separated
// token containing at least one letter or digit, which leaves little markdown
// to strip:
//
//   don't            one token, has letters                         → 1
//   well-known       a hyphen does not split a word                 → 1
//   `**bold**`       markers ride on a token that has letters       → 1
//   `code`           a word in backticks is still a word            → 1
//   #  -  >  |  ---  no letters or digits                           → 0
//   —  …  ***        no letters or digits                           → 0
//
// A few things are removed first, because each would add tokens the writer
// never wrote: fenced code blocks, asides (`<!-- -->`), the URL half of links
// and images, and the format's two directives, a `{pagebreak}` line and the
// `{align:…}` at the front of an aligned paragraph, which would make a
// centred `* * *` one word. Both directives are the codec's
// alone: typed text has its `{` escaped, so a writer's own "{pagebreak}"
// still counts.

const ASIDE = /<!--[\s\S]*?-->/g;
/** `![alt](url)`: an image contributes nothing, not even its alt text. */
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
/** `[text](url)`: keep the text, drop the URL. */
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
/**
 * HTML tags and angle-bracket autolinks. Anchored to a leading letter so it
 * cannot eat `<6>` out of a line of arithmetic.
 */
const TAG = /<\/?[A-Za-z][^\s>]*>/g;
/** The codec's page break: a line of its own. */
const PAGEBREAK = /^\{pagebreak\}[ \t]*$/gm;
/** The codec's alignment, at the start of a paragraph's line. */
const ALIGN = /^\{align:(?:left|center|right|justify)\}/gm;

/**
 * A fenced block's opening line, as CommonMark reads it: three or more
 * backticks and an info string with no backtick. A line whose backtick run
 * closes later on the same line is a code span, which the codec writes for a
 * monospace run holding backticks. Backticks only: `~~~` is left as typed
 * and is a writer's scene break.
 */
const FENCE_OPEN = /^[ \t]*(`{3,})[^`]*$/;
/** A closing line: a backtick run and nothing but whitespace after it. */
const FENCE_CLOSE = /^[ \t]*(`{3,})[ \t]*$/;

const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Drop fenced code blocks.
 *
 * A scanner rather than one regex, because of the fence never closed, as
 * mid-paste: `$` under the `m` flag means end of line, so a single pattern
 * matches only the opening marker. An unterminated fence swallows the rest of
 * the file, as the renderer does. A fence closes only on a run at least as
 * long as the one that opened it.
 */
function stripFences(markdown: string): string {
  const kept: string[] = [];
  let open = 0;

  for (const line of markdown.split(/\r?\n/)) {
    if (open > 0) {
      const close = FENCE_CLOSE.exec(line);
      if (close && close[1].length >= open) open = 0;
      continue;
    }
    const start = FENCE_OPEN.exec(line);
    if (start) open = start[1].length;
    else kept.push(line);
  }
  return kept.join("\n");
}

export function countWords(markdown: string): number {
  if (!markdown) return 0;

  const prose = stripFences(markdown)
    .replace(PAGEBREAK, " ")
    .replace(ALIGN, "")
    .replace(ASIDE, " ")
    .replace(IMAGE, " ")
    .replace(LINK, "$1")
    .replace(TAG, " ");

  let count = 0;
  for (const token of prose.split(/\s+/)) {
    if (token && HAS_WORD_CHAR.test(token)) count += 1;
  }
  return count;
}

/** How many Parts and Sections the shape holds, at any depth. */
export function structureCounts(structure: DocumentStructure): {
  parts: number;
  sections: number;
} {
  let parts = 0;
  let sections = 0;
  walk(structure.children, (node: DocNode) => {
    if (node.kind === "part") parts += 1;
    else sections += 1;
  });
  return { parts, sections };
}

/**
 * Assemble the stats block from a per-node count.
 *
 * The totals are derived here, not passed in, so they cannot disagree with
 * the list they summarise. Entries naming a node the shape does not contain
 * are dropped, so a removed node stops contributing.
 *
 * Entries are keyed by the node's id, never a file name: the adopted snapshot
 * a count came from can change (another snapshot adopted, a rename
 * re-stemming the files), and the count belongs to the node.
 */
export function buildStats(
  structure: DocumentStructure,
  perNode: NodeStat[],
  countedAt: string,
): DocumentStats {
  const known = new Set<string>();
  walk(structure.children, (node: DocNode) => known.add(node.id));

  const kept = perNode.filter((entry) => known.has(entry.nodeId));
  const { parts, sections } = structureCounts(structure);

  return {
    words: kept.reduce((total, entry) => total + entry.words, 0),
    parts,
    sections,
    countedAt,
    perNode: kept,
  };
}

/**
 * Replace one node's count, leaving every other entry alone, and re-total.
 * The node's session delta survives a mid-session save: it names the last
 * session with work, and only the exit diff ends a session.
 */
export function withNodeCount(
  stats: DocumentStats,
  structure: DocumentStructure,
  nodeId: string,
  words: number,
  at: string,
): DocumentStats {
  const others = stats.perNode.filter((entry) => entry.nodeId !== nodeId);
  const prev = stats.perNode.find((entry) => entry.nodeId === nodeId);
  return buildStats(
    structure,
    [
      ...others,
      {
        nodeId,
        words,
        updatedAt: at,
        ...(prev?.lastDelta !== undefined ? { lastDelta: prev.lastDelta } : {}),
      },
    ],
    at,
  );
}

/**
 * Diff a stats block against a session baseline: the per-node word delta for
 * every node that moved, positive for written words and negative for cut
 * ones. A node the baseline does not name counts from zero, so a section
 * created and written this sitting moved by its whole length; the caller
 * folds backfilled counts into the baseline so disk truth never reads as
 * work. An empty result means the visit changed nothing, and the caller
 * writes nothing.
 */
export function sessionDeltas(
  perNode: readonly NodeStat[],
  baseline: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const entry of perNode) {
    const delta = entry.words - (baseline.get(entry.nodeId) ?? 0);
    if (delta !== 0) out.set(entry.nodeId, delta);
  }
  return out;
}

/** A new project's stats: counted, and empty. */
export function emptyStats(countedAt: string): DocumentStats {
  return { words: 0, parts: 0, sections: 0, countedAt, perNode: [] };
}
