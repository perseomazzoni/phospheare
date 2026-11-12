// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  bump,
  emptySource,
  type ImportedComment,
  type Inline,
  type ReadReport,
  type Signals,
  type SourceDocument,
} from "../../domain/source";
import type { FormatReader, ReadContext } from "../../ports";
import { ReadRefused } from "../failure";
import { FlowBuilder, COMMENT_MARK, pacer, unmarked } from "../flowBuilder";
import { attr, descendant, kid, kids, parseXml, resolvePath } from "../xml";
import { partText, unzipParts } from "../zip";
import { DocxStyles, readParaProps, readRunProps } from "./docxStyles";

// Reads .docx, the format most manuscripts arrive in and the one importers
// most often get wrong. What this reader does about the usual complaints:
//
//   - formatting resolves through the full style chain with the format's
//     toggle rule (`docxStyles.ts`), so italics set by a style survive;
//   - headings are found by style name or outline level, never by the
//     localised style id;
//   - a page break is `w:br type="page"`, `pageBreakBefore` (direct or by
//     style), or a section break that starts a new page, and never
//     `lastRenderedPageBreak`, which is only where the last layout of the app
//     the writer used happened to wrap;
//   - a table of contents, a TOC field or a TOC content control, is dropped
//     whole, so its entries never look like chapters;
//   - tracked changes are accepted (insertions kept, deletions dropped) and
//     the report says how many;
//   - `mc:AlternateContent` is read once, through its Fallback, so a shape
//     with a modern and a legacy form is not read twice;
//   - comments, with their replies and resolved state from
//     `commentsExtended`, are read into the model, not lost;
//   - footnotes and endnotes are counted from their references in the text
//     and never opened: the project has no place for them, and the report
//     says so.
//
// Headers and footers are not the book and are never opened.

const WANTED = new Set([
  "_rels/.rels",
  "word/_rels/document.xml.rels",
  "word/styles.xml",
  "word/comments.xml",
  "word/commentsExtended.xml",
  "docProps/core.xml",
]);

interface Ref {
  key: string;
  block: number;
  offset: number;
}

interface Part {
  inlines: Inline[];
  refs: string[];
  breakBefore: boolean;
}

interface Field {
  instr: string;
  result: boolean;
}

class DocxWalker {
  readonly builder: FlowBuilder;
  readonly refs: Ref[] = [];
  private pendingBreak = false;
  private fields: Field[] = [];
  private tocDepth = 0;
  private readonly lists = new Set<string>();
  private readonly tracked = new Set<Element>();
  private readonly pace: { tick(): Promise<void> };
  /** Text boxes met inside the paragraph being read, read after it. */
  private boxes: Element[] = [];
  /** Drawings met so far, so a paragraph can tell it held only one. */
  private frames = 0;

  constructor(
    private readonly styles: DocxStyles,
    private readonly report: ReadReport,
    ctx: ReadContext,
  ) {
    this.builder = new FlowBuilder(report);
    this.pace = pacer(ctx);
  }

  async body(container: Element, origin?: Signals["origin"]): Promise<void> {
    for (const el of kids(container)) {
      switch (el.localName) {
        case "p":
          await this.paragraph(el, origin);
          break;
        case "tbl":
          bump(this.report, "tables");
          for (const tr of unwrapped(el, "tr"))
            for (const tc of unwrapped(tr, "tc")) await this.body(tc, "table");
          break;
        case "sdt":
          if (isTocSdt(el)) break;
          await this.body(kid(el, "sdtContent") ?? el, origin);
          break;
        case "customXml":
          await this.body(el, origin);
          break;
        // Whole paragraphs inserted or deleted with changes tracked are
        // accepted like the run-level ones, and counted the same way.
        case "ins":
        case "moveTo":
          this.countTracked(el);
          await this.body(el, origin);
          break;
        case "del":
        case "moveFrom":
          this.countTracked(el);
          break;
        case "AlternateContent":
          await this.body(
            kid(el, "Fallback") ?? kid(el, "Choice") ?? el,
            origin,
          );
          break;
      }
    }
  }

  /**
   * A paragraph, then the text boxes anchored in it. A text box's words are
   * the writer's (a letter, a sign, a sidebar), and the manuscript has no
   * floating frames, so they come across as paragraphs where the box was
   * anchored rather than being left behind.
   */
  private async paragraph(
    p: Element,
    origin?: Signals["origin"],
  ): Promise<void> {
    await this.paragraphText(p, origin);
    for (const box of this.boxes.splice(0)) await this.body(box, origin);
  }

  private async paragraphText(
    p: Element,
    origin?: Signals["origin"],
  ): Promise<void> {
    await this.pace.tick();
    const framesBefore = this.frames;
    const pPr = kid(p, "pPr");
    const styleId = valOf(pPr, "pStyle");
    const name = this.styles.nameOf(styleId ?? this.styles.defaultPara);
    // TOC entries go; the "TOC Heading" ("Contents") stays, as matter the
    // preview lists and leaves out by default.
    const tocEntry = !!name && /^toc \d$/.test(name);
    const props = this.styles.paragraph(styleId, readParaProps(pPr));

    const signals: Signals = {};
    if (name) signals.styleName = name;
    const heading = name ? /^heading (\d)$/.exec(name) : null;
    if (heading) signals.headingLevel = Math.min(6, Number(heading[1]));
    else if (props.outlineLevel !== undefined && props.outlineLevel < 9)
      signals.headingLevel = Math.min(6, props.outlineLevel + 1);
    if (name === "title") signals.role = "title";
    else if (name === "subtitle") signals.role = "subtitle";
    else if (name === "toc heading") signals.role = "toc";
    if (origin) signals.origin = origin;
    const numPr = pPr ? kid(pPr, "numPr") : null;
    if (numPr) {
      signals.origin = signals.origin ?? "list";
      const numId = valOf(numPr, "numId") ?? "";
      if (numId !== "0" && !this.lists.has(numId)) {
        this.lists.add(numId);
        bump(this.report, "lists");
      }
    }

    const parts: Part[] = [
      {
        inlines: [],
        refs: [],
        breakBefore: this.pendingBreak || !!props.pageBreakBefore,
      },
    ];
    this.pendingBreak = false;
    const tocAtStart = this.tocDepth > 0;
    let sawToc = tocAtStart;
    const ctx = {
      styleId: styleId ?? this.styles.defaultPara,
      parts,
      size: undefined as number | undefined,
      caps: true,
      texted: false,
      hiddenText: false,
      onToc: () => (sawToc = true),
    };
    this.inline(
      kids(p).filter((el) => el.localName !== "pPr"),
      ctx,
    );
    if (ctx.size !== undefined) signals.fontSizePt = ctx.size;
    if (ctx.texted && ctx.caps) signals.allCaps = true;

    // A section break that starts a new page breaks before the next paragraph.
    const sect = pPr ? kid(pPr, "sectPr") : null;
    if (sect) {
      const type = valOf(sect, "type");
      if (type !== "continuous" && type !== "nextColumn")
        this.pendingBreak = true;
    }

    if (tocEntry || sawToc || this.tocDepth > 0) return;
    // A paragraph whose every word is hidden, or that only anchored a
    // picture or a text box, is not a blank line, which reads as a scene
    // break: it is dropped, and its page break passed on.
    if (
      (ctx.hiddenText || this.frames > framesBefore) &&
      !ctx.texted &&
      parts.every((part) => !part.refs.length)
    ) {
      if (parts.some((part) => part.breakBefore)) this.pendingBreak = true;
      return;
    }
    const align = props.align ?? "left";
    parts.forEach((part, i) => {
      const empty =
        !part.inlines.some((x) => x.text.trim() && x.text !== COMMENT_MARK) &&
        !part.refs.length;
      // A paragraph that only carries a page break, the usual way to start a
      // chapter on a new page, is a break, not two blank lines.
      if (empty && parts.length > 1) {
        if (i === parts.length - 1 && part.breakBefore)
          this.pendingBreak = true;
        else if (i < parts.length - 1 && part.breakBefore)
          parts[i + 1].breakBefore = true;
        return;
      }
      const block = this.builder.next;
      const offsets = this.builder.para(part.inlines, align, {
        ...signals,
        ...(part.breakBefore ? { breakBefore: true } : {}),
      });
      part.refs.forEach((key, n) =>
        this.refs.push({ key, block, offset: offsets[n] ?? 0 }),
      );
    });
  }

  private inline(
    nodes: Element[],
    ctx: {
      styleId?: string;
      parts: Part[];
      size?: number;
      caps: boolean;
      texted: boolean;
      hiddenText: boolean;
      onToc: () => void;
    },
  ): void {
    const part = () => ctx.parts[ctx.parts.length - 1];
    const mark = (key: string) => {
      part().inlines.push({ text: COMMENT_MARK });
      part().refs.push(key);
    };
    for (const el of nodes) {
      switch (el.localName) {
        case "r":
          this.run(el, ctx);
          break;
        case "hyperlink":
          bump(this.report, "links");
          this.inline(kids(el), ctx);
          break;
        case "ins":
        case "moveTo":
          this.countTracked(el);
          this.inline(kids(el), ctx);
          break;
        case "del":
        case "moveFrom":
          this.countTracked(el);
          break;
        case "smartTag":
        case "customXml":
        case "dir":
        case "bdo":
          this.inline(kids(el), ctx);
          break;
        case "sdt":
          this.inline(kids(kid(el, "sdtContent") ?? el), ctx);
          break;
        case "fldSimple":
          if (/^\s*TOC\b/i.test(attr(el, "instr") ?? "")) {
            ctx.onToc();
            break;
          }
          this.inline(kids(el), ctx);
          break;
        case "AlternateContent":
          this.inline(
            kids(kid(el, "Fallback") ?? kid(el, "Choice") ?? el),
            ctx,
          );
          break;
        case "commentRangeStart":
          mark(`cs:${attr(el, "id")}`);
          break;
        case "commentRangeEnd":
          mark(`ce:${attr(el, "id")}`);
          break;
      }
    }
  }

  private run(
    r: Element,
    ctx: {
      styleId?: string;
      parts: Part[];
      size?: number;
      caps: boolean;
      texted: boolean;
      hiddenText: boolean;
      onToc: () => void;
    },
  ): void {
    const rPr = kid(r, "rPr");
    const props = this.styles.run(
      ctx.styleId,
      valOf(rPr, "rStyle"),
      readRunProps(rPr),
    );
    const part = () => ctx.parts[ctx.parts.length - 1];
    const push = (text: string) => {
      // Inside a field's instruction nothing is text; in its result, all is.
      if (this.fields.some((f) => !f.result)) return;
      if (props.hidden) {
        if (text.trim()) {
          bump(this.report, "hiddenText");
          ctx.hiddenText = true;
        }
        return;
      }
      if (text.trim()) {
        ctx.texted = true;
        if (!props.caps) ctx.caps = false;
        if (ctx.size === undefined && props.size) ctx.size = props.size;
      }
      part().inlines.push({
        text,
        bold: props.bold,
        italic: props.italic,
        underline: props.underline,
        mono: props.mono,
      });
    };
    const split = (page: boolean) => {
      if (this.fields.some((f) => !f.result)) return;
      ctx.parts.push({ inlines: [], refs: [], breakBefore: page });
    };
    const mark = (key: string) => {
      part().inlines.push({ text: COMMENT_MARK });
      part().refs.push(key);
    };

    for (const el of kids(r)) {
      switch (el.localName) {
        case "t":
          push(unmarked(el.textContent ?? ""));
          break;
        case "tab":
        case "ptab":
          push(" ");
          break;
        case "br": {
          const type = attr(el, "type");
          if (type === "page") split(true);
          else if (type !== "column") split(false);
          break;
        }
        case "cr":
          split(false);
          break;
        case "noBreakHyphen":
          push("-");
          break;
        case "sym": {
          const code = parseInt(attr(el, "char") ?? "", 16);
          // Symbol-font glyphs live in the private-use area and mean nothing
          // in another font; a real character is kept.
          if (Number.isFinite(code) && code > 0 && code < 0xe000)
            push(String.fromCodePoint(code));
          break;
        }
        case "fldChar": {
          const type = attr(el, "fldCharType");
          if (type === "begin") this.fields.push({ instr: "", result: false });
          else if (type === "separate") {
            const field = this.fields[this.fields.length - 1];
            if (field) {
              field.result = true;
              if (/^\s*TOC\b/i.test(field.instr)) {
                this.tocDepth += 1;
                ctx.onToc();
              }
            }
          } else if (type === "end") {
            const field = this.fields.pop();
            if (field && field.result && /^\s*TOC\b/i.test(field.instr))
              this.tocDepth = Math.max(0, this.tocDepth - 1);
          }
          break;
        }
        case "instrText": {
          const field = this.fields[this.fields.length - 1];
          if (field && !field.result) field.instr += el.textContent ?? "";
          break;
        }
        case "footnoteReference":
          bump(this.report, "footnotes");
          break;
        case "endnoteReference":
          bump(this.report, "endnotes");
          break;
        case "commentReference":
          mark(`cr:${attr(el, "id")}`);
          break;
        case "drawing":
        case "pict":
        case "object":
          this.frame(el);
          break;
        // One branch only: the Choice and its Fallback are the same box
        // drawn twice, and reading both says it twice.
        case "AlternateContent": {
          const branch = kid(el, "Fallback") ?? kid(el, "Choice");
          if (branch) this.frame(branch);
          break;
        }
      }
    }
  }

  /** A drawing: its text box read after the paragraph, a picture counted. */
  private frame(el: Element): void {
    this.frames += 1;
    const box = descendant(el, "txbxContent");
    if (box) this.boxes.push(box);
    else bump(this.report, "images");
  }

  private countTracked(el: Element): void {
    if (this.tracked.has(el)) return;
    this.tracked.add(el);
    bump(this.report, "trackedChanges");
  }
}

function valOf(parent: Element | null, localName: string): string | undefined {
  const el = parent ? kid(parent, localName) : null;
  return (el && attr(el, "val")) || undefined;
}

function isTocSdt(sdt: Element): boolean {
  const gallery = descendant(kid(sdt, "sdtPr") ?? sdt, "docPartGallery");
  return !!gallery && /table of contents/i.test(attr(gallery, "val") ?? "");
}

/**
 * A table's rows, or a row's cells, including those wrapped in a content
 * control or custom XML, as the body walker unwraps paragraphs.
 */
function unwrapped(el: Element, localName: string): Element[] {
  const out: Element[] = [];
  for (const child of kids(el))
    if (child.localName === localName) out.push(child);
    else if (child.localName === "sdt")
      out.push(...unwrapped(kid(child, "sdtContent") ?? child, localName));
    else if (child.localName === "customXml")
      out.push(...unwrapped(child, localName));
  return out;
}

/** The main document part's path, from the package relationships. */
function mainPart(parts: Record<string, Uint8Array>): string {
  const rels = partText(parts, "_rels/.rels");
  if (rels) {
    const doc = parseXml(rels);
    for (const rel of kids(doc.documentElement, "Relationship"))
      if (/\/officeDocument$/.test(attr(rel, "Type") ?? "")) {
        const target = attr(rel, "Target");
        if (target) return resolvePath("", target);
      }
  }
  return "word/document.xml";
}

/** The paragraphs of a comment, as runs. */
async function commentBody(
  el: Element,
  styles: DocxStyles,
  ctx: ReadContext,
): Promise<Inline[][]> {
  const walker = new DocxWalker(styles, {}, ctx);
  await walker.body(el);
  return walker.builder.blocks
    .filter((b) => b.kind === "para" && b.inlines.length)
    .map((b) => (b.kind === "para" ? b.inlines : []));
}

async function readComments(
  parts: Record<string, Uint8Array>,
  styles: DocxStyles,
  refs: readonly Ref[],
  doc: SourceDocument,
  ctx: ReadContext,
): Promise<void> {
  const at = (key: string) => refs.find((ref) => ref.key === key);
  const anchor = (start?: Ref, end?: Ref) =>
    start
      ? {
          flow: 0,
          start: { block: start.block, offset: start.offset },
          end: { block: (end ?? start).block, offset: (end ?? start).offset },
        }
      : null;

  const commentsXml = partText(parts, "word/comments.xml");
  if (!commentsXml) return;
  // Replies and resolved state live in commentsExtended, keyed by the
  // paraId of each comment's last paragraph.
  const extended = new Map<string, { parent?: string; done: boolean }>();
  const extXml = partText(parts, "word/commentsExtended.xml");
  if (extXml)
    for (const ex of kids(parseXml(extXml).documentElement, "commentEx")) {
      const paraId = attr(ex, "paraId");
      if (paraId)
        extended.set(paraId, {
          parent: attr(ex, "paraIdParent") ?? undefined,
          done: attr(ex, "done") === "1",
        });
    }
  const byPara = new Map<string, string>();
  const comments: { id: string; el: Element; paraId?: string }[] = [];
  for (const el of kids(parseXml(commentsXml).documentElement, "comment")) {
    const id = attr(el, "id") ?? "";
    const paras = kids(el, "p");
    const paraId = paras.length
      ? (attr(paras[paras.length - 1], "paraId") ?? undefined)
      : undefined;
    if (paraId) byPara.set(paraId, id);
    comments.push({ id, el, paraId });
  }
  for (const { id, el, paraId } of comments) {
    const ext = paraId ? extended.get(paraId) : undefined;
    const parentId = ext?.parent ? byPara.get(ext.parent) : undefined;
    const comment: ImportedComment = {
      sourceId: `c:${id}`,
      anchor: anchor(
        at(`cs:${id}`) ?? at(`cr:${id}`),
        at(`ce:${id}`) ?? at(`cr:${id}`),
      ),
      body: await commentBody(el, styles, ctx),
    };
    const author = attr(el, "author");
    const initials = attr(el, "initials");
    const date = attr(el, "date");
    if (author) comment.author = author;
    if (initials) comment.initials = initials;
    if (date) comment.date = date;
    if (parentId !== undefined) comment.parentId = `c:${parentId}`;
    if (ext?.done) comment.resolved = true;
    doc.comments.push(comment);
    bump(doc.report, parentId !== undefined ? "replies" : "comments");
  }
}

function readCore(xml: string | null, doc: SourceDocument): void {
  if (!xml) return;
  const root = parseXml(xml).documentElement;
  const text = (name: string) =>
    descendant(root, name)?.textContent?.trim() || undefined;
  const title = text("title");
  const author = text("creator");
  const language = text("language");
  if (title) doc.meta.title = title;
  if (author) doc.meta.author = author;
  if (language) doc.meta.language = language;
}

export const docxReader: FormatReader = {
  format: "docx",
  async read(bytes, name, ctx) {
    const doc = emptySource("docx");
    const index = unzipParts(bytes, (n) => n === "_rels/.rels");
    const main = mainPart(index);
    const parts = unzipParts(bytes, (n) => n === main || WANTED.has(n));
    const xml = partText(parts, main);
    if (!xml) throw new ReadRefused("damaged", "no document part");
    const styles = new DocxStyles(partText(parts, "word/styles.xml"));
    const body = descendant(parseXml(xml), "body");
    if (!body) throw new ReadRefused("damaged", "no body");

    const walker = new DocxWalker(styles, doc.report, ctx);
    await walker.body(body);
    doc.flows.push({ name, blocks: walker.builder.blocks });
    await readComments(parts, styles, walker.refs, doc, ctx);
    readCore(partText(parts, "docProps/core.xml"), doc);
    if (!doc.meta.language && styles.language)
      doc.meta.language = styles.language;
    return doc;
  },
};
