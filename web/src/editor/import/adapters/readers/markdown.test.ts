// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { blockText, type SourceBlock } from "../../domain/source";
import { markdownReader } from "./markdown";

const ctx = { yield: async () => undefined };
const read = (md: string) =>
  markdownReader.read(new TextEncoder().encode(md), "book.md", ctx);
const texts = (blocks: SourceBlock[]) =>
  blocks.map((b) => (b.kind === "para" ? blockText(b) : `<${b.kind}>`));

describe("markdownReader", () => {
  it("reads general Markdown: headings, emphasis, breaks", async () => {
    const doc = await read(
      "# Part One\n\n## Chapter 1\n\nShe was *sure* and **loud**, `code`.\nSame paragraph.\n\n* * *\n\nAfter.\n",
    );
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual([
      "Part One",
      "Chapter 1",
      "She was sure and loud, code. Same paragraph.",
      "<rule>",
      "After.",
    ]);
    expect(blocks[0]).toMatchObject({ signals: { headingLevel: 1 } });
    expect(blocks[1]).toMatchObject({ signals: { headingLevel: 2 } });
    expect(blocks[2]).toMatchObject({
      inlines: [
        { text: "She was " },
        { text: "sure", italic: true },
        { text: " and " },
        { text: "loud", bold: true },
        { text: ", " },
        { text: "code", mono: true },
        { text: ". Same paragraph." },
      ],
    });
  });

  it("reads Phospheare's own dialect with the editor's codec", async () => {
    const doc = await read(
      "# One\n\nBefore.\n\n{align:center}\\* \\* \\*\n\n{pagebreak}\n\nAfter *this*.",
    );
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual([
      "One",
      "Before.",
      "* * *",
      "<pageBreak>",
      "After this.",
    ]);
    expect(blocks[2]).toMatchObject({ align: "center" });
  });

  it("takes the title, author and language from front matter", async () => {
    const doc = await read(
      "---\ntitle: Once Dark\nauthor: Ada Byron\nlang: it\n---\n\nText.",
    );
    expect(doc.meta).toEqual({
      title: "Once Dark",
      author: "Ada Byron",
      language: "it",
    });
    expect(texts(doc.flows[0].blocks)).toEqual(["Text."]);
  });

  it("lifts footnotes out of the text and only counts them", async () => {
    const doc = await read(
      "The storm[^1] came.\n\n[^1]: In 1947,\n    at dawn.\n[^2]: Never cited.\n",
    );
    // A definition's continuation line goes with it, and an uncited one is
    // counted all the same: what the file holds is two footnotes.
    expect(texts(doc.flows[0].blocks)).toEqual(["The storm came."]);
    expect(doc.comments).toEqual([]);
    expect(doc.report).toMatchObject({ footnotes: 2 });
  });

  it("walks HTML in the file inertly, and inline HTML emphasis", async () => {
    const doc = await read(
      'Plain <em>em</em> and <b>b</b>.\n\n<div><p style="font-style:italic">Styled</p><script>window.x=1</script></div>\n',
    );
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual(["Plain em and b.", "Styled"]);
    expect(blocks[0]).toMatchObject({
      inlines: [
        { text: "Plain " },
        { text: "em", italic: true },
        { text: " and " },
        { text: "b", bold: true },
        { text: "." },
      ],
    });
    expect(blocks[1]).toMatchObject({
      inlines: [{ text: "Styled", italic: true }],
    });
  });

  it("flattens lists, quotes, code and tables, and counts them", async () => {
    const doc = await read(
      "- a\n- b\n\n> quoted\n\n```\nl1\nl2\n```\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n![pic](p.png) [link](u) ~~gone~~\n",
    );
    expect(texts(doc.flows[0].blocks)).toEqual([
      "a",
      "b",
      "quoted",
      "l1",
      "l2",
      "x",
      "y",
      "1",
      "2",
      "link gone",
    ]);
    expect(doc.report).toMatchObject({
      lists: 1,
      quotes: 1,
      tables: 1,
      images: 1,
      links: 1,
      strike: 1,
    });
  });

  it("splits a paragraph at a hard break", async () => {
    const doc = await read("Line one  \nLine two\n");
    expect(texts(doc.flows[0].blocks)).toEqual(["Line one", "Line two"]);
  });

  it("ignores front matter that is not a mapping, and names every author of a book with several", async () => {
    const list = await read("---\n- one\n- two\n---\n\nText.");
    expect(list.meta).toEqual({});
    const many = await read("---\nauthor: [Ada, Byron]\n---\n\nText.");
    expect(many.meta).toMatchObject({ author: "Ada, Byron" });
  });

  it("reads the dialect's second heading level, and counts a footnote nobody cites", async () => {
    const dialect = await read("## Two\n\nText.\n\n{pagebreak}\n\nMore.");
    expect(dialect.flows[0].blocks[0]).toMatchObject({
      signals: { headingLevel: 2 },
    });
    const notes = await read("Text.\n\n[^a]: Never cited.\n");
    expect(texts(notes.flows[0].blocks)).toEqual(["Text."]);
    expect(notes.report).toMatchObject({ footnotes: 1 });
  });

  it("reads inline HTML strong and line breaks", async () => {
    const doc = await read("She was <strong>loud</strong><br>and gone.");
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual(["She was loud", "and gone."]);
    expect(blocks[0]).toMatchObject({
      inlines: [{ text: "She was " }, { text: "loud", bold: true }],
    });
  });
});

describe("markdownReader", () => {
  it("a leading --- block that is not YAML front matter is text, not dropped", async () => {
    const doc = await read(
      "---\nIt was night.\n\nShe waited.\n---\n\nThe morning came.\n",
    );
    const all = texts(doc.flows[0].blocks);
    expect(all).toContain("It was night.");
    expect(all).toContain("She waited.");
    expect(all).toContain("The morning came.");
  });

  it("an inline HTML span's italics survive, as the reader's header says", async () => {
    const doc = await read(
      'She said <span style="font-style:italic">never</span> again.\n',
    );
    expect(doc.flows[0].blocks[0]).toMatchObject({
      inlines: [
        { text: "She said " },
        { text: "never", italic: true },
        { text: " again." },
      ],
    });
  });
});
