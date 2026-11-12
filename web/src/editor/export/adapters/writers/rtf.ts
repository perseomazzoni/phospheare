// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Writes RTF, for the agent who asks for it and for the drafting apps whose
// compile format it is. It is hand-written RTF 1.9 with a stylesheet, so a
// word processor sees named styles rather than direct formatting on every
// paragraph, as with DOCX and ODT.
//
// RTF is 7-bit: anything outside ASCII is written as `\uN?`, a signed 16-bit
// code unit where `?` is what a reader without Unicode shows instead, and
// `\`, `{` and `}` are escaped. That is the format's whole injection surface,
// and `rtfText` is its one entry point.

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
  type Align,
  type Block,
  type Chapter,
  type ExportDocument,
  type Inline,
  type Opening,
} from "../../domain/model";
import type { FormatWriter } from "../../ports";
import { draftFooterParts, halfPoints, pagedPlan, twips } from "./paged";
import { stripInvalidXml, utf8 } from "./xml";

/** Text as RTF: escaped, non-ASCII as `\uN?`, breaks and tabs as controls. */
export function rtfText(text: string): string {
  let out = "";
  for (const char of stripInvalidXml(text)) {
    if (char === "\\" || char === "{" || char === "}") out += `\\${char}`;
    else if (char === "\n") out += "\\line ";
    else if (char === "\t") out += "\\tab ";
    else {
      const code = char.codePointAt(0) ?? 0;
      if (code < 0x80) out += char;
      else
        // Characters above the BMP go as their two UTF-16 halves.
        for (let i = 0; i < char.length; i += 1) {
          const unit = char.charCodeAt(i);
          out += `\\u${unit > 32767 ? unit - 65536 : unit}?`;
        }
    }
  }
  return out;
}

const ALIGN = {
  left: "\\ql",
  center: "\\qc",
  right: "\\qr",
  justify: "\\qj",
} as const;

/** Style numbers, and the paragraph formatting each one stands for. */
interface Style {
  id: number;
  name: string;
  format: string;
}

function stylesFor(geometry: Geometry): Record<string, Style> {
  const { layout } = geometry;
  const size = halfPoints(layout.size);
  const line = `\\sl${Math.round(240 * layout.lineHeight)}\\slmult1`;
  const indent = twips(layout.indent);
  const headingSize = (level: number) =>
    halfPoints(layout.size * headingStyle(layout, level).scale);
  const styles: Record<string, Style> = {
    normal: {
      id: 0,
      name: "Normal",
      format: `\\ql\\fi${indent}${line}\\f0\\fs${size}`,
    },
    first: {
      id: 1,
      name: "Body First",
      format: `\\ql\\fi${layout.indentOpeners ? indent : 0}${line}\\f0\\fs${size}`,
    },
    title: {
      id: 8,
      name: "Title",
      format: `\\qc\\fi0${line}\\f0\\fs${halfPoints(layout.size * titleScale(layout))}`,
    },
    byline: {
      id: 9,
      name: "Byline",
      format: `\\qc\\fi0${line}\\sa${Math.round(480 * layout.lineHeight)}\\f0\\fs${size}`,
    },
    contact: {
      id: 10,
      name: "Contact",
      format: `\\ql\\fi0\\sl276\\slmult1\\tqr\\tx${twips(geometry.width)}\\f0\\fs${size}`,
    },
    scene: {
      id: 11,
      name: "Scene Break",
      format: `\\qc\\fi0${line}\\sb${size * 5}\\sa${size * 5}\\f0\\fs${size}`,
    },
    quote: {
      id: 12,
      name: "Quote",
      format: `\\ql\\fi0\\li720\\ri720${line}\\f0\\fs${size}`,
    },
    code: {
      id: 13,
      name: "Code",
      format: `\\ql\\fi0\\sl240\\slmult1\\f1\\fs${size - 2}`,
    },
    fact: {
      id: 14,
      name: "Fact",
      format: `\\ql\\fi-3168\\li3168\\tx3168\\sl276\\slmult1\\f0\\fs${size}`,
    },
    list: {
      id: 15,
      name: "List Paragraph",
      format: `\\ql\\fi-360\\li720\\tx720${line}\\f0\\fs${size}`,
    },
    toc1: { id: 16, name: "toc 1", format: `\\ql\\fi0${line}\\f0\\fs${size}` },
    toc2: {
      id: 17,
      name: "toc 2",
      format: `\\ql\\fi0\\li440${line}\\f0\\fs${size}`,
    },
  };
  for (const level of [1, 2, 3, 4, 5, 6])
    styles[`h${level}`] = {
      id: level + 1,
      name: `heading ${level}`,
      format: `${headingStyle(layout, level).centred ? "\\qc" : "\\ql"}\\fi0\\keepn${line}\\sa${level <= 2 ? Math.round(240 * layout.lineHeight) : 120}\\outlinelevel${level - 1}\\f0\\fs${headingSize(level)}${headingStyle(layout, level).italic ? "\\i" : ""}`,
    };
  return styles;
}

class RtfBuilder {
  readonly out: string[] = [];
  private pendingBreak = false;

  constructor(
    private readonly doc: ExportDocument,
    private readonly geometry: Geometry,
    private readonly styles: Record<string, Style>,
  ) {}

  private para(style: Style, content: string, extra = "") {
    const lead = this.pendingBreak ? "\\page " : "";
    this.pendingBreak = false;
    this.out.push(
      `${lead}\\pard\\plain\\s${style.id}${style.format}${extra} ${content}\\par`,
    );
  }

  /** A break before whatever comes next, chapter or paragraph. */
  pageBreak() {
    this.pendingBreak = true;
  }

  /** A section break: the text starts here, with its own page furniture. */
  section(sectd: string) {
    this.pendingBreak = false;
    this.out.push(`\\sect${sectd}`);
  }

  run(inline: Inline): string {
    let text = rtfText(inline.text);
    if (inline.mono) text = `{\\f1 ${text}}`;
    if (inline.strike) text = `{\\strike ${text}}`;
    if (inline.italic) text = `{\\i ${text}}`;
    if (inline.bold) text = `{\\b ${text}}`;
    if (inline.href)
      text = `{\\field{\\*\\fldinst HYPERLINK "${rtfText(inline.href).replace(/"/g, "")}"}{\\fldrslt{\\ul\\cf2 ${text}}}}`;
    return text;
  }

  runs(inlines: readonly Inline[]): string {
    return inlines.map((inline) => this.run(inline)).join("");
  }

  chapter(chapter: Chapter) {
    if (chapter.opening)
      this.opening(chapter.opening, chapter.kind === "title");
    if (chapter.title !== null)
      this.para(
        this.styles[`h${chapter.level}`],
        rtfText(chapter.title),
        chapter.opening ? "" : `\\sb${twips(chapterDrop(this.geometry))}`,
      );
    if (chapter.kind === "toc")
      for (const entry of tocEntries(this.doc))
        this.para(this.styles[`toc${entry.level}`], rtfText(entry.title));
    for (const block of chapter.blocks) this.block(block, 0, null);
  }

  private opening(opening: Opening, titlePage: boolean) {
    const [first, ...rest] = opening.contact;
    this.para(
      this.styles.contact,
      rtfText(`${first ?? ""}\t${opening.wordCount}`),
    );
    for (const line of rest) this.para(this.styles.contact, rtfText(line));
    this.para(
      this.styles.title,
      rtfText(opening.title),
      `\\sb${twips(titleDrop(this.geometry, opening.contact.length, titlePage))}`,
    );
    if (opening.byline) this.para(this.styles.byline, rtfText(opening.byline));
  }

  block(block: Block, depth: number, quote: boolean | null) {
    const { layout } = this.geometry;
    const align = (value: Align) =>
      value === "left" ? "" : ALIGN[alignFor(value, layout)];
    switch (block.kind) {
      case "heading":
        this.para(
          this.styles[`h${block.level}`],
          this.runs(block.inlines),
          align(block.align),
        );
        return;
      case "paragraph": {
        const blank = block.blank === true;
        const style = quote
          ? this.styles.quote
          : block.opener
            ? this.styles.first
            : this.styles.normal;
        this.para(
          style,
          blank ? "" : this.runs(block.inlines),
          blank ? "" : align(block.align),
        );
        return;
      }
      case "list":
        block.items.forEach((item, index) => {
          const marker = block.ordered ? `${block.start + index}.` : "\\bullet";
          const left = 720 * (depth + 1);
          item.forEach((inner, at) => {
            if (inner.kind === "list") this.block(inner, depth + 1, quote);
            else if (inner.kind === "paragraph")
              this.para(
                this.styles.list,
                `${at === 0 ? `${marker}\\tab ` : ""}${this.runs(inner.inlines)}`,
                `\\li${left}\\tx${left}${at === 0 ? "" : "\\fi0"}`,
              );
            else this.block(inner, depth, quote);
          });
        });
        return;
      case "quote":
        for (const inner of block.blocks) this.block(inner, depth, true);
        return;
      case "code":
        this.para(this.styles.code, rtfText(block.text));
        return;
      case "sceneBreak":
        this.para(this.styles.scene, rtfText(layout.sceneGlyph));
        return;
      case "pageBreak":
        this.pageBreak();
        return;
      case "facts":
        for (const [label, value] of block.rows)
          this.para(
            this.styles.fact,
            `{\\b ${rtfText(label)}}\\tab ${rtfText(value)}`,
          );
        return;
    }
  }
}

export function renderRtf(doc: ExportDocument): string {
  const plan = pagedPlan(doc);
  const { geometry } = plan;
  const { layout, page, margins } = geometry;
  const styles = stylesFor(geometry);
  const builder = new RtfBuilder(doc, geometry, styles);

  const pageSetup = `\\pgwsxn${twips(page.width)}\\pghsxn${twips(page.height)}\\margtsxn${twips(margins.top)}\\margbsxn${twips(margins.bottom)}\\marglsxn${twips(margins.inner)}\\margrsxn${twips(margins.outer)}\\headery${twips(margins.top / 2)}\\footery${twips(margins.bottom / 2)}`;

  const pageField = `{\\field{\\*\\fldinst PAGE}{\\fldrslt 1}}`;
  const [before, middle, after] = draftFooterParts(doc);
  // `\noline` on the furniture: a review copy numbers the text's lines, and
  // some word processors otherwise count the footer's two lines as the page's
  // last.
  const header =
    plan.runningHead !== null
      ? `{\\header\\pard\\plain\\noline\\qr\\f0\\fs${halfPoints(layout.size)} ${rtfText(plan.runningHead)}${pageField}\\par}${plan.bareFirstPage ? `{\\headerf\\pard\\plain\\par}` : ""}`
      : "";
  const footer =
    layout.footer === "draft"
      ? `{\\footer\\pard\\plain\\noline\\qc\\f0\\fs${halfPoints(layout.size)} ${rtfText(before)}${pageField}${rtfText(middle)}{\\field{\\*\\fldinst NUMPAGES}{\\fldrslt 1}}${rtfText(after)}\\par}`
      : layout.footer === "page"
        ? `{\\footer\\pard\\plain\\noline\\qc\\f0\\fs${halfPoints(layout.size)} ${pageField}\\par}`
        : "";
  const bodySection = `\\sectd\\sbkpage${pageSetup}\\pgnrestart\\pgnstarts1${layout.lineNumbers ? "\\linemod1\\lineppage\\linex360" : ""}${plan.bareFirstPage && plan.runningHead !== null ? "\\titlepg" : ""}${header}${footer}`;

  plan.front.forEach((chapter, index) => {
    if (index > 0) builder.pageBreak();
    builder.chapter(chapter);
  });
  plan.body.forEach((chapter, index) => {
    if (index === 0 && plan.front.length > 0) builder.section(bodySection);
    else if (index > 0) builder.pageBreak();
    builder.chapter(chapter);
  });

  const font = FONTS[layout.font].office;
  const mono = FONTS[MONO_FONT].office;
  const stylesheet = Object.values(styles)
    .sort((a, b) => a.id - b.id)
    .map(
      (style) =>
        `{${style.id === 0 ? "" : `\\s${style.id}`}${style.format} ${style.name};}`,
    )
    .join("\n");
  const info = `{\\info{\\title ${rtfText(doc.meta.title)}}${doc.meta.author ? `{\\author ${rtfText(doc.meta.author)}}` : ""}${doc.meta.subject ? `{\\subject ${rtfText(doc.meta.subject)}}` : ""}}`;
  // The first section's setup is the front matter's, or the text's when the
  // book has no front matter.
  const firstSection =
    plan.front.length > 0 || plan.body.length === 0
      ? `\\sectd${pageSetup}`
      : bodySection;

  return `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1
{\\fonttbl{\\f0\\froman\\fcharset0 ${font};}{\\f1\\fmodern\\fcharset0 ${mono};}}
{\\colortbl;\\red0\\green0\\blue0;\\red5\\green99\\blue193;}
{\\stylesheet
${stylesheet}
}
${info}
\\paperw${twips(page.width)}\\paperh${twips(page.height)}\\margl${twips(margins.inner)}\\margr${twips(margins.outer)}\\margt${twips(margins.top)}\\margb${twips(margins.bottom)}${margins.mirrored ? "\\margmirror" : ""}\\widowctrl
${firstSection}
${builder.out.join("\n")}
}
`;
}

export const rtfWriter: FormatWriter = {
  format: "rtf",
  write: async (doc) => utf8(renderRtf(doc)),
};
