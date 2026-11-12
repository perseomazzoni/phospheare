// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Writes CommonMark, not the app's dialect: a file any Markdown tool reads.
// Formatting survives the export, so the dialect's two extensions, which have
// no CommonMark spelling, travel as the HTML blocks and inline HTML the spec
// allows rather than being dropped:
//
//   - a centred, right-aligned or justified paragraph is an HTML `<p>` with
//     its alignment, its inline formatting written as HTML too, because
//     Markdown is not parsed inside an HTML block;
//   - a page break is `<div style="break-after: page"></div>`, which every
//     HTML renderer honours when printing.

import {
  tocEntries,
  type Block,
  type ExportDocument,
  type Inline,
} from "../../domain/model";
import type { FormatWriter } from "../../ports";
import { inlinesToHtml } from "./markup";
import { stripInvalidText, utf8 } from "./xml";

const PAGE_BREAK = `<div style="break-after: page"></div>`;

/**
 * Backslash-escapes what would otherwise be read as markup: inline markers
 * everywhere, block markers only at a line start, where they open a block,
 * and a run of `#` after a space at a line end, which closes a heading and
 * would otherwise be dropped from it.
 */
function escapeText(text: string): string {
  return text
    .replace(/[\\`*_[\]<>~|&]/g, "\\$&")
    .replace(/^(\s*)([#>+=-])/gm, "$1\\$2")
    .replace(/^(\s*\d+)([.)])/gm, "$1\\$2")
    .replace(/(^|[ \t])#(#*[ \t]*)$/gm, "$1\\#$2");
}

/**
 * Four spaces or a tab at a block's start make it indented code, and fewer
 * are dropped by any reader, so a paragraph's leading spaces and tabs are
 * dropped here: the paragraph starts flush left.
 */
function flushLeft(markdown: string): string {
  return markdown.replace(/^[ \t]+/, "");
}

/** One run's text, with no emphasis: code is fenced, anything else escaped. */
function runToMarkdown(inline: Inline): string {
  if (inline.mono) {
    const fence = "`".repeat(longestRun(inline.text, "`") + 1);
    const pad =
      inline.text.startsWith("`") || inline.text.endsWith("`") ? " " : "";
    const code = `${fence}${pad}${inline.text}${pad}${fence}`;
    return inline.href ? `[${code}](${destination(inline.href)})` : code;
  }
  // codeql[js/incomplete-sanitization] a newline becomes a hard break; `escapeText` has escaped every backslash
  const text = escapeText(inline.text).replace(/\n/g, "\\\n");
  return inline.href && inline.text.trim() !== ""
    ? `[${text}](${destination(inline.href)})`
    : text;
}

/**
 * The marks, outermost first. Strike is GFM, not CommonMark, so it is `<del>`,
 * inline HTML whose Markdown content is still parsed.
 */
const MARKS = ["strike", "bold", "italic"] as const;
const DELIMITERS: Record<(typeof MARKS)[number], [string, string]> = {
  strike: ["<del>", "</del>"],
  bold: ["**", "**"],
  italic: ["*", "*"],
};

/**
 * Runs that share a mark are wrapped in it together. Wrapped one by one, an
 * italic word beside an italic code span reads ``*x**`foo`*``, and CommonMark
 * takes the middle `**` as one delimiter run: the italic closes early and two
 * literal asterisks print around the code.
 *
 * Whitespace at a wrapped span's edge moves outside its delimiters, because a
 * delimiter followed by whitespace does not open: `** bold**` is not bold, and
 * that is how italics get lost on export.
 */
function marked(inlines: readonly Inline[], depth: number): string {
  if (depth === MARKS.length) return inlines.map(runToMarkdown).join("");
  const mark = MARKS[depth];
  let out = "";
  let start = 0;
  while (start < inlines.length) {
    const on = Boolean(inlines[start][mark]);
    let end = start;
    while (end < inlines.length && Boolean(inlines[end][mark]) === on) end += 1;
    const group = inlines.slice(start, end);
    out += on ? wrapGroup(group, mark, depth) : marked(group, depth + 1);
    start = end;
  }
  return out;
}

function wrapGroup(
  group: readonly Inline[],
  mark: (typeof MARKS)[number],
  depth: number,
): string {
  const runs = group.map((inline) => ({ ...inline }));
  const first = runs[0];
  const last = runs[runs.length - 1];
  // Code keeps its edges: a space inside a code span is its content.
  const lead = first.mono ? "" : (/^\s*/.exec(first.text)?.[0] ?? "");
  first.text = first.text.slice(lead.length);
  const trail = last.mono ? "" : (/\s*$/.exec(last.text)?.[0] ?? "");
  last.text = last.text.slice(0, last.text.length - trail.length);
  const inner = marked(
    runs.filter((run) => run.text !== ""),
    depth + 1,
  );
  // A line break moved out with the whitespace is still the writer's hard
  // break, as it is inside a run.
  // codeql[js/incomplete-sanitization] a newline becomes a hard break in text that is only whitespace
  const hard = (space: string) => space.replace(/\n/g, "\\\n");
  // Nothing but whitespace under the mark: there is nothing to emphasise,
  // and empty delimiters would print as literal asterisks.
  if (inner === "") return hard(lead + trail);
  const [open, close] = DELIMITERS[mark];
  return `${hard(lead)}${open}${inner}${close}${hard(trail)}`;
}

function destination(href: string): string {
  return /[\s()<>]/.test(href)
    ? `<${href.replace(/[<>]/g, encodeURIComponent)}>`
    : href;
}

function longestRun(text: string, char: string): number {
  let longest = 0;
  let current = 0;
  for (const c of text) {
    current = c === char ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function inlinesToMarkdown(inlines: readonly Inline[]): string {
  return marked(inlines, 0);
}

function indent(text: string, by: string): string {
  return text
    .split("\n")
    .map((line, index) => (index === 0 || line === "" ? line : by + line))
    .join("\n");
}

function blockToMarkdown(block: Block): string {
  switch (block.kind) {
    case "heading": {
      const align = block.align;
      if (align !== "left")
        return `<h${block.level} style="text-align:${align}">${inlinesToHtml(block.inlines)}</h${block.level}>`;
      return `${"#".repeat(block.level)} ${inlinesToMarkdown(block.inlines)}`;
    }
    case "paragraph": {
      if (block.blank) return "&nbsp;";
      if (block.align !== "left")
        return `<p style="text-align:${block.align}">${inlinesToHtml(block.inlines)}</p>`;
      return flushLeft(inlinesToMarkdown(block.inlines));
    }
    case "list":
      return block.items
        .map((item, index) => {
          const marker = block.ordered ? `${block.start + index}. ` : "- ";
          const body = item.map((inner) => blockToMarkdown(inner)).join("\n\n");
          return marker + indent(body, " ".repeat(marker.length));
        })
        .join("\n");
    case "quote":
      return block.blocks
        .map((inner) => blockToMarkdown(inner))
        .join("\n\n")
        .split("\n")
        .map((line) => (line === "" ? ">" : `> ${line}`))
        .join("\n");
    case "code": {
      const fence = "`".repeat(Math.max(3, longestRun(block.text, "`") + 1));
      return `${fence}\n${block.text}\n${fence}`;
    }
    case "sceneBreak":
      // A thematic break is CommonMark's own scene break, and reads back as
      // one.
      return "* * *";
    case "pageBreak":
      return PAGE_BREAK;
    case "facts":
      return block.rows
        .map(
          ([label, value]) =>
            `- **${escapeText(label)}:** ${escapeText(value)}`,
        )
        .join("\n");
  }
}

export function renderCommonMark(doc: ExportDocument): string {
  // Only a file with contents links anywhere, so only that file carries the
  // anchors; elsewhere they are markup a reader of the plain file trips over.
  const linked = doc.chapters.some((chapter) => chapter.kind === "toc");
  const chapters = doc.chapters.map((chapter) => {
    const parts: string[] = [];
    // An explicit anchor, because CommonMark defines no heading ids and the
    // contents must link somewhere that exists.
    if (chapter.title !== null) {
      const heading = `${"#".repeat(chapter.level)} ${escapeText(chapter.title)}`;
      parts.push(linked ? `<a id="${chapter.id}"></a>\n\n${heading}` : heading);
    }
    if (chapter.kind === "toc")
      parts.push(
        tocEntries(doc)
          .map(
            (entry) =>
              `${entry.level === 2 ? "  " : ""}- [${escapeText(entry.title)}](#${entry.id})`,
          )
          .join("\n"),
      );
    // The writer's own alignment, as written: `assemble.ts` always sets a
    // reflowing format as a book, and a book keeps a justified line.
    for (const block of chapter.blocks) parts.push(blockToMarkdown(block));
    return parts.join("\n\n");
  });
  return `${chapters.join(`\n\n${PAGE_BREAK}\n\n`)}\n`;
}

export const commonmarkWriter: FormatWriter = {
  format: "md",
  write: async (doc) => utf8(stripInvalidText(renderCommonMark(doc))),
};
