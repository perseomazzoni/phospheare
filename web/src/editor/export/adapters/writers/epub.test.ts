// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { tocEntries } from "../../domain/model";
import { epubWriter, identifierOf } from "./epub";
import { isoSeconds } from "./xml";
import { PRODUCT } from "../../../../product";
import {
  NASTY_CLEAN,
  firstLocalEntry,
  parseXml,
  testDoc,
  unzipText,
} from "./document.fixture";

// A validator rejects an EPUB whole, so the suite walks the package as
// EPUBCheck does: from the stored `mimetype`, through `container.xml` to the
// package document, and from the manifest and spine to the files they name.
// Every cross-reference is resolved, not just present, because a spine
// itemref pointing at nothing fails upload.

const OPF_NS = "http://www.idpf.org/2007/opf";
const DC_NS = "http://purl.org/dc/elements/1.1/";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const OPS_NS = "http://www.idpf.org/2007/ops";

async function open(doc = testDoc()) {
  const bytes = await epubWriter.write(doc);
  return { bytes, files: unzipText(bytes) };
}

/** The meta elements of the OPF with this `property`, by text. */
const metas = (opf: Document, property: string) =>
  [...opf.getElementsByTagNameNS(OPF_NS, "meta")]
    .filter((meta) => meta.getAttribute("property") === property)
    .map((meta) => meta.textContent);

describe("the EPUB package", () => {
  it("opens with `mimetype`, stored, reading application/epub+zip", async () => {
    const { bytes } = await open();
    expect(firstLocalEntry(bytes)).toEqual({
      name: "mimetype",
      method: 0,
      data: "application/epub+zip",
    });
  });

  it("is well-formed XML in every part", async () => {
    const { files } = await open();
    const xmlParts = Object.keys(files).filter((path) =>
      /\.(xml|opf|ncx|xhtml)$/.test(path),
    );
    expect(xmlParts.length).toBeGreaterThan(5);
    for (const path of xmlParts)
      expect(() => parseXml(files[path], path)).not.toThrow();
  });

  it("points container.xml at a package document that exists", async () => {
    const { files } = await open();
    const container = parseXml(files["META-INF/container.xml"]);
    const rootfile = container.getElementsByTagName("rootfile")[0];
    expect(rootfile.getAttribute("media-type")).toBe(
      "application/oebps-package+xml",
    );
    expect(files[rootfile.getAttribute("full-path") ?? ""]).toBeDefined();
  });
});

describe("the package document", () => {
  it("carries the required metadata, the identifier it names as unique among it", async () => {
    const { files } = await open();
    const opf = parseXml(files["OEBPS/content.opf"]);
    const pkg = opf.documentElement;
    expect(pkg.getAttribute("version")).toBe("3.0");
    const identifier = opf.getElementsByTagNameNS(DC_NS, "identifier")[0];
    expect(identifier.getAttribute("id")).toBe(
      pkg.getAttribute("unique-identifier"),
    );
    expect(identifier.textContent).toBe(
      "urn:uuid:3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    );
    expect(opf.getElementsByTagNameNS(DC_NS, "title")[0].textContent).toBe(
      "The <Book> & “Co”",
    );
    expect(opf.getElementsByTagNameNS(DC_NS, "language")[0].textContent).toBe(
      "en",
    );
    expect(opf.getElementsByTagNameNS(DC_NS, "creator")[0].textContent).toBe(
      "Ann Writer",
    );
    // Seconds, no fraction, UTC: the one form EPUBCheck accepts.
    expect(metas(opf, "dcterms:modified")).toEqual(["2026-10-01T14:32:05Z"]);
  });

  it("describes its accessibility, as an EU sale expects", async () => {
    const { files } = await open();
    const opf = parseXml(files["OEBPS/content.opf"]);
    expect(metas(opf, "schema:accessMode")).toEqual(["textual"]);
    expect(metas(opf, "schema:accessModeSufficient")).toEqual(["textual"]);
    expect(metas(opf, "schema:accessibilityFeature")).toEqual(
      expect.arrayContaining(["structuralNavigation", "tableOfContents"]),
    );
    expect(metas(opf, "schema:accessibilityHazard")).toEqual(["none"]);
    expect(metas(opf, "schema:accessibilitySummary")[0]).toBeTruthy();
  });

  // Assistive software reads the summary aloud, so it comes from the locale
  // like every other word in the file, and is escaped.
  it("carries the summary the book's language gave it", async () => {
    const doc = testDoc();
    doc.meta.accessibilitySummary = "Testo & titoli <navigabili>";
    const opf = parseXml((await open(doc)).files["OEBPS/content.opf"]);
    expect(metas(opf, "schema:accessibilitySummary")).toEqual([
      "Testo & titoli <navigabili>",
    ]);
  });

  it("has unique manifest ids, every href a file, every itemref an item", async () => {
    const { files } = await open();
    const opf = parseXml(files["OEBPS/content.opf"]);
    const items = [...opf.getElementsByTagNameNS(OPF_NS, "item")];
    const ids = items.map((item) => item.getAttribute("id"));
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of items)
      expect(files[`OEBPS/${item.getAttribute("href")}`]).toBeDefined();
    const itemrefs = [...opf.getElementsByTagNameNS(OPF_NS, "itemref")].map(
      (ref) => ref.getAttribute("idref"),
    );
    for (const idref of itemrefs) expect(ids).toContain(idref);
    // The spine is the book's reading order, one chapter file each.
    expect(itemrefs).toEqual(testDoc().chapters.map((chapter) => chapter.id));
    expect(
      items
        .find((item) => item.getAttribute("properties") === "nav")
        ?.getAttribute("href"),
    ).toBe("nav.xhtml");
  });
});

describe("navigation", () => {
  it("has a nav document with a toc nav whose links all land", async () => {
    const { files } = await open();
    const nav = parseXml(files["OEBPS/nav.xhtml"]);
    const toc = [...nav.getElementsByTagNameNS(XHTML_NS, "nav")].find(
      (el) => el.getAttributeNS(OPS_NS, "type") === "toc",
    );
    expect(toc).toBeDefined();
    const hrefs = [...(toc?.getElementsByTagNameNS(XHTML_NS, "a") ?? [])].map(
      (a) => a.getAttribute("href") ?? "",
    );
    expect(hrefs).toHaveLength(tocEntries(testDoc()).length);
    for (const href of hrefs) {
      const [file, fragment] = href.split("#");
      const target = parseXml(files[`OEBPS/${file}`], file);
      expect(target.getElementById(fragment)).not.toBeNull();
    }
  });

  it("keeps an NCX beside it for older readers, every point landing in a file", async () => {
    const { files } = await open();
    const ncx = parseXml(files["OEBPS/toc.ncx"]);
    const sources = [...ncx.getElementsByTagName("content")].map(
      (content) => content.getAttribute("src") ?? "",
    );
    expect(sources).toHaveLength(tocEntries(testDoc()).length);
    for (const src of sources)
      expect(files[`OEBPS/${src.split("#")[0]}`]).toBeDefined();
  });

  it("lists the tech page when it is the only thing exported, never an empty nav", async () => {
    const doc = testDoc();
    const { files } = await open({
      ...doc,
      chapters: doc.chapters.slice(0, 1),
    });
    const nav = parseXml(files["OEBPS/nav.xhtml"]);
    expect(nav.getElementsByTagNameNS(XHTML_NS, "li")).toHaveLength(1);
  });
});

describe("the chapter files", () => {
  it("keeps ids unique within each file and the text escaped, never markup", async () => {
    const { files } = await open();
    const all = Object.keys(files).filter((path) =>
      /OEBPS\/c\d+\.xhtml$/.test(path),
    );
    expect(all).toHaveLength(testDoc().chapters.length);
    let text = "";
    for (const path of all) {
      const page = parseXml(files[path], path);
      const ids = [...page.querySelectorAll("[id]")].map((el) => el.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(page.getElementsByTagNameNS(XHTML_NS, "script")).toHaveLength(0);
      text += page.documentElement.textContent;
    }
    expect(text).toContain(NASTY_CLEAN);
  });

  it("prints the scene break as a glyph, never an empty element", async () => {
    const { files } = await open();
    const page = parseXml(files["OEBPS/c4.xhtml"]);
    const breaks = page.querySelectorAll(".scene-break");
    expect(breaks).toHaveLength(1);
    expect(breaks[0].textContent?.trim()).not.toBe("");
  });
});

describe("identifierOf, and the modified date", () => {
  it("makes a UUID a lower-case urn:uuid and anything else a URN under the product's name", () => {
    expect(identifierOf("ABCDEF01-2345-6789-ABCD-EF0123456789")).toBe(
      "urn:uuid:abcdef01-2345-6789-abcd-ef0123456789",
    );
    expect(identifierOf("my book")).toBe(`urn:${PRODUCT.kebab}:book:my%20book`);
  });

  it("drops the milliseconds EPUB does not allow", () => {
    expect(isoSeconds("2026-10-01T14:32:05.999Z")).toBe("2026-10-01T14:32:05Z");
  });
});
