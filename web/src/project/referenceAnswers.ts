// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import MarkdownIt from "markdown-it";
import type { Token } from "markdown-it";
import { isUnwritten } from "../ai/domain/rooms";
import { stripAsides } from "./asides";

// ── Unanswered template questions ────────────────────────────────────────────
//
// Every reference document starts as a template: a run of questions, each a
// bold label, a hint in a comment, and an empty bullet for the writer.
//
//     `- **Paure:**`
//     `  <!-- Suggerimento: che cosa teme il personaggio? -->`
//     `  -`
//
// The questions left unanswered must not reach a model. The hint is
// already stripped, but `- **Paure:**` over nothing reads as a missing
// answer, and a model asked what the character fears answers from a blank.
// Thirty of those make the model's copy say the writer has barely begun a
// character they may have finished.
//
// This changes the model's copy only. The writer's view keeps every question,
// because that is what a template is for.
//
// ── Parsing over pattern matching ────────────────────────────────────────────
//
// The writer owns these files, can edit them in any editor, and need not keep
// the templates' shape. A line matcher would read `+ **Label:**` as prose,
// flatten a tab-indented answer and find questions inside a fenced code
// block, all silently. So the document is parsed and the token stream walked,
// and each token's `map` gives the source lines to remove. Everything kept is
// the writer's own bytes: nothing is re-rendered or normalized.
//
// An unanswered question is not a list item with an empty child: the empty
// `-` line underlines the label, so CommonMark reads the pair as a setext
// heading and the item has no content. An answered one is a paragraph with a
// nested list under it. `hasContent` handles both by asking only whether the
// writer put text there.

/**
 * Parsing only: `.render()` is never called, so `safeMarkdown.ts`'s renderer
 * hardening does not apply. `html: false` keeps a comment as text rather than
 * an html token, so `stripAsides` judges it whichever order the two strips
 * run in.
 */
const parser = new MarkdownIt({ html: false, linkify: false });

/**
 * Something the writer put there, with any note in it discounted.
 *
 * A letter or a digit, the test `stats.ts` uses for a word. Not any
 * non-space: an empty bullet the parser could not place (`* **A:**` then a
 * lone `*`, which CommonMark reads as lazy continuation) arrives as the text
 * `*`, as does a stray `-` or `:` from a half-edited question, and none of
 * them is an answer.
 */
function hasContent(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(stripAsides(value));
}

/**
 * Is this inline run nothing but a bold label?
 *
 * Structural, so `**Paure:**`, `__Paure:__` and `**Paure**:` are one shape,
 * and a change of emphasis syntax cannot turn a question into prose. Text
 * outside the bold run decides it: a formula line such as
 * `- **[PROTAGONIST]**, a [BRIEF DESCRIPTION], wants …` opens with bold too,
 * and is content written in the question's place.
 *
 * The colon is allowed on either side of the closing `**` and nowhere else.
 */
function isBareLabel(inline: Token): boolean {
  let depth = 0;
  let runs = 0;
  let outside = "";
  for (const child of inline.children ?? []) {
    if (child.type === "strong_open") {
      depth += 1;
      if (depth === 1) runs += 1;
      continue;
    }
    if (child.type === "strong_close") {
      depth -= 1;
      continue;
    }
    // Inside the bold run are the label's own words, which are the question.
    if (depth > 0) continue;
    if (child.type === "softbreak" || child.type === "hardbreak") continue;
    outside += child.content;
  }
  return runs === 1 && !hasContent(outside);
}

/** One question in the document, and what the writer did with it. */
interface Item {
  /** Source lines, `[from, to)`. */
  from: number;
  to: number;
  /** Which top-level list it belongs to; siblings share it. */
  list: number;
  /** Its first line is a bold label and nothing else: a question. */
  bare: boolean;
  /** Something the writer wrote lives under that label. */
  filled: boolean;
}

/** A heading and the lines it occupies, two when it is setext. */
interface Section {
  from: number;
  to: number;
  level: number;
}

/** The index of the `*_close` that matches the `*_open` at `from`. */
export function closeOf(tokens: readonly Token[], from: number): number {
  const level = tokens[from].level;
  for (let i = from + 1; i < tokens.length; i += 1)
    if (tokens[i].level === level && tokens[i].type.endsWith("_close"))
      return i;
  return tokens.length;
}

/**
 * Headings left standing over nothing.
 *
 * `## Identità` directly above `## Storia personale` is a table of contents
 * for a document that is not there, and reads as a section the writer chose
 * to leave blank rather than one never started. A heading survives if anything
 * survives under it before the next heading at its level or above; a deeper
 * heading counts as content.
 *
 * Run to a fixed point, so a `##` left hollow by the removal of the `###`
 * inside it goes on the next pass. Level 1 is never removed, so the assistant
 * can say which document it read.
 */
function dropEmptySections(
  alive: boolean[],
  lines: readonly string[],
  sections: readonly Section[],
): void {
  const hollow = (section: Section) => {
    if (!alive[section.from] || section.level < 2) return false;
    // From the end of this heading: a setext heading is two lines, and its
    // underline is not content under it.
    for (let i = section.to; i < alive.length; i += 1) {
      if (!alive[i]) continue;
      const next = sections.find((one) => one.from === i);
      if (next) return next.level <= section.level;
      if (lines[i].trim() !== "") return false;
    }
    return true;
  };
  for (
    let victim = sections.find(hollow);
    victim;
    victim = sections.find(hollow)
  )
    for (let line = victim.from; line < victim.to; line += 1)
      alive[line] = false;
}

// ── Unfilled fill-in formulas ────────────────────────────────────────────────
//
// Some templates offer a formula rather than a blank: the logline's
// `**[PROTAGONIST]**, a [BRIEF DESCRIPTION], wants [DESIRE]…`. It sits under
// its question as a bullet, so the parse reads it as an answer, and a model
// reading it learns about the template, not the book. `isUnwritten`
// (`ai/domain/rooms.ts`) discounts such a line when deciding whether a
// document is written; this applies the same rule to what is sent, so the two
// cannot disagree.
//
// A line with two or more all-caps slots is the template's. A slot is
// bracketed text with a capital and no lower-case letter, in any alphabet, so
// `[Location]`, a heading the writer is meant to rename, and a writer's own
// `[sic]` are not slots. A filled formula has no slots left and is the
// writer's. One with two slots still standing is dropped, because a model
// handed "Mara wants [DESIRE]" fills the gap from its own guess.

const SLOT = /\[[^\]\n\p{Ll}]*\p{Lu}[^\]\n\p{Ll}]*\]/gu;

function isFormula(line: string): boolean {
  return (line.match(SLOT) ?? []).length >= 2;
}

/**
 * The document with every unanswered question removed, whole.
 *
 * The block is the unit: the label, its hint and the empty bullet under it go
 * together, because half a question left behind is the same noise.
 *
 * A parse failure returns the text with only its formulas removed, never
 * empty. A model seeing a document's scaffolding is a cost; deleting a
 * writer's answers because their file surprised the parser is a loss.
 */
export function stripUnansweredQuestions(text: string): string {
  // markdown-it normalizes newlines before it counts lines, so the same
  // normalization happens here, or every `map` would be off by the number of
  // CRLFs above it.
  //
  // The unfilled formulas go first, as lines, so a question left holding
  // only one reads as unanswered and goes whole.
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !isFormula(line))
    .join("\n");
  const lines = normalized.split("\n");
  try {
    const tokens = parser.parse(normalized, {});
    const alive = lines.map(() => true);
    const sections: Section[] = [];
    const items: Item[] = [];
    let list = 0;

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      // A heading at the document's own level is a section. The setext
      // headings the empty bullets create sit inside list items, several
      // levels down, and are not sections.
      if (token.type === "heading_open" && token.level === 0 && token.map)
        sections.push({
          from: token.map[0],
          to: token.map[1],
          level: Number(token.tag.slice(1)),
        });
      if (token.level === 0 && token.type.endsWith("list_open")) list += 1;
      // Level 1 is an item of a list at the document's own level: the
      // questions. A bullet nested under an answer is the answer, not a
      // question of its own.
      if (token.type !== "list_item_open" || token.level !== 1 || !token.map)
        continue;
      const inner = tokens.slice(i + 1, closeOf(tokens, i));
      const inlines = inner.filter((one) => one.type === "inline");
      const [label, ...rest] = inlines;
      items.push({
        from: token.map[0],
        to: token.map[1],
        list,
        bare: label !== undefined && isBareLabel(label),
        filled: rest.some((one) => hasContent(one.content)),
      });
    }

    for (const [at, item] of items.entries()) {
      if (!item.bare || item.filled) continue;
      // An answer typed flush left is the label's sibling, not its child, so
      // the label reads as empty; removing it would leave the answer under no
      // question. A next sibling that is content rather than another question
      // keeps the label.
      const next = items[at + 1];
      if (next && next.list === item.list && !next.bare) continue;
      for (let line = item.from; line < item.to; line += 1) alive[line] = false;
    }

    dropEmptySections(alive, lines, sections);
    return lines
      .filter((_, index) => alive[index])
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch {
    return normalized;
  }
}

/**
 * Whether a reference document says anything the writer wrote: the
 * assistant's own test (`isUnwritten`), on the text as the assistant reads
 * it, with hints, unanswered questions and unfilled formulas gone. The same
 * rule on both sides, so a document this lets be created is one the chat
 * stops asking for.
 */
export function hasWriting(text: string): boolean {
  return !isUnwritten(stripAsides(stripUnansweredQuestions(text)));
}
