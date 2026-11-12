// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { blockText, type SourceBlock } from "../../domain/source";
import { rtfReader } from "./rtf";

const ctx = { yield: async () => undefined };
const latin1 = (text: string) =>
  new Uint8Array(Array.from(text, (c) => c.charCodeAt(0) & 0xff));
const read = (rtf: string) => rtfReader.read(latin1(rtf), "book.rtf", ctx);
const texts = (blocks: SourceBlock[]) =>
  blocks.map((b) => (b.kind === "para" ? blockText(b) : `<${b.kind}>`));

const HEAD =
  "{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang1040" +
  "{\\fonttbl{\\f0\\froman\\fcharset0 Times;}{\\f1\\fmodern\\fcharset0 Courier New;}{\\f2\\fnil\\fcharset238 Arial CE;}}" +
  "{\\colortbl;\\red0\\green0\\blue0;}" +
  "{\\stylesheet{\\s0 Normal;}{\\s1\\outlinelevel0 heading 1;}{\\s2 Title;}{\\*\\cs10 Emphasis;}}" +
  "{\\info{\\title Once Dark}{\\author Ada Byron}}";

describe("rtfReader", () => {
  it("reads paragraphs, emphasis, alignment and headings", async () => {
    const doc = await read(
      HEAD +
        "\\pard\\s2\\qc Once Dark\\par" +
        "\\pard\\s1 Chapter One\\par" +
        "\\pard\\plain She was {\\i sure} and {\\b loud}, {\\f1 code}.\\par" +
        "\\pard\\qj Justified.\\par}",
    );
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual([
      "Once Dark",
      "Chapter One",
      "She was sure and loud, code.",
      "Justified.",
    ]);
    expect(blocks[0]).toMatchObject({
      align: "center",
      signals: { role: "title" },
    });
    expect(blocks[1]).toMatchObject({ signals: { headingLevel: 1 } });
    expect(blocks[2]).toMatchObject({
      inlines: [
        { text: "She was " },
        { text: "sure", italic: true },
        { text: " and " },
        { text: "loud", bold: true },
        { text: ", " },
        { text: "code", mono: true },
        { text: "." },
      ],
    });
    expect(blocks[3]).toMatchObject({ align: "justify" });
    expect(doc.meta).toEqual({
      title: "Once Dark",
      author: "Ada Byron",
      language: "it-IT",
    });
  });

  it("reads \\u once, skipping its \\uc fallback characters", async () => {
    const doc = await read(
      HEAD +
        "\\pard \\u8220\\'93quoted\\u8221\\'94 and {\\uc2\\u8212 --} done\\par}",
    );
    expect(texts(doc.flows[0].blocks)).toEqual(["“quoted” and — done"]);
  });

  it("decodes bytes by the code page, and by the font's charset", async () => {
    const doc = await read(
      HEAD + "\\pard It\\'92s caf\\'e9.\\par\\pard {\\f2 \\'9a\\'e8}\\par}",
    );
    // cp1252 for the body; cp1250 (charset 238) under font 2: "š" and "č".
    expect(texts(doc.flows[0].blocks)).toEqual(["It’s café.", "šč"]);
  });

  it("drops hidden and deleted text, and steps over pictures and \\bin", async () => {
    const doc = await read(
      HEAD +
        "\\pard Seen{\\v secret}{\\deleted gone} kept{\\*\\shppict{\\pict\\pngblip 89504e47}}{\\*\\unknowndest junk}\\bin3 {}x.\\par}",
    );
    expect(texts(doc.flows[0].blocks)).toEqual(["Seen kept."]);
    expect(doc.report).toMatchObject({
      hiddenText: 1,
      trackedChanges: 1,
      images: 1,
    });
  });

  it("keeps a field's result, and drops a table of contents", async () => {
    const doc = await read(
      HEAD +
        '\\pard See {\\field{\\*\\fldinst HYPERLINK "x"}{\\fldrslt the map}}.\\par' +
        "{\\field{\\*\\fldinst TOC \\\\o}{\\fldrslt \\pard One\\tab 1\\par\\pard Two\\tab 9\\par}}" +
        "\\pard After.\\par}",
    );
    expect(texts(doc.flows[0].blocks)).toEqual(["See the map.", "After."]);
  });

  it("breaks pages on \\page, \\sect and \\pagebb, and splits at \\line", async () => {
    const doc = await read(
      HEAD +
        "\\pard One.\\par\\page\\pard Two.\\par\\sect\\pard Three.\\par\\pard\\pagebb Four.\\par\\pard a\\line b\\par}",
    );
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual([
      "One.",
      "Two.",
      "Three.",
      "Four.",
      "a",
      "b",
    ]);
    expect(
      blocks.map((b) => (b.kind === "para" ? !!b.signals.breakBefore : null)),
    ).toEqual([false, true, true, true, false, false]);
  });

  it("reads ranged comments, and counts footnotes and endnotes without keeping them", async () => {
    const doc = await read(
      HEAD +
        "\\pard The {\\*\\atrfstart 1}storm{\\*\\atrfend 1}{\\*\\atnid E}{\\*\\atnauthor Ed}\\chatn{\\*\\annotation{\\*\\atnref 1}\\pard\\plain Which?}" +
        "{\\super\\chftn}{\\footnote\\pard\\plain{\\super\\chftn} In 1947.} came" +
        "{\\footnote\\ftnalt\\pard\\plain Later.}.\\par}",
    );
    expect(texts(doc.flows[0].blocks)).toEqual(["The storm came."]);
    // Only the comment is a note: a footnote leaves neither its body nor its
    // number in the text, and nothing else of it is kept.
    expect(doc.comments).toHaveLength(1);
    const [comment] = doc.comments;
    expect(comment).toMatchObject({
      author: "Ed",
      initials: "E",
      body: [[{ text: "Which?" }]],
      anchor: { start: { block: 0, offset: 4 }, end: { block: 0, offset: 9 } },
    });
    expect(doc.report).toMatchObject({
      comments: 1,
      footnotes: 1,
      endnotes: 1,
    });
  });

  it("reads table cells as paragraphs and counts the table", async () => {
    const doc = await read(
      HEAD +
        "\\trowd\\cellx1000\\cellx2000\\pard\\intbl a\\cell b\\cell\\row\\pard After.\\par}",
    );
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual(["a", "b", "After."]);
    expect(blocks[0]).toMatchObject({ signals: { origin: "table" } });
    expect(doc.report).toMatchObject({ tables: 1 });
  });

  it("refuses bytes that are not RTF", async () => {
    await expect(read("hello")).rejects.toMatchObject({ reason: "damaged" });
  });

  it("reads the control symbols as the characters they stand for", async () => {
    const doc = await read(
      HEAD +
        "\\pard a\\\\b \\{c\\} non\\~breaking well\\_known op\\-tional\\par" +
        "\\pard first\\\nsecond\\par}",
    );
    expect(texts(doc.flows[0].blocks)).toEqual([
      // `\~` is a real no-break space; `\_` is written as a plain hyphen,
      // which every search matches.
      `a\\b {c} non${String.fromCharCode(160)}breaking well-known optional`,
      "first",
      "second",
    ]);
  });

  it("names the typographer's symbols, and right-aligns on \\qr", async () => {
    const doc = await read(
      HEAD +
        "\\pard\\qr \\ldblquote Yes\\rdblquote\\emdash she said\\endash \\lquote no\\rquote\\bullet\\par}",
    );
    const [block] = doc.flows[0].blocks;
    // The space after a control word is its delimiter, never text.
    expect(texts([block])).toEqual(["“Yes”—she said–‘no’•"]);
    expect(block).toMatchObject({ align: "right" });
  });

  it("reads every underline, small and full capitals, and strikethrough", async () => {
    const doc = await read(
      HEAD +
        "\\pard {\\ul a}{\\uld b}{\\uldb c}{\\ulw d} {\\ul x\\ulnone y} {\\caps loud}{\\scaps small} {\\strike gone}{\\striked0 kept}\\par}",
    );
    const [block] = doc.flows[0].blocks;
    if (block.kind !== "para") throw new Error("not a paragraph");
    const under = block.inlines.filter((i) => i.underline).map((i) => i.text);
    expect(under.join("")).toBe("abcdx");
    expect(block.inlines.find((i) => i.text.includes("y"))?.underline).toBe(
      undefined,
    );
    // Adjacent underlined runs are one run once tidied: "abcd" and "x".
    expect(doc.report).toMatchObject({ strike: 1, underline: 2 });
  });

  it("reads a negative \\u as the code unit it wraps to, and \\uc0 skips nothing", async () => {
    const doc = await read(
      HEAD + "\\pard {\\uc0\\u-3913 }x{\\uc1\\u233\\'e9}\\par}",
    );
    // -3913 + 65536 = 61623 (U+F0B7, the Symbol font's bullet slot).
    const [text] = texts(doc.flows[0].blocks);
    expect(text.charCodeAt(0)).toBe(61623);
    expect(text.slice(1)).toBe("xé");
  });

  it("finds a heading by its style's outline level, and a subtitle by name", async () => {
    const doc = await read(
      "{\\rtf1\\ansi{\\fonttbl{\\f0 Times;}}" +
        "{\\stylesheet{\\s0 Normal;}{\\s3\\outlinelevel1 Section Head;}{\\s4 Subtitle;}{\\s5 Caf\\'e9;}}" +
        "\\pard\\s4 A beginning\\par\\pard\\s3 Part of it\\par\\pard\\outlinelevel2 Deeper\\par\\pard\\s5 Body\\par}",
    );
    const blocks = doc.flows[0].blocks;
    expect(blocks[0]).toMatchObject({ signals: { role: "subtitle" } });
    expect(blocks[1]).toMatchObject({ signals: { headingLevel: 2 } });
    expect(blocks[2]).toMatchObject({ signals: { headingLevel: 3 } });
    expect(blocks[3]).toMatchObject({ signals: { styleName: "café" } });
  });

  it("counts shapes as text boxes and skips them, and keeps a tab as a space", async () => {
    const doc = await read(
      HEAD +
        "\\pard One\\tab two{\\shp{\\*\\shpinst{\\shptxt boxed}}}{\\shpgrp{\\shp x}} three\\par}",
    );
    expect(texts(doc.flows[0].blocks)).toEqual(["One two three"]);
    expect(doc.report).toMatchObject({ textBoxes: 2 });
  });

  it("steps over raw \\bin bytes even when they look like markup", async () => {
    // The four bytes are `{`, `\`, `}` and `\`; what follows is text again.
    const doc = await read(HEAD + "\\pard a\\bin4 {\\}\\b c\\par}");
    expect(texts(doc.flows[0].blocks)).toEqual(["ab c"]);
  });

  it("keeps a comment with no range on the point where it stands", async () => {
    const doc = await read(
      HEAD +
        "\\pard Here{\\*\\atnid A}{\\*\\atnauthor Ann}\\chatn{\\*\\annotation\\pard\\plain Note.} it is.\\par}",
    );
    expect(doc.comments[0]).toMatchObject({
      author: "Ann",
      anchor: { start: { offset: 4 }, end: { offset: 4 } },
    });
  });

  it("keeps a page break before a paragraph that carries a comment", async () => {
    const doc = await read(
      HEAD +
        "\\pard One.\\par\\page\\pard {\\*\\atrfstart 1}Chapter Two{\\*\\atrfend 1}{\\*\\atnid E}{\\*\\atnauthor Ed}\\chatn{\\*\\annotation{\\*\\atnref 1}\\pard\\plain Check.\\par More.}\\par\\pard Text.\\par}",
    );
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual(["One.", "Chapter Two", "Text."]);
    expect(
      blocks.map((b) => (b.kind === "para" ? !!b.signals.breakBefore : null)),
    ).toEqual([false, true, false]);
    expect(doc.comments).toHaveLength(1);
  });

  it("decodes raw 8-bit text by the code page, byte for byte", async () => {
    const doc = await read(
      HEAD +
        "\\pard It\x92s \x93fine\x94 \x96 caf\xe9\x85 \x80\\par\\pard {\\f2 \x9a\x8a}\\par}",
    );
    expect(texts(doc.flows[0].blocks)).toEqual(["It’s “fine” – café… €", "šŠ"]);
  });

  it("steps over a skipped group holding a word that starts with bin", async () => {
    const doc = await read(
      HEAD +
        "\\pard Before.\\par{\\*\\oldsprops \\binsxn1}\\pard After one.\\par\\pard After two.\\par}",
    );
    expect(texts(doc.flows[0].blocks)).toEqual([
      "Before.",
      "After one.",
      "After two.",
    ]);
  });

  it("decodes the title, the author and a comment's author by the code page", async () => {
    const doc = await read(
      HEAD +
        "{\\info{\\title L\\'92amica \x93geniale\x94}{\\author \\u321\\'3fukasz}}" +
        "\\pard Here{\\*\\atnid A}{\\*\\atnauthor \\uc1\\u321\\'3fukasz \\u8217\r\n\\'92}\\chatn{\\*\\annotation\\pard\\plain Note.} it is.\\par}",
    );
    expect(doc.meta.title).toBe("L’amica “geniale”");
    expect(doc.meta.author).toBe("Łukasz");
    expect(doc.comments[0].author).toBe("Łukasz ’");
  });

  it("does not count a line break as \\u's fallback character", async () => {
    const doc = await read(HEAD + "\\pard It\\u8217\r\n\\'92s\\par}");
    expect(texts(doc.flows[0].blocks)).toEqual(["It’s"]);
  });
});
