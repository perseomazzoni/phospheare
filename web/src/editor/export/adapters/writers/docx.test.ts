// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  LAYOUT_IDS,
  PAGE_SIZES,
  PAGE_SIZE_IDS,
  type LayoutId,
  type PageSizeId,
} from "../../domain/layout";
import { docxWriter } from "./docx";
import {
  IN_TEXT_PAGE_BREAKS,
  NASTY_CLEAN,
  hasForbidden,
  parseXml,
  testDoc,
  unzipText,
  type TestDocOptions,
} from "./document.fixture";

// A .docx is read after the writer by an editor who restyles it and a book
// formatter who imports it, and both read styles and page structure, not
// appearance. The suite reads the package's XML as a word processor does, by
// namespace, relationship id and style id, and resolves every reference it
// finds.

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

async function open(options: TestDocOptions = {}) {
  const files = unzipText(await docxWriter.write(testDoc(options)));
  const part = (path: string) => parseXml(files[path], path);
  return { files, part, document: part("word/document.xml") };
}

const all = (node: Document | Element, tag: string) => [
  ...node.getElementsByTagNameNS(W, tag),
];
const val = (el: Element | undefined) => el?.getAttributeNS(W, "val") ?? null;

/** The section properties that close the document: the text's own. */
const bodySect = (document: Document) => {
  const body = all(document, "body")[0];
  const last = body.lastElementChild;
  if (last?.localName !== "sectPr") throw new Error("no final sectPr");
  return last;
};

describe("the DOCX package", () => {
  it("has no mimetype, and its content types name every part that exists", async () => {
    const { files, part } = await open();
    expect(files.mimetype).toBeUndefined();
    const overrides = [
      ...part("[Content_Types].xml").getElementsByTagName("Override"),
    ];
    expect(overrides.length).toBeGreaterThan(0);
    for (const override of overrides)
      expect(
        files[(override.getAttribute("PartName") ?? "").slice(1)],
      ).toBeDefined();
    expect(files["word/document.xml"]).toBeDefined();
    expect(files["word/styles.xml"]).toBeDefined();
  });

  it.each(LAYOUT_IDS)(
    "is well-formed XML in every part (%s)",
    async (layout) => {
      const { files } = await open({ layout });
      for (const path of Object.keys(files).filter((p) =>
        /\.(xml|rels)$/.test(p),
      ))
        expect(() => parseXml(files[path], path)).not.toThrow();
    },
  );

  it("resolves every internal relationship to a part and every hyperlink to its address", async () => {
    const { files, part, document } = await open();
    const rels = [
      ...part("word/_rels/document.xml.rels").getElementsByTagName(
        "Relationship",
      ),
    ];
    const byId = new Map(rels.map((rel) => [rel.getAttribute("Id"), rel]));
    for (const rel of rels.filter(
      (r) => r.getAttribute("TargetMode") !== "External",
    ))
      expect(files[`word/${rel.getAttribute("Target")}`]).toBeDefined();
    const links = all(document, "hyperlink").map((link) => {
      const rel = byId.get(link.getAttributeNS(R, "id"));
      expect(rel?.getAttribute("TargetMode")).toBe("External");
      return rel?.getAttribute("Target");
    });
    expect(links).toEqual([
      "https://example.com/a?b=1&c=2",
      "mailto:ann@example.com",
    ]);
  });

  it("names the book and its author in the core properties", async () => {
    const { part } = await open();
    const core = part("docProps/core.xml");
    const dc = "http://purl.org/dc/elements/1.1/";
    expect(core.getElementsByTagNameNS(dc, "title")[0].textContent).toBe(
      "The <Book> & “Co”",
    );
    expect(core.getElementsByTagNameNS(dc, "creator")[0].textContent).toBe(
      "Ann Writer",
    );
  });
});

describe("the text", () => {
  it("keeps the writer's words, minus what XML forbids", async () => {
    const { document } = await open();
    const text = all(document, "t")
      .map((t) => t.textContent)
      .join("");
    expect(text).toContain(NASTY_CLEAN);
    expect(hasForbidden(text)).toBe(false);
  });

  it("marks italic and bold runs in their run properties", async () => {
    const { document } = await open();
    const run = (text: string) =>
      all(document, "r").find((r) =>
        all(r, "t").some((t) => t.textContent === text),
      );
    expect(all(run("italic") as Element, "i")).toHaveLength(1);
    expect(all(run("bold") as Element, "b")).toHaveLength(1);
    expect(all(run("both") as Element, "i")).toHaveLength(1);
    expect(all(run("struck") as Element, "strike")).toHaveLength(1);
  });

  it("styles every paragraph by name, and every name it uses is defined", async () => {
    const { document, part } = await open();
    const defined = new Set(
      all(part("word/styles.xml"), "style").map((style) =>
        style.getAttributeNS(W, "styleId"),
      ),
    );
    const used = all(document, "p").map((p) => val(all(p, "pStyle")[0]));
    expect(used).not.toContain(null);
    for (const style of used) expect(defined).toContain(style);
    // The named styles a formatter maps on import, all in use.
    expect(used).toEqual(
      expect.arrayContaining([
        "Heading1",
        "Heading2",
        "BodyFirst",
        "Normal",
        "SceneBreak",
        "Quote",
        "Code",
        "ListParagraph",
        "Fact",
        "TOC1",
      ]),
    );
  });

  it("restarts an ordered list at its own start", async () => {
    const { part } = await open();
    const overrides = all(part("word/numbering.xml"), "startOverride");
    expect(overrides.map((el) => val(el))).toEqual(["3"]);
  });
});

describe("page structure", () => {
  it.each(LAYOUT_IDS)(
    "breaks the page once per chapter boundary, plus the writer's own (%s)",
    async (layout) => {
      const { document } = await open({ layout });
      const chapters = testDoc({ layout }).chapters.length;
      const pageBreaks = all(document, "br").filter(
        (br) => br.getAttributeNS(W, "type") === "page",
      ).length;
      // The front matter's own section ends on a new page: that boundary is
      // the break there, so it counts once and gets no break run on top.
      const sectionBreaks = all(document, "pPr").filter((pPr) =>
        all(pPr, "sectPr").some(
          (sect) => val(all(sect, "type")[0]) === "nextPage",
        ),
      ).length;
      expect(sectionBreaks).toBe(1);
      expect(pageBreaks + sectionBreaks).toBe(
        chapters - 1 + IN_TEXT_PAGE_BREAKS,
      );
      // Nothing after the last chapter: no trailing blank page.
      const paragraphs = all(document, "p");
      expect(all(paragraphs[paragraphs.length - 1], "br")).toHaveLength(0);
    },
  );

  it.each(
    LAYOUT_IDS.flatMap((layout) =>
      PAGE_SIZE_IDS.map((page) => [layout, page] as [LayoutId, PageSizeId]),
    ),
  )("sets the page size in twips (%s on %s)", async (layout, page) => {
    const { document } = await open({ layout, page });
    for (const pgSz of all(document, "pgSz")) {
      expect(pgSz.getAttributeNS(W, "w")).toBe(
        String(Math.round(PAGE_SIZES[page].width * 20)),
      );
      expect(pgSz.getAttributeNS(W, "h")).toBe(
        String(Math.round(PAGE_SIZES[page].height * 20)),
      );
    }
  });

  it("restarts page numbering at the text, leaving the front unnumbered", async () => {
    const { document } = await open();
    expect(
      all(bodySect(document), "pgNumType")[0].getAttributeNS(W, "start"),
    ).toBe("1");
    const front = all(document, "pPr").flatMap((pPr) => all(pPr, "sectPr"));
    expect(front).toHaveLength(1);
    expect(all(front[0], "headerReference")).toHaveLength(0);
    expect(all(front[0], "footerReference")).toHaveLength(0);
  });

  it.each(["manuscriptModern", "manuscriptClassic"] as const)(
    "gives a manuscript a running head with a PAGE field (%s)",
    async (layout) => {
      const { document, files, part } = await open({ layout });
      const refs = all(bodySect(document), "headerReference");
      expect(refs.map((ref) => ref.getAttributeNS(W, "type"))).toEqual([
        "default",
      ]);
      const header = part("word/header1.xml");
      expect(
        all(header, "instrText").map((el) => el.textContent?.trim()),
      ).toEqual(["PAGE"]);
      expect(files["word/header1.xml"]).toContain("Writer / The Book / ");
      // Shunn: no page number at the foot of a manuscript.
      expect(all(bodySect(document), "footerReference")).toHaveLength(0);
    },
  );

  it("leaves a story's first text page without the running head", async () => {
    const { document } = await open({
      layout: "manuscriptModern",
      story: true,
    });
    const sect = bodySect(document);
    expect(
      all(sect, "headerReference").map((ref) => ref.getAttributeNS(W, "type")),
    ).toEqual(["default", "first"]);
    expect(all(sect, "titlePg")).toHaveLength(1);
  });

  it("numbers the lines of the review copy, and only the review copy", async () => {
    for (const layout of LAYOUT_IDS) {
      const { document } = await open({ layout });
      expect(all(bodySect(document), "lnNumType")).toHaveLength(
        layout === "review" ? 1 : 0,
      );
    }
  });

  it("puts the draft line with page and count fields in the review footer", async () => {
    const { part, files } = await open({ layout: "review" });
    const footer = part("word/footer1.xml");
    expect(
      all(footer, "instrText").map((el) => el.textContent?.trim()),
    ).toEqual(["PAGE", "NUMPAGES"]);
    expect(files["word/footer1.xml"]).toContain(
      "Draft · 1 October 2026 · page ",
    );
  });

  it("numbers a book's pages at the foot, with no running head", async () => {
    const { document } = await open({ layout: "book" });
    expect(all(bodySect(document), "headerReference")).toHaveLength(0);
    expect(all(bodySect(document), "footerReference")).toHaveLength(1);
  });

  it("mirrors a trim book's margins and lets Word rebuild the contents", async () => {
    const { part } = await open({ layout: "book", page: "trade" });
    const settings = part("word/settings.xml");
    expect(all(settings, "mirrorMargins")).toHaveLength(1);
    expect(val(all(settings, "updateFields")[0])).toBe("true");
  });
});
