// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import MarkdownIt from "markdown-it";
import type { Token } from "markdown-it";
import { closeOf } from "./referenceAnswers";
import { stripAsides } from "./asides";
import { hasContent } from "../text/hasContent";

// The names a book's people and places go by.
//
// `/where` finds a moment the writer describes, and a writer describes it the
// way the book talks: "when the old man dies", not "when Aldo dies". The
// character sheet's first field, "Names and nicknames", knows Aldo is the old
// man, and the Locations document knows the harbour is also "the Mouth". Only
// those two fields are read: the names the writer recorded, never what a
// sheet says about the person, whose age, role, relationships and fears are
// private notes a locate run has no use for. A note nested under a name
// ("only the children say it") is about the name and is not read either.
//
// The writer may reshape these files in any editor, so the document is parsed
// and the token stream walked, as in `referenceAnswers.ts`: a code fence is
// not a field, `**Names**:` is the same label as `**Names:**`, and an
// unanswered field, whose empty bullet CommonMark reads as a setext
// underline, has no answers rather than a stray `-`.
//
// A label here is looser than in `referenceAnswers.ts`, which asks whether a
// question is unanswered; here the question is which field this is, and an
// answer on the label's own line (`**Names:** Aldo, the old man`) or on the
// line under it without a bullet counts. A field is an item whose first line
// opens with a bold run, and whatever follows the run is answer. One line is
// one name, never split on commas: "Aldo, son of Bruno" is one name.
//
// The templates are localised, so the labels are read from the shipped
// templates (`nameFieldsOf`, fed by `referenceTemplates.ts`), not copied
// here: a renamed template field changes what is read, and a new language
// brings its labels. A writer who renames the field in their own copy loses
// the aliases but keeps the title, so the name the person is filed under
// still reaches the model.

/** Parsing only, with `html: false` as in `referenceAnswers.ts`. */
const parser = new MarkdownIt({ html: false, linkify: false });

/** Which fields hold names, in every language the templates ship. */
export interface NameFields {
  /** The names field of a character sheet ("Names and nicknames"). */
  sheet: readonly string[];
  /** The names field under a place ("Names"). */
  place: readonly string[];
  /** A place heading the template ships and nobody filled ("[Location]"). */
  placeholders: readonly string[];
}

/** A label or heading as compared: its words, without the colon or case. */
function normal(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*$/, "")
    .trim()
    .toLocaleLowerCase();
}

/**
 * The lines of a run of inline tokens as a reader sees them, markup taken
 * off, so `*the Mouth*` is the name `the Mouth`.
 */
function lines(children: readonly Token[]): string[] {
  return children
    .map((child) =>
      child.type === "text" || child.type === "code_inline"
        ? child.content
        : child.type === "softbreak" || child.type === "hardbreak"
          ? "\n"
          : "",
    )
    .join("")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim());
}

/**
 * The label an inline run opens with and the lines after it, or null when it
 * does not open with a bold run. The colon may sit inside the run or just
 * after it; everything past it is the writer's answer.
 */
function opening(inline: Token): { label: string; rest: string[] } | null {
  const children = inline.children ?? [];
  let at = 0;
  // Leading whitespace a strip left behind is not text before the label.
  while (children[at]?.type === "text" && !children[at].content.trim()) at += 1;
  if (children[at]?.type !== "strong_open") return null;
  let depth = 0;
  let label = "";
  for (; at < children.length; at += 1) {
    const child = children[at];
    if (child.type === "strong_open") depth += 1;
    else if (child.type === "strong_close") depth -= 1;
    else label += child.content;
    if (depth === 0) break;
  }
  const rest = lines(children.slice(at + 1));
  if (rest.length > 0) rest[0] = rest[0].replace(/^:\s*/, "");
  return { label, rest: rest.filter(hasContent) };
}

/** One labelled field, and the `##` it sits under (null above the first). */
interface Field {
  heading: string | null;
  label: string;
  answers: string[];
}

/**
 * A document's `##` headings and its labelled fields, in order.
 *
 * A field is an item of a list at the document's own level whose first line
 * opens with a bold label. Its answers are the rest of the label's line, any
 * paragraph of the item's own, and the first line of each item directly under
 * it. A list nested under an answer is a note about that answer and is not
 * read. A `#` is the document's title and names nothing, so it closes the
 * current `##` rather than opening one.
 */
function outline(text: string): { headings: string[]; fields: Field[] } {
  const tokens = parser.parse(stripAsides(text).replace(/\r\n?/g, "\n"), {});
  const headings: string[] = [];
  const fields: Field[] = [];
  let heading: string | null = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "heading_open" && token.level === 0) {
      const inline = tokens[i + 1];
      heading =
        token.tag === "h2" && inline?.type === "inline"
          ? lines(inline.children ?? [])
              .join(" ")
              .trim()
          : null;
      if (heading !== null) headings.push(heading);
      continue;
    }
    if (token.type !== "list_item_open" || token.level !== 1) continue;
    const close = closeOf(tokens, i);
    // The item's own lines sit two levels in (item → paragraph → inline);
    // the first line of an item directly under it, four.
    const own = token.level + 2;
    const child = token.level + 4;
    const inside = tokens.slice(i + 1, close);
    const [first, ...more] = inside.filter(
      (one) => one.type === "inline" && one.level === own,
    );
    const field = first ? opening(first) : null;
    if (field === null) continue;
    const answers = [...field.rest];
    for (const one of more) answers.push(...lines(one.children ?? []));
    for (let j = 0; j < inside.length; j += 1)
      if (
        inside[j].type === "list_item_open" &&
        inside[j].level === token.level + 2
      ) {
        const firstLine = inside
          .slice(j + 1)
          .find((one) => one.type === "inline" && one.level === child);
        if (firstLine) answers.push(lines(firstLine.children ?? [])[0] ?? "");
      }
    fields.push({
      heading,
      label: field.label,
      answers: answers.filter(hasContent),
    });
    i = close;
  }
  return { headings, fields };
}

/**
 * The names a character sheet records besides its title: the answers under
 * its names field. Empty when the field is unanswered, missing or renamed, as
 * the title still names the person, and empty, never a throw, when the file
 * surprises the parser, so a locate run does not fail on it.
 */
export function sheetAliases(text: string, fields: NameFields): string[] {
  const labels = new Set(fields.sheet.map(normal));
  try {
    return (
      outline(text).fields.find((field) => labels.has(normal(field.label)))
        ?.answers ?? []
    );
  } catch {
    return [];
  }
}

/**
 * The places a Locations document records, one list per place: its `##`
 * heading first, because that is what the writer calls it, then the answers
 * under its names field. The template's placeholder heading is no place, nor
 * is a heading with no letter in it; a heading with no fields under it is a
 * place, because the writer named it, which is all `/where` needs.
 *
 * At most `limit` places, the walk stopping there: one document may hold
 * thousands, and the caller shows a bounded list. One pass, so a long
 * document costs its length and no more.
 */
export function placeNames(
  text: string,
  fields: NameFields,
  limit = Infinity,
): string[][] {
  const labels = new Set(fields.place.map(normal));
  const placeholders = new Set(fields.placeholders.map(normal));
  try {
    const found = outline(text);
    const aliases = new Map<string, string[]>();
    for (const field of found.fields)
      if (field.heading !== null && labels.has(normal(field.label)))
        aliases.set(field.heading, [
          ...(aliases.get(field.heading) ?? []),
          ...field.answers,
        ]);
    const seen = new Set<string>();
    const out: string[][] = [];
    for (const heading of found.headings) {
      if (out.length >= limit) break;
      if (seen.has(heading)) continue;
      seen.add(heading);
      if (!hasContent(heading) || placeholders.has(normal(heading))) continue;
      out.push([heading, ...(aliases.get(heading) ?? [])]);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Which fields hold names, as one language's shipped templates spell them:
 * the character sheet's first field, and the Locations template's first `##`
 * (its placeholder) with the first field under it.
 */
export function nameFieldsOf(character: string, locations: string): NameFields {
  const sheet = outline(character).fields[0];
  const place = outline(locations).fields.find(
    (field) => field.heading !== null,
  );
  return {
    sheet: sheet ? [sheet.label] : [],
    place: place ? [place.label] : [],
    placeholders: place?.heading ? [place.heading] : [],
  };
}
