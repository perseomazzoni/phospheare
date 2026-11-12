// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Renders blocks as the markup the HTML file and the EPUB share. It is
// XHTML (every element closed, `<br/>` and `<hr/>` self-closed, entities
// limited to XML's own) because an EPUB's content documents must be
// well-formed XML, and XHTML written this way is also valid HTML5, so one
// renderer serves both.
//
// Every word goes through `escapeXml`. No string from the book is spliced
// into a tag or an attribute unescaped; a link's href is one of the three
// schemes the parsers allow, and is escaped too.

import {
  FONTS,
  LAYOUTS,
  MONO_FONT,
  alignFor,
  headingStyle,
  type LayoutSpec,
} from "../../domain/layout";
import {
  tocEntries,
  type Block,
  type Chapter,
  type ExportDocument,
  type Inline,
  type TocEntry,
} from "../../domain/model";
import { escapeXml } from "./xml";

export function inlinesToHtml(inlines: readonly Inline[]): string {
  return inlines
    .map((inline) => {
      let html = escapeXml(inline.text).replace(/\n/g, "<br/>");
      if (inline.mono) html = `<code>${html}</code>`;
      if (inline.strike) html = `<del>${html}</del>`;
      if (inline.italic) html = `<em>${html}</em>`;
      if (inline.bold) html = `<strong>${html}</strong>`;
      if (inline.href) html = `<a href="${escapeXml(inline.href)}">${html}</a>`;
      return html;
    })
    .join("");
}

function alignStyle(
  align: "left" | "center" | "right" | "justify",
  layout: LayoutSpec,
): string {
  const effective = alignFor(align, layout);
  return effective === "left" ? "" : ` style="text-align:${effective}"`;
}

export function blocksToHtml(
  blocks: readonly Block[],
  layout: LayoutSpec,
): string {
  return blocks.map((block) => blockToHtml(block, layout)).join("\n");
}

function blockToHtml(block: Block, layout: LayoutSpec): string {
  switch (block.kind) {
    case "heading":
      return `<h${block.level}${alignStyle(block.align, layout)}>${inlinesToHtml(block.inlines)}</h${block.level}>`;
    case "paragraph": {
      if (block.blank) return `<p class="blank">&#160;</p>`;
      const cls = block.opener ? ` class="opener"` : "";
      return `<p${cls}${alignStyle(block.align, layout)}>${inlinesToHtml(block.inlines)}</p>`;
    }
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const start =
        block.ordered && block.start !== 1 ? ` start="${block.start}"` : "";
      const items = block.items
        .map((item) => `<li>${blocksToHtml(item, layout)}</li>`)
        .join("");
      return `<${tag}${start}>${items}</${tag}>`;
    }
    case "quote":
      return `<blockquote>${blocksToHtml(block.blocks, layout)}</blockquote>`;
    case "code":
      return `<pre><code>${escapeXml(block.text)}</code></pre>`;
    case "sceneBreak":
      // A visible glyph, never an empty paragraph: readers collapse empty
      // ones, and a scene change would vanish.
      return `<p class="scene-break" role="separator">${escapeXml(layout.sceneGlyph)}</p>`;
    case "pageBreak":
      return `<div class="page-break"></div>`;
    case "facts":
      return `<dl class="facts">${block.rows
        .map(
          ([label, value]) =>
            `<dt>${escapeXml(label)}</dt><dd>${escapeXml(value)}</dd>`,
        )
        .join("")}</dl>`;
  }
}

/** A chapter's heading and body, as one `<section>`. */
export function chapterToHtml(
  chapter: Chapter,
  doc: ExportDocument,
  href: (id: string) => string,
  epubType?: string,
): string {
  const layout = LAYOUTS[doc.layout];
  const type = epubType ? ` epub:type="${epubType}"` : "";
  const heading =
    chapter.title !== null
      ? `<h${chapter.level} id="${chapter.id}-title">${escapeXml(chapter.title)}</h${chapter.level}>`
      : "";
  const body =
    chapter.kind === "toc"
      ? tocToHtml(doc, href)
      : blocksToHtml(chapter.blocks, layout);
  return `<section id="${chapter.id}" class="chapter chapter-${chapter.kind}"${type}>\n${heading}\n${body}\n</section>`;
}

/** The visible contents: Parts with their Sections nested beneath. */
function tocToHtml(doc: ExportDocument, href: (id: string) => string): string {
  return `<nav class="toc">${nestedList(tocEntries(doc), href)}</nav>`;
}

interface TocNode {
  entry: TocEntry;
  children: TocEntry[];
}

/**
 * Contents entries as a two-level tree: a level-2 entry hangs under the
 * level-1 entry before it, and stands at the top when there is none, as for
 * a Section with no Part.
 */
export function tocTree(entries: readonly TocEntry[]): TocNode[] {
  const tree: TocNode[] = [];
  for (const entry of entries) {
    const last = tree[tree.length - 1];
    if (entry.level === 2 && last && last.entry.level === 1)
      last.children.push(entry);
    else tree.push({ entry, children: [] });
  }
  return tree;
}

export function nestedList(
  entries: readonly TocEntry[],
  href: (id: string) => string,
): string {
  const link = (entry: TocEntry) =>
    `<a href="${escapeXml(href(entry.id))}">${escapeXml(entry.title)}</a>`;
  const items = tocTree(entries).map(({ entry, children }) => {
    const nested =
      children.length > 0
        ? `<ol>${children.map((child) => `<li>${link(child)}</li>`).join("")}</ol>`
        : "";
    return `<li>${link(entry)}${nested}</li>`;
  });
  return `<ol>${items.join("")}</ol>`;
}

/** Each heading level's space above and below, in ems, as on screen. */
const HEADING_MARGINS = [
  "3em 0 1.5em",
  "2em 0 1em",
  "1.5em 0 0.5em",
  "1em 0 0.5em",
  "1em 0 0.5em",
  "1em 0 0.5em",
];

/** One rule per heading level, from the layout's heading scale. */
function headingRules(layout: LayoutSpec): string {
  return HEADING_MARGINS.map((margin, index) => {
    const style = headingStyle(layout, index + 1);
    return `h${index + 1} { font-size: ${style.scale}em; margin: ${margin};${style.centred ? " text-align: center;" : ""}${style.italic ? " font-style: italic;" : ""} }`;
  }).join("\n");
}

/** The stylesheet the HTML file and the EPUB share, from the layout's row. */
export function stylesheet(doc: ExportDocument): string {
  const layout = LAYOUTS[doc.layout];
  const mono = FONTS[MONO_FONT].css;
  return `body { font-family: ${FONTS[layout.font].css}; line-height: ${layout.lineHeight}; margin: 0 auto; max-width: 38em; padding: 0 1em; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; font-weight: normal; }
${headingRules(layout)}
p { margin: 0; text-indent: 1.5em; }
p.opener { text-indent: ${layout.indentOpeners ? "1.5em" : "0"}; }
p.blank { text-indent: 0; }
p.scene-break { text-indent: 0; text-align: center; margin: 1em 0; }
.chapter { break-after: page; page-break-after: always; }
.chapter:last-child { break-after: auto; page-break-after: auto; }
.page-break { break-after: page; page-break-after: always; }
blockquote { margin: 1em 2em; }
blockquote p, li p { text-indent: 0; }
pre { white-space: pre-wrap; font-family: ${mono}; font-size: 0.9em; }
code { font-family: ${mono}; font-size: 0.95em; }
dl.facts { display: grid; grid-template-columns: max-content 1fr; gap: 0.25em 1.5em; }
dl.facts dt { font-weight: bold; }
dl.facts dd { margin: 0; }
nav.toc ol { list-style: none; padding-left: 0; }
nav.toc ol ol { padding-left: 1.5em; }
nav.toc a { text-decoration: none; color: inherit; }
`;
}
