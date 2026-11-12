// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { blockText, type SourceBlock } from "../../domain/source";
import { epubReader } from "./epub";
import { epubOf, zipOf, type EpubParts } from "./packages.fixture";

const ctx = { yield: async () => undefined };
const read = (parts: EpubParts) =>
  epubReader.read(epubOf(parts), "book.epub", ctx);
const texts = (blocks: SourceBlock[]) =>
  blocks.map((b) => (b.kind === "para" ? blockText(b) : `<${b.kind}>`));

describe("epubReader", () => {
  it("reads the spine in order, with the nav's titles and the package's facts", async () => {
    const doc = await read({
      title: "Once Dark",
      creator: "Ada Byron",
      language: "it",
      chapters: [
        {
          file: "c2.xhtml",
          body: "<h1>Two</h1><p>Second.</p>",
          navTitle: "Chapter Two",
        },
        {
          file: "c1.xhtml",
          body: "<h1>One</h1><p>First <em>now</em>.</p>",
          navTitle: "Chapter One",
        },
      ],
    });
    expect(doc.flows.map((f) => [f.name, f.navTitle])).toEqual([
      ["OEBPS/c2.xhtml", "Chapter Two"],
      ["OEBPS/c1.xhtml", "Chapter One"],
    ]);
    expect(texts(doc.flows[1].blocks)).toEqual(["One", "First now."]);
    expect(doc.flows[1].blocks[1]).toMatchObject({
      inlines: [
        { text: "First " },
        { text: "now", italic: true },
        { text: "." },
      ],
    });
    expect(doc.meta).toEqual({
      title: "Once Dark",
      author: "Ada Byron",
      language: "it",
    });
  });

  it("reads an EPUB 2 NCX when there is no nav", async () => {
    const doc = await read({
      ncx: true,
      chapters: [{ file: "a.xhtml", body: "<p>x</p>", navTitle: "Prologue" }],
    });
    expect(doc.flows[0].navTitle).toBe("Prologue");
  });

  it('marks linear="no" items and gives a flow the role its epub:type says', async () => {
    const doc = await read({
      chapters: [
        { file: "cr.xhtml", body: "<p>© 2026</p>", type: "copyright-page" },
        { file: "aside.xhtml", body: "<p>Map</p>", linear: false },
        {
          file: "c1.xhtml",
          body: '<section epub:type="chapter"><p>Text</p></section>',
        },
      ],
    });
    expect(doc.flows.map((f) => [f.role ?? null, f.linear ?? true])).toEqual([
      ["copyright", true],
      [null, false],
      [null, true],
    ]);
  });

  it("parses a chapter that is not well-formed XML as HTML instead of refusing it", async () => {
    const doc = await read({
      chapters: [{ file: "c.xhtml", body: "<p>One&nbsp;two<br>three</p>" }],
    });
    expect(texts(doc.flows[0].blocks)).toEqual(["One two", "three"]);
  });

  it("keeps an endnote in another file out of the text, and counts it", async () => {
    const doc = await read({
      chapters: [
        {
          file: "c1.xhtml",
          body: '<p>Word<a epub:type="noteref" href="notes.xhtml#n1">1</a> on.</p>',
        },
        {
          file: "notes.xhtml",
          body: '<section epub:type="endnotes"><h2>Notes</h2><ol><li id="n1"><p>The note.</p></li></ol></section>',
        },
      ],
    });
    expect(texts(doc.flows[0].blocks)).toEqual(["Word on."]);
    // The reference leaves no mark and the body is not read as a comment: the
    // project has no place for an endnote, so it is only counted.
    expect(doc.comments).toEqual([]);
    expect(doc.report).toMatchObject({ endnotes: 1 });
    // The notes page keeps its heading, as matter the preview leaves out.
    expect(texts(doc.flows[1].blocks)).toEqual(["Notes"]);
    expect(doc.flows[1].role).toBe("notes");
  });

  it("refuses DRM, but not font obfuscation", async () => {
    const enc = (algorithm: string) =>
      `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/></enc:EncryptedData></encryption>`;
    await expect(
      read({
        chapters: [{ file: "c.xhtml", body: "<p>x</p>" }],
        extra: {
          "META-INF/encryption.xml": enc(
            "http://www.w3.org/2001/04/xmlenc#aes128-cbc",
          ),
        },
      }),
    ).rejects.toMatchObject({ reason: "drm" });
    const ok = await read({
      chapters: [{ file: "c.xhtml", body: "<p>x</p>" }],
      extra: {
        "META-INF/encryption.xml": enc("http://www.idpf.org/2008/embedding"),
      },
    });
    expect(texts(ok.flows[0].blocks)).toEqual(["x"]);
  });

  it("calls a zip with no package document damaged", async () => {
    await expect(
      epubReader.read(
        zipOf({ "META-INF/container.xml": "<container/>" }),
        "x.epub",
        ctx,
      ),
    ).rejects.toMatchObject({ reason: "damaged" });
  });

  it("refuses an ebook with a rights file, which only DRM writes", async () => {
    await expect(
      read({
        chapters: [{ file: "c.xhtml", body: "<p>x</p>" }],
        extra: { "META-INF/rights.xml": "<rights/>" },
      }),
    ).rejects.toMatchObject({ reason: "drm" });
  });

  it("calls a package with no spine, or nothing readable in it, damaged", async () => {
    const container =
      '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="p.opf"/></rootfiles></container>';
    const opf = (inner: string) =>
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/>${inner}</package>`;
    const open = (files: Record<string, string>) =>
      epubReader.read(zipOf(files), "x.epub", ctx);
    await expect(
      open({ mimetype: "application/epub+zip" }),
    ).rejects.toMatchObject({
      reason: "damaged",
    });
    await expect(
      open({
        "META-INF/container.xml": container,
        "p.opf": opf("<manifest/>"),
      }),
    ).rejects.toMatchObject({ reason: "damaged" });
    // A spine whose items are missing from the manifest, or from the zip.
    await expect(
      open({
        "META-INF/container.xml": container,
        "p.opf": opf(
          '<manifest><item id="a" href="gone.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="nobody"/></spine>',
        ),
      }),
    ).rejects.toMatchObject({ reason: "damaged" });
  });
});
