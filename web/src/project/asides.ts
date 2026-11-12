// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Asides: `<!-- … -->` in the writer's files.
//
// An aside is the one thing in a document addressed to nobody: a template's
// `<!-- Hint: … -->` (Italian `<!-- Suggerimento: … -->`), a writer's
// `<!-- fix this scene -->`, a passage parked out of the way. The reader
// renders them as quiet notes, and they are stripped before any of the
// document reaches a model, so guidance never becomes context.
//
// A comment is a margin thread beside the prose (`editor/comments`), kept in
// its own file and never inside the writer's text; an aside is the part of
// the text that is not for reading.
//
// This module owns the syntax, so every consumer shares one definition.
//
// The scan is textual, so a literal `<!--` inside a fenced code block counts
// as an aside. A reference document is prose and pointers, not code, so a
// fence-aware parser is not worth its cost.

const ASIDE_SOURCE = String.raw`<!--([\s\S]*?)-->`;

/**
 * A fresh global matcher. A shared regex would carry `lastIndex` between
 * scans; a factory cannot.
 */
export function asideRegex(): RegExp {
  return new RegExp(ASIDE_SOURCE, "g");
}

/**
 * An aside that is the whole of its line or lines, newline included.
 *
 * The body is `(?:(?!-->)[\s\S])*?`, not `[\s\S]*?`: a lazy body can backtrack
 * past the first `-->` when what follows does not match, so
 * `<!-- a -->keep me<!-- b -->` would read as one aside and take "keep me"
 * with it. A body that cannot contain `-->` cannot reach the second one.
 */
const WHOLE_LINE_ASIDE = new RegExp(
  String.raw`^[ \t]*<!--(?:(?!-->)[\s\S])*?-->[ \t]*(?:\r?\n|$)`,
  "gm",
);

/**
 * An aside with text before it on its line, and any space hugging it.
 *
 * The lookbehind protects indentation: `  <!-- hint --> text` is an indented
 * line, and eating its two spaces would move the line to the top level of a
 * list, which in markdown changes which question an answer belongs to. An
 * aside at a line's start, past its indent, is `LEADING_ASIDE`'s.
 *
 * The surrounding space is part of the match, so one space replaces the aside
 * and whatever hugged it and no run of spaces is created. Collapsing runs
 * afterwards would also rewrite the writer's own spacing, and
 * `Evidence.reveal` searches the real file for a quote the model took from
 * this text, so a quote with a closed-up double space is not found.
 */
const INLINE_ASIDE = new RegExp(
  String.raw`(?<=[^\n \t])[ \t]*` + ASIDE_SOURCE + String.raw`[ \t]*`,
  "g",
);

/** An aside opening a line after its indent: it leaves, the indent stays. */
const LEADING_ASIDE = new RegExp(ASIDE_SOURCE + String.raw`[ \t]*`, "g");

/**
 * The same text with every aside removed, for anything bound for a model.
 *
 * Fed to a model as prose, an aside makes the assistant answer about material
 * the writer does not consider written, and a hint such as "describe your
 * antagonist here" reads to a model as an instruction.
 *
 * An aside on its own lines takes them with it. Most template asides are a
 * hint indented under its question, and an emptied line left behind would put
 * a blank between each question and its answer, turning a tight list loose.
 *
 * An inline aside becomes one space, never none and never two. None would
 * turn `opened<!-- note -->and` into `openedand`, a word the assistant could
 * quote back that matches nothing in the file. Two would come from the space
 * already beside the aside, which `INLINE_ASIDE` takes into its match.
 *
 * The last two replacements tidy what the removal exposes: a line left ending
 * in its indent, which at a line's end is half of markdown's two-space hard
 * break, and the hole an aside between two paragraphs leaves.
 */
export function stripAsides(text: string): string {
  return text
    .replace(WHOLE_LINE_ASIDE, "")
    .replace(INLINE_ASIDE, " ")
    .replace(LEADING_ASIDE, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}
