// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { Inline } from "../../domain/model";
import { markdownParser } from "../markdownBlocks";
import { commonmarkWriter, renderCommonMark } from "./commonmark";
import { IN_TEXT_PAGE_BREAKS, hasForbidden, testDoc } from "./document.fixture";

// The Markdown file is real CommonMark that any tool reads, and carries what
// the dialect has and CommonMark lacks (alignment, page breaks) as the raw
// HTML the spec allows. The rows pin spelling: the marks a CommonMark reader
// sees and the HTML blocks it passes through.

const PAGE_BREAK = `<div style="break-after: page"></div>`;
const count = (text: string, needle: string) => text.split(needle).length - 1;

/**
 * One paragraph written and read back by the app's own CommonMark reader, the
 * closest check that a Markdown tool sees what the writer wrote without a
 * second parser. Strikethrough is left out: it travels as `<del>`, which that
 * reader keeps as text.
 */
function roundTrip(inlines: Inline[]): Inline[] {
  const [block] = markdownParser.parse(writeParagraph(inlines));
  return block.kind === "paragraph" ? block.inlines : [];
}

/** The Markdown file for one left-aligned paragraph. */
function writeParagraph(inlines: Inline[]): string {
  const doc = testDoc();
  return renderCommonMark({
    ...doc,
    chapters: [
      {
        ...doc.chapters[4],
        title: null,
        blocks: [{ kind: "paragraph", align: "left", inlines }],
      },
    ],
  });
}

describe("renderCommonMark", () => {
  const doc = testDoc();
  const md = renderCommonMark(doc);

  it("ends every chapter but the last on a page break, plus the writer's own", () => {
    expect(count(md, PAGE_BREAK)).toBe(
      doc.chapters.length - 1 + IN_TEXT_PAGE_BREAKS,
    );
    // No trailing break: the file ends on the last chapter's words.
    expect(md.trimEnd().endsWith("The last words.")).toBe(true);
  });

  it("writes chapter headings by level, escaping the title's markup", () => {
    expect(md).toContain("\n# Part One\n");
    expect(md).toContain("\n## Chapter \\<One\\> \\& “Two”\n");
    expect(md).toContain("\n### A heading\n");
  });

  it("spells the inline marks CommonMark reads", () => {
    expect(md).toContain("Plain *italic* and **bold** ***both***");
    expect(md).toContain("<del>struck</del>");
    expect(md).toContain("[a link](https://example.com/a?b=1&c=2)");
    expect(md).toContain("[mail me](mailto:ann@example.com)");
    // A backtick inside the code needs a longer fence around it.
    expect(md).toContain("``mono`tick``");
  });

  it("moves edge whitespace outside the markers, where `** bold**` would not be bold", () => {
    const out = renderCommonMark({
      ...doc,
      chapters: [
        {
          ...doc.chapters[4],
          title: null,
          blocks: [
            {
              kind: "paragraph",
              align: "left",
              inlines: [
                { text: "a" },
                { text: " b ", italic: true },
                { text: "c" },
              ],
            },
          ],
        },
      ],
    });
    expect(out).toBe("a *b* c\n");
  });

  it("escapes characters that would open a block at a line start", () => {
    const out = renderCommonMark({
      ...doc,
      chapters: [
        {
          ...doc.chapters[4],
          title: null,
          blocks: [
            {
              kind: "paragraph",
              align: "left",
              inlines: [{ text: "# not a heading" }],
            },
            {
              kind: "paragraph",
              align: "left",
              inlines: [{ text: "1. not a list" }],
            },
            {
              kind: "paragraph",
              align: "left",
              inlines: [{ text: "> not a quote" }],
            },
          ],
        },
      ],
    });
    expect(out).toBe(
      "\\# not a heading\n\n1\\. not a list\n\n\\> not a quote\n",
    );
  });

  // A closing run of `#` after a space is the end of an ATX heading, not its
  // text, so a title ending in " #" would lose the mark.
  it("keeps a heading's closing `#` as text", () => {
    const out = renderCommonMark({
      ...doc,
      chapters: [
        {
          ...doc.chapters[4],
          title: "Take #",
          blocks: [
            {
              kind: "heading",
              level: 2,
              align: "left",
              inlines: [{ text: "Scene ##" }],
            },
          ],
        },
      ],
    });
    const blocks = markdownParser.parse(out);
    const headings = blocks.flatMap((block) =>
      block.kind === "heading"
        ? [block.inlines.map((i) => i.text).join("")]
        : [],
    );
    expect(headings).toEqual(["Take #", "Scene ##"]);
  });

  // Four spaces or a tab at a paragraph's start open an indented code block.
  it("writes a paragraph that starts indented flush left, as a paragraph", () => {
    for (const text of ["    She left.", "\tShe left.", "  She left."]) {
      expect(writeParagraph([{ text }])).toBe("She left.\n");
      expect(roundTrip([{ text }])).toEqual([{ text: "She left." }]);
    }
    const bold: Inline[] = [{ text: "    She left.", bold: true }];
    expect(writeParagraph(bold)).toBe("**She left.**\n");
    expect(roundTrip(bold)).toEqual([{ text: "She left.", bold: true }]);
  });

  it("drops the spaces before a paragraph's opening bold run", () => {
    const inlines: Inline[] = [
      { text: "    " },
      { text: "She", bold: true },
      { text: " left." },
    ];
    const out = writeParagraph(inlines);
    expect(out).toBe("**She** left.\n");
    expect(out).not.toContain("&#");
    expect(roundTrip(inlines)).toEqual([
      { text: "She", bold: true },
      { text: " left." },
    ]);
  });

  it("carries alignment as an HTML block, with its inline formatting as HTML", () => {
    expect(md).toContain(
      `<p style="text-align:center">The part&apos;s epigraph.</p>`,
    );
    expect(md).toContain(`<p style="text-align:right">Right line</p>`);
    expect(md).toContain(`<p style="text-align:justify">Justified line</p>`);
    expect(md).toContain(`<h4 style="text-align:center">Centred heading</h4>`);
  });

  it("writes lists with their numbering and nesting, quotes, code and the scene break", () => {
    expect(md).toContain("3. third item\n4. fourth item\n\n   - nested bullet");
    expect(md).toContain("> Quoted words");
    expect(md).toContain("```\nconst x = a < b && c;\n  indented\n```");
    expect(md).toContain("\n* * *\n");
    expect(md).toContain("&nbsp;");
  });

  it("writes the tech page's facts as a bold-labelled list", () => {
    expect(md).toContain(
      "- **Title:** The \\<Book\\> \\& Co\n- **Words:** 1,200",
    );
  });

  it("lists the contents as links to anchors that exist", () => {
    expect(md).toContain(
      "- [Part One](#c3)\n  - [Chapter \\<One\\> \\& “Two”](#c4)",
    );
    for (const id of ["c3", "c4", "c5"])
      expect(md).toContain(`<a id="${id}"></a>`);
  });

  it("writes no anchors at all when the file has no contents to link from", () => {
    expect(renderCommonMark(testDoc({ toc: false }))).not.toContain("<a id=");
  });

  it("reads back as the same formatting through a CommonMark parser", () => {
    const inlines: Inline[] = [
      { text: "Plain " },
      { text: "italic", italic: true },
      { text: " and " },
      { text: "bold", bold: true },
      { text: " " },
      { text: "both", bold: true, italic: true },
      { text: " " },
      { text: "mono`tick", mono: true },
      { text: " " },
      { text: "a link", href: "https://example.com/a?b=1&c=2" },
      // Text that looks like markup comes back as the same text.
      { text: " *not* [marks] <here>" },
    ];
    expect(roundTrip(inlines)).toEqual(inlines);
  });

  // Adjacent runs that share a mark are wrapped together. Delimiters written
  // back to back (`*x**`foo`*`) read as one `**` delimiter run in CommonMark,
  // closing the italic early and printing literal asterisks around the code.
  it("keeps a shared mark across adjacent runs with no space between them", () => {
    const inlines: Inline[] = [
      { text: "x", italic: true },
      { text: "foo", italic: true, mono: true },
    ];
    expect(roundTrip(inlines)).toEqual(inlines);
  });

  it("encodes as UTF-8 through the writer", async () => {
    const bytes = await commonmarkWriter.write(doc);
    const written = new TextDecoder().decode(bytes);
    // Everything but the two characters no reader can see (`U+0001`,
    // `U+FFFE`).
    expect(hasForbidden(md)).toBe(true);
    expect(hasForbidden(written)).toBe(false);
    expect(written).toBe(md.split("\u0001").join("").split("\uFFFE").join(""));
    expect(commonmarkWriter.format).toBe("md");
  });
});
