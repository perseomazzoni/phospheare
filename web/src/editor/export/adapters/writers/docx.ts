// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Writes DOCX (Office Open XML) for the two people who open it after the
// writer: an editor who restyles it, and a book formatter who imports it.
// Both read styles, not direct formatting, so every paragraph carries a named
// style (Normal, Body First, Heading 1–6, Scene Break, Quote, Code, Title) and
// the layout's numbers live in those styles, once.
//
// The one piece of direct formatting that is the writer's choice is a
// paragraph's alignment. The rest (a chapter heading's drop, the contact
// block's tab, a list item's indent) is page geometry the layout row
// dictates, which no style can hold because it depends on where on the page
// the paragraph falls.
//
// Page structure:
//
//   - each chapter ends with a page break run in its last paragraph, because
//     a break in a paragraph of its own leaves an empty line at the top of
//     the next page;
//   - the pages before the text are their own section, with no header, and
//     the text's section restarts numbering at 1; the section boundary is
//     the page break there, so no break run is added on top of it;
//   - a story's first text page has no running head (`titlePg`).
//
// Word processors reject a file whose children of `pPr`, `rPr`, `sectPr` and
// `settings` are out of schema order, so the builders emit them in that order.

import {
  FONTS,
  MONO_FONT,
  alignFor,
  chapterDrop,
  headingStyle,
  titleDrop,
  titleScale,
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
import {
  draftFooterParts,
  halfPoints,
  pagedPlan,
  twips,
  type PagedPlan,
} from "./paged";
import { escapeXml, isoSeconds, XML_DECLARATION } from "./xml";
import { zipPackage } from "./zip";
import { PRODUCT } from "../../../../product";

const W = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;

type Jc = "left" | "center" | "right" | "both";
const JC: Record<"left" | "center" | "right" | "justify", Jc> = {
  left: "left",
  center: "center",
  right: "right",
  justify: "both",
};

interface PPr {
  style: string;
  keepNext?: boolean;
  numPr?: { ilvl: number; numId: number };
  tabs?: { val: "left" | "right"; pos: number }[];
  spacingBefore?: number;
  spacingAfter?: number;
  indLeft?: number;
  jc?: Jc;
  sectPr?: string;
}

interface Para {
  pPr: PPr;
  runs: string[];
}

function pPrXml(p: PPr): string {
  // Schema order: pStyle, keepNext, numPr, tabs, spacing, ind, jc, sectPr.
  let xml = `<w:pStyle w:val="${p.style}"/>`;
  if (p.keepNext) xml += `<w:keepNext/>`;
  if (p.numPr)
    xml += `<w:numPr><w:ilvl w:val="${p.numPr.ilvl}"/><w:numId w:val="${p.numPr.numId}"/></w:numPr>`;
  if (p.tabs)
    xml += `<w:tabs>${p.tabs.map((tab) => `<w:tab w:val="${tab.val}" w:pos="${tab.pos}"/>`).join("")}</w:tabs>`;
  if (p.spacingBefore !== undefined || p.spacingAfter !== undefined)
    xml += `<w:spacing${p.spacingBefore !== undefined ? ` w:before="${p.spacingBefore}"` : ""}${p.spacingAfter !== undefined ? ` w:after="${p.spacingAfter}"` : ""}/>`;
  if (p.indLeft !== undefined) xml += `<w:ind w:left="${p.indLeft}"/>`;
  if (p.jc) xml += `<w:jc w:val="${p.jc}"/>`;
  if (p.sectPr) xml += p.sectPr;
  return `<w:pPr>${xml}</w:pPr>`;
}

const paraXml = (p: Para) => `<w:p>${pPrXml(p.pPr)}${p.runs.join("")}</w:p>`;

/** `text` as runs' content: line breaks and tabs are elements, not text. */
function textXml(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .split("\t")
        .map((piece) =>
          piece ? `<w:t xml:space="preserve">${escapeXml(piece)}</w:t>` : "",
        )
        .join("<w:tab/>"),
    )
    .join("<w:br/>");
}

const PAGE_BREAK_RUN = `<w:r><w:br w:type="page"/></w:r>`;

const field = (instr: string, shown: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${shown}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;

class DocxBuilder {
  readonly paras: Para[] = [];
  readonly links: string[] = [];
  /** A numbering instance per list, so each counts from its own start. */
  readonly nums: { abstract: 0 | 1; start: number }[] = [];
  private pendingBreak = false;

  constructor(
    private readonly doc: ExportDocument,
    private readonly plan: PagedPlan,
  ) {}

  private push(para: Para) {
    if (this.pendingBreak) this.breakAfterLast();
    this.paras.push(para);
  }

  /** A page break at the end of the last paragraph written. */
  breakAfterLast() {
    this.pendingBreak = false;
    const last = this.paras[this.paras.length - 1];
    if (last) last.runs.push(PAGE_BREAK_RUN);
  }

  /** Ends the front section: its properties go on the last paragraph. */
  endFrontSection(sectPr: string) {
    const last = this.paras[this.paras.length - 1];
    if (last) last.pPr.sectPr = sectPr;
  }

  run(inline: Inline): string {
    let rPr = "";
    if (inline.href) rPr += `<w:rStyle w:val="Hyperlink"/>`;
    if (inline.mono) {
      const mono = FONTS[MONO_FONT].office;
      rPr += `<w:rFonts w:ascii="${mono}" w:hAnsi="${mono}" w:cs="${mono}"/>`;
    }
    if (inline.bold) rPr += `<w:b/>`;
    if (inline.italic) rPr += `<w:i/>`;
    if (inline.strike) rPr += `<w:strike/>`;
    const run = `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}${textXml(inline.text)}</w:r>`;
    if (!inline.href) return run;
    this.links.push(inline.href);
    return `<w:hyperlink r:id="rIdLink${this.links.length}">${run}</w:hyperlink>`;
  }

  runs(inlines: readonly Inline[]): string[] {
    return inlines.map((inline) => this.run(inline));
  }

  chapter(chapter: Chapter) {
    const { geometry } = this.plan;
    if (chapter.opening)
      this.opening(chapter.opening, chapter.kind === "title");
    if (chapter.title !== null)
      this.push({
        pPr: {
          style: `Heading${chapter.level}`,
          keepNext: true,
          // The heading drops down its page, unless the manuscript's title
          // furniture already stands above it on this page.
          spacingBefore: chapter.opening
            ? undefined
            : twips(chapterDrop(geometry)),
        },
        runs: [`<w:r>${textXml(chapter.title)}</w:r>`],
      });
    if (chapter.kind === "toc") this.toc();
    for (const block of chapter.blocks) this.block(block, 0, null);
  }

  private opening(opening: Opening, titlePage: boolean) {
    const { geometry } = this.plan;
    const [first, ...rest] = opening.contact;
    // Standard manuscript format: the contact block top-left, the word count
    // top-right on the same first line.
    this.push({
      pPr: {
        style: "Contact",
        tabs: [{ val: "right", pos: twips(geometry.width) }],
      },
      runs: [`<w:r>${textXml(`${first ?? ""}\t${opening.wordCount}`)}</w:r>`],
    });
    for (const line of rest)
      this.push({
        pPr: { style: "Contact" },
        runs: [`<w:r>${textXml(line)}</w:r>`],
      });
    this.push({
      pPr: {
        style: "Title",
        spacingBefore: twips(
          titleDrop(geometry, opening.contact.length, titlePage),
        ),
      },
      runs: [`<w:r>${textXml(opening.title)}</w:r>`],
    });
    if (opening.byline)
      this.push({
        pPr: { style: "Byline" },
        runs: [`<w:r>${textXml(opening.byline)}</w:r>`],
      });
  }

  private toc() {
    const entries = tocEntries(this.doc);
    // A TOC field that a word processor rebuilds, page numbers included, when
    // the file opens (`updateFields`). The entries written inside it are what
    // any other reader shows, so the field is never empty.
    const begin = `<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
    const end = `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    if (entries.length === 0) {
      this.push({ pPr: { style: "TOC1" }, runs: [begin, end] });
      return;
    }
    entries.forEach((entry, index) => {
      const runs = [`<w:r>${textXml(entry.title)}</w:r>`];
      if (index === 0) runs.unshift(begin);
      if (index === entries.length - 1) runs.push(end);
      this.push({ pPr: { style: `TOC${entry.level}` }, runs });
    });
  }

  block(block: Block, depth: number, quoteStyle: string | null) {
    const layout = this.plan.geometry.layout;
    switch (block.kind) {
      case "heading":
        this.push({
          pPr: {
            style: `Heading${block.level}`,
            keepNext: true,
            jc:
              block.align === "left"
                ? undefined
                : JC[alignFor(block.align, layout)],
          },
          runs: this.runs(block.inlines),
        });
        return;
      case "paragraph": {
        const align = alignFor(block.align, layout);
        const blank = block.blank === true;
        this.push({
          pPr: {
            style: quoteStyle ?? (block.opener ? "BodyFirst" : "Normal"),
            jc: align === "left" || blank ? undefined : JC[align],
          },
          runs: blank ? [] : this.runs(block.inlines),
        });
        return;
      }
      case "list": {
        this.nums.push({ abstract: block.ordered ? 1 : 0, start: block.start });
        const numId = this.nums.length;
        for (const item of block.items) {
          item.forEach((inner, index) => {
            if (index === 0 && inner.kind === "paragraph")
              this.push({
                pPr: {
                  style: "ListParagraph",
                  numPr: { ilvl: Math.min(depth, 8), numId },
                },
                runs: this.runs(inner.inlines),
              });
            else if (inner.kind === "paragraph")
              this.push({
                pPr: { style: "ListParagraph", indLeft: 720 * (depth + 1) },
                runs: this.runs(inner.inlines),
              });
            else
              this.block(
                inner,
                inner.kind === "list" ? depth + 1 : depth,
                quoteStyle,
              );
          });
        }
        return;
      }
      case "quote":
        for (const inner of block.blocks) this.block(inner, depth, "Quote");
        return;
      case "code":
        this.push({
          pPr: { style: "Code" },
          runs: [`<w:r>${textXml(block.text)}</w:r>`],
        });
        return;
      case "sceneBreak":
        this.push({
          pPr: { style: "SceneBreak" },
          runs: [`<w:r>${textXml(layout.sceneGlyph)}</w:r>`],
        });
        return;
      case "pageBreak":
        this.pendingBreak = true;
        return;
      case "facts":
        for (const [label, value] of block.rows)
          this.push({
            pPr: { style: "Fact" },
            runs: [
              `<w:r><w:rPr><w:b/></w:rPr>${textXml(label)}</w:r>`,
              `<w:r>${textXml(`\t${value}`)}</w:r>`,
            ],
          });
        return;
    }
  }
}

function sectPrXml(
  plan: PagedPlan,
  refs: { header?: boolean; firstHeader?: boolean; footer?: boolean },
  body: boolean,
): string {
  const { geometry } = plan;
  const { page, margins, layout } = geometry;
  let xml = "";
  if (refs.header)
    xml += `<w:headerReference w:type="default" r:id="rIdHeader"/>`;
  if (refs.firstHeader)
    xml += `<w:headerReference w:type="first" r:id="rIdHeaderFirst"/>`;
  if (refs.footer)
    xml += `<w:footerReference w:type="default" r:id="rIdFooter"/>`;
  xml += `<w:type w:val="nextPage"/>`;
  xml += `<w:pgSz w:w="${twips(page.width)}" w:h="${twips(page.height)}"/>`;
  xml += `<w:pgMar w:top="${twips(margins.top)}" w:right="${twips(margins.outer)}" w:bottom="${twips(margins.bottom)}" w:left="${twips(margins.inner)}" w:header="${twips(margins.top / 2)}" w:footer="${twips(margins.bottom / 2)}" w:gutter="0"/>`;
  if (body && layout.lineNumbers)
    xml += `<w:lnNumType w:countBy="1" w:restart="newPage"/>`;
  if (body) xml += `<w:pgNumType w:start="1"/>`;
  if (refs.firstHeader) xml += `<w:titlePg/>`;
  return `<w:sectPr>${xml}</w:sectPr>`;
}

function stylesXml(doc: ExportDocument, plan: PagedPlan): string {
  const { layout } = plan.geometry;
  const font = FONTS[layout.font].office;
  const mono = FONTS[MONO_FONT].office;
  const line = Math.round(240 * layout.lineHeight);
  const size = halfPoints(layout.size);
  const indent = twips(layout.indent);
  const headingSize = (level: number) =>
    halfPoints(layout.size * headingStyle(layout, level).scale);
  const style = (id: string, name: string, pPr: string, rPr = "", extra = "") =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>${extra}<w:qFormat/><w:pPr>${pPr}</w:pPr>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}</w:style>`;
  const headings = [1, 2, 3, 4, 5, 6]
    .map((level) =>
      style(
        `Heading${level}`,
        `heading ${level}`,
        `<w:keepNext/><w:spacing w:before="${level <= 2 ? 0 : line / 2}" w:after="${level <= 2 ? line : line / 2}"/><w:ind w:firstLine="0"/>${headingStyle(layout, level).centred ? `<w:jc w:val="center"/>` : ""}<w:outlineLvl w:val="${level - 1}"/>`,
        `${headingStyle(layout, level).italic ? "<w:i/>" : ""}<w:sz w:val="${headingSize(level)}"/><w:szCs w:val="${headingSize(level)}"/>`,
        `<w:next w:val="BodyFirst"/>`,
      ),
    )
    .join("");
  return `${XML_DECLARATION}
<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="${escapeXml(doc.meta.language)}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl/><w:ind w:firstLine="${indent}"/></w:pPr></w:style>
${style("BodyFirst", "Body First", `<w:ind w:firstLine="${layout.indentOpeners ? indent : 0}"/>`, "", `<w:next w:val="Normal"/>`)}
${headings}
${style("Title", "Title", `<w:spacing w:after="0"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>`, titleScale(layout) === 1 ? "" : `<w:sz w:val="${halfPoints(layout.size * titleScale(layout))}"/>`)}
${style("Byline", "Byline", `<w:spacing w:after="${line * 2}"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>`)}
${style("Contact", "Contact", `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/>`)}
${style("SceneBreak", "Scene Break", `<w:spacing w:before="${line / 2}" w:after="${line / 2}"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>`, "", `<w:next w:val="BodyFirst"/>`)}
${style("Quote", "Quote", `<w:ind w:left="720" w:right="720" w:firstLine="0"/>`)}
${style("Code", "Code", `<w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/>`, `<w:rFonts w:ascii="${mono}" w:hAnsi="${mono}" w:cs="${mono}"/><w:sz w:val="${size - 2}"/>`)}
${style("ListParagraph", "List Paragraph", `<w:ind w:firstLine="0"/>`)}
${style("Fact", "Fact", `<w:tabs><w:tab w:val="left" w:pos="3168"/></w:tabs><w:spacing w:line="276" w:lineRule="auto"/><w:ind w:left="3168" w:hanging="3168"/>`)}
${style("TOC1", "toc 1", `<w:ind w:firstLine="0"/>`)}
${style("TOC2", "toc 2", `<w:ind w:left="440" w:firstLine="0"/>`)}
${style("Header", "header", `<w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/>`)}
${style("Footer", "footer", `<w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>`)}
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>
`;
}

function numberingXml(nums: { abstract: 0 | 1; start: number }[]): string {
  const levels = (ordered: boolean) =>
    Array.from({ length: 9 }, (_, ilvl) =>
      ordered
        ? `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${ilvl + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (ilvl + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
        : `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${ilvl % 2 === 0 ? "•" : "◦"}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (ilvl + 1)}" w:hanging="360"/></w:pPr></w:lvl>`,
    ).join("");
  return `${XML_DECLARATION}
<w:numbering ${W}>
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels(false)}</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true)}</w:abstractNum>
${nums
  .map(
    (num, index) =>
      `<w:num w:numId="${index + 1}"><w:abstractNumId w:val="${num.abstract}"/>${num.abstract === 1 ? `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${num.start}"/></w:lvlOverride>` : ""}</w:num>`,
  )
  .join("\n")}
</w:numbering>
`;
}

const hdrFtr = (tag: "hdr" | "ftr", body: string) =>
  `${XML_DECLARATION}\n<w:${tag} ${W}>${body}</w:${tag}>\n`;

function docxEntries(doc: ExportDocument) {
  const plan = pagedPlan(doc);
  const { layout } = plan.geometry;
  const builder = new DocxBuilder(doc, plan);

  const header = plan.runningHead !== null;
  const footer = layout.footer !== "none";
  const bodyRefs = {
    header,
    firstHeader: header && plan.bareFirstPage,
    footer,
  };

  plan.front.forEach((chapter, index) => {
    builder.chapter(chapter);
    const lastFront = index === plan.front.length - 1;
    if (lastFront && plan.body.length > 0)
      builder.endFrontSection(sectPrXml(plan, {}, false));
    else if (!lastFront) builder.breakAfterLast();
  });
  plan.body.forEach((chapter, index) => {
    builder.chapter(chapter);
    if (index < plan.body.length - 1) builder.breakAfterLast();
  });

  const finalSect =
    plan.body.length > 0
      ? sectPrXml(plan, bodyRefs, true)
      : sectPrXml(plan, {}, false);
  const documentXml = `${XML_DECLARATION}
<w:document ${W}><w:body>
${builder.paras.map(paraXml).join("\n")}
${finalSect}
</w:body></w:document>
`;

  const pageField = field("PAGE", "1");
  const headerXml = hdrFtr(
    "hdr",
    `<w:p><w:pPr><w:pStyle w:val="Header"/><w:jc w:val="right"/></w:pPr>${plan.runningHead ? `<w:r>${textXml(plan.runningHead)}</w:r>` : ""}${pageField}</w:p>`,
  );
  const firstHeaderXml = hdrFtr(
    "hdr",
    `<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr></w:p>`,
  );
  const [before, middle, after] = draftFooterParts(doc);
  const footerXml = hdrFtr(
    "ftr",
    layout.footer === "draft"
      ? `<w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r>${textXml(before)}</w:r>${pageField}<w:r>${textXml(middle)}</w:r>${field("NUMPAGES", "1")}${after ? `<w:r>${textXml(after)}</w:r>` : ""}</w:p>`
      : `<w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>${pageField}</w:p>`,
  );

  const hasToc = doc.chapters.some((chapter) => chapter.kind === "toc");
  const settingsXml = `${XML_DECLARATION}
<w:settings ${W}><w:zoom w:percent="100"/>${plan.geometry.margins.mirrored ? "<w:mirrorMargins/>" : ""}<w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>${hasToc ? `<w:updateFields w:val="true"/>` : ""}<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>
`;

  const rel = (id: string, type: string, target: string, external = false) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${escapeXml(target)}"${external ? ` TargetMode="External"` : ""}/>`;
  const documentRels = `${XML_DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rel("rIdStyles", "styles", "styles.xml")}
${rel("rIdSettings", "settings", "settings.xml")}
${rel("rIdNumbering", "numbering", "numbering.xml")}
${rel("rIdHeader", "header", "header1.xml")}
${rel("rIdHeaderFirst", "header", "header2.xml")}
${rel("rIdFooter", "footer", "footer1.xml")}
${builder.links.map((href, index) => rel(`rIdLink${index + 1}`, "hyperlink", href, true)).join("\n")}
</Relationships>
`;

  const created = isoSeconds(doc.meta.exportedAt);
  const core = `${XML_DECLARATION}
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapeXml(doc.meta.title)}</dc:title>
${doc.meta.subject ? `<dc:subject>${escapeXml(doc.meta.subject)}</dc:subject>\n` : ""}${doc.meta.author ? `<dc:creator>${escapeXml(doc.meta.author)}</dc:creator>\n` : ""}<dc:language>${escapeXml(doc.meta.language)}</dc:language>
<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>
</cp:coreProperties>
`;
  const app = `${XML_DECLARATION}
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${escapeXml(PRODUCT.name)}</Application></Properties>
`;
  const contentTypes = `${XML_DECLARATION}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
`;
  const rootRels = `${XML_DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
`;

  return [
    { path: "[Content_Types].xml", data: contentTypes },
    { path: "_rels/.rels", data: rootRels },
    { path: "docProps/core.xml", data: core },
    { path: "docProps/app.xml", data: app },
    { path: "word/document.xml", data: documentXml },
    { path: "word/styles.xml", data: stylesXml(doc, plan) },
    { path: "word/settings.xml", data: settingsXml },
    { path: "word/numbering.xml", data: numberingXml(builder.nums) },
    { path: "word/header1.xml", data: headerXml },
    { path: "word/header2.xml", data: firstHeaderXml },
    { path: "word/footer1.xml", data: footerXml },
    { path: "word/_rels/document.xml.rels", data: documentRels },
  ];
}

export const docxWriter: FormatWriter = {
  format: "docx",
  write: async (doc) => zipPackage(docxEntries(doc)),
};
