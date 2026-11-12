// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import MarkdownIt from "markdown-it";
import type { Token } from "markdown-it";
import { hasContent } from "../../text/hasContent";

// A reference document's outline, with exact places.
//
// Every line of every answer is kept with its offsets into the text it was
// given, because a record is evidence: a finding that quotes a character
// sheet names the field and the person the quote belongs to, and the quote is
// validated inside that field's own span. "Somewhere in the file"
// proves nothing when the same words sit under two fields.
//
// Parsed, never pattern-matched, for the reason `project/referenceAnswers.ts`
// gives: the writer owns these files and may reshape them in any editor. The
// token stream decides the structure (which item is a field, which heading a
// field sits under, what is a code fence); the source lines inside each
// token's `map` give the offsets. Within a field, a line is an answer line
// whatever its bullet or indentation, with its indentation kept, so a note
// nested under an answer can still be told from the answer.
//
// A field is a top-level list item, or a top-level paragraph, whose first
// line opens with a bold run: `**Label:** answer`, `**Label**: answer`, or an
// answer on the line under it with or without a bullet. A level-2 item is
// never a field, because the logline's formula `**[PROTAGONIST]**, a …`
// filled in is an answer. An item without a label directly after a field in
// the same list is that field's answer written flush-left, the case
// `project/referenceAnswers.ts` also keeps. Everything else (prose, a table,
// a quote, a list under no field) is loose: kept, with its offsets and its
// heading, for whoever reads it as context.

/** `html: false` for the reason `project/referenceAnswers.ts` gives. */
const parser = new MarkdownIt({ html: false, linkify: false });

/** A span of the text as given, trimmed, and how far its line was indented. */
export interface OutlineLine {
  text: string;
  start: number;
  end: number;
  /** Columns of indentation before the line's marker or text (a tab is 4). */
  indent: number;
}

export interface OutlineHeading {
  level: number;
  text: string;
  start: number;
  end: number;
}

export interface OutlineField {
  /** The nearest heading of level 2 or deeper above the field. */
  heading: OutlineHeading | null;
  /** The label as written, markup off, colon kept where the writer put one. */
  label: string;
  /** The whole field, label to last answer. */
  start: number;
  end: number;
  /** Every line of answer with content: the label line's rest first. */
  answers: OutlineLine[];
}

export interface Outline {
  /** The document's `#` title, when it opens with one. */
  title: string | null;
  headings: OutlineHeading[];
  fields: OutlineField[];
  /** Content under no field, each line with the heading it sits under. */
  loose: Array<OutlineLine & { heading: OutlineHeading | null }>;
}

/**
 * A label or heading as compared: its words alone, one space between them,
 * without the colon, in lower case, so `**Names**:` and `**Names:**` are one
 * label, and so is a label a writer retyped with two spaces.
 */
export function normalLabel(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .replace(/\s*:\s*$/u, "")
    .trim()
    .toLocaleLowerCase();
}

interface SourceLine {
  start: number;
  /** Where the line's content ends, before any `\r`. */
  end: number;
}

function sourceLines(text: string): SourceLine[] {
  const out: SourceLine[] = [];
  let start = 0;
  for (;;) {
    const at = text.indexOf("\n", start);
    const stop = at === -1 ? text.length : at;
    out.push({
      start,
      end: stop > start && text[stop - 1] === "\r" ? stop - 1 : stop,
    });
    if (at === -1) return out;
    start = at + 1;
  }
}

/**
 * What a line's own marker is: a quote's `>` and a bullet. Never an ordered
 * list's number: "1850. The flood." is Markdown for an item numbered 1850,
 * and on a timeline that number is the year, so stepping over it would lose
 * the one fact the line holds.
 */
const MARKER = /^(?:>\s?)*(?:[-*+](?:\s+|$))?/u;

/**
 * One source line as an answer line: indentation measured, a list or quote
 * marker stepped over, trailing space trimmed. Null for a line with nothing
 * a writer wrote in it.
 */
function lineAt(
  text: string,
  line: SourceLine,
  from = line.start,
): OutlineLine | null {
  const raw = text.slice(from, line.end);
  let at = 0;
  let indent = 0;
  while (at < raw.length && (raw[at] === " " || raw[at] === "\t")) {
    indent += raw[at] === "\t" ? 4 : 1;
    at += 1;
  }
  const marker = MARKER.exec(raw.slice(at));
  if (marker && from === line.start) at += marker[0].length;
  const body = raw.slice(at).replace(/\s+$/u, "");
  if (!hasContent(body)) return null;
  const start = from + at;
  return { text: body, start, end: start + body.length, indent };
}

/** The markup-free text of an inline run, one line per source line. */
function plain(children: readonly Token[]): string {
  return children
    .map((child) =>
      child.type === "text" || child.type === "code_inline"
        ? child.content
        : child.type === "softbreak" || child.type === "hardbreak"
          ? "\n"
          : "",
    )
    .join("");
}

/** The label an inline run opens with, or null when it opens with no bold. */
function openingLabel(inline: Token | undefined): string | null {
  const children = inline?.children ?? [];
  let at = 0;
  while (children[at]?.type === "text" && !children[at].content.trim()) at += 1;
  if (children[at]?.type !== "strong_open") return null;
  let depth = 0;
  let label = "";
  for (; at < children.length; at += 1) {
    const child = children[at];
    if (child.type === "strong_open") depth += 1;
    else if (child.type === "strong_close") depth -= 1;
    else if (child.type === "softbreak" || child.type === "hardbreak") break;
    else label += child.content;
    if (depth === 0) break;
  }
  return hasContent(label) ? label.replace(/\s+/gu, " ").trim() : null;
}

/**
 * Where the answer on a label's own line begins: after the closing `**` (or
 * `__`) of the opening bold run, and after a colon that sits outside it.
 */
function afterLabel(text: string, line: SourceLine): number | null {
  const raw = text.slice(line.start, line.end);
  const open = /(\*\*|__)/u.exec(raw);
  if (!open) return null;
  const close = raw.indexOf(open[1], open.index + 2);
  if (close === -1) return null;
  let at = close + 2;
  const rest = /^\s*:?/u.exec(raw.slice(at));
  at += rest ? rest[0].length : 0;
  return line.start + at;
}

function closeOf(tokens: readonly Token[], from: number): number {
  const level = tokens[from].level;
  for (let at = from + 1; at < tokens.length; at += 1)
    if (tokens[at].level === level && tokens[at].type.endsWith("_close"))
      return at;
  return tokens.length;
}

/**
 * A reference document's outline. Never throws on a writer's file: a
 * document the parser can make nothing of is all loose lines, which the
 * records read as the writer's own notes.
 */
export function outlineOf(text: string): Outline {
  const lines = sourceLines(text);
  const tokens = parser.parse(text, {});
  const outline: Outline = { title: null, headings: [], fields: [], loose: [] };
  let heading: OutlineHeading | null = null;

  const span = (map: [number, number] | null | undefined) => {
    const [first, stop] = map ?? [0, 0];
    return lines.slice(first, stop);
  };
  const addLoose = (range: readonly SourceLine[]) => {
    for (const line of range) {
      const one = lineAt(text, line);
      if (one) outline.loose.push({ ...one, heading });
    }
  };
  /** A field from its label and the source lines its token covers. */
  const field = (label: string, range: readonly SourceLine[]): OutlineField => {
    const [first, ...more] = range;
    const answers: OutlineLine[] = [];
    const from = first ? afterLabel(text, first) : null;
    if (first && from !== null) {
      const rest = lineAt(text, first, from);
      if (rest) answers.push({ ...rest, indent: 0 });
    }
    for (const line of more) {
      const one = lineAt(text, line);
      if (one) answers.push(one);
    }
    // The field ends where the writer's last word does, not on the blank
    // line a list item's range carries after it.
    return {
      heading,
      label,
      start: first?.start ?? 0,
      end: Math.max(first?.end ?? 0, answers[answers.length - 1]?.end ?? 0),
      answers,
    };
  };

  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token.level !== 0) continue;
    if (token.type === "heading_open") {
      const inline = tokens[at + 1];
      const words = plain(inline?.children ?? [])
        .replace(/\s+/gu, " ")
        .trim();
      const [line] = span(token.map);
      const found: OutlineHeading = {
        level: Number(token.tag.slice(1)),
        text: words,
        start: line?.start ?? 0,
        end: line?.end ?? 0,
      };
      if (found.level === 1) {
        // A `#` is the document's own title and names nothing: it closes
        // the current heading rather than opening one.
        if (outline.title === null) outline.title = words;
        heading = null;
      } else {
        heading = found;
        outline.headings.push(found);
      }
      at = closeOf(tokens, at);
      continue;
    }
    if (
      token.type === "bullet_list_open" ||
      token.type === "ordered_list_open"
    ) {
      const close = closeOf(tokens, at);
      let last: OutlineField | null = null;
      for (let item = at + 1; item < close; item += 1) {
        if (tokens[item].type !== "list_item_open" || tokens[item].level !== 1)
          continue;
        const end = closeOf(tokens, item);
        const inline = tokens
          .slice(item + 1, end)
          .find((one) => one.type === "inline");
        const label = openingLabel(inline);
        const range = span(tokens[item].map);
        if (label !== null) {
          last = field(label, range);
          outline.fields.push(last);
        } else if (last) {
          // An answer written flush-left, as a sibling of its label.
          for (const line of range) {
            const one = lineAt(text, line);
            if (one) last.answers.push(one);
          }
          last.end = Math.max(
            last.end,
            last.answers[last.answers.length - 1]?.end ?? 0,
          );
        } else addLoose(range);
        item = end;
      }
      at = close;
      continue;
    }
    if (token.type === "paragraph_open") {
      const label = openingLabel(tokens[at + 1]);
      const range = span(token.map);
      if (label !== null) outline.fields.push(field(label, range));
      else addLoose(range);
      at = closeOf(tokens, at);
      continue;
    }
    if (token.map) {
      // A table, a quote, a code block, a rule: the writer's, loose.
      addLoose(span(token.map));
      if (token.nesting === 1) at = closeOf(tokens, at);
    }
  }
  return outline;
}
