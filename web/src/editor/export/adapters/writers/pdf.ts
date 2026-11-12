// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Writes PDF through pdfmake, with every font embedded: a PDF that names a
// font without embedding it is what print-on-demand services send back. The
// faces are static OFL/Apache TTFs served from `public/fonts/export/` and
// fetched only by a writer who exports a PDF; the app's own woff2 files are
// variable and split by script, which an embedder cannot use.
//
// A pure function (`pdfDefinition`) builds the document definition, so what a
// PDF says is tested without rendering one; `write` is the thin render around
// it.
//
// The engine has two limits:
//
//   - pdfmake has one set of margins for every page, so a trim size's mirrored
//     margins are set as the spine-side margin on both sides: the text clears
//     the gutter on every page, at the cost of a little width. A printer-ready
//     PDF/X is out of this export's scope.
//   - It does not expose where it breaks lines, so the review copy numbers
//     paragraphs in the margin, not lines. DOCX, ODT and RTF number lines.
//
// The document fetches nothing: `setUrlAccessPolicy` refuses every URL, so no
// text in the book can make the renderer reach the network.

import pdfMake from "pdfmake/build/pdfmake";
import {
  FONTS,
  MONO_FONT,
  alignFor,
  chapterDrop,
  contactLine,
  headingStyle,
  titleDrop,
  titleScale,
  type FontId,
} from "../../domain/layout";
import {
  type Block,
  type Chapter,
  type ExportDocument,
  type Inline,
  type Opening,
} from "../../domain/model";
import type { FormatWriter } from "../../ports";
import { draftFooterParts, pagedPlan, type PagedPlan } from "./paged";
import { stripInvalidXml } from "./xml";
import { PRODUCT } from "../../../../product";

/** The four faces of a font family, by file name under `fonts/export/`. */
export function fontFiles(font: FontId) {
  const stem = FONTS[font].pdf;
  return {
    normal: `${stem}-Regular.ttf`,
    bold: `${stem}-Bold.ttf`,
    italics: `${stem}-Italic.ttf`,
    bolditalics: `${stem}-BoldItalic.ttf`,
  };
}

type Node = Record<string, unknown>;

class PdfBuilder {
  /** The review copy's last paragraph number. */
  private paragraphNumber = 0;
  private pendingBreak = false;
  usesMono = false;

  constructor(private readonly plan: PagedPlan) {}

  private take(node: Node): Node {
    if (!this.pendingBreak) return node;
    this.pendingBreak = false;
    return { ...node, pageBreak: "before" };
  }

  inline(inline: Inline): Node {
    if (inline.mono) this.usesMono = true;
    return {
      text: stripInvalidXml(inline.text),
      ...(inline.bold ? { bold: true } : {}),
      ...(inline.italic ? { italics: true } : {}),
      ...(inline.mono ? { font: FONTS[MONO_FONT].pdf } : {}),
      ...(inline.strike ? { decoration: "lineThrough" } : {}),
      ...(inline.href ? { link: inline.href, decoration: "underline" } : {}),
    };
  }

  inlines(inlines: readonly Inline[]): Node[] {
    return inlines.map((inline) => this.inline(inline));
  }

  chapter(chapter: Chapter, first: boolean): Node[] {
    const { geometry } = this.plan;
    const nodes: Node[] = [];
    if (chapter.opening)
      nodes.push(...this.opening(chapter.opening, chapter.kind === "title"));
    if (chapter.title !== null)
      nodes.push({
        text: stripInvalidXml(chapter.title),
        style: `h${chapter.level}`,
        id: chapter.id,
        // Only the book's own chapters make the contents.
        ...(chapter.kind !== "tech" && chapter.kind !== "toc"
          ? { tocItem: true }
          : {}),
        marginTop: chapter.opening ? 0 : chapterDrop(geometry),
      });
    if (chapter.kind === "toc")
      nodes.push({
        toc: { numberStyle: { alignment: "right" } },
      });
    for (const block of chapter.blocks) nodes.push(...this.block(block, false));
    // Each chapter after the first starts a page.
    if (!first && nodes.length > 0)
      nodes[0] = { ...nodes[0], pageBreak: "before" };
    return nodes;
  }

  private opening(opening: Opening, titlePage: boolean): Node[] {
    const { geometry } = this.plan;
    const lineHeight = contactLine(geometry) / geometry.layout.size;
    return [
      {
        columns: [
          {
            width: "*",
            stack: opening.contact.map(stripInvalidXml),
            lineHeight,
          },
          {
            width: "auto",
            text: stripInvalidXml(opening.wordCount),
            lineHeight,
          },
        ],
      },
      {
        text: stripInvalidXml(opening.title),
        style: "title",
        marginTop: titleDrop(geometry, opening.contact.length, titlePage),
      },
      ...(opening.byline
        ? [{ text: stripInvalidXml(opening.byline), style: "byline" }]
        : []),
    ];
  }

  block(block: Block, quoted: boolean): Node[] {
    const { layout } = this.plan.geometry;
    switch (block.kind) {
      case "heading":
        return [
          this.take({
            text: this.inlines(block.inlines),
            style: `h${block.level}`,
            alignment: alignFor(block.align, layout),
          }),
        ];
      case "paragraph": {
        if (block.blank) return [this.take({ text: "\u00A0" })];
        const node: Node = {
          text: this.inlines(block.inlines),
          alignment: alignFor(block.align, layout),
          leadingIndent:
            quoted || (block.opener && !layout.indentOpeners)
              ? 0
              : layout.indent,
        };
        if (!layout.lineNumbers || quoted) return [this.take(node)];
        // The review copy: the paragraph's number in the margin beside it.
        this.paragraphNumber += 1;
        return [
          this.take({
            columns: [
              {
                width: 22,
                text: String(this.paragraphNumber),
                fontSize: 7,
                color: "#777777",
                alignment: "right",
                marginTop: 2,
              },
              { width: "*", ...node },
            ],
            columnGap: 6,
            marginLeft: -28,
          }),
        ];
      }
      case "list": {
        const items = block.items.map((item) => ({
          stack: item.flatMap((inner) => this.block(inner, true)),
        }));
        return [
          this.take(
            block.ordered
              ? { ol: items, start: block.start, marginBottom: layout.size / 2 }
              : { ul: items, marginBottom: layout.size / 2 },
          ),
        ];
      }
      case "quote":
        return [
          this.take({
            stack: block.blocks.flatMap((inner) => this.block(inner, true)),
            marginLeft: 36,
            marginRight: 36,
          }),
        ];
      case "code":
        this.usesMono = true;
        return [
          this.take({
            text: stripInvalidXml(block.text),
            font: FONTS[MONO_FONT].pdf,
            fontSize: layout.size - 1,
            lineHeight: 1.15,
            preserveLeadingSpaces: true,
          }),
        ];
      case "sceneBreak":
        return [this.take({ text: layout.sceneGlyph, style: "scene" })];
      case "pageBreak":
        this.pendingBreak = true;
        return [];
      case "facts":
        return [
          this.take({
            table: {
              widths: [150, "*"],
              body: block.rows.map(([label, value]) => [
                { text: stripInvalidXml(label), bold: true },
                stripInvalidXml(value),
              ]),
            },
            layout: "noBorders",
            lineHeight: 1.15,
          }),
        ];
    }
  }
}

export function pdfDefinition(doc: ExportDocument): {
  definition: Node;
  fonts: FontId[];
} {
  const plan = pagedPlan(doc);
  const { geometry } = plan;
  const { layout, page, margins } = geometry;
  const builder = new PdfBuilder(plan);

  const front = plan.front.flatMap((chapter, index) =>
    builder.chapter(chapter, index === 0),
  );
  const body = plan.body.flatMap((chapter, index) =>
    builder.chapter(chapter, index === 0),
  );

  // Body pages are numbered from 1. The header and footer are laid out after
  // the text and called page by page in order, so the first page they are
  // asked about is the text's first page.
  let bodyStart = Infinity;
  const bodyPage = (current: number) => {
    bodyStart = Math.min(bodyStart, current);
    return current - bodyStart + 1;
  };
  const furniture = {
    fontSize: Math.min(layout.size, 10),
    margin: [0, 0, 0, 0],
  };
  const header =
    plan.runningHead !== null
      ? (current: number) => {
          const n = bodyPage(current);
          if (n === 1 && plan.bareFirstPage) return null;
          return {
            text: stripInvalidXml(`${plan.runningHead}${n}`),
            alignment: "right",
            fontSize: layout.size,
            margin: [margins.inner, margins.top / 2, margins.outer, 0],
          };
        }
      : null;
  const [before, middle, after] = draftFooterParts(doc);
  const footer =
    layout.footer === "none"
      ? null
      : (current: number, count: number) => {
          const n = bodyPage(current);
          const text =
            layout.footer === "draft"
              ? `${before}${n}${middle}${count - bodyStart + 1}${after}`
              : String(n);
          return {
            ...furniture,
            text: stripInvalidXml(text),
            alignment: "center",
            margin: [margins.inner, margins.bottom / 2 - 6, margins.outer, 0],
          };
        };

  const mirrored = margins.mirrored;
  const pageMargins = [
    margins.inner,
    margins.top,
    mirrored ? margins.inner : margins.outer,
    margins.bottom,
  ];

  const content: Node[] = [];
  if (front.length > 0)
    content.push({ section: front, header: null, footer: null });
  if (body.length > 0) content.push({ section: body, header, footer });

  const heading = (level: number) => {
    const style = headingStyle(layout, level);
    return {
      fontSize: layout.size * style.scale,
      alignment: style.centred ? "center" : "left",
      ...(style.italic ? { italics: true } : {}),
    };
  };
  const line = layout.size * layout.lineHeight;

  return {
    fonts:
      builder.usesMono && layout.font !== MONO_FONT
        ? [layout.font, MONO_FONT]
        : [layout.font],
    definition: {
      pageSize: { width: page.width, height: page.height },
      pageMargins,
      language: doc.meta.language,
      info: {
        title: doc.meta.title,
        ...(doc.meta.author ? { author: doc.meta.author } : {}),
        ...(doc.meta.subject ? { subject: doc.meta.subject } : {}),
        creator: PRODUCT.name,
        producer: PRODUCT.name,
      },
      defaultStyle: {
        font: FONTS[layout.font].pdf,
        fontSize: layout.size,
        lineHeight: layout.lineHeight,
      },
      styles: {
        h1: { ...heading(1), marginBottom: line },
        h2: { ...heading(2), marginBottom: line },
        h3: {
          ...heading(3),
          marginTop: layout.size,
          marginBottom: layout.size / 2,
        },
        h4: {
          ...heading(4),
          marginTop: layout.size,
          marginBottom: layout.size / 2,
        },
        h5: {
          ...heading(5),
          marginTop: layout.size,
          marginBottom: layout.size / 2,
        },
        h6: {
          ...heading(6),
          marginTop: layout.size,
          marginBottom: layout.size / 2,
        },
        title: {
          alignment: "center",
          fontSize: layout.size * titleScale(layout),
        },
        byline: { alignment: "center", marginBottom: line * 2 },
        scene: {
          alignment: "center",
          marginTop: layout.size / 2,
          marginBottom: layout.size / 2,
        },
      },
      content: content.length > 0 ? content : [{ text: "" }],
    },
  };
}

/** Chunked: one `String.fromCharCode(...bytes)` over a font overflows. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** A PDF writer that fetches its fonts by file name under `fonts/export/`. */
export function createPdfWriter(
  loadFont: (file: string) => Promise<Uint8Array>,
): FormatWriter {
  return {
    format: "pdf",
    async write(doc) {
      const { definition, fonts } = pdfDefinition(doc);
      const vfs: Record<string, string> = {};
      const families: Record<string, ReturnType<typeof fontFiles>> = {};
      for (const font of fonts) {
        const files = fontFiles(font);
        families[FONTS[font].pdf] = files;
        for (const file of Object.values(files))
          vfs[file] = base64(await loadFont(file));
      }
      pdfMake.addVirtualFileSystem(vfs);
      pdfMake.addFonts(families);
      // Nothing in a book may make the renderer fetch anything.
      pdfMake.setUrlAccessPolicy(() => false);
      return new Uint8Array(await pdfMake.createPdf(definition).getBuffer());
    },
  };
}
