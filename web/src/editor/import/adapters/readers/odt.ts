// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  bump,
  emptySource,
  type Align,
  type ImportedComment,
  type Inline,
  type ReadReport,
  type Signals,
  type SourceDocument,
} from "../../domain/source";
import type { FormatReader, ReadContext } from "../../ports";
import { ReadRefused } from "../failure";
import { FlowBuilder, COMMENT_MARK, pacer, unmarked } from "../flowBuilder";
import { attr, descendant, kid, kids, parseXml } from "../xml";
import { partText, unzipParts } from "../zip";

// Reads .odt, the open office suites' format and an export target of online
// and desktop word processors. ODF styles inherit through
// `style:parent-style-name` and, unlike a .docx's, do not toggle: an italic
// span in an italic paragraph is still italic. A paragraph's automatic style
// (in content.xml) usually names a common one (in styles.xml), so both files
// are read into one table.
//
// Page breaks are `fo:break-before`/`fo:break-after` on a paragraph's style,
// or a change of master page, which starts a new page by definition. Soft
// page breaks are where the last layout wrapped and are ignored, like a
// .docx's `lastRenderedPageBreak`. Tables of contents and indexes are dropped
// whole. Tracked changes are accepted: the deletions sit apart, in
// `text:tracked-changes`, and are never read as text.

interface TextProps {
  italic?: boolean;
  bold?: boolean;
  underline?: boolean;
  caps?: boolean;
  hidden?: boolean;
  mono?: boolean;
  size?: number;
}

interface ParaProps {
  align?: Align;
  breakBefore?: boolean;
  breakAfter?: boolean;
  masterPage?: string;
}

interface OdfStyle {
  name: string;
  display: string;
  family: string;
  parent?: string;
  text: TextProps;
  para: ParaProps;
}

const MONO = /courier|consolas|menlo|monaco|mono|source code/i;
const DROPPED = new Set([
  "table-of-content",
  "alphabetical-index",
  "illustration-index",
  "table-index",
  "object-index",
  "user-index",
  "bibliography",
  "tracked-changes",
  "sequence-decls",
  "variable-decls",
  "user-field-decls",
  "forms",
]);

function textProps(el: Element | null, fonts: Map<string, string>): TextProps {
  const props: TextProps = {};
  if (!el) return props;
  const style = attr(el, "font-style");
  if (style) props.italic = style === "italic" || style === "oblique";
  const weight = attr(el, "font-weight");
  if (weight) props.bold = weight === "bold" || Number(weight) >= 600;
  const underline = attr(el, "text-underline-style");
  if (underline) props.underline = underline !== "none";
  const transform = attr(el, "text-transform");
  if (transform) props.caps = transform === "uppercase";
  if (attr(el, "font-variant") === "small-caps") props.caps = true;
  if (attr(el, "display") === "none") props.hidden = true;
  const font = attr(el, "font-name");
  const family =
    attr(el, "font-family") ?? (font ? fonts.get(font) : undefined) ?? font;
  if (family) props.mono = MONO.test(family);
  const size = /^([\d.]+)pt$/.exec(attr(el, "font-size") ?? "");
  if (size) props.size = Number(size[1]);
  return props;
}

function paraProps(el: Element | null): ParaProps {
  const props: ParaProps = {};
  if (!el) return props;
  const align = attr(el, "text-align");
  if (align === "center") props.align = "center";
  else if (align === "end" || align === "right") props.align = "right";
  else if (align === "justify") props.align = "justify";
  else if (align === "start" || align === "left") props.align = "left";
  if (attr(el, "break-before") === "page") props.breakBefore = true;
  if (attr(el, "break-after") === "page") props.breakAfter = true;
  return props;
}

class OdfStyles {
  private readonly styles = new Map<string, OdfStyle>();
  private readonly defaults = new Map<string, TextProps>();
  readonly language?: string;

  constructor(docs: Document[]) {
    const fonts = new Map<string, string>();
    for (const doc of docs)
      for (const face of Array.from(
        doc.getElementsByTagNameNS("*", "font-face"),
      )) {
        const name = attr(face, "name");
        const family = attr(face, "font-family");
        if (name && family) fonts.set(name, family);
      }
    let language: string | undefined;
    for (const doc of docs) {
      for (const el of Array.from(
        doc.getElementsByTagNameNS("*", "default-style"),
      )) {
        const tp = kid(el, "text-properties");
        this.defaults.set(attr(el, "family") ?? "", textProps(tp, fonts));
        const lang = tp ? attr(tp, "language") : null;
        if (lang && lang !== "zxx" && !language) {
          const country = tp ? attr(tp, "country") : null;
          language =
            country && country !== "none" ? `${lang}-${country}` : lang;
        }
      }
      for (const el of Array.from(doc.getElementsByTagNameNS("*", "style"))) {
        if (el.namespaceURI && !el.namespaceURI.includes("style")) continue;
        const name = attr(el, "name");
        if (!name) continue;
        const para = paraProps(kid(el, "paragraph-properties"));
        const master = attr(el, "master-page-name");
        if (master) para.masterPage = master;
        this.styles.set(name, {
          name,
          display: (
            attr(el, "display-name") ?? name.replace(/_20_/g, " ")
          ).toLowerCase(),
          family: attr(el, "family") ?? "paragraph",
          parent: attr(el, "parent-style-name") ?? undefined,
          text: textProps(kid(el, "text-properties"), fonts),
          para,
        });
      }
    }
    this.language = language;
  }

  private chain(name: string | null): OdfStyle[] {
    const out: OdfStyle[] = [];
    const seen = new Set<string>();
    for (let style = name ? this.styles.get(name) : undefined; style;) {
      if (seen.has(style.name)) break;
      seen.add(style.name);
      out.push(style);
      style = style.parent ? this.styles.get(style.parent) : undefined;
    }
    return out;
  }

  text(name: string | null, family: string): TextProps {
    const out: TextProps = { ...this.defaults.get(family) };
    for (const style of this.chain(name).reverse())
      Object.assign(out, defined(style.text));
    return out;
  }

  para(name: string | null): ParaProps {
    const out: ParaProps = {};
    const chain = this.chain(name);
    for (const style of [...chain].reverse())
      Object.assign(out, defined(style.para));
    // A master page belongs to the style that names it, not to its parents,
    // so only a paragraph's own automatic style starts a new page that way.
    out.masterPage = chain[0]?.para.masterPage;
    return out;
  }

  /** The names in a style's chain, nearest first ("heading 1", "title"). */
  names(name: string | null): string[] {
    return this.chain(name).map((style) => style.display);
  }
}

function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

const ROW_GROUPS = new Set([
  "table-header-rows",
  "table-rows",
  "table-row-group",
]);

/**
 * A table's own cells in reading order, through its row groups. A nested
 * table's cells are left to the cell that holds it, so its text reads once.
 */
function tableCells(table: Element): Element[] {
  const cells: Element[] = [];
  const rows = (el: Element) => {
    for (const child of kids(el))
      if (child.localName === "table-row")
        cells.push(...kids(child, "table-cell"));
      else if (ROW_GROUPS.has(child.localName)) rows(child);
  };
  rows(table);
  return cells;
}

interface Ref {
  key: string;
  block: number;
  offset: number;
}

interface Part {
  inlines: Inline[];
  refs: string[];
}

class OdtWalker {
  readonly builder: FlowBuilder;
  readonly refs: Ref[] = [];
  readonly comments: ImportedComment[] = [];
  private pendingBreak = false;
  private master: string | undefined;
  private readonly pace: { tick(): Promise<void> };
  private commentCount = 0;
  /** Text boxes met inside the paragraph being read, read after it. */
  private boxes: Element[] = [];
  /** Frames met so far, so a paragraph can tell it held only one. */
  private frames = 0;

  constructor(
    private readonly styles: OdfStyles,
    private readonly report: ReadReport,
    ctx: ReadContext,
    /**
     * False for the walker reading a comment's body: only the book's own
     * walker keeps comments and counts footnotes.
     */
    private readonly readsBook = true,
  ) {
    this.builder = new FlowBuilder(report);
    this.pace = pacer(ctx);
  }

  async body(container: Element, origin?: Signals["origin"]): Promise<void> {
    for (const el of kids(container)) {
      const name = el.localName;
      if (DROPPED.has(name)) continue;
      switch (name) {
        case "p":
        case "h":
          await this.paragraph(el, origin);
          break;
        case "list":
          if (!origin) bump(this.report, "lists");
          for (const item of kids(el)) await this.body(item, origin ?? "list");
          break;
        case "list-item":
        case "list-header":
          await this.body(el, origin ?? "list");
          break;
        case "table":
          bump(this.report, "tables");
          for (const cell of tableCells(el)) await this.body(cell, "table");
          break;
        case "section":
        case "index-body":
          await this.body(el, origin);
          break;
        case "frame":
          this.frame(el);
          for (const box of this.boxes.splice(0)) await this.body(box, origin);
          break;
      }
    }
  }

  private async paragraph(
    p: Element,
    origin?: Signals["origin"],
  ): Promise<void> {
    await this.pace.tick();
    this.paragraphNow(p, origin);
    // A text box's words are the writer's, and the manuscript has no
    // floating frames, so they come across as paragraphs where it was
    // anchored.
    for (const box of this.boxes.splice(0)) await this.body(box, origin);
  }

  /** A frame: its text box read after the paragraph, a picture counted. */
  private frame(el: Element): void {
    this.frames += 1;
    const box = descendant(el, "text-box");
    if (box) this.boxes.push(box);
    else bump(this.report, "images");
  }

  private paragraphNow(p: Element, origin?: Signals["origin"]): void {
    const framesBefore = this.frames;
    const styleName = attr(p, "style-name");
    const props = this.styles.para(styleName);
    const names = this.styles.names(styleName);
    const signals: Signals = {};
    if (names[0]) signals.styleName = names[0];
    if (p.localName === "h") {
      const level = Number(attr(p, "outline-level") ?? "1");
      signals.headingLevel = Math.min(
        6,
        Math.max(1, Number.isFinite(level) ? level : 1),
      );
    } else {
      const heading = names.map((n) => /^heading (\d)$/.exec(n)).find(Boolean);
      if (heading) signals.headingLevel = Math.min(6, Number(heading[1]));
    }
    if (names.includes("title")) signals.role = "title";
    else if (names.includes("subtitle")) signals.role = "subtitle";
    if (origin) signals.origin = origin;

    let breakBefore = this.pendingBreak || !!props.breakBefore;
    if (props.masterPage && props.masterPage !== this.master) {
      if (this.master !== undefined) breakBefore = true;
      this.master = props.masterPage;
    }
    this.pendingBreak = !!props.breakAfter;

    const parts: Part[] = [{ inlines: [], refs: [] }];
    const base = this.styles.text(styleName, "paragraph");
    const sizes: number[] = [];
    let caps = true;
    let texted = false;
    let hiddenText = false;
    const walk = (node: Node, fmt: TextProps) => {
      const part = parts[parts.length - 1];
      if (node.nodeType === 3) {
        const text = unmarked((node as Text).data);
        if (!text) return;
        if (fmt.hidden) {
          if (text.trim()) {
            bump(this.report, "hiddenText");
            hiddenText = true;
          }
          return;
        }
        if (text.trim()) {
          texted = true;
          if (!fmt.caps) caps = false;
          if (fmt.size) sizes.push(fmt.size);
        }
        part.inlines.push({
          text,
          bold: fmt.bold,
          italic: fmt.italic,
          underline: fmt.underline,
          mono: fmt.mono,
        });
        return;
      }
      if (node.nodeType !== 1) return;
      const el = node as Element;
      switch (el.localName) {
        case "span": {
          const span = this.styles.text(attr(el, "style-name"), "text");
          const next = { ...fmt, ...defined(span) };
          for (const child of Array.from(el.childNodes)) walk(child, next);
          return;
        }
        case "a":
          bump(this.report, "links");
          for (const child of Array.from(el.childNodes)) walk(child, fmt);
          return;
        case "s": {
          const count = Number(attr(el, "c") ?? "1");
          part.inlines.push({
            text: " ".repeat(Number.isFinite(count) ? Math.min(count, 8) : 1),
          });
          return;
        }
        case "tab":
          part.inlines.push({ text: " " });
          return;
        case "line-break":
          parts.push({ inlines: [], refs: [] });
          return;
        // A footnote or endnote is counted, and its body never read as text.
        case "note":
          if (this.readsBook)
            bump(
              this.report,
              attr(el, "note-class") === "endnote" ? "endnotes" : "footnotes",
            );
          return;
        case "annotation":
          this.annotation(el, part);
          return;
        case "annotation-end":
          part.inlines.push({ text: COMMENT_MARK });
          part.refs.push(`ae:${attr(el, "name") ?? ""}`);
          return;
        case "frame":
          this.frame(el);
          return;
        case "change":
        case "change-start":
        case "change-end":
        case "soft-page-break":
        case "bookmark":
        case "bookmark-start":
        case "bookmark-end":
        case "reference-mark":
        case "reference-mark-start":
        case "reference-mark-end":
          return;
        default:
          // Fields (page numbers, dates, cross-references) and unknown
          // wrappers keep their visible text.
          for (const child of Array.from(el.childNodes)) walk(child, fmt);
      }
    };
    for (const child of Array.from(p.childNodes)) walk(child, base);
    // A paragraph whose every word is hidden, or that only anchored a picture
    // or a text box, is not a blank line: a blank line reads as a scene
    // break. Its page break, if it had one, passes to the next paragraph.
    if (
      (hiddenText || this.frames > framesBefore) &&
      !texted &&
      parts.every((part) => !part.refs.length)
    ) {
      this.pendingBreak ||= breakBefore;
      return;
    }
    if (sizes.length) signals.fontSizePt = sizes[0];
    if (texted && caps) signals.allCaps = true;

    const align = props.align ?? "left";
    parts.forEach((part, i) => {
      const block = this.builder.next;
      const offsets = this.builder.para(part.inlines, align, {
        ...signals,
        ...(i === 0 && breakBefore ? { breakBefore: true } : {}),
      });
      part.refs.forEach((key, n) =>
        this.refs.push({ key, block, offset: offsets[n] ?? 0 }),
      );
    });
  }

  private annotation(el: Element, part: Part): void {
    this.commentCount += 1;
    const name = attr(el, "name");
    const key = name ? `as:${name}` : `a:${this.commentCount}`;
    part.inlines.push({ text: COMMENT_MARK });
    part.refs.push(key);
    if (!this.readsBook) return;
    const comment: ImportedComment = {
      sourceId: key,
      anchor: null,
      body: this.bodyOf(el),
    };
    const author = kid(el, "creator")?.textContent?.trim();
    const date = kid(el, "date")?.textContent?.trim();
    if (author) comment.author = author;
    if (date) comment.date = date;
    this.comments.push(comment);
    bump(this.report, "comments");
  }

  /** A comment's paragraphs as runs, read by a walker of its own. */
  private bodyOf(el: Element): Inline[][] {
    const inner = new OdtWalker(
      this.styles,
      {},
      { yield: async () => undefined },
      false,
    );
    const paras: Inline[][] = [];
    for (const p of kids(el).filter(
      (c) => c.localName === "p" || c.localName === "h",
    )) {
      // Synchronous: a comment is a handful of paragraphs, and its body is
      // needed now, while the paragraph that cites it is being read.
      inner.paragraphNow(p);
    }
    for (const block of inner.builder.blocks)
      if (block.kind === "para" && block.inlines.length)
        paras.push(block.inlines);
    return paras;
  }
}

function readMeta(xml: string | null, doc: SourceDocument): void {
  if (!xml) return;
  const root = parseXml(xml).documentElement;
  const text = (name: string) =>
    descendant(root, name)?.textContent?.trim() || undefined;
  const title = text("title");
  const author = text("creator") ?? text("initial-creator");
  const language = text("language");
  if (title) doc.meta.title = title;
  if (author) doc.meta.author = author;
  if (language) doc.meta.language = language;
}

export const odtReader: FormatReader = {
  format: "odt",
  async read(bytes, name, ctx) {
    const doc = emptySource("odt");
    const parts = unzipParts(
      bytes,
      (n) => n === "content.xml" || n === "styles.xml" || n === "meta.xml",
    );
    const content = partText(parts, "content.xml");
    if (!content) throw new ReadRefused("damaged", "no content.xml");
    const contentDoc = parseXml(content);
    const stylesXml = partText(parts, "styles.xml");
    const styles = new OdfStyles(
      stylesXml ? [parseXml(stylesXml), contentDoc] : [contentDoc],
    );
    const body = descendant(contentDoc, "body");
    const officeText = body ? kid(body, "text") : null;
    if (!officeText) throw new ReadRefused("damaged", "no office:text");

    const changes = descendant(officeText, "tracked-changes");
    if (changes)
      bump(
        doc.report,
        "trackedChanges",
        kids(changes, "changed-region").length,
      );

    const walker = new OdtWalker(styles, doc.report, ctx);
    await walker.body(officeText);
    doc.flows.push({ name, blocks: walker.builder.blocks });

    // Each comment anchors where its mark landed; a ranged comment runs from
    // its own mark to its `annotation-end`.
    const at = new Map(walker.refs.map((ref) => [ref.key, ref]));
    for (const comment of walker.comments) {
      const start = at.get(comment.sourceId);
      if (!start) continue;
      const end = comment.sourceId.startsWith("as:")
        ? at.get(`ae:${comment.sourceId.slice(3)}`)
        : undefined;
      comment.anchor = {
        flow: 0,
        start: { block: start.block, offset: start.offset },
        end: { block: (end ?? start).block, offset: (end ?? start).offset },
      };
    }
    doc.comments = walker.comments;
    readMeta(partText(parts, "meta.xml"), doc);
    if (!doc.meta.language && styles.language)
      doc.meta.language = styles.language;
    return doc;
  },
};
