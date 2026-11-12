// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import MarkdownIt from "markdown-it";
import type { Token } from "markdown-it";
import { parse as parseYaml } from "yaml";
import { parseDocument } from "../../../../security/trustedHtml";
import { commonmarkCodec } from "../../../engine/adapters/commonmark";
import {
  bump,
  emptySource,
  mergeReports,
  type Inline,
  type Signals,
  type SourceDocument,
} from "../../domain/source";
import type { FormatReader } from "../../ports";
import { decodeText } from "../decode";
import { FlowBuilder, pacer, unmarked } from "../flowBuilder";
import { parseDeclarations } from "../css";
import { walkHtml } from "../htmlFlow";

// Reads Markdown, of which two kinds arrive. The app's own files, a project's
// documents or a manuscript exported to Markdown, are in the editor's dialect,
// with `{pagebreak}` and `{align:center}`, and the engine's own codec reads
// them exactly. Anything else is general Markdown (plain-text editors, note
// tools, a static site) and goes through markdown-it.
//
// The markdown-it here is a second instance, with `html: true`, used for
// tokens only: nothing is ever rendered. HTML in the file, such as a
// `<span style="font-style:italic">` or a pasted `<table>`, is handed to the
// inert-DOM walker the HTML reader uses, so it obeys the same rules.
//
// Footnotes (`[^1]` with `[^1]: …` definitions) are not core Markdown, so
// their references and definitions are lifted out before parsing, and
// counted. The project has no place for them, and the report says so; left
// in, a definition would read as a paragraph of the book.

const tokens = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
});

const DIALECT = /^(\{pagebreak\}|\{align:(left|center|right|justify)\})/m;
const FRONT_MATTER = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/;
const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:[ \t]?(.*)$/;
const FOOTNOTE_REF = /\[\^([^\]\s]+)\](?!:)/g;

export const markdownReader: FormatReader = {
  format: "md",
  async read(bytes, name, ctx) {
    const doc = emptySource("md");
    let text = unmarked(decodeText(bytes)).replace(/\r\n?/g, "\n");

    const front = FRONT_MATTER.exec(text);
    // Only a block that is front matter, YAML naming keys, leaves the text.
    // A book may open with a rule, prose and another rule, and that prose is
    // the book.
    if (front && readFrontMatter(front[1], doc))
      text = text.slice(front[0].length);

    if (DIALECT.test(text)) {
      readDialect(text, name, doc);
      return doc;
    }

    const { body, count } = liftFootnotes(text);
    bump(doc.report, "footnotes", count);
    const prose = body.replace(FOOTNOTE_REF, "");
    await readTokens(tokens.parse(prose, {}), name, doc, ctx);
    return doc;
  },
};

/** Reads front matter into the meta; `false` if the block is not a mapping. */
function readFrontMatter(yaml: string, doc: SourceDocument): boolean {
  let data: unknown;
  try {
    data = parseYaml(yaml);
  } catch {
    return false;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const map = data as Record<string, unknown>;
  const str = (...keys: string[]) => {
    for (const key of keys) {
      const value = map[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (Array.isArray(value) && typeof value[0] === "string")
        return value.join(", ");
    }
    return undefined;
  };
  const title = str("title");
  const author = str("author", "authors", "creator");
  const language = str("lang", "language");
  if (title) doc.meta.title = title;
  if (author) doc.meta.author = author;
  if (language) doc.meta.language = language;
  return true;
}

/** The editor's own dialect, read by the editor's own codec. */
function readDialect(text: string, name: string, doc: SourceDocument): void {
  const flow = new FlowBuilder(doc.report);
  for (const para of commonmarkCodec.parse(text)) {
    if (para.blockType === "pagebreak") {
      flow.pageBreak();
      continue;
    }
    const signals: Signals = {};
    if (para.blockType === "h1") signals.headingLevel = 1;
    if (para.blockType === "h2") signals.headingLevel = 2;
    flow.para(
      para.runs.map((run) => ({
        text: run.text,
        bold: run.format.bold,
        italic: run.format.italic,
        mono: run.format.monospace,
      })),
      para.alignment,
      signals,
    );
  }
  doc.flows.push({ name, blocks: flow.blocks });
}

/** Lifts each `[^id]: …` footnote definition and its indented lines out. */
function liftFootnotes(text: string): { body: string; count: number } {
  const ids = new Set<string>();
  const kept: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const def = FOOTNOTE_DEF.exec(lines[i]);
    if (!def) {
      kept.push(lines[i]);
      continue;
    }
    while (i + 1 < lines.length && /^( {2,}|\t)\S/.test(lines[i + 1])) i++;
    ids.add(def[1]);
  }
  return { body: kept.join("\n"), count: ids.size };
}

async function readTokens(
  stream: Token[],
  name: string,
  doc: SourceDocument,
  ctx: Parameters<FormatReader["read"]>[2],
): Promise<void> {
  const flow = new FlowBuilder(doc.report);
  const pace = pacer(ctx);
  let list = 0;
  let quote = 0;
  let heading: number | undefined;
  let inTable = false;

  const emit = async (inlines: Inline[], signals: Signals) => {
    // Markdown cannot write a blank paragraph: blank lines only part
    // paragraphs. A paragraph with no text is markup alone, such as the
    // app's own export's anchor `<a id="c3"></a>`, and not a blank line the
    // writer typed, which the import keeps everywhere else.
    if (!inlines.some((inline) => inline.text.trim())) return;
    await pace.tick();
    flow.para(inlines, "left", signals);
  };

  const origin = (): Signals => {
    if (inTable) return { origin: "table" };
    if (list) return { origin: "list" };
    if (quote) return { origin: "quote" };
    return {};
  };

  for (const token of stream) {
    switch (token.type) {
      case "heading_open":
        heading = Number(token.tag.slice(1));
        break;
      case "heading_close":
        heading = undefined;
        break;
      case "bullet_list_open":
      case "ordered_list_open":
        if (list === 0) bump(doc.report, "lists");
        list += 1;
        break;
      case "bullet_list_close":
      case "ordered_list_close":
        list -= 1;
        break;
      case "blockquote_open":
        if (quote === 0) bump(doc.report, "quotes");
        quote += 1;
        break;
      case "blockquote_close":
        quote -= 1;
        break;
      case "table_open":
        bump(doc.report, "tables");
        inTable = true;
        break;
      case "table_close":
        inTable = false;
        break;
      case "hr":
        flow.rule();
        break;
      case "fence":
      case "code_block":
        for (const line of token.content.replace(/\n$/, "").split("\n"))
          await emit([{ text: line, mono: true }], { origin: "code" });
        break;
      case "html_block": {
        // Through the same inert walker as a web page, never rendered.
        const page = parseDocument(token.content, "text/html");
        const report = {};
        const walk = walkHtml(page, report);
        mergeReports(doc.report, report);
        for (const block of walk.blocks)
          if (block.kind === "para")
            flow.para(block.inlines, block.align, block.signals);
          else if (block.kind === "pageBreak") flow.pageBreak();
          else flow.rule();
        break;
      }
      case "inline": {
        const signals: Signals = { ...origin() };
        if (heading) signals.headingLevel = heading;
        for (const para of inlineRuns(token.children ?? [], doc))
          await emit(para, signals);
        break;
      }
    }
  }

  doc.flows.push({ name, blocks: flow.blocks });
}

/**
 * An inline token stream as runs. A hard break or an HTML `<br>` starts a
 * new paragraph, because the engine holds no line break inside one.
 */
function inlineRuns(children: Token[], doc: SourceDocument): Inline[][] {
  const paras: Inline[][] = [[]];
  let italic = 0;
  let bold = 0;
  let underline = 0;
  // What each open `<span>` turned on, so its close turns off only that.
  const spans: { italic: number; bold: number; underline: number }[] = [];
  const push = (text: string, mono = false) =>
    paras[paras.length - 1].push({
      text,
      italic: italic > 0,
      bold: bold > 0,
      underline: underline > 0,
      mono,
    });
  for (const child of children) {
    switch (child.type) {
      case "text":
        push(child.content);
        break;
      case "softbreak":
        push(" ");
        break;
      case "hardbreak":
        paras.push([]);
        break;
      case "code_inline":
        push(child.content, true);
        break;
      case "em_open":
        italic += 1;
        break;
      case "em_close":
        italic -= 1;
        break;
      case "strong_open":
        bold += 1;
        break;
      case "strong_close":
        bold -= 1;
        break;
      case "s_open":
        bump(doc.report, "strike");
        break;
      case "link_open":
        bump(doc.report, "links");
        break;
      case "image":
        bump(doc.report, "images");
        break;
      case "html_inline": {
        const tag = /^<\s*(\/?)\s*([a-z]+)/i.exec(child.content);
        if (!tag) break;
        const close = tag[1] === "/";
        const step = close ? -1 : 1;
        switch (tag[2].toLowerCase()) {
          case "em":
          case "i":
            italic = Math.max(0, italic + step);
            break;
          case "strong":
          case "b":
            bold = Math.max(0, bold + step);
            break;
          case "u":
            underline = Math.max(0, underline + step);
            break;
          case "br":
            paras.push([]);
            break;
          // A span's inline style carries its emphasis, read by the same
          // declaration parser the HTML reader uses. Its text is
          // a token of its own, so nothing here is ever rendered.
          case "span": {
            if (close) {
              const open = spans.pop();
              if (open) {
                italic = Math.max(0, italic - open.italic);
                bold = Math.max(0, bold - open.bold);
                underline = Math.max(0, underline - open.underline);
              }
              break;
            }
            const style = /\bstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(
              child.content,
            );
            const props = parseDeclarations(style?.[2] ?? style?.[3] ?? "");
            const open = {
              italic: props.italic ? 1 : 0,
              bold: props.bold ? 1 : 0,
              underline: props.underline ? 1 : 0,
            };
            italic += open.italic;
            bold += open.bold;
            underline += open.underline;
            spans.push(open);
            break;
          }
        }
        break;
      }
    }
  }
  return paras;
}
