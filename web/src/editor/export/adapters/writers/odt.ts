// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Writes ODT (OpenDocument Text), the DOCX writer's twin for every ODF
// reader: named paragraph styles carry the layout (Text Body, Heading 1–6,
// Scene Break, Quotations and the rest), so the file is restyled, not
// repaired.
//
// ODF expresses a page break as a property of the paragraph that starts the
// new page, and a change of page furniture as that paragraph's master page.
// So each chapter's first paragraph carries one of:
//
//   - the front matter's master, on the document's first paragraph;
//   - the text's master with page numbering restarted at 1; a story's first
//     page uses a master with no running head, which hands on to the normal
//     one (`style:next-style-name`);
//   - a plain page break.
//
// That is the rule every other writer follows, that every chapter but the
// last ends on a page break, said from the other side of the break.
//
// ODF collapses runs of spaces as HTML does, so spaces, tabs and line breaks
// are written as `text:s`, `text:tab` and `text:line-break`.

import {
  FONTS,
  MONO_FONT,
  alignFor,
  chapterDrop,
  headingStyle,
  titleDrop,
  titleScale,
  type Geometry,
} from "../../domain/layout";
import {
  tocEntries,
  type Block,
  type Chapter,
  type ExportDocument,
  type Inline,
  type Opening,
} from "../../domain/model";
import type { FormatWriter } from "../../ports";
import { draftFooterParts, pagedPlan, type PagedPlan } from "./paged";
import { escapeXml, XML_DECLARATION } from "./xml";
import { zipPackage } from "./zip";
import { PRODUCT } from "../../../../product";

const NS = `xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.3"`;

const pt = (value: number) => `${Math.round(value * 100) / 100}pt`;

/** Spaces, tabs and line breaks as ODF elements, around escaped text. */
export function odfText(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .split("\t")
        .map((piece) =>
          escapeXml(piece)
            .replace(
              / {2,}/g,
              (spaces) => ` <text:s text:c="${spaces.length - 1}"/>`,
            )
            .replace(/^ /, `<text:s/>`),
        )
        .join("<text:tab/>"),
    )
    .join("<text:line-break/>");
}

type ChapterStart = "front" | "body" | "bodyFirst" | "break" | null;

interface ParaItem {
  kind: "p";
  heading?: number;
  style: string;
  align?: "left" | "center" | "right" | "justify";
  marginTop?: number;
  start?: ChapterStart;
  content: string;
}

type Item = ParaItem | { kind: "raw"; xml: string };

class OdtBuilder {
  readonly items: Item[] = [];
  private readonly textStyles = new Map<string, string>();
  private readonly paraStyles = new Map<string, string>();
  readonly automatic: string[] = [];
  private start: ChapterStart = null;
  private pendingBreak = false;

  constructor(
    private readonly doc: ExportDocument,
    private readonly geometry: Geometry,
  ) {}

  /** Marks the next paragraph as a chapter's start, of this kind. */
  beginChapter(start: ChapterStart) {
    this.start = start;
  }

  private para(item: Omit<ParaItem, "kind">) {
    const start = this.start ?? (this.pendingBreak ? "break" : null);
    this.start = null;
    this.pendingBreak = false;
    this.items.push({ kind: "p", ...item, start: item.start ?? start });
  }

  private raw(xml: string) {
    // A list or a contents index cannot carry a page break itself: an empty
    // paragraph in front of it does, so the break is never lost.
    if (this.start !== null || this.pendingBreak)
      this.para({ style: "Standard", content: "" });
    this.items.push({ kind: "raw", xml });
  }

  span(inline: Inline): string {
    const key = `${inline.bold ? "b" : ""}${inline.italic ? "i" : ""}${inline.mono ? "m" : ""}${inline.strike ? "s" : ""}`;
    let text = odfText(inline.text);
    if (key) {
      let name = this.textStyles.get(key);
      if (!name) {
        name = `T${this.textStyles.size + 1}`;
        this.textStyles.set(key, name);
        const mono = FONTS[MONO_FONT].pdf;
        this.automatic.push(
          `<style:style style:name="${name}" style:family="text"><style:text-properties${inline.bold ? ` fo:font-weight="bold"` : ""}${inline.italic ? ` fo:font-style="italic"` : ""}${inline.mono ? ` style:font-name="${mono}"` : ""}${inline.strike ? ` style:text-line-through-style="solid"` : ""}/></style:style>`,
        );
      }
      text = `<text:span text:style-name="${name}">${text}</text:span>`;
    }
    if (inline.href)
      text = `<text:a xlink:type="simple" xlink:href="${escapeXml(inline.href)}">${text}</text:a>`;
    return text;
  }

  spans(inlines: readonly Inline[]): string {
    return inlines.map((inline) => this.span(inline)).join("");
  }

  /** The automatic style a paragraph needs, made once per distinct need. */
  paragraphStyle(item: ParaItem): string {
    const align = item.align && item.align !== "left" ? item.align : undefined;
    if (!align && item.marginTop === undefined && !item.start)
      return item.style;
    const key = `${item.style}|${align ?? ""}|${item.marginTop ?? ""}|${item.start ?? ""}`;
    let name = this.paraStyles.get(key);
    if (name) return name;
    name = `P${this.paraStyles.size + 1}`;
    this.paraStyles.set(key, name);
    const master =
      item.start === "front"
        ? ` style:master-page-name="Front"`
        : item.start === "body"
          ? ` style:master-page-name="Body"`
          : item.start === "bodyFirst"
            ? ` style:master-page-name="BodyFirst"`
            : "";
    const props = [
      align
        ? `fo:text-align="${align === "justify" ? "justify" : align === "center" ? "center" : "end"}"`
        : "",
      item.marginTop !== undefined
        ? `fo:margin-top="${pt(item.marginTop)}"`
        : "",
      item.start === "break" ? `fo:break-before="page"` : "",
      item.start === "body" || item.start === "bodyFirst"
        ? `style:page-number="1"`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    this.automatic.push(
      `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${item.style}"${master}><style:paragraph-properties ${props}/></style:style>`,
    );
    return name;
  }

  chapter(chapter: Chapter) {
    if (chapter.opening)
      this.opening(chapter.opening, chapter.kind === "title");
    if (chapter.title !== null)
      this.para({
        heading: chapter.level,
        style: `Heading_20_${chapter.level}`,
        marginTop: chapter.opening ? undefined : chapterDrop(this.geometry),
        content: odfText(chapter.title),
      });
    if (chapter.kind === "toc") this.toc();
    for (const block of chapter.blocks) this.block(block, null);
  }

  private opening(opening: Opening, titlePage: boolean) {
    const [first, ...rest] = opening.contact;
    this.para({
      style: "Contact",
      content: odfText(`${first ?? ""}\t${opening.wordCount}`),
    });
    for (const line of rest)
      this.para({ style: "Contact", content: odfText(line) });
    this.para({
      style: "Title",
      marginTop: titleDrop(this.geometry, opening.contact.length, titlePage),
      content: odfText(opening.title),
    });
    if (opening.byline)
      this.para({ style: "Byline", content: odfText(opening.byline) });
  }

  private toc() {
    const entries = tocEntries(this.doc);
    const template = (level: number) =>
      `<text:table-of-content-entry-template text:outline-level="${level}" text:style-name="Contents_20_${level}"><text:index-entry-text/><text:index-entry-tab-stop style:type="right" style:leader-char="."/><text:index-entry-page-number/></text:table-of-content-entry-template>`;
    this.raw(
      `<text:table-of-content text:name="Contents"><text:table-of-content-source text:outline-level="2" text:use-index-marks="false">${template(1)}${template(2)}</text:table-of-content-source><text:index-body>${entries
        .map(
          (entry) =>
            `<text:p text:style-name="Contents_20_${entry.level}">${odfText(entry.title)}</text:p>`,
        )
        .join("")}</text:index-body></text:table-of-content>`,
    );
  }

  /**
   * One block inside a list item. A list item in ODF holds paragraphs and
   * lists only, so every other kind is said in those: a quote's paragraphs
   * are the item's own, and a heading keeps its marks as a paragraph. No kind
   * falls to an empty paragraph, so a quote inside a list (`- > words`)
   * reaches the ODT.
   */
  private listChildXml(child: Block): string {
    const p = (content: string) =>
      `<text:p text:style-name="List_20_Paragraph">${content}</text:p>`;
    switch (child.kind) {
      case "list":
        return this.listXml(child);
      case "paragraph":
      case "heading":
        return p(this.spans(child.inlines));
      case "quote":
        return child.blocks.map((inner) => this.listChildXml(inner)).join("");
      case "code":
        return p(odfText(child.text));
      case "sceneBreak":
        return p(odfText(this.geometry.layout.sceneGlyph));
      case "facts":
        return child.rows
          .map(([label, value]) => p(odfText(`${label}: ${value}`)))
          .join("");
      case "pageBreak":
        return "";
    }
  }

  private listXml(block: Extract<Block, { kind: "list" }>): string {
    const items = block.items
      .map((item, index) => {
        const inner = item.map((child) => this.listChildXml(child)).join("");
        const start =
          block.ordered && index === 0 && block.start !== 1
            ? ` text:start-value="${block.start}"`
            : "";
        return `<text:list-item${start}>${inner || `<text:p text:style-name="List_20_Paragraph"/>`}</text:list-item>`;
      })
      .join("");
    return `<text:list text:style-name="${block.ordered ? "L_number" : "L_bullet"}">${items}</text:list>`;
  }

  block(block: Block, quoteStyle: string | null) {
    const { layout } = this.geometry;
    switch (block.kind) {
      case "heading":
        this.para({
          heading: block.level,
          style: `Heading_20_${block.level}`,
          align: alignFor(block.align, layout),
          content: this.spans(block.inlines),
        });
        return;
      case "paragraph": {
        const blank = block.blank === true;
        this.para({
          style: quoteStyle ?? (block.opener ? "Body_20_First" : "Standard"),
          align: blank ? undefined : alignFor(block.align, layout),
          content: blank ? "" : this.spans(block.inlines),
        });
        return;
      }
      case "list":
        this.raw(this.listXml(block));
        return;
      case "quote":
        for (const inner of block.blocks) this.block(inner, "Quotations");
        return;
      case "code":
        this.para({
          style: "Preformatted_20_Text",
          content: odfText(block.text),
        });
        return;
      case "sceneBreak":
        this.para({
          style: "Scene_20_Break",
          content: odfText(layout.sceneGlyph),
        });
        return;
      case "pageBreak":
        this.pendingBreak = true;
        return;
      case "facts":
        for (const [label, value] of block.rows)
          this.para({
            style: "Fact",
            content: `${this.span({ text: label, bold: true })}<text:tab/>${odfText(value)}`,
          });
        return;
    }
  }

  xml(): string {
    return this.items
      .map((item) => {
        if (item.kind === "raw") return item.xml;
        const style = this.paragraphStyle(item);
        return item.heading !== undefined
          ? `<text:h text:style-name="${style}" text:outline-level="${item.heading}">${item.content}</text:h>`
          : `<text:p text:style-name="${style}">${item.content}</text:p>`;
      })
      .join("\n");
  }
}

function stylesXml(doc: ExportDocument, plan: PagedPlan): string {
  const { layout, page, margins } = plan.geometry;
  const font = FONTS[layout.font].office;
  // The mono face is declared under its PDF family name, not its office one.
  // The classic manuscript's body face is also "Courier New", and ODF treats
  // two font-face declarations under one style:name as one face, so the body
  // and the code would share whatever the second one said.
  const mono = FONTS[MONO_FONT];
  const size = pt(layout.size);
  const lineHeight = `${Math.round(layout.lineHeight * 100)}%`;
  const headingSize = (level: number) =>
    pt(layout.size * headingStyle(layout, level).scale);
  const paragraph = (
    name: string,
    display: string,
    pProps: string,
    tProps = "",
    extra = "",
    tabStop?: { position: number; type: "left" | "right" },
  ) =>
    `<style:style style:name="${name}" style:display-name="${display}" style:family="paragraph" style:parent-style-name="Standard"${extra}><style:paragraph-properties ${pProps}>${tabStop ? `<style:tab-stops><style:tab-stop style:position="${pt(tabStop.position)}" style:type="${tabStop.type}"/></style:tab-stops>` : ""}</style:paragraph-properties>${tProps ? `<style:text-properties ${tProps}/>` : ""}</style:style>`;
  const headings = [1, 2, 3, 4, 5, 6]
    .map((level) =>
      paragraph(
        `Heading_20_${level}`,
        `Heading ${level}`,
        `fo:text-indent="0pt" fo:margin-top="${level <= 2 ? "0pt" : pt(layout.size)}" fo:margin-bottom="${pt(level <= 2 ? layout.size * layout.lineHeight : layout.size / 2)}" fo:keep-with-next="always"${headingStyle(layout, level).centred ? ` fo:text-align="center"` : ""}`,
        `fo:font-size="${headingSize(level)}"${headingStyle(layout, level).italic ? ` fo:font-style="italic"` : ""}`,
        ` style:default-outline-level="${level}" style:class="text" style:next-style-name="Body_20_First"`,
      ),
    )
    .join("");
  const listLevels = (ordered: boolean) =>
    Array.from({ length: 10 }, (_, index) => {
      const props = `<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${pt(36 * (index + 1))}" fo:text-indent="-18pt" fo:margin-left="${pt(36 * (index + 1))}"/></style:list-level-properties>`;
      return ordered
        ? `<text:list-level-style-number text:level="${index + 1}" style:num-suffix="." style:num-format="1">${props}</text:list-level-style-number>`
        : `<text:list-level-style-bullet text:level="${index + 1}" text:bullet-char="${index % 2 === 0 ? "•" : "◦"}">${props}</text:list-level-style-bullet>`;
    }).join("");

  const hasHeader = plan.runningHead !== null;
  const hasFooter = layout.footer !== "none";
  // ODF's page margin is the paper's edge to the header; the header then
  // takes its own height out of the text block. Half the margin each keeps
  // the text where the layout says it starts.
  const pageLayout = (name: string, header: boolean, footer: boolean) =>
    `<style:page-layout style:name="${name}" style:page-usage="${margins.mirrored ? "mirrored" : "all"}"><style:page-layout-properties fo:page-width="${pt(page.width)}" fo:page-height="${pt(page.height)}" fo:margin-top="${pt(header ? margins.top / 2 : margins.top)}" fo:margin-bottom="${pt(footer ? margins.bottom / 2 : margins.bottom)}" fo:margin-left="${pt(margins.inner)}" fo:margin-right="${pt(margins.outer)}" style:print-orientation="portrait"/>${header ? `<style:header-style><style:header-footer-properties fo:min-height="0pt" fo:margin-bottom="${pt(Math.max(0, margins.top / 2 - layout.size * 1.2))}"/></style:header-style>` : ""}${footer ? `<style:footer-style><style:header-footer-properties fo:min-height="0pt" fo:margin-top="${pt(Math.max(0, margins.bottom / 2 - layout.size * 1.2))}"/></style:footer-style>` : ""}</style:page-layout>`;

  const pageNumber = `<text:page-number text:select-page="current">1</text:page-number>`;
  const header = hasHeader
    ? `<style:header><text:p text:style-name="Header">${odfText(plan.runningHead ?? "")}${pageNumber}</text:p></style:header>`
    : "";
  const emptyHeader = hasHeader
    ? `<style:header><text:p text:style-name="Header"/></style:header>`
    : "";
  const [before, middle, after] = draftFooterParts(doc);
  const footer = !hasFooter
    ? ""
    : layout.footer === "draft"
      ? `<style:footer><text:p text:style-name="Footer">${odfText(before)}${pageNumber}${odfText(middle)}<text:page-count>1</text:page-count>${odfText(after)}</text:p></style:footer>`
      : `<style:footer><text:p text:style-name="Footer">${pageNumber}</text:p></style:footer>`;

  return `${XML_DECLARATION}
<office:document-styles ${NS}>
<office:font-face-decls>
<style:font-face style:name="${escapeXml(font)}" svg:font-family="'${escapeXml(font)}'" style:font-family-generic="${layout.font === "courierPrime" ? "modern" : "roman"}" style:font-pitch="${layout.font === "courierPrime" ? "fixed" : "variable"}"/>
<style:font-face style:name="${mono.pdf}" svg:font-family="'${escapeXml(mono.office)}'" style:font-family-generic="modern" style:font-pitch="fixed"/>
</office:font-face-decls>
<office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties fo:line-height="${lineHeight}" fo:orphans="2" fo:widows="2"/><style:text-properties style:font-name="${escapeXml(font)}" fo:font-size="${size}" fo:language="${escapeXml(doc.meta.language)}" fo:country="none"/></style:default-style>
<style:style style:name="Standard" style:family="paragraph" style:class="text"><style:paragraph-properties fo:text-indent="${pt(layout.indent)}" fo:margin-top="0pt" fo:margin-bottom="0pt"/></style:style>
${paragraph("Body_20_First", "Body First", `fo:text-indent="${pt(layout.indentOpeners ? layout.indent : 0)}"`, "", ` style:next-style-name="Standard"`)}
${headings}
${paragraph("Title", "Title", `fo:text-indent="0pt" fo:text-align="center"`, titleScale(layout) === 1 ? "" : `fo:font-size="${pt(layout.size * titleScale(layout))}"`)}
${paragraph("Byline", "Byline", `fo:text-indent="0pt" fo:text-align="center" fo:margin-bottom="${pt(layout.size * layout.lineHeight * 2)}"`)}
${paragraph("Contact", "Contact", `fo:text-indent="0pt" fo:line-height="115%"`, "", "", { position: plan.geometry.width, type: "right" })}
${paragraph("Scene_20_Break", "Scene Break", `fo:text-indent="0pt" fo:text-align="center" fo:margin-top="${pt(layout.size / 2)}" fo:margin-bottom="${pt(layout.size / 2)}"`, "", ` style:next-style-name="Body_20_First"`)}
${paragraph("Quotations", "Quotations", `fo:text-indent="0pt" fo:margin-left="36pt" fo:margin-right="36pt"`)}
${paragraph("Preformatted_20_Text", "Preformatted Text", `fo:text-indent="0pt" fo:line-height="115%"`, `style:font-name="${mono.pdf}" fo:font-size="${pt(layout.size - 1)}"`)}
${paragraph("List_20_Paragraph", "List Paragraph", `fo:text-indent="0pt"`)}
${paragraph("Fact", "Fact", `fo:text-indent="-158.4pt" fo:margin-left="158.4pt" fo:line-height="115%"`)}
${paragraph("Contents_20_1", "Contents 1", `fo:text-indent="0pt"`)}
${paragraph("Contents_20_2", "Contents 2", `fo:text-indent="0pt" fo:margin-left="22pt"`)}
${paragraph("Header", "Header", `fo:text-indent="0pt" fo:text-align="end" fo:line-height="100%" text:number-lines="false"`)}
${paragraph("Footer", "Footer", `fo:text-indent="0pt" fo:text-align="center" fo:line-height="100%" text:number-lines="false"`)}
<text:list-style style:name="L_bullet">${listLevels(false)}</text:list-style>
<text:list-style style:name="L_number">${listLevels(true)}</text:list-style>
<text:linenumbering-configuration text:number-lines="${layout.lineNumbers}" text:offset="14pt" style:num-format="1" text:number-position="left" text:increment="1" text:restart-on-page="true"/>
</office:styles>
<office:automatic-styles>
${pageLayout("PMFront", false, false)}
${pageLayout("PMBody", hasHeader, hasFooter)}
</office:automatic-styles>
<office:master-styles>
<style:master-page style:name="Standard" style:page-layout-name="PMFront"/>
<style:master-page style:name="Front" style:page-layout-name="PMFront"/>
<style:master-page style:name="Body" style:page-layout-name="PMBody">${header}${footer}</style:master-page>
<style:master-page style:name="BodyFirst" style:page-layout-name="PMBody" style:next-style-name="Body">${emptyHeader}${footer}</style:master-page>
</office:master-styles>
</office:document-styles>
`;
}

function odtEntries(doc: ExportDocument) {
  const plan = pagedPlan(doc);
  const builder = new OdtBuilder(doc, plan.geometry);
  plan.front.forEach((chapter, index) => {
    builder.beginChapter(index === 0 ? "front" : "break");
    builder.chapter(chapter);
  });
  plan.body.forEach((chapter, index) => {
    builder.beginChapter(
      index === 0 ? (plan.bareFirstPage ? "bodyFirst" : "body") : "break",
    );
    builder.chapter(chapter);
  });
  const body = builder.xml();

  const content = `${XML_DECLARATION}
<office:document-content ${NS}>
<office:automatic-styles>
${builder.automatic.join("\n")}
</office:automatic-styles>
<office:body><office:text>
${body}
</office:text></office:body>
</office:document-content>
`;
  const date = new Date(doc.meta.exportedAt)
    .toISOString()
    .replace(/\.\d{3}Z$/, "");
  const meta = `${XML_DECLARATION}
<office:document-meta ${NS}><office:meta>
<meta:generator>${escapeXml(PRODUCT.name)}</meta:generator>
<dc:title>${escapeXml(doc.meta.title)}</dc:title>
${doc.meta.subject ? `<dc:subject>${escapeXml(doc.meta.subject)}</dc:subject>\n` : ""}${doc.meta.author ? `<meta:initial-creator>${escapeXml(doc.meta.author)}</meta:initial-creator>\n<dc:creator>${escapeXml(doc.meta.author)}</dc:creator>\n` : ""}<dc:language>${escapeXml(doc.meta.language)}</dc:language>
<meta:creation-date>${date}</meta:creation-date>
<dc:date>${date}</dc:date>
</office:meta></office:document-meta>
`;
  const manifest = `${XML_DECLARATION}
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>
`;
  return [
    { path: "content.xml", data: content },
    { path: "styles.xml", data: stylesXml(doc, plan) },
    { path: "meta.xml", data: meta },
    { path: "META-INF/manifest.xml", data: manifest },
  ];
}

export const odtWriter: FormatWriter = {
  format: "odt",
  write: async (doc) =>
    zipPackage(odtEntries(doc), "application/vnd.oasis.opendocument.text"),
};
