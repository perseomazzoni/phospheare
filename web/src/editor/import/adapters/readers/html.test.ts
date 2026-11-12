// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { blockText, type SourceBlock } from "../../domain/source";
import { htmlReader } from "./html";

const ctx = { yield: async () => undefined };
const read = (html: string) =>
  htmlReader.read(new TextEncoder().encode(html), "page.html", ctx);
const texts = (blocks: SourceBlock[]) =>
  blocks.map((b) => (b.kind === "para" ? blockText(b) : `<${b.kind}>`));

describe("htmlReader", () => {
  it("keeps an online word processor's italics, which live in class rules, not tags", async () => {
    const doc = await read(
      `<html><head><style>.c3{font-style:italic}.c4{font-weight:700}.c5{text-align:center}</style></head>
       <body><p class="c5"><span>She was </span><span class="c3">certain</span><span class="c4"> now</span>.</p></body></html>`,
    );
    const [para] = doc.flows[0].blocks;
    expect(para).toMatchObject({
      align: "center",
      inlines: [
        { text: "She was " },
        { text: "certain", italic: true },
        { text: " now", bold: true },
        { text: "." },
      ],
    });
    expect(doc.report).toMatchObject({ italic: 1, bold: 1 });
  });

  it("reads Docs' title, subtitle and comments, and only counts its footnotes", async () => {
    const doc = await read(
      `<body>
        <p class="title"><span>Once Dark</span></p>
        <p class="subtitle"><span>A novel</span></p>
        <h1>One</h1>
        <p><span>The storm came</span><sup><a href="#ftnt1" id="ftnt_ref1">[1]</a></sup><span> at dawn.</span><a href="#cmnt1" id="cmnt_ref1">[a]</a></p>
        <hr>
        <div><p><a href="#ftnt_ref1" id="ftnt1">[1]</a><span> In 1947.</span></p></div>
        <div><p><a href="#cmnt_ref1" id="cmnt1">[a]</a><span>Too early?</span></p></div>
      </body>`,
    );
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual([
      "Once Dark",
      "A novel",
      "One",
      "The storm came at dawn.",
      "<rule>",
    ]);
    expect(blocks[0]).toMatchObject({ signals: { role: "title" } });
    expect(blocks[1]).toMatchObject({ signals: { role: "subtitle" } });
    expect(blocks[2]).toMatchObject({ signals: { headingLevel: 1 } });
    // The footnote leaves no mark and no body: only the comment is a note.
    expect(doc.comments).toEqual([
      expect.objectContaining({
        sourceId: "cmnt1",
        anchor: expect.objectContaining({ start: { block: 3, offset: 23 } }),
      }),
    ]);
    expect(doc.report).toMatchObject({ footnotes: 1, comments: 1 });
  });

  it("reads Word's web page: MsoTitle and outline levels", async () => {
    const doc = await read(
      `<body><p class="MsoTitle">The Book</p><p style="mso-outline-level:2">Part Two</p><p class="MsoNormal">&nbsp;</p><p class="MsoNormal">Text.</p></body>`,
    );
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual(["The Book", "Part Two", "", "Text."]);
    expect(blocks[0]).toMatchObject({ signals: { role: "title" } });
    expect(blocks[1]).toMatchObject({ signals: { headingLevel: 2 } });
  });

  it("reads our own export back: chapters, scene breaks, page breaks, blanks", async () => {
    const doc = await read(
      `<html lang="it"><head><title>Once Dark</title><meta name="author" content="Ada"></head><body>
        <section class="chapter chapter-title"><h1>Once Dark</h1><p>Ada</p></section>
        <section class="chapter chapter-section"><h2 id="c1-title">One</h2><p>Before.</p>
          <p class="scene-break" role="separator">* * *</p><p class="blank">&#160;</p><p>After.</p>
          <div class="page-break"></div><p>Next page.</p></section>
      </body></html>`,
    );
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual([
      "Once Dark",
      "Ada",
      "One",
      "Before.",
      "* * *",
      "",
      "After.",
      "<pageBreak>",
      "Next page.",
    ]);
    expect(blocks[0]).toMatchObject({
      signals: { role: "titlePage", breakBefore: true },
    });
    expect(blocks[2]).toMatchObject({
      signals: { headingLevel: 2, breakBefore: true },
    });
    expect(doc.meta).toEqual({
      title: "Once Dark",
      author: "Ada",
      language: "it",
    });
  });

  it("keeps script and handlers inert: they arrive as nothing, or as text", async () => {
    const doc = await read(
      `<body><script>window.pwned = 1</script><p>&lt;img src=x onerror=alert(1)&gt;</p><p><img src="x" onerror="window.pwned=2">Pic</p></body>`,
    );
    expect(texts(doc.flows[0].blocks)).toEqual([
      "<img src=x onerror=alert(1)>",
      "Pic",
    ]);
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
    expect(doc.report).toMatchObject({ images: 1 });
  });

  it("splits a paragraph at <br>, flattens lists and tables, and counts them", async () => {
    const doc = await read(
      `<body><p>One<br>Two</p><ul><li>a</li><li>b<ul><li>c</li></ul></li></ul><table><tr><td>x</td><td>y</td></tr></table><blockquote><p>q</p></blockquote><pre>l1\nl2</pre><p><a href="https://x">link</a> <s>gone</s></p></body>`,
    );
    const blocks = doc.flows[0].blocks;
    expect(texts(blocks)).toEqual([
      "One",
      "Two",
      "a",
      "b",
      "c",
      "x",
      "y",
      "q",
      "l1",
      "l2",
      "link gone",
    ]);
    expect(blocks[2]).toMatchObject({ signals: { origin: "list" } });
    expect(blocks[5]).toMatchObject({ signals: { origin: "table" } });
    expect(blocks[7]).toMatchObject({ signals: { origin: "quote" } });
    expect(blocks[8]).toMatchObject({ signals: { origin: "code" } });
    expect(doc.report).toMatchObject({
      lists: 1,
      tables: 1,
      quotes: 1,
      links: 1,
      strike: 1,
    });
  });

  it("leaves hidden text out and says so", async () => {
    const doc = await read(
      `<head><style>.h{display:none}</style></head><body><p>Seen</p><p class="h">Unseen</p><p hidden>Also</p></body>`,
    );
    expect(texts(doc.flows[0].blocks)).toEqual(["Seen"]);
    expect(doc.report).toMatchObject({ hiddenText: 2 });
  });

  it("decodes by the charset the page declares", async () => {
    const head = new TextEncoder().encode('<meta charset="windows-1252"><p>It');
    const bytes = new Uint8Array([...head, 0x92, 0x73]);
    const doc = await htmlReader.read(bytes, "a.htm", ctx);
    expect(texts(doc.flows[0].blocks)).toEqual(["It’s"]);
  });

  it("steps over epub-style notes: noteref, aside, and a note nobody cites", async () => {
    const doc = await read(
      `<body><p>Word<a epub:type="noteref" href="#fn1">1</a> end.</p>
       <aside epub:type="footnote" id="fn1"><p>The note.</p></aside>
       <aside epub:type="endnote" id="en9"><p>Orphan.</p></aside></body>`,
    );
    expect(texts(doc.flows[0].blocks)).toEqual(["Word end."]);
    expect(doc.comments).toEqual([]);
    expect(doc.report).toMatchObject({ footnotes: 1, endnotes: 1 });
  });

  it("reads formatting from tags and inline styles alike", async () => {
    const doc = await read(
      `<body><p><u>under</u> <ins>added</ins> <code>c</code><tt>t</tt><kbd>k</kbd><samp>s</samp>
       <cite>Ulysses</cite> <span style="font-style:italic;font-weight:bold">both</span>
       <span style="text-decoration:underline">lined</span> <span style="font-family:Courier New">mono</span>
       <span style="text-decoration:line-through">gone</span> <s>struck</s>
       <em style="font-style:normal">upright</em> <a href="https://example.com">link</a></p></body>`,
    );
    const [para] = doc.flows[0].blocks;
    if (para.kind !== "para") throw new Error("not a paragraph");
    const of = (text: string) => para.inlines.find((i) => i.text === text);
    expect(of("under")).toMatchObject({ underline: true });
    expect(of("added")).toMatchObject({ underline: true });
    expect(of("ctks")).toMatchObject({ mono: true });
    expect(of("Ulysses")).toMatchObject({ italic: true });
    expect(of("both")).toMatchObject({ italic: true, bold: true });
    expect(of("lined")).toMatchObject({ underline: true });
    expect(of("mono")).toMatchObject({ mono: true });
    expect(of("upright")?.italic).toBeUndefined();
    expect(doc.report).toMatchObject({ strike: 2, links: 1 });
  });

  it("reads a block's alignment, size, capitals and breaks from its markup", async () => {
    const doc = await read(
      `<body><center><p>Centred</p></center>
       <p align="right">Right</p>
       <p style="font-size:24px;text-transform:uppercase">Big</p>
       <div class="page-break"></div>
       <p style="page-break-after:always">Before a break</p>
       <p>After it</p>
       <hr style="page-break-before:always"/>
       <p>And another</p>
       <p class="subtitle">A subtitle</p>
       <p style="display:none">Hidden</p><p style="visibility:hidden"> </p></body>`,
    );
    const all = doc.flows[0].blocks;
    // A page-break element and a breaking `<hr>` are breaks of their own; a
    // break-after marks the paragraph that follows.
    expect(texts(all)).toEqual([
      "Centred",
      "Right",
      "Big",
      "<pageBreak>",
      "Before a break",
      "After it",
      "<pageBreak>",
      "And another",
      "A subtitle",
    ]);
    const blocks = all.filter((b) => b.kind === "para");
    expect(blocks[0]).toMatchObject({ align: "center" });
    expect(blocks[1]).toMatchObject({ align: "right" });
    expect(blocks[2]).toMatchObject({
      signals: { fontSizePt: 18, allCaps: true },
    });
    expect(blocks[4]).toMatchObject({ signals: { breakBefore: true } });
    expect(blocks[6]).toMatchObject({ signals: { role: "subtitle" } });
    // An empty hidden element hides nothing worth counting.
    expect(doc.report).toMatchObject({ hiddenText: 1 });
  });

  it("finds notes by list containers, by their ids, and under a superscript, and keeps them out", async () => {
    const doc = await read(
      `<body><p>One<a epub:type="noteref" href="#n1">1</a> two<sup><a href="#footnote-2">2</a></sup>
       three<a epub:type="noteref" href="#e1">i</a> four<a href="#nowhere">x</a>.</p>
       <section epub:type="footnotes"><ol><li id="n1"><p>First <em>note</em>.</p><p>Its second paragraph.</p></li></ol></section>
       <div id="footnote-2"><p>Second note. <a epub:type="backlink" href="#r2">back</a></p></div>
       <section epub:type="rearnotes"><ol><li id="e1"><p>An endnote.</p></li><li id="e2"><p>Uncited.</p></li></ol></section></body>`,
    );
    expect(texts(doc.flows[0].blocks)).toEqual(["One two three fourx."]);
    // Every body was found, so none of their words reached the text, and
    // each is counted, none kept.
    expect(doc.comments).toEqual([]);
    expect(doc.report).toMatchObject({ footnotes: 2, endnotes: 2 });
  });

  it("takes the language from xml:lang or a content-language header when there is no lang", async () => {
    const doc = await read(
      `<html><head><meta http-equiv="Content-Language" content="it"><meta name="author" content="Ada"></head><body><p>Ciao.</p></body></html>`,
    );
    expect(doc.meta).toMatchObject({ language: "it", author: "Ada" });
  });
});
