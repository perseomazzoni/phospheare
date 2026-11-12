// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { blockText, type SourceBlock } from "../../domain/source";
import { odtReader } from "./odt";
import { odtOf, zipOf, type OdtParts } from "./packages.fixture";

const ctx = { yield: async () => undefined };
const read = (parts: OdtParts) => odtReader.read(odtOf(parts), "book.odt", ctx);
const texts = (blocks: SourceBlock[]) =>
  blocks.map((b) => (b.kind === "para" ? blockText(b) : `<${b.kind}>`));

const COMMON = `
  <style:default-style style:family="paragraph"><style:text-properties fo:language="it" fo:country="IT"/></style:default-style>
  <style:style style:name="Standard" style:family="paragraph"/>
  <style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Standard"/>
  <style:style style:name="Title" style:family="paragraph"/>
  <style:style style:name="Emphasis" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
  <style:style style:name="Quote" style:family="paragraph"><style:text-properties fo:font-style="italic"/></style:style>`;

describe("odtReader", () => {
  it("reads headings by outline level and style, and the title", async () => {
    const doc = await read({
      styles: COMMON,
      text: `<text:p text:style-name="Title">Once Dark</text:p>
        <text:h text:style-name="Heading_20_1" text:outline-level="1">One</text:h>
        <text:p text:style-name="Heading_20_1">Two</text:p>
        <text:p text:style-name="Standard">Body.</text:p>`,
    });
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual(["Once Dark", "One", "Two", "Body."]);
    expect(blocks[0]).toMatchObject({ signals: { role: "title" } });
    expect(blocks[1]).toMatchObject({ signals: { headingLevel: 1 } });
    expect(blocks[2]).toMatchObject({ signals: { headingLevel: 1 } });
    expect(doc.meta.language).toBe("it-IT");
  });

  it("resolves italics through automatic and common styles, without toggling", async () => {
    const doc = await read({
      styles: COMMON,
      automatic: `<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
        <style:style style:name="P1" style:family="paragraph" style:parent-style-name="Quote"/>`,
      text: `<text:p>She was <text:span text:style-name="Emphasis">sure</text:span> and <text:span text:style-name="T1">loud</text:span>.</text:p>
        <text:p text:style-name="P1">Dear <text:span text:style-name="Emphasis">Anna</text:span></text:p>`,
    });
    const blocks = doc.flows[0].blocks;
    expect(blocks[0]).toMatchObject({
      inlines: [
        { text: "She was " },
        { text: "sure", italic: true },
        { text: " and " },
        { text: "loud", bold: true },
        { text: "." },
      ],
    });
    // ODF does not toggle: an italic span in an italic paragraph stays italic.
    expect(blocks[1]).toMatchObject({
      inlines: [{ text: "Dear Anna", italic: true }],
    });
  });

  it("breaks pages on break-before, break-after and a change of master page, never a soft break", async () => {
    const doc = await read({
      automatic: `<style:style style:name="PB" style:family="paragraph"><style:paragraph-properties fo:break-before="page"/></style:style>
        <style:style style:name="PA" style:family="paragraph"><style:paragraph-properties fo:break-after="page"/></style:style>
        <style:style style:name="M1" style:family="paragraph" style:master-page-name="Standard"/>
        <style:style style:name="M2" style:family="paragraph" style:master-page-name="Chapter"/>`,
      text: `<text:p text:style-name="M1">First.</text:p>
        <text:p>Same<text:soft-page-break/> page.</text:p>
        <text:p text:style-name="PB">Broken before.</text:p>
        <text:p text:style-name="PA">Broken after.</text:p>
        <text:p>Next.</text:p>
        <text:p text:style-name="M2">New master.</text:p>`,
    });
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual([
      "First.",
      "Same page.",
      "Broken before.",
      "Broken after.",
      "Next.",
      "New master.",
    ]);
    expect(
      blocks.map((b) => (b.kind === "para" ? !!b.signals.breakBefore : null)),
    ).toEqual([false, false, true, false, true, true]);
  });

  it("expands spaces and tabs, splits at line breaks, drops the table of contents", async () => {
    const doc = await read({
      text: `<text:table-of-content><text:index-body><text:p>One ..... 1</text:p></text:index-body></text:table-of-content>
        <text:p>a<text:s text:c="3"/>b<text:tab/>c<text:line-break/>d</text:p>`,
    });
    expect(texts(doc.flows[0].blocks)).toEqual(["a b c", "d"]);
  });

  it("accepts tracked changes: deletions are never read as text", async () => {
    const doc = await read({
      text: `<text:tracked-changes><text:changed-region text:id="c1"><text:deletion><text:p>walked</text:p></text:deletion></text:changed-region></text:tracked-changes>
        <text:p>She <text:change text:change-id="c1"/>ran.</text:p>`,
    });
    expect(texts(doc.flows[0].blocks)).toEqual(["She ran."]);
    expect(doc.report).toMatchObject({ trackedChanges: 1 });
  });

  it("reads ranged comments, and counts footnotes and endnotes without keeping them", async () => {
    const doc = await read({
      text: `<text:p>The <office:annotation office:name="a1"><dc:creator>Ed</dc:creator><dc:date>2026-01-01</dc:date><text:p>Which?</text:p></office:annotation>storm<office:annotation-end office:name="a1"/><text:note text:id="ftn1" text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>In 1947.</text:p></text:note-body></text:note> came<text:note text:id="e1" text:note-class="endnote"><text:note-citation>i</text:note-citation><text:note-body><text:p>Later.</text:p></text:note-body></text:note>.</text:p>`,
    });
    expect(texts(doc.flows[0].blocks)).toEqual(["The storm came."]);
    // Only the comment is a note: a footnote's citation and body stay out of
    // the text, and nothing else of it is kept.
    expect(doc.comments.map((n) => n.sourceId)).toEqual(["as:a1"]);
    expect(doc.comments[0]).toMatchObject({
      author: "Ed",
      body: [[{ text: "Which?" }]],
      anchor: { start: { offset: 4 }, end: { offset: 9 } },
    });
    expect(doc.report).toMatchObject({
      footnotes: 1,
      endnotes: 1,
      comments: 1,
    });
  });

  it("reads a nested table's text once", async () => {
    const T = 'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"';
    const doc = await read({
      text: `<text:p>Before</text:p>
        <table:table ${T}><table:table-header-rows><table:table-row><table:table-cell><text:p>Head</text:p></table:table-cell></table:table-row></table:table-header-rows>
          <table:table-row><table:table-cell><text:p>Outer</text:p>
            <table:table><table:table-row><table:table-cell><text:p>Inner</text:p></table:table-cell></table:table-row></table:table>
          </table:table-cell><table:covered-table-cell/></table:table-row>
          <table:table-row-group><table:table-rows><table:table-row><table:table-cell><text:p>Grouped</text:p></table:table-cell></table:table-row></table:table-rows></table:table-row-group>
        </table:table>
        <text:p>After</text:p>`,
    });
    expect(texts(doc.flows[0].blocks)).toEqual([
      "Before",
      "Head",
      "Outer",
      "Inner",
      "Grouped",
      "After",
    ]);
  });

  it("flattens lists and tables, counts frames, and reads meta.xml", async () => {
    const doc = await read({
      text: `<text:list><text:list-item><text:p>item</text:p></text:list-item></text:list>
        <table:table xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"><table:table-row><table:table-cell><text:p>cell</text:p></table:table-cell></table:table-row></table:table>
        <text:p><draw:frame xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"/>Pic</text:p>`,
      meta: { title: "Once Dark", creator: "Ada", language: "en-GB" },
    });
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual(["item", "cell", "Pic"]);
    expect(blocks[0]).toMatchObject({ signals: { origin: "list" } });
    expect(blocks[1]).toMatchObject({ signals: { origin: "table" } });
    expect(doc.report).toMatchObject({ lists: 1, tables: 1, images: 1 });
    expect(doc.meta).toEqual({
      title: "Once Dark",
      author: "Ada",
      language: "en-GB",
    });
  });

  it("reads every text property that carries meaning, and alignment", async () => {
    const doc = await read({
      automatic: `
        <style:style style:name="T1" style:family="text"><style:text-properties fo:font-style="oblique" fo:font-weight="700"/></style:style>
        <style:style style:name="T2" style:family="text"><style:text-properties style:text-underline-style="solid"/></style:style>
        <style:style style:name="T3" style:family="text"><style:text-properties fo:text-transform="uppercase"/></style:style>
        <style:style style:name="T4" style:family="text"><style:text-properties fo:font-variant="small-caps"/></style:style>
        <style:style style:name="T5" style:family="text"><style:text-properties text:display="none"/></style:style>
        <style:style style:name="T6" style:family="text"><style:text-properties fo:font-weight="normal" style:text-underline-style="none"/></style:style>
        <style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:text-align="justify"/></style:style>
        <style:style style:name="P2" style:family="paragraph"><style:paragraph-properties fo:text-align="start"/></style:style>`,
      text: `<text:p text:style-name="P1"><text:span text:style-name="T1">both</text:span> <text:span text:style-name="T2">under</text:span> <text:span text:style-name="T6">plain</text:span> <text:a xlink:href="https://example.com">link</text:a><text:span text:style-name="T5">hidden</text:span></text:p>
        <text:p text:style-name="P2"><text:span text:style-name="T3">LOUD</text:span></text:p>
        <text:p><text:span text:style-name="T4">Small</text:span></text:p>
        <text:p><text:span text:style-name="T5">only hidden</text:span></text:p>`,
    });
    const blocks = doc.flows[0].blocks;
    // The paragraph that held only hidden text is gone, not a blank line.
    expect(texts(blocks)).toEqual(["both under plain link", "LOUD", "Small"]);
    expect(blocks[0]).toMatchObject({
      align: "justify",
      inlines: [
        { text: "both", italic: true, bold: true },
        { text: " " },
        { text: "under", underline: true },
        { text: " plain link" },
      ],
    });
    expect(blocks[1]).toMatchObject({
      align: "left",
      signals: { allCaps: true },
    });
    expect(blocks[2]).toMatchObject({ signals: { allCaps: true } });
    expect(doc.report).toMatchObject({ links: 1, hiddenText: 2 });
  });

  it("leaves no empty paragraph where a frame stood alone", async () => {
    const doc = await read({
      styles: COMMON,
      text: `<text:p>One</text:p>
        <text:p><draw:frame><draw:text-box><text:p>boxed</text:p></draw:text-box></draw:frame></text:p>
        <text:p><draw:frame><draw:image/></draw:frame></text:p>
        <text:p>Two</text:p>`,
    });
    expect(texts(doc.flows[0].blocks)).toEqual(["One", "boxed", "Two"]);
    expect(doc.report).toMatchObject({ images: 1 });
  });

  it("reads list headers, sections, index bodies and text boxes as text, and a subtitle by name", async () => {
    const doc = await read({
      styles:
        COMMON +
        '<style:style style:name="Subtitle" style:family="paragraph"/>',
      text: `<text:p text:style-name="Subtitle">A beginning</text:p>
        <text:list><text:list-header><text:p>Header</text:p></text:list-header></text:list>
        <text:section><text:p>In a section.</text:p></text:section>
        <text:alphabetical-index><text:index-body><text:p>Index entry</text:p></text:index-body></text:alphabetical-index>
        <text:index-body><text:p>Loose index body</text:p></text:index-body>
        <text:p><draw:frame><draw:text-box><text:p>boxed</text:p></draw:text-box></draw:frame>Framed</text:p>
        <draw:frame><draw:text-box><text:p>loose box</text:p></draw:text-box></draw:frame>
        <text:h>No level</text:h>
        <text:p>a<text:s/>b<text:s text:c="x"/>c</text:p>`,
    });
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual([
      "A beginning",
      "Header",
      "In a section.",
      // An alphabetical index is generated, like a table of contents.
      "Loose index body",
      "Framed",
      // A text box comes after the paragraph it is anchored in.
      "boxed",
      "loose box",
      "No level",
      "a b c",
    ]);
    expect(blocks[0]).toMatchObject({ signals: { role: "subtitle" } });
    expect(blocks[1]).toMatchObject({ signals: { origin: "list" } });
    expect(blocks[7]).toMatchObject({ signals: { headingLevel: 1 } });
    expect(texts(blocks)).not.toContain("Index entry");
    expect(doc.report.textBoxes).toBeUndefined();
  });

  it("refuses a package with no text body", async () => {
    await expect(
      odtReader.read(
        zipOf({ "content.xml": "<office:document-content/>" }),
        "book.odt",
        ctx,
      ),
    ).rejects.toMatchObject({ reason: "damaged" });
    await expect(
      odtReader.read(zipOf({ mimetype: "x" }), "book.odt", ctx),
    ).rejects.toMatchObject({ reason: "damaged" });
  });
});
