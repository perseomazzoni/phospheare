// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Writes plain text, for the submission form that takes nothing else. Plain
// text cannot carry alignment or a typeface, so it carries what it can by
// convention: `_italic_` and `*bold*`, the manuscript tradition for emphasis
// typed on a machine with one face; titles underlined with `=` and `-`; a `#`
// for a scene break; and a form feed (U+000C) where a chapter ends, plain
// text's one page break, which printers and word processors honour.

import {
  tocEntries,
  type Block,
  type ExportDocument,
  type Inline,
} from "../../domain/model";
import type { FormatWriter } from "../../ports";
import { stripInvalidText, utf8 } from "./xml";

const FORM_FEED = "\f";

function inlineToText(inline: Inline): string {
  let text = inline.text;
  if (inline.italic) text = `_${text}_`;
  if (inline.bold) text = `*${text}*`;
  if (inline.href && inline.href !== inline.text)
    text = `${text} (${inline.href})`;
  return text;
}

function inlinesToText(inlines: readonly Inline[]): string {
  return inlines.map(inlineToText).join("");
}

function underline(title: string, char: string): string {
  return `${title}\n${char.repeat(Math.max(3, Array.from(title).length))}`;
}

function prefixLines(text: string, first: string, rest: string): string {
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? first : rest) + line)
    .join("\n");
}

function blockToText(block: Block): string {
  switch (block.kind) {
    case "heading":
      return underline(
        inlinesToText(block.inlines),
        block.level <= 2 ? "-" : "~",
      );
    case "paragraph":
      return inlinesToText(block.inlines);
    case "list":
      return block.items
        .map((item, index) => {
          const marker = block.ordered ? `${block.start + index}. ` : "- ";
          const body = item.map(blockToText).join("\n\n");
          return prefixLines(body, marker, " ".repeat(marker.length));
        })
        .join("\n");
    case "quote":
      return prefixLines(
        block.blocks.map(blockToText).join("\n\n"),
        "> ",
        "> ",
      );
    case "code":
      return prefixLines(block.text, "    ", "    ");
    case "sceneBreak":
      return "#";
    case "pageBreak":
      return FORM_FEED;
    case "facts":
      return block.rows
        .map(([label, value]) => `${label}: ${value}`)
        .join("\n");
  }
}

export function renderText(doc: ExportDocument): string {
  const chapters = doc.chapters.map((chapter) => {
    const parts: string[] = [];
    if (chapter.title !== null)
      parts.push(underline(chapter.title, chapter.level === 1 ? "=" : "-"));
    if (chapter.kind === "toc")
      parts.push(
        tocEntries(doc)
          .map((entry) => `${entry.level === 2 ? "    " : ""}${entry.title}`)
          .join("\n"),
      );
    parts.push(...chapter.blocks.map(blockToText));
    return parts.join("\n\n");
  });
  return `${chapters.join(`\n${FORM_FEED}\n`)}\n`;
}

export const textWriter: FormatWriter = {
  format: "txt",
  write: async (doc) => utf8(stripInvalidText(renderText(doc))),
};
