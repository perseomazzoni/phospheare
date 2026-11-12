// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── Quotations checked against what was read ─────────────────────────────────
//
// `PROSE_BOUNDARY` asks for every quotation exactly as the source writes it,
// and `anchorState` holds a review's findings to that. A chat answer gets the
// same check, because a model's near-misses (a typographic apostrophe, a
// capital letter, an added article) are ones a writer would not catch, and a
// writer takes a chat's quotation for the book's words.
//
// An answer's quotations, every blockquote and every inline quotation long
// enough to be a passage rather than a name, are looked for in the texts the
// run itself read. The comparison forgives what a copy may change without
// changing the words (the kind of quotation mark, the apostrophe, emphasis
// markers, spacing, letter case, a marked elision) and nothing else, so what
// it reports is a quotation whose words are not in what was read.

import { mendTables } from "./answerForm";
import { typographic } from "./textMatch";

/** Shorter than this, a quoted phrase is a name or a title, not a passage. */
export const QUOTE_MIN = 25;

/** At most this many unfound quotations are kept on a turn. */
export const UNFOUND_MAX = 12;

/** At most this long, each, as kept on a turn. */
export const UNFOUND_QUOTE_MAX = 600;

/** A citation id a quotation may end with (`QUOTE_FORM`). */
const TRAILING_ID =
  /[\s(【[]*(?:node:[^\s)\]】,;]+|reference:[^\n)\]】]+?\.md|web:\d+)[\s)\]】.,;]*$/u;

/** A marked elision: `...`, `…`, `[…]`, `(…)`. */
const ELISION =
  /\s*(?:\[\s*(?:…|\.\.\.)\s*\]|\(\s*(?:…|\.\.\.)\s*\)|…|\.\.\.)\s*/u;

/**
 * The quotations an answer makes, as written: each blockquote whole (its
 * lines joined, its closing source id and outer quotation marks taken off),
 * then each inline «…», “…” or "…" of at least `QUOTE_MIN` characters outside
 * a blockquote. A fenced code block is a diagram, never a quotation.
 */
export function quotedPassages(answer: string): string[] {
  const out: string[] = [];
  const prose: string[] = [];
  let block: string[] = [];
  let fenced = false;
  const flush = () => {
    if (block.length === 0) return;
    // A closing line that only says whose words they were ("— Leo Bellini
    // - 4" under the quotation) is an attribution, not the passage.
    const lines =
      block.length > 1 && ATTRIBUTION_LINE.test(block[block.length - 1])
        ? block.slice(0, -1)
        : block;
    const whole = lines.join(" ").replace(TRAILING_ID, "").trim();
    for (const piece of quotationsIn(whole)) {
      const passage = unwrap(withoutAttribution(piece));
      if (Array.from(passage).length >= QUOTE_MIN) out.push(passage);
    }
    block = [];
  };
  // A table the model broke is read as the writer sees it (`mendTables`):
  // a row's quotations are inline, never one stray blockquote.
  for (const line of mendTables(answer).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const quoted = /^\s*>\s?(.*)$/.exec(line);
    if (quoted) {
      block.push(quoted[1] ?? "");
      continue;
    }
    flush();
    prose.push(line);
  }
  flush();
  const inline = /«([^«»\n]+)»|“([^“”\n]+)”|"([^"\n]+)"/gu;
  for (const match of prose.join("\n").matchAll(inline)) {
    const passage = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (Array.from(passage).length >= QUOTE_MIN) out.push(passage);
  }
  return out;
}

/**
 * The answer's quotations whose words are in none of `texts`, in the order
 * the answer makes them, each once, at most `UNFOUND_MAX`.
 */
export function unfoundQuotes(
  answer: string,
  texts: readonly string[],
): string[] {
  const haystacks = texts.map(comparable);
  const out: string[] = [];
  for (const passage of quotedPassages(answer)) {
    if (out.includes(Array.from(passage).slice(0, UNFOUND_QUOTE_MAX).join("")))
      continue;
    const pieces = passage
      .split(ELISION)
      .map(comparable)
      .filter((piece) => piece.length > 0);
    if (pieces.length === 0) continue;
    const found = haystacks.some((text) => inOrder(text, pieces));
    if (!found)
      out.push(Array.from(passage).slice(0, UNFOUND_QUOTE_MAX).join(""));
    if (out.length === UNFOUND_MAX) break;
  }
  return out;
}

/** Every piece in `text`, each after the one before it. */
function inOrder(text: string, pieces: readonly string[]): boolean {
  let from = 0;
  for (const piece of pieces) {
    const at = text.indexOf(piece, from);
    if (at < 0) return false;
    from = at + piece.length;
  }
  return true;
}

// ── Source names after a quotation ───────────────────────────────────────────
//
// A model often follows a verbatim quotation with the Section's name after a
// dash («…» — Leo Bellini - 4), on the same line or the next, or in
// parentheses after the sentence. `TRAILING_ID` takes off only a closing id,
// so these name forms are stripped here before the search. The warning is
// worth something only while it is rare; one that fires on a correct
// quotation teaches the writer to ignore it.

/** A blockquote's last line that names a source rather than quoting one. */
const ATTRIBUTION_LINE = /^\s*[—–-]{1,2}\s*\S.{0,79}$/u;

/** A closing quotation mark or a sentence's end, a dash and a short name. */
const DASHED_NAME = /^([\s\S]*[»”".!?…])\s*[—–]{1,2}\s*[^«»“”".!?…]{1,80}$/u;

/** A sentence's end, then a short name in parentheses to the end. */
const PARENTHESISED_NAME = /^([\s\S]*[»”".!?…])\s*\([^()]{1,80}\)$/u;

/** `passage` without a source name its writer set after it. */
function withoutAttribution(passage: string): string {
  const dashed = DASHED_NAME.exec(passage);
  if (dashed) return dashed[1].trim();
  const parenthesised = PARENTHESISED_NAME.exec(passage);
  return parenthesised ? parenthesised[1].trim() : passage;
}

/**
 * A blockquote holding two quotations one after the other — «…» «…» — read as
 * two: joined, the pair is in no text, since the book has words between them.
 */
function quotationsIn(block: string): string[] {
  if (!/^[«“]/u.test(block)) return [block];
  return block.split(/(?<=[»”])\s+(?=[«“])/u);
}

/** The outer quotation marks of a blockquote, if it has a matching pair. */
function unwrap(passage: string): string {
  const pairs: Record<string, string> = { "«": "»", "“": "”", '"': '"' };
  const close = pairs[passage[0] ?? ""];
  return close && passage.length > 1 && passage.endsWith(close)
    ? passage.slice(1, -1).trim()
    : passage;
}

/**
 * A text as the comparison reads it: what a faithful copy may still change,
 * made the same on both sides.
 */
function comparable(text: string): string {
  return typographic(text.normalize("NFC"))
    .replace(/[*_]/g, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}
