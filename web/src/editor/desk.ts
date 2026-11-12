// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The Desk, as arithmetic: what the editor opens on. The Desk serves re-entry,
// the writer's return to where they were, what they had decided and what they
// were about to do, and nothing else.
//
// The first band is the writer's own last sentence rather than a summary of
// it, because reading their own last line is how writers resume.
//
// Pure and separate from the component, so text extraction is settled in
// Node.

import {
  MARKERS,
  commonmarkCodec,
  paragraphText,
  type Paragraph,
  type Run,
} from "./engine";
import { findNode, walk } from "../project/structure";
import type {
  DocNode,
  DocumentProperties,
  DocumentStructure,
  NodeStat,
} from "../project/types";

/** Roughly how much of the last paragraph to show. Words, not characters. */
const TAIL_WORDS = 60;

/**
 * The last paragraph the writer wrote, from the file they last had open, or
 * `null` when there is none.
 *
 * A paragraph, not a line: a line break inside a paragraph is not a place
 * anyone stopped. It comes back parsed by the codec, with its formatting
 * intact, so the Desk renders it as the editor would. A directive like
 * `{align:center}# Ormai siamo partiti!` must come back as a centered heading,
 * not as brace text, and the only reliable reading of the format is the
 * codec's own.
 *
 * Two kinds of paragraph are skipped. A page break has no content to read
 * back. A paragraph that is only a note to self is the thread, which has its
 * own band; showing it here would repeat it and hide the prose the writer
 * stopped in.
 */
export function lastParagraph(markdown: string): Paragraph | null {
  const doc = commonmarkCodec.parse(markdown);
  for (let i = doc.length - 1; i >= 0; i--) {
    const para = doc[i];
    if (para.blockType === "pagebreak") continue;
    const text = paragraphText(para);
    // The codec represents a blank block as whitespace-only text.
    if (text.trim().length === 0) continue;
    if (isMarkerOnly(text)) continue;
    return tailParagraph(para, TAIL_WORDS);
  }
  return null;
}

/**
 * The node whose words changed most recently, the Desk's first answer to
 * where the writer left off.
 *
 * Only a node the editor wrote has a stamp: the count pass sets `updatedAt` on
 * a save and never backfills it, so an entry without one is not a candidate.
 * When nothing was ever written the answer is `null` and the Desk falls to the
 * next source, rather than to whichever node sorts first.
 */
export function mostRecent(props: DocumentProperties | null): string | null {
  const nodes = props?.stats.perNode ?? [];
  let best: NodeStat | null = null;
  for (const entry of nodes) {
    if (!entry.updatedAt) continue;
    if (!best || entry.updatedAt > (best.updatedAt ?? "")) best = entry;
  }
  return best?.nodeId ?? null;
}

/**
 * The first place a writer can start: the first Section in reading order,
 * else the first Part.
 *
 * A fresh project's creation shapes are Parts holding nothing, and a writer
 * told to start must be handed a page they can type on. A project with only
 * Parts still has one, the first Part's own text file. Without the fallback
 * the Desk's start button does not render on a fresh project, which leaves a
 * phone landing with no way in.
 */
export function firstOpenable(structure: DocumentStructure): DocNode | null {
  let fallback: DocNode | null = null;
  let found: DocNode | null = null;
  walk(structure.children, (node) => {
    if (found) return;
    if (!fallback) fallback = node;
    if (node.kind === "section") found = node;
  });
  return found ?? fallback;
}

/**
 * The desk's reading order: the nodes to try, in the order to try them.
 *
 * Each source answers a different question, and the first with an answer
 * wins. What the writer last wrote (`mostRecent`) is the resume band's
 * subject. What they last had open (`ui.lastOpened`) covers a project opened
 * but never written. The first openable node guarantees that an untouched
 * project still has a page to start on. A source naming a node that is not in
 * the document, such as a removed `lastOpened`, is dropped rather than
 * trusted, and each node appears once.
 */
export function resumeSources(
  props: DocumentProperties | null,
  structure: DocumentStructure,
): DocNode[] {
  const out: DocNode[] = [];
  const seen = new Set<string>();
  const push = (id: string | null) => {
    if (!id || seen.has(id)) return;
    const node = findNode(structure, id);
    if (!node) return;
    seen.add(id);
    out.push(node);
  };
  push(mostRecent(props));
  push(props?.ui.lastOpened ?? null);
  const first = firstOpenable(structure);
  if (first) push(first.id);
  return out;
}

/**
 * The last thing left unfinished, if the writer left a sign.
 *
 * Searched from the end backwards, because the most recent marker is the one
 * they were in the middle of. Returns `null` when there is none, so the band
 * is absent rather than invented.
 */
export function openThread(markdown: string): OpenThread | null {
  const blocks = blocksOf(markdown);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const text = plain(blocks[i]);
    for (const marker of MARKERS) {
      const found = marker.exec(text);
      if (found)
        return { text: clamp(found[0], 90), fromEnd: blocks.length - 1 - i };
    }
  }
  return null;
}

export interface OpenThread {
  /** The marker and what followed it, trimmed to something readable. */
  text: string;
  /** How many paragraphs from the end it sits. */
  fromEnd: number;
  /**
   * The file it was found in. `openThread` reads a string and cannot know it,
   * so the caller stamps it on; the Desk uses it to name the marker's Section.
   */
  fileName?: string;
}

// Finding a marker needs no model, because the Desk must be complete for a
// writer who never configures an assistant. `MARKERS` lives in the engine's
// domain so this layer and the engine agree on what counts as a marker.

/** A paragraph that is nothing but a note to self. */
function isMarkerOnly(text: string): boolean {
  return MARKERS.some((marker) => {
    const found = marker.exec(text);
    return found !== null && found[0].trim().length === text.trim().length;
  });
}

function blocksOf(markdown: string): string[] {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

/**
 * The paragraph's last `n` words, as a paragraph.
 *
 * The cut is made on the joined text, so a word split across a format
 * boundary stays one word, and the surviving tail keeps the formats the runs
 * carried. The leading ellipsis says the cut happened, and it rides the first
 * surviving run's format.
 */
function tailParagraph(para: Paragraph, n: number): Paragraph {
  const full = paragraphText(para);
  const words = full.split(/\s+/).filter(Boolean);
  if (words.length <= n) return para;
  const skip = words.length - n;
  let seen = 0;
  let cut = full.length;
  for (const match of full.matchAll(/\S+/g)) {
    if (seen === skip) {
      cut = match.index ?? full.length;
      break;
    }
    seen += 1;
  }
  const runs: Run[] = [];
  let offset = 0;
  for (const run of para.runs) {
    const from = Math.max(cut - offset, 0);
    if (from < run.text.length) {
      const text = run.text.slice(from);
      runs.push({
        text: runs.length === 0 ? `… ${text}` : text,
        format: run.format,
      });
    }
    offset += run.text.length;
  }
  return { ...para, runs };
}

function clamp(text: string, max: number): string {
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Markdown stripped back to what the writer would read aloud.
 *
 * Shallow, and used only by the thread scan: it quotes the writer's prose,
 * it does not render it. Anything it fails to strip shows as a stray
 * asterisk, a smaller cost than a parser in the editor's first paint.
 */
function plain(block: string): string {
  // Escaped characters are parked before the emphasis rules run and restored
  // after. Otherwise the italic rule eats an escaped asterisk's markers, and a
  // literal `\*asterisk\*` comes back as `\asterisk`.
  //
  // The slot is delimited by a control character, not spaces: a
  // space-delimited index is indistinguishable from a sentence holding a bare
  // number, and " 3 " would come back as `undefined`.
  const parked: string[] = [];
  return block
    .replace(ESCAPED, (_, ch: string) => `${SLOT}${parked.push(ch) - 1}${SLOT}`)
    .replace(CODE, "$1")
    .replace(BOLD, "$1")
    .replace(ITALIC, "$1")
    .replace(PARKED, (_, index: string) => parked[Number(index)])
    .replace(FOLD_LINES, " ")
    .trim();
}

const SLOT = "";
const PARKED = new RegExp(`${SLOT}(\\d+)${SLOT}`, "g");
const ESCAPED = /\\([\\*`_{}[\]()#+\-.!])/g;
const CODE = /`([^`]*)`/g;
const BOLD = /\*\*([^*]*)\*\*/g;
const ITALIC = /\*([^*]*)\*/g;
const FOLD_LINES = /\s*\n\s*/g;
