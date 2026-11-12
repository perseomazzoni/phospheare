// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The writers' test book ───────────────────────────────────────────────────
//
// One hand-built `ExportDocument` every writer's suite serialises, so the
// eight writers are held to the same book rather than eight private ones that
// each dodge a different edge. Its shape is the one `assemble.ts` builds (tech
// page, a manuscript's title page, the contents, then the text, ids `c1…` in
// reading order), but by hand, so a writer test fails on the writer and never
// on the assembler or a parser.
//
// It also carries the two readers the zip writers' suites share, the
// package's first local file header and an XML parse that refuses a
// `parsererror`, because "mimetype is first and stored" and "every part is
// well-formed" are the same claim for EPUB, DOCX and ODT.

import { unzipSync, strFromU8 } from "fflate";
import { parseDocument } from "../../../../security/trustedHtml";
import { LAYOUTS, type LayoutId, type PageSizeId } from "../../domain/layout";
import type { Block, Chapter, ExportDocument } from "../../domain/model";

/**
 * Markup, an injection attempt, a control character and a noncharacter in one
 * run: `U+0001` and `U+FFFE` are what XML 1.0 forbids, and `{`, `}` and `\`
 * are RTF's whole escape surface.
 */
export const NASTY = `<script>alert('x')</script> & "q" \u0001gone\uFFFE {brace} back\\slash`;
/** `NASTY` as a reader must see it: every character but the two forbidden. */
export const NASTY_CLEAN = `<script>alert('x')</script> & "q" gone {brace} back\\slash`;
/**
 * Whether either forbidden character of `NASTY` survived into a writer's
 * output. A plain search, not a regex, because the lint gate forbids a
 * control character in a pattern.
 */
export const hasForbidden = (text: string | null | undefined): boolean =>
  (text ?? "").includes("\u0001") || (text ?? "").includes("\uFFFE");
/** Latin-1, typographic quotes, an astral-plane emoji and CJK. */
export const WORLD = "è “quotes” 🎉 漢字";

/** The writer's own `{pagebreak}`s in the test book's text. */
export const IN_TEXT_PAGE_BREAKS = 1;

const p = (
  text: string,
  align: "left" | "center" | "right" | "justify" = "left",
  opener = false,
): Block => ({
  kind: "paragraph",
  inlines: [{ text }],
  align,
  ...(opener ? { opener } : {}),
});

const richParagraph: Block = {
  kind: "paragraph",
  opener: true,
  align: "left",
  inlines: [
    { text: "Plain " },
    { text: "italic", italic: true },
    { text: " and " },
    { text: "bold", bold: true },
    { text: " " },
    { text: "both", bold: true, italic: true },
    { text: " " },
    { text: "mono`tick", mono: true },
    { text: " " },
    { text: "struck", strike: true },
    { text: " " },
    { text: "a link", href: "https://example.com/a?b=1&c=2" },
    { text: " " },
    { text: "mail me", href: "mailto:ann@example.com" },
    { text: "." },
  ],
};

export interface TestDocOptions {
  layout?: LayoutId;
  page?: PageSizeId;
  /** A contents page, as the writer ticks it; an EPUB always has one. */
  toc?: boolean;
  /** Under a manuscript layout, the opening on the text's first page. */
  story?: boolean;
}

export function testDoc(options: TestDocOptions = {}): ExportDocument {
  const layout = options.layout ?? "book";
  const manuscript = LAYOUTS[layout].manuscript;
  const opening = {
    contact: ["Ann Writer", "1 Via Roma", "ann@example.com"],
    wordCount: "about 1,000 words",
    title: "The <Book>",
    byline: "by Ann Writer",
  };
  const chapters: Omit<Chapter, "id">[] = [
    {
      kind: "tech",
      title: "Technical page",
      level: 1,
      numbered: false,
      blocks: [
        {
          kind: "facts",
          rows: [
            ["Title", "The <Book> & Co"],
            ["Words", "1,200"],
          ],
        },
      ],
    },
  ];
  if (manuscript && !options.story)
    chapters.push({
      kind: "title",
      title: null,
      level: 1,
      numbered: false,
      opening,
      blocks: [],
    });
  if (options.toc ?? true)
    chapters.push({
      kind: "toc",
      title: "Contents",
      level: 1,
      numbered: false,
      blocks: [],
    });
  chapters.push(
    {
      kind: "part",
      title: "Part One",
      level: 1,
      numbered: true,
      ...(manuscript && options.story ? { opening } : {}),
      blocks: [p("The part's epigraph.", "center", true)],
    },
    {
      kind: "section",
      title: "Chapter <One> & “Two”",
      level: 2,
      numbered: true,
      blocks: [
        {
          kind: "heading",
          level: 3,
          inlines: [{ text: "A heading" }],
          align: "left",
        },
        richParagraph,
        p("Centred line", "center"),
        p("Right line", "right"),
        p("Justified line", "justify"),
        {
          kind: "heading",
          level: 4,
          inlines: [{ text: "Centred heading" }],
          align: "center",
        },
        {
          kind: "list",
          ordered: true,
          start: 3,
          items: [
            [p("third item")],
            [
              p("fourth item"),
              {
                kind: "list",
                ordered: false,
                start: 1,
                items: [[p("nested bullet")]],
              },
            ],
          ],
        },
        { kind: "quote", blocks: [p("Quoted words")] },
        { kind: "code", text: "const x = a < b && c;\n  indented" },
        { kind: "sceneBreak" },
        p(NASTY, "left", true),
        { kind: "pageBreak" },
        p(WORLD, "left", true),
        // A blank line the writer left, as `tidy` marks it.
        {
          kind: "paragraph",
          inlines: [{ text: "" }],
          align: "left",
          blank: true,
        },
        p("After a blank line."),
      ],
    },
    {
      kind: "section",
      title: "Chapter Two",
      level: 2,
      numbered: true,
      blocks: [p("The last words.", "left", true)],
    },
  );
  return {
    meta: {
      id: "3F2504E0-4F89-11D3-9A0C-0305E82C3301",
      title: "The <Book> & “Co”",
      author: "Ann Writer",
      language: "en",
      subject: "Fantasy, Mystery",
      exportedAt: "2026-10-01T14:32:05.123Z",
      accessibilitySummary: "Text only, with headings and a table of contents.",
    },
    layout,
    page: options.page ?? "a4",
    runningHeader: "Writer / The Book",
    furniture: {
      draft: "Draft · 1 October 2026",
      pageOf: "page {page} of {pages}",
    },
    chapters: chapters.map((chapter, index) => ({
      ...chapter,
      id: `c${index + 1}`,
    })),
  };
}

// ── Reading a package back ───────────────────────────────────────────────────

/** Every entry of a zip, decoded as UTF-8 text. */
export function unzipText(bytes: Uint8Array): Record<string, string> {
  return Object.fromEntries(
    Object.entries(unzipSync(bytes)).map(([path, data]) => [
      path,
      strFromU8(data),
    ]),
  );
}

/**
 * The archive's first local file header, read straight from the bytes: what a
 * reader sniffing the type sees before it parses any directory.
 */
export function firstLocalEntry(bytes: Uint8Array): {
  name: string;
  method: number;
  data: string;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50)
    throw new Error("not a zip local header");
  const method = view.getUint16(8, true);
  const size = view.getUint32(18, true);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const name = strFromU8(bytes.subarray(30, 30 + nameLength));
  const start = 30 + nameLength + extraLength;
  return { name, method, data: strFromU8(bytes.subarray(start, start + size)) };
}

/** An XML part, parsed; throws on anything that is not well-formed. */
export function parseXml(text: string, path = "part"): Document {
  const doc = parseDocument(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0)
    throw new Error(`${path} is not well-formed XML`);
  return doc;
}
