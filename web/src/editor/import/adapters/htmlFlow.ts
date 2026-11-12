// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  bump,
  type Align,
  type ImportedComment,
  type Inline,
  type MatterKind,
  type ReadReport,
  type Signals,
  type SourceBlock,
  type SourceMeta,
} from "../domain/source";
import { classRules, parseDeclarations, type StyleProps } from "./css";
import {
  cleanInlines,
  FlowBuilder,
  COMMENT_MARK,
  unmarked,
} from "./flowBuilder";

// One walker over inert HTML. HTML arrives four ways (a web page, an online
// word processor's "download as web page", a desktop one's "save as web
// page", and the XHTML inside an epub), and Markdown can carry it too. All of
// them are parsed by `DOMParser` into a document no script can run in, and
// walked here, once, by one piece of code. It does not reuse the
// engine's clipboard codec `browserHtml.ts`, which reads markup with regular
// expressions and so cannot see a class-based italic.
//
// The walk is a paragraph accumulator. Text lands in the open paragraph,
// carrying the formatting its ancestors give it: tags (`<em>`, `<b>`), class
// rules from `<style>`, where the online word processor puts every italic,
// and inline styles. Every block boundary closes the paragraph. A paragraph
// element (`<p>`, `<h2>`, `<li>` and the rest) always yields one, even empty,
// because an empty paragraph is how a desktop word processor's page writes a
// blank line, and blank lines are evidence; a wrapper (`<div>`, `<section>`)
// yields one only when it held loose text.
//
// What the walker recognises beyond plain HTML:
//   - the online word processor's `p.title`/`p.subtitle`, `#cmnt` comments
//     and `#ftnt` footnotes, which are stepped over and counted, never read
//     as text;
//   - the desktop word processor's `MsoTitle`/`MsoSubtitle` and
//     `mso-outline-level`;
//   - the app's own export: `section.chapter-*`, `p.scene-break`,
//     `div.page-break`, `p.blank`;
//   - epub: `epub:type` and `role="doc-*"` for matter and for notes.

const SKIP = new Set([
  "head",
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "button",
  "input",
  "select",
  "textarea",
  "math",
  "canvas",
  "audio",
  "video",
  "map",
]);

const IMAGES = new Set(["img", "svg", "picture", "image"]);

/** Elements that always make a paragraph of their own. */
const PARAGRAPHS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "dt",
  "dd",
  "pre",
  "figcaption",
  "td",
  "th",
  "caption",
  "summary",
  "address",
]);

/** Elements that only wrap, closing the open paragraph going in and out. */
const WRAPPERS = new Set([
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "aside",
  "nav",
  "figure",
  "blockquote",
  "ul",
  "ol",
  "dl",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "body",
  "html",
  "center",
  "details",
  "hgroup",
  "menu",
  "fieldset",
  "form",
]);

/** `epub:type` and `role="doc-*"` names, as matter. */
const MATTER_TYPES: Record<string, MatterKind> = {
  toc: "toc",
  titlepage: "titlePage",
  halftitlepage: "titlePage",
  frontispiece: "titlePage",
  "copyright-page": "copyright",
  colophon: "copyright",
  dedication: "dedication",
  epigraph: "epigraph",
  foreword: "foreword",
  preface: "preface",
  introduction: "introduction",
  prologue: "prologue",
  epilogue: "epilogue",
  afterword: "afterword",
  conclusion: "afterword",
  acknowledgments: "acknowledgments",
  acknowledgements: "acknowledgments",
  appendix: "appendix",
  glossary: "glossary",
  bibliography: "bibliography",
  index: "index",
  endnotes: "notes",
  footnotes: "notes",
  rearnotes: "notes",
  contributors: "about",
  "other-credits": "about",
};

/** The app's own export's chapter classes. */
const EXPORT_CHAPTERS: Record<string, MatterKind> = {
  "chapter-title": "titlePage",
  "chapter-toc": "toc",
};

interface Fmt {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  mono: boolean;
}

interface BlockCtx {
  align: Align;
  role?: Signals["role"];
  origin?: Signals["origin"];
  fontSizePt?: number;
  caps?: boolean;
}

interface OpenPara {
  inlines: Inline[];
  align: Align;
  signals: Signals;
  /** Note targets whose marks this paragraph holds, in order. */
  refs: string[];
}

/**
 * A reference that may cite a comment, before it is linked to its body. A
 * footnote's reference looks the same until then: it finds no comment body
 * and is dropped.
 */
export interface CommentRef {
  /** The target as written: "#fn1", "notes.xhtml#fn1". */
  href: string;
  block: number;
  offset: number;
}

export interface CommentBody {
  body: Inline[][];
}

/**
 * What a body element is. Footnotes and endnotes are found only so the walk
 * can step over them and the report can count them: the project has no place
 * for them, so their bodies are never kept.
 */
type BodyKind = "comment" | "footnote" | "endnote";

export interface HtmlWalk {
  blocks: SourceBlock[];
  refs: CommentRef[];
  /** Comment bodies by their element id. */
  bodies: Map<string, CommentBody>;
  meta: SourceMeta;
}

/** Every token of an `epub:type` or `role` attribute, without `doc-`. */
function semanticTypes(el: Element): string[] {
  const types: string[] = [];
  for (const a of Array.from(el.attributes))
    if (
      (a.localName === "type" && a.prefix === "epub") ||
      a.name === "epub:type" ||
      a.localName === "role"
    )
      for (const token of a.value.split(/\s+/))
        if (token) types.push(token.replace(/^doc-/, "").toLowerCase());
  return types;
}

const NOTE_TYPES = new Set(["footnote", "endnote", "rearnote", "note"]);
const NOTE_ID = /^(fn|ftn|ftnt|footnote|note|endnote|en|cmnt)[-_:]?\w*\d/i;

function noteKindOf(el: Element): BodyKind | null {
  const types = semanticTypes(el);
  if (types.includes("endnote") || types.includes("rearnote")) return "endnote";
  if (types.some((t) => NOTE_TYPES.has(t))) return "footnote";
  return null;
}

/** The element a note body lives in, for a reference pointing at `target`. */
function noteBodyOf(target: Element): { el: Element; kind: BodyKind } | null {
  const id = target.getAttribute("id") ?? "";
  // The online word processor's target is the back-link anchor, wrapped in a
  // <p> in a <div>.
  if (/^cmnt\d+$/.test(id))
    return { el: target.closest("div") ?? target, kind: "comment" };
  if (/^ftnt\d+$/.test(id))
    return { el: target.closest("div") ?? target, kind: "footnote" };
  for (let el: Element | null = target; el; el = el.parentElement) {
    const kind = noteKindOf(el);
    if (kind) return { el, kind };
    const types = semanticTypes(el);
    if (types.includes("endnotes") || types.includes("rearnotes"))
      return { el: target, kind: "endnote" };
    if (types.includes("footnotes")) return { el: target, kind: "footnote" };
  }
  if (NOTE_ID.test(id)) return { el: target, kind: "footnote" };
  return null;
}

function isNoteRef(a: Element): boolean {
  const href = a.getAttribute("href") ?? "";
  if (!href.includes("#")) return false;
  const types = semanticTypes(a);
  if (types.includes("noteref")) return true;
  if (types.includes("backlink")) return false;
  const id = a.getAttribute("id") ?? "";
  if (/^(ftnt|cmnt)_ref\d+$/.test(id)) return true;
  if (/^#(ftnt|cmnt)\d+$/.test(href)) return true;
  return !!a.closest("sup") && NOTE_ID.test(href.split("#")[1] ?? "");
}

/**
 * What an element says it is, as matter (`epub:type="copyright-page"`,
 * `role="doc-dedication"`), or `undefined`. The epub reader asks it of a
 * chapter's body and first section, to give the whole flow its role.
 */
export function matterTypeOf(el: Element): MatterKind | undefined {
  for (const type of semanticTypes(el))
    if (MATTER_TYPES[type]) return MATTER_TYPES[type];
  return undefined;
}

/**
 * Walks a parsed HTML or XHTML document, adding to `report`. Note bodies and
 * references are returned for the caller to link, because an epub's notes can
 * sit in a different file from the text that cites them.
 */
export function walkHtml(doc: Document, report: ReadReport): HtmlWalk {
  const rules = classRules(
    Array.from(doc.getElementsByTagName("style")).map(
      (s) => s.textContent ?? "",
    ),
  );
  const builder = new FlowBuilder(report);
  const refs: CommentRef[] = [];
  const bodies = new Map<string, CommentBody>();

  // Note bodies first, so the walk can step over them. Each body element is
  // found once, with its kind decided where it is found.
  const found = new Map<Element, BodyKind>();
  const refTargets = new Map<Element, string>();
  for (const a of Array.from(doc.getElementsByTagName("a"))) {
    if (!isNoteRef(a)) continue;
    const href = a.getAttribute("href") ?? "";
    refTargets.set(a, href);
    const local = href.startsWith("#")
      ? doc.getElementById(href.slice(1))
      : null;
    const body = local ? noteBodyOf(local) : null;
    if (body && !found.has(body.el)) found.set(body.el, body.kind);
  }
  // Bodies nobody in this file cites are still bodies: an epub's notes file
  // holds the notes its chapters cite from elsewhere.
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    const kind = noteKindOf(el);
    if (kind && !found.has(el)) found.set(el, kind);
    const types = semanticTypes(el);
    const listKind = types.includes("footnotes")
      ? "footnote"
      : types.includes("endnotes") || types.includes("rearnotes")
        ? "endnote"
        : null;
    if (listKind)
      for (const item of Array.from(el.querySelectorAll("li[id], aside[id]")))
        if (!found.has(item)) found.set(item, listKind);
  }
  // A body inside another body is part of it, not a note of its own.
  const skipped = new Set<Element>();
  for (const el of found.keys()) {
    let nested = false;
    for (let up = el.parentElement; up; up = up.parentElement)
      if (found.has(up)) nested = true;
    if (!nested) skipped.add(el);
  }
  for (const el of skipped) {
    const kind = found.get(el) ?? "footnote";
    // The online word processor keys a body by the back-link anchor inside
    // it, not the div.
    const docsAnchor = Array.from(el.querySelectorAll("a[id]")).find((a) =>
      /^(ftnt|cmnt)\d+$/.test(a.getAttribute("id") ?? ""),
    );
    const id =
      docsAnchor?.getAttribute("id") ??
      el.getAttribute("id") ??
      el.querySelector("[id]")?.getAttribute("id");
    if (!id) continue;
    if (kind === "comment")
      bodies.set(id, { body: commentParagraphs(el, rules) });
    bump(
      report,
      kind === "comment"
        ? "comments"
        : kind === "endnote"
          ? "endnotes"
          : "footnotes",
    );
  }

  let open: OpenPara | null = null;
  let pendingBreak = false;
  const countedLists = new Set<Element>();
  const countedTables = new Set<Element>();
  const countedQuotes = new Set<Element>();

  const close = (force: boolean) => {
    const para = open;
    open = null;
    if (!para) return;
    const hasText =
      para.inlines.some((i) => i.text.trim()) || para.refs.length > 0;
    if (!hasText && !force) {
      // Dropped empty, it hands its page break on to the next paragraph.
      if (para.signals.breakBefore) pendingBreak = true;
      return;
    }
    const block = builder.next;
    const offsets = builder.para(para.inlines, para.align, para.signals);
    para.refs.forEach((href, i) =>
      refs.push({ href, block, offset: offsets[i] ?? 0 }),
    );
  };

  const ensure = (ctx: BlockCtx, signals: Signals = {}): OpenPara => {
    if (!open) {
      const merged: Signals = { ...signals };
      if (ctx.role && !merged.role) merged.role = ctx.role;
      if (ctx.origin) merged.origin = ctx.origin;
      if (ctx.fontSizePt) merged.fontSizePt = ctx.fontSizePt;
      if (ctx.caps) merged.allCaps = true;
      if (pendingBreak) {
        merged.breakBefore = true;
        pendingBreak = false;
      }
      open = { inlines: [], align: ctx.align, signals: merged, refs: [] };
    }
    return open;
  };

  const styleOf = (el: Element): StyleProps => {
    let props: StyleProps = {};
    for (const cls of (el.getAttribute("class") ?? "").split(/\s+/))
      if (cls && rules.has(cls)) props = { ...props, ...rules.get(cls) };
    const inline = el.getAttribute("style");
    if (inline) props = { ...props, ...parseDeclarations(inline) };
    return props;
  };

  const fmtOf = (tag: string, base: Fmt, style: StyleProps): Fmt => {
    const fmt = { ...base };
    if (
      tag === "em" ||
      tag === "i" ||
      tag === "cite" ||
      tag === "dfn" ||
      tag === "var"
    )
      fmt.italic = true;
    if (tag === "strong" || tag === "b") fmt.bold = true;
    if (tag === "u" || tag === "ins") fmt.underline = true;
    if (tag === "code" || tag === "tt" || tag === "kbd" || tag === "samp")
      fmt.mono = true;
    if (style.italic !== undefined) fmt.italic = style.italic;
    if (style.bold !== undefined) fmt.bold = style.bold;
    if (style.underline !== undefined) fmt.underline = style.underline;
    if (style.mono) fmt.mono = true;
    return fmt;
  };

  const visit = (node: Node, fmt: Fmt, ctx: BlockCtx, signals: Signals) => {
    if (node.nodeType === 3 || node.nodeType === 4) {
      const raw = unmarked((node as Text).data);
      if (!raw) return;
      if (ctx.origin === "code") {
        // Preformatted text keeps its lines as paragraphs.
        const lines = raw.split("\n");
        lines.forEach((line, i) => {
          if (i > 0) close(true);
          ensure(ctx, signals).inlines.push({ text: line, ...fmt });
        });
        return;
      }
      if (!open && !raw.trim()) return;
      ensure(ctx, signals).inlines.push({ text: raw, ...fmt });
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.localName.toLowerCase();
    if (SKIP.has(tag) || skipped.has(el)) return;
    const style = styleOf(el);
    if (style.hidden || el.hasAttribute("hidden")) {
      if ((el.textContent ?? "").trim()) bump(report, "hiddenText");
      return;
    }
    if (IMAGES.has(tag)) {
      bump(report, "images");
      return;
    }
    if (tag === "br") {
      close(true);
      return;
    }
    const cls = (el.getAttribute("class") ?? "").split(/\s+/);
    if (tag === "hr") {
      close(false);
      if (cls.includes("page-break") || style.breakBefore || style.breakAfter)
        builder.pageBreak();
      else builder.rule();
      return;
    }
    if (cls.includes("page-break") && !(el.textContent ?? "").trim()) {
      close(false);
      builder.pageBreak();
      return;
    }

    const href = refTargets.get(el);
    if (href !== undefined) {
      const para = ensure(ctx, signals);
      para.inlines.push({ text: COMMENT_MARK, ...fmt });
      para.refs.push(href);
      return;
    }

    const isPara = PARAGRAPHS.has(tag);
    const isWrapper = WRAPPERS.has(tag);
    if (!isPara && !isWrapper) {
      // Inline: formatting changes, the paragraph does not.
      if (tag === "a" && el.hasAttribute("href")) bump(report, "links");
      if (tag === "s" || tag === "strike" || tag === "del" || style.strike)
        bump(report, "strike");
      const next = fmtOf(tag, fmt, style);
      for (const child of Array.from(el.childNodes))
        visit(child, next, ctx, signals);
      return;
    }

    // A block: close what is open, work out what this block says, walk it.
    close(false);
    const next: BlockCtx = { ...ctx };
    if (style.align) next.align = style.align;
    const alignAttr = el.getAttribute("align")?.toLowerCase();
    if (
      alignAttr === "center" ||
      alignAttr === "right" ||
      alignAttr === "justify"
    )
      next.align = alignAttr;
    if (tag === "center") next.align = "center";
    if (style.fontSizePt) next.fontSizePt = style.fontSizePt;
    if (style.caps !== undefined) next.caps = style.caps;
    for (const type of semanticTypes(el))
      if (MATTER_TYPES[type]) next.role = MATTER_TYPES[type];
    for (const c of cls) if (EXPORT_CHAPTERS[c]) next.role = EXPORT_CHAPTERS[c];
    if (tag === "nav" && cls.includes("toc")) next.role = "toc";
    if (tag === "li" || tag === "dt" || tag === "dd") next.origin = "list";
    if (tag === "td" || tag === "th" || tag === "caption")
      next.origin = "table";
    if (tag === "pre") next.origin = "code";
    if (tag === "blockquote") {
      next.origin = "quote";
      if (!countedQuotes.has(el)) {
        countedQuotes.add(el);
        bump(report, "quotes");
      }
    }
    if (
      (tag === "ul" || tag === "ol" || tag === "dl") &&
      !el.parentElement?.closest("ul,ol,dl")
    ) {
      if (!countedLists.has(el)) {
        countedLists.add(el);
        bump(report, "lists");
      }
    }
    if (tag === "table" && !countedTables.has(el)) {
      countedTables.add(el);
      bump(report, "tables");
    }
    // The app's export ends each chapter on a page; the next starts a new one.
    if (style.breakBefore || (tag === "section" && cls.includes("chapter")))
      pendingBreak = true;

    const own: Signals = {};
    if (/^h[1-6]$/.test(tag)) own.headingLevel = Number(tag[1]);
    if (style.outlineLevel) own.headingLevel = style.outlineLevel;
    if (cls.includes("title") || cls.includes("MsoTitle")) own.role = "title";
    if (cls.includes("subtitle") || cls.includes("MsoSubtitle"))
      own.role = "subtitle";
    const childSignals = isPara ? { ...signals, ...own } : signals;
    const childFmt = fmtOf(tag, fmt, style);
    // A paragraph element opens its paragraph now, so `<p>&nbsp;</p>` is
    // still a paragraph. A block inside it that closes it empty drops the
    // empty one.
    if (isPara) ensure(next, childSignals);
    for (const child of Array.from(el.childNodes))
      visit(child, childFmt, next, childSignals);
    close(isPara);
    if (style.breakAfter) pendingBreak = true;
  };

  const plain: Fmt = {
    bold: false,
    italic: false,
    underline: false,
    mono: false,
  };
  const root = doc.body ?? doc.documentElement;
  if (root) visit(root, plain, { align: "left" }, {});
  close(false);

  return { blocks: builder.blocks, refs, bodies, meta: metaOf(doc) };
}

/** A comment body's paragraphs, the back-link and its "[a]" taken out. */
function commentParagraphs(
  el: Element,
  rules: Map<string, StyleProps>,
): Inline[][] {
  const paras: Inline[][] = [];
  let current: Inline[] = [];
  const push = () => {
    const clean = cleanInlines(current);
    if (clean.length) paras.push(clean);
    current = [];
  };
  const walk = (node: Node, fmt: Fmt) => {
    if (node.nodeType === 3) {
      current.push({ text: (node as Text).data, ...fmt });
      return;
    }
    if (node.nodeType !== 1) return;
    const child = node as Element;
    const tag = child.localName.toLowerCase();
    if (SKIP.has(tag) || IMAGES.has(tag)) return;
    const types = semanticTypes(child);
    const id = child.getAttribute("id") ?? "";
    const href = child.getAttribute("href") ?? "";
    // The way back to the text: the online word processor's "[a]" anchor,
    // or an epub's back-link.
    if (
      tag === "a" &&
      (types.includes("backlink") ||
        /^(ftnt|cmnt)\d+$/.test(id) ||
        /_ref\d+$/.test(href))
    )
      return;
    const props: StyleProps = {};
    for (const cls of (child.getAttribute("class") ?? "").split(/\s+/))
      if (cls && rules.has(cls)) Object.assign(props, rules.get(cls));
    Object.assign(props, parseDeclarations(child.getAttribute("style") ?? ""));
    const next = { ...fmt };
    if (tag === "em" || tag === "i") next.italic = true;
    if (tag === "strong" || tag === "b") next.bold = true;
    if (props.italic !== undefined) next.italic = props.italic;
    if (props.bold !== undefined) next.bold = props.bold;
    const block = PARAGRAPHS.has(tag) || WRAPPERS.has(tag);
    if (block) push();
    for (const grand of Array.from(child.childNodes)) walk(grand, next);
    if (block) push();
  };
  walk(el, { bold: false, italic: false, underline: false, mono: false });
  push();
  return paras;
}

function metaOf(doc: Document): SourceMeta {
  const meta: SourceMeta = {};
  const title = doc.querySelector("title")?.textContent?.trim();
  if (title) meta.title = title;
  const author = doc
    .querySelector('meta[name="author" i], meta[name="dc.creator" i]')
    ?.getAttribute("content")
    ?.trim();
  if (author) meta.author = author;
  const html = doc.documentElement;
  const lang =
    html?.getAttribute("lang") ??
    html?.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang") ??
    html?.getAttribute("xml:lang") ??
    doc
      .querySelector('meta[http-equiv="content-language" i]')
      ?.getAttribute("content");
  if (lang?.trim()) meta.language = lang.trim();
  return meta;
}

/**
 * Links references to their bodies. `resolve` turns a reference's href into
 * the key its body was stored under; an epub qualifies it with the file. A
 * reference whose body is missing is dropped, and a body nobody cites is kept
 * with no anchor, because it is still the editor's comment.
 */
export function linkComments(
  refs: readonly (CommentRef & { flow: number })[],
  bodies: ReadonlyMap<string, CommentBody>,
  resolve: (ref: CommentRef & { flow: number }) => string,
): ImportedComment[] {
  const comments: ImportedComment[] = [];
  const cited = new Set<string>();
  for (const ref of refs) {
    const key = resolve(ref);
    const body = bodies.get(key);
    if (!body || cited.has(key)) continue;
    cited.add(key);
    const point = { block: ref.block, offset: ref.offset };
    comments.push({
      sourceId: key,
      anchor: { flow: ref.flow, start: point, end: point },
      body: body.body,
    });
  }
  for (const [key, body] of bodies)
    if (!cited.has(key))
      comments.push({
        sourceId: key,
        anchor: null,
        body: body.body,
      });
  return comments;
}
