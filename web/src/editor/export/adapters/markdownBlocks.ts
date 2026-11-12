// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Reads reference and note Markdown into the export model, through the app's
// one hardened Markdown instance (`safeMarkdown.ts`) and never a second
// configuration. That instance decides that raw HTML is text, that an image is
// its alt text, and that only http, https and mailto links exist.
//
// A reference file is untrusted input, since the writer's folder is not a
// trust boundary, and an export is a file other people open: an EPUB or HTML
// file carrying a `javascript:` link out of a reference would carry it into
// someone's reader. So this reads markdown-it's tokens, not its HTML, and
// nothing rendered here reaches a writer as markup.
//
// A line break inside a paragraph travels as "\n" in the inline text; every
// writer turns it into its own format's line break.

import type { Token } from "markdown-it";
import { markdown } from "../../components/safeMarkdown";
import type { Block, HeadingLevel, Inline } from "../domain/model";
import type { BlockParser } from "../ports";

const SAFE_HREF = /^(https?:|mailto:)/i;

interface Marks {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  href?: string;
}

function inlinesOf(children: readonly Token[] | null): Inline[] {
  const out: Inline[] = [];
  const marks: Marks = { bold: false, italic: false, strike: false };
  const push = (text: string, mono = false) => {
    if (text === "") return;
    out.push({
      text,
      ...(marks.bold ? { bold: true } : {}),
      ...(marks.italic ? { italic: true } : {}),
      ...(marks.strike ? { strike: true } : {}),
      ...(mono ? { mono: true } : {}),
      ...(marks.href ? { href: marks.href } : {}),
    });
  };
  for (const token of children ?? []) {
    switch (token.type) {
      case "text":
        push(token.content);
        break;
      case "code_inline":
        push(token.content, true);
        break;
      case "softbreak":
        push(" ");
        break;
      case "hardbreak":
        push("\n");
        break;
      case "image":
        // The alt text, as the reader shows it; an image is never fetched.
        push(token.content);
        break;
      case "strong_open":
        marks.bold = true;
        break;
      case "strong_close":
        marks.bold = false;
        break;
      case "em_open":
        marks.italic = true;
        break;
      case "em_close":
        marks.italic = false;
        break;
      case "s_open":
        marks.strike = true;
        break;
      case "s_close":
        marks.strike = false;
        break;
      case "link_open": {
        // The instance already refuses unsafe schemes; the check repeats here
        // because this is where the href leaves for a file.
        const href = String(token.attrGet("href") ?? "");
        marks.href = SAFE_HREF.test(href.trim()) ? href.trim() : undefined;
        break;
      }
      case "link_close":
        marks.href = undefined;
        break;
      default:
        // `html_inline` cannot occur (`html: false`); anything else unknown
        // keeps its text rather than vanishing.
        push(token.content);
    }
  }
  return merge(out);
}

/** Adjacent inlines with the same marks become one. */
function merge(inlines: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const inline of inlines) {
    const last = out[out.length - 1];
    if (
      last &&
      !!last.bold === !!inline.bold &&
      !!last.italic === !!inline.italic &&
      !!last.strike === !!inline.strike &&
      !!last.mono === !!inline.mono &&
      last.href === inline.href
    )
      last.text += inline.text;
    else out.push({ ...inline });
  }
  return out;
}

/** Parses tokens from `start` until the matching `close` type, or the end. */
function blocksOf(
  tokens: readonly Token[],
  start: number,
  close: string | null,
): { blocks: Block[]; next: number } {
  const blocks: Block[] = [];
  let i = start;
  while (i < tokens.length) {
    const token = tokens[i];
    if (close !== null && token.type === close) return { blocks, next: i + 1 };
    switch (token.type) {
      case "heading_open": {
        const level = Number(token.tag.slice(1)) as HeadingLevel;
        blocks.push({
          kind: "heading",
          level,
          inlines: inlinesOf(tokens[i + 1]?.children ?? null),
          align: "left",
        });
        i += 3;
        continue;
      }
      case "paragraph_open":
        blocks.push({
          kind: "paragraph",
          inlines: inlinesOf(tokens[i + 1]?.children ?? null),
          align: "left",
        });
        i += 3;
        continue;
      case "bullet_list_open":
      case "ordered_list_open": {
        const ordered = token.type === "ordered_list_open";
        const closer = ordered ? "ordered_list_close" : "bullet_list_close";
        const items: Block[][] = [];
        let j = i + 1;
        while (j < tokens.length && tokens[j].type !== closer) {
          if (tokens[j].type === "list_item_open") {
            const item = blocksOf(tokens, j + 1, "list_item_close");
            items.push(item.blocks);
            j = item.next;
          } else j += 1;
        }
        blocks.push({
          kind: "list",
          ordered,
          start: ordered ? Number(token.attrGet("start") ?? 1) : 1,
          items,
        });
        i = j + 1;
        continue;
      }
      case "blockquote_open": {
        const inner = blocksOf(tokens, i + 1, "blockquote_close");
        blocks.push({ kind: "quote", blocks: inner.blocks });
        i = inner.next;
        continue;
      }
      case "fence":
      case "code_block":
        blocks.push({ kind: "code", text: token.content.replace(/\n$/, "") });
        break;
      case "hr":
        blocks.push({ kind: "sceneBreak" });
        break;
      case "table_open": {
        // A table becomes one paragraph per row, its cells side by side: the
        // export model has no tables, and a reference that carries one wants
        // its words kept, not its grid.
        let j = i + 1;
        let row: Inline[] = [];
        while (j < tokens.length && tokens[j].type !== "table_close") {
          const cell = tokens[j];
          if (cell.type === "tr_open") row = [];
          else if (cell.type === "inline") {
            if (row.length > 0) row.push({ text: "  |  " });
            row.push(...inlinesOf(cell.children));
          } else if (cell.type === "tr_close")
            blocks.push({
              kind: "paragraph",
              inlines: merge(row),
              align: "left",
            });
          j += 1;
        }
        i = j + 1;
        continue;
      }
      case "html_block":
        // Cannot occur with `html: false`; kept as text if it does.
        blocks.push({
          kind: "paragraph",
          inlines: [{ text: token.content.trim() }],
          align: "left",
        });
        break;
    }
    i += 1;
  }
  return { blocks, next: i };
}

export const markdownParser: BlockParser = {
  parse: (text) => blocksOf(markdown.parse(text, {}), 0, null).blocks,
};
