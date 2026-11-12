// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { blockText, type SourceBlock } from "../../domain/source";
import { docxReader } from "./docx";
import { docxOf, wp, wr, type DocxParts } from "./packages.fixture";

const ctx = { yield: async () => undefined };
const read = (parts: DocxParts) =>
  docxReader.read(docxOf(parts), "book.docx", ctx);
const texts = (blocks: SourceBlock[]) =>
  blocks.map((b) => (b.kind === "para" ? blockText(b) : `<${b.kind}>`));

const HEADING_STYLES = `
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Titolo1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="ChapterTitle"><w:name w:val="Chapter Title"/><w:basedOn w:val="Titolo1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
  <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:rPr><w:i/></w:rPr></w:style>
  <w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:rPr><w:i/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>`;

describe("docxReader", () => {
  it("keeps italics that live in a character style, with Word's toggle rule", async () => {
    const doc = await read({
      styles: HEADING_STYLES,
      body:
        wp(
          wr("She was ") + wr("sure", '<w:rStyle w:val="Emphasis"/>') + wr("."),
        ) +
        // In an italic paragraph style, Emphasis turns italic off.
        wp(
          wr("Dear ") + wr("Anna", '<w:rStyle w:val="Emphasis"/>'),
          '<w:pStyle w:val="Quote"/>',
        ) +
        // Direct formatting is absolute.
        wp(wr("plain", '<w:rStyle w:val="Emphasis"/><w:i w:val="0"/>')),
    });
    const blocks = doc.flows[0].blocks;
    expect(blocks[0]).toMatchObject({
      inlines: [
        { text: "She was " },
        { text: "sure", italic: true },
        { text: "." },
      ],
    });
    expect(blocks[1]).toMatchObject({
      inlines: [{ text: "Dear ", italic: true }, { text: "Anna" }],
    });
    expect(
      (blocks[1] as { inlines: { italic?: boolean }[] }).inlines[1].italic,
    ).toBeFalsy();
    expect(
      (blocks[2] as { inlines: { italic?: boolean }[] }).inlines[0].italic,
    ).toBeFalsy();
  });

  it("finds headings by style name and inherited outline level, never by id", async () => {
    const doc = await read({
      styles: HEADING_STYLES,
      body:
        wp(wr("Once Dark"), '<w:pStyle w:val="Title"/>') +
        wp(wr("One"), '<w:pStyle w:val="Titolo1"/>') +
        wp(wr("Two"), '<w:pStyle w:val="ChapterTitle"/>') +
        wp(wr("Three"), '<w:outlineLvl w:val="1"/>') +
        wp(wr("Body")),
    });
    expect(
      doc.flows[0].blocks.map((b) => (b.kind === "para" ? b.signals : null)),
    ).toEqual([
      { styleName: "title", role: "title" },
      { styleName: "heading 1", headingLevel: 1 },
      { styleName: "chapter title", headingLevel: 1 },
      { styleName: "normal", headingLevel: 2 },
      { styleName: "normal" },
    ]);
  });

  it("reads page breaks three ways and ignores Word's last layout", async () => {
    const doc = await read({
      styles: HEADING_STYLES,
      body:
        wp(wr("End of one.")) +
        wp('<w:r><w:br w:type="page"/></w:r>') +
        wp(wr("Two begins.")) +
        wp(wr("Three."), "<w:pageBreakBefore/>") +
        wp(
          wr("Section ends."),
          '<w:sectPr><w:type w:val="nextPage"/></w:sectPr>',
        ) +
        wp(wr("Four.")) +
        wp(
          "<w:r><w:t>Same</w:t><w:lastRenderedPageBreak/><w:t> page.</w:t></w:r>",
        ) +
        wp('<w:r><w:t>Before</w:t><w:br w:type="page"/><w:t>after</w:t></w:r>'),
    });
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual([
      "End of one.",
      "Two begins.",
      "Three.",
      "Section ends.",
      "Four.",
      "Same page.",
      "Before",
      "after",
    ]);
    const breaks = blocks.map((b) =>
      b.kind === "para" ? !!b.signals.breakBefore : null,
    );
    expect(breaks).toEqual([
      false,
      true,
      true,
      false,
      true,
      false,
      false,
      true,
    ]);
  });

  it("drops a table of contents, as a field or as a content control", async () => {
    const doc = await read({
      styles: HEADING_STYLES,
      body:
        wp(
          '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> TOC \\o "1-3" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
            wr("Chapter One\t3"),
          '<w:pStyle w:val="TOC1"/>',
        ) +
        wp(wr("Chapter Two\t9"), '<w:pStyle w:val="TOC1"/>') +
        wp('<w:r><w:fldChar w:fldCharType="end"/></w:r>') +
        '<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/></w:docPartObj></w:sdtPr><w:sdtContent>' +
        wp(wr("Contents")) +
        wp(wr("One ..... 1")) +
        "</w:sdtContent></w:sdt>" +
        wp(wr("Chapter One"), '<w:pStyle w:val="Titolo1"/>'),
    });
    expect(texts(doc.flows[0].blocks)).toEqual(["Chapter One"]);
  });

  it("keeps a field's result and drops its instruction, nested or not", async () => {
    const doc = await read({
      body: wp(
        wr("See ") +
          '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>HYPERLINK "x"</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
          wr("the map") +
          '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
          wr("."),
      ),
    });
    expect(texts(doc.flows[0].blocks)).toEqual(["See the map."]);
  });

  it("accepts tracked changes and says how many", async () => {
    const doc = await read({
      body: wp(
        wr("She ") +
          `<w:del><w:r><w:delText>walked</w:delText></w:r></w:del>` +
          `<w:ins>${wr("ran")}</w:ins>` +
          wr("."),
      ),
    });
    expect(texts(doc.flows[0].blocks)).toEqual(["She ran."]);
    expect(doc.report).toMatchObject({ trackedChanges: 2 });
  });

  it("reads AlternateContent once, through its fallback, counts the picture and keeps a text box as text", async () => {
    const doc = await read({
      body: wp(
        wr("Text") +
          '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing/></mc:Choice><mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:r>' +
          "<w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>boxed</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r>",
      ),
    });
    expect(texts(doc.flows[0].blocks)).toEqual(["Text", "boxed"]);
    expect(doc.report).toMatchObject({ images: 1 });
    expect(doc.report.textBoxes).toBeUndefined();
  });

  it("leaves no empty paragraph where a text box or picture stood alone", async () => {
    // An empty paragraph between two of prose would read as a scene break.
    const doc = await read({
      body:
        wp(wr("One")) +
        wp(
          "<w:r><w:drawing><w:txbxContent>" +
            wp(wr("boxed")) +
            "</w:txbxContent></w:drawing></w:r>",
        ) +
        wp("<w:r><w:drawing/></w:r>") +
        wp(wr("Two")),
    });
    expect(texts(doc.flows[0].blocks)).toEqual(["One", "boxed", "Two"]);
    expect(doc.report).toMatchObject({ images: 1 });
  });

  it("reads Strict OOXML, whose namespace is different", async () => {
    const doc = await read({
      ns: 'xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main"',
      body: wp(wr("Strict ") + wr("italic", '<w:i w:val="true"/>')),
    });
    expect(doc.flows[0].blocks[0]).toMatchObject({
      inlines: [{ text: "Strict " }, { text: "italic", italic: true }],
    });
  });

  it("reads comments with replies and resolved state, and only counts footnotes and endnotes", async () => {
    const doc = await read({
      body: wp(
        wr("The ") +
          '<w:commentRangeStart w:id="1"/>' +
          wr("storm") +
          '<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>' +
          '<w:r><w:footnoteReference w:id="2"/></w:r>' +
          wr(" came") +
          '<w:r><w:endnoteReference w:id="3"/></w:r>' +
          wr("."),
      ),
      footnotes:
        '<w:footnote w:type="separator" w:id="-1"><w:p/></w:footnote><w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> In 1947.</w:t></w:r></w:p></w:footnote>',
      endnotes:
        '<w:endnote w:id="3"><w:p><w:r><w:t>Later.</w:t></w:r></w:p></w:endnote>',
      comments:
        '<w:comment w:id="1" w:author="Ed" w:initials="E" w:date="2026-01-01T00:00:00Z"><w:p w14:paraId="AA"><w:r><w:t>Which storm?</w:t></w:r></w:p></w:comment>' +
        '<w:comment w:id="5" w:author="Ada"><w:p w14:paraId="BB"><w:r><w:t>The big one.</w:t></w:r></w:p></w:comment>',
      commentsExtended:
        '<w15:commentEx w15:paraId="AA" w15:done="1"/><w15:commentEx w15:paraId="BB" w15:paraIdParent="AA"/>',
    });
    expect(texts(doc.flows[0].blocks)).toEqual(["The storm came."]);
    // The footnote and endnote parts are in the package and never opened:
    // the two are counted from their references, and only comments are kept.
    expect(doc.comments.map((n) => n.sourceId)).toEqual(["c:1", "c:5"]);
    const byId = Object.fromEntries(doc.comments.map((n) => [n.sourceId, n]));
    expect(byId["c:1"]).toMatchObject({
      author: "Ed",
      initials: "E",
      resolved: true,
      anchor: { start: { block: 0, offset: 4 }, end: { block: 0, offset: 9 } },
    });
    expect(byId["c:5"]).toMatchObject({ parentId: "c:1", author: "Ada" });
    expect(doc.report).toMatchObject({
      footnotes: 1,
      endnotes: 1,
      comments: 1,
      replies: 1,
    });
  });

  it("takes the book's facts from core.xml and its language from the defaults", async () => {
    const doc = await read({
      body: wp(wr("x")),
      core: { title: "Once Dark", creator: "Ada Byron" },
      styles:
        '<w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="it-IT"/></w:rPr></w:rPrDefault></w:docDefaults>',
    });
    expect(doc.meta).toEqual({
      title: "Once Dark",
      author: "Ada Byron",
      language: "it-IT",
    });
  });

  it("leaves hidden text out, counts it, and flattens tables and lists", async () => {
    const doc = await read({
      body:
        wp(wr("Seen") + wr(" secret", "<w:vanish/>")) +
        "<w:tbl><w:tr><w:tc>" +
        wp(wr("cell")) +
        "</w:tc></w:tr></w:tbl>" +
        wp(
          wr("item"),
          '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr>',
        ),
    });
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual(["Seen", "cell", "item"]);
    expect(blocks[1]).toMatchObject({ signals: { origin: "table" } });
    expect(blocks[2]).toMatchObject({ signals: { origin: "list" } });
    expect(doc.report).toMatchObject({ hiddenText: 1, tables: 1, lists: 1 });
  });

  it("reads table rows and cells wrapped in a content control or custom XML", async () => {
    const doc = await read({
      body:
        wp(wr("Before")) +
        "<w:tbl><w:tr><w:tc>" +
        wp(wr("Row one")) +
        "</w:tc></w:tr><w:sdt><w:sdtPr/><w:sdtContent><w:tr><w:tc>" +
        wp(wr("Row in sdt")) +
        "</w:tc><w:sdt><w:sdtContent><w:tc>" +
        wp(wr("Cell in sdt")) +
        "</w:tc></w:sdtContent></w:sdt></w:tr></w:sdtContent></w:sdt>" +
        "<w:customXml><w:tr><w:customXml><w:tc>" +
        wp(wr("Custom")) +
        "</w:tc></w:customXml></w:tr></w:customXml></w:tbl>" +
        wp(wr("After")),
    });
    expect(texts(doc.flows[0].blocks)).toEqual([
      "Before",
      "Row one",
      "Row in sdt",
      "Cell in sdt",
      "Custom",
      "After",
    ]);
  });

  it("drops a paragraph whose every word is hidden, keeping its page break", async () => {
    const doc = await read({
      body:
        wp(wr("Before.")) +
        wp(wr("secret", "<w:vanish/>"), "<w:pageBreakBefore/>") +
        wp(wr("After.")),
    });
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual(["Before.", "After."]);
    expect(blocks[1]).toMatchObject({ signals: { breakBefore: true } });
  });

  it("records a paragraph's size and capitals for detection", async () => {
    const doc = await read({
      body: wp(wr("CHAPTER ONE", '<w:caps/><w:sz w:val="36"/>')),
    });
    expect(doc.flows[0].blocks[0]).toMatchObject({
      signals: { fontSizePt: 18, allCaps: true },
    });
  });

  it("reads through the wrappers Word puts around text", async () => {
    const doc = await read({
      body:
        // A block content control, a custom-XML block and a moved paragraph.
        `<w:sdt><w:sdtContent>${wp(wr("In a control."))}</w:sdtContent></w:sdt>` +
        `<w:customXml>${wp(wr("In custom XML."))}</w:customXml>` +
        `<w:ins>${wp(wr("Inserted."))}</w:ins>` +
        `<w:moveTo>${wp(wr("Moved here."))}</w:moveTo>` +
        `<w:del>${wp(wr("Deleted."))}</w:del>` +
        `<mc:AlternateContent><mc:Choice Requires="w14">${wp(wr("New Word."))}</mc:Choice><mc:Fallback>${wp(wr("Old Word."))}</mc:Fallback></mc:AlternateContent>` +
        // And inline: a link, a smart tag, bidi wrappers, an inline control,
        // a simple field and inline AlternateContent.
        wp(
          `<w:hyperlink r:id="x">${wr("a link")}</w:hyperlink>` +
            `<w:smartTag>${wr(" tagged")}</w:smartTag>` +
            `<w:dir>${wr(" dir")}</w:dir><w:bdo>${wr(" bdo")}</w:bdo>` +
            `<w:sdt><w:sdtContent>${wr(" control")}</w:sdtContent></w:sdt>` +
            `<w:fldSimple w:instr=" PAGE ">${wr(" 7")}</w:fldSimple>` +
            `<mc:AlternateContent><mc:Choice>${wr(" new")}</mc:Choice><mc:Fallback>${wr(" old")}</mc:Fallback></mc:AlternateContent>`,
        ),
    });
    expect(texts(doc.flows[0].blocks)).toEqual([
      "In a control.",
      "In custom XML.",
      "Inserted.",
      "Moved here.",
      "Old Word.",
      "a link tagged dir bdo control 7 old",
    ]);
    expect(doc.report).toMatchObject({ links: 1, trackedChanges: 3 });
  });

  it("drops a table of contents written as a simple field", async () => {
    const doc = await read({
      body:
        wp(
          `<w:fldSimple w:instr=' TOC \\o "1-3" '>${wr("Chapter 1 .... 3")}</w:fldSimple>`,
        ) + wp(wr("The text.")),
    });
    expect(texts(doc.flows[0].blocks)).toEqual(["The text."]);
  });

  it("reads breaks, symbols and special hyphens inside a run", async () => {
    const doc = await read({
      body: wp(
        "<w:r><w:t>one</w:t><w:br/><w:t>two</w:t><w:cr/><w:t>three</w:t>" +
          '<w:br w:type="column"/><w:t xml:space="preserve"> still</w:t>' +
          "<w:noBreakHyphen/><w:t>three</w:t>" +
          '<w:sym w:font="Wingdings" w:char="F04A"/><w:sym w:char="2014"/><w:t>end</w:t></w:r>',
      ),
    });
    // A column break is layout; a symbol-font glyph means nothing elsewhere.
    expect(texts(doc.flows[0].blocks)).toEqual([
      "one",
      "two",
      "three still-three—end",
    ]);
  });

  it("tells a text box from a picture inside AlternateContent, reading the box once", async () => {
    const doc = await read({
      body: wp(
        wr("Text") +
          '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing/></mc:Choice><mc:Fallback><w:pict><w:txbxContent><w:p><w:r><w:t>boxed</w:t></w:r></w:p></w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r>' +
          "<w:r><w:object/></w:r>",
      ),
    });
    expect(texts(doc.flows[0].blocks)).toEqual(["Text", "boxed"]);
    expect(doc.report).toMatchObject({ images: 1 });
    expect(doc.report.textBoxes).toBeUndefined();
  });

  it("marks a subtitle and a contents heading by their style names", async () => {
    const doc = await read({
      styles:
        HEADING_STYLES +
        '<w:style w:type="paragraph" w:styleId="Sub"><w:name w:val="Subtitle"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/></w:style>',
      body:
        wp(wr("A beginning"), '<w:pStyle w:val="Sub"/>') +
        wp(wr("Contents"), '<w:pStyle w:val="TOCHeading"/>'),
    });
    const blocks = doc.flows[0].blocks;
    expect(blocks[0]).toMatchObject({ signals: { role: "subtitle" } });
    expect(blocks[1]).toMatchObject({ signals: { role: "toc" } });
  });

  it("refuses a package with no document body", async () => {
    await expect(
      docxReader.read(docxOf({ body: "" }).slice(0, 0), "book.docx", ctx),
    ).rejects.toBeTruthy();
  });
});
