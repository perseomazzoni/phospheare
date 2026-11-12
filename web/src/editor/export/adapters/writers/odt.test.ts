// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { LAYOUT_IDS, PAGE_SIZES, type LayoutId } from "../../domain/layout";
import type { Block } from "../../domain/model";
import { odfText, odtWriter } from "./odt";
import {
  IN_TEXT_PAGE_BREAKS,
  NASTY_CLEAN,
  firstLocalEntry,
  hasForbidden,
  parseXml,
  testDoc,
  unzipText,
  type TestDocOptions,
} from "./document.fixture";

// ODF marks a new page on the paragraph that starts it, with
// `fo:break-before` or a change of master page, through an automatic style
// the paragraph names. The suite counts pages by resolving each paragraph's
// style rather than counting strings: a break style defined once and used by
// three paragraphs is three breaks.

const OFFICE = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
const STYLE = "urn:oasis:names:tc:opendocument:xmlns:style:1.0";
const TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
const FO = "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0";
const DC = "http://purl.org/dc/elements/1.1/";

async function open(options: TestDocOptions = {}) {
  const bytes = await odtWriter.write(testDoc(options));
  const files = unzipText(bytes);
  const part = (path: string) => parseXml(files[path], path);
  return {
    bytes,
    files,
    part,
    content: part("content.xml"),
    styles: part("styles.xml"),
  };
}

const all = (node: Document | Element, ns: string, tag: string) => [
  ...node.getElementsByTagNameNS(ns, tag),
];

/** The automatic styles of `content.xml`, by name. */
function automaticStyles(content: Document): Map<string, Element> {
  const auto = all(content, OFFICE, "automatic-styles")[0];
  return new Map(
    all(auto, STYLE, "style").map((style) => [
      style.getAttributeNS(STYLE, "name") ?? "",
      style,
    ]),
  );
}

/** The paragraphs of the text that begin a page, in order, with how. */
function pageStarts(content: Document) {
  const styles = automaticStyles(content);
  const text = all(content, OFFICE, "text")[0];
  return [...text.querySelectorAll("*")]
    .filter(
      (el) =>
        el.namespaceURI === TEXT &&
        (el.localName === "p" || el.localName === "h"),
    )
    .flatMap((el) => {
      const style = styles.get(el.getAttributeNS(TEXT, "style-name") ?? "");
      const props = style
        ? all(style, STYLE, "paragraph-properties")[0]
        : undefined;
      const master = style?.getAttributeNS(STYLE, "master-page-name") || null;
      const breaks = props?.getAttributeNS(FO, "break-before") === "page";
      return master || breaks
        ? [
            {
              master,
              breaks,
              pageNumber: props?.getAttributeNS(STYLE, "page-number") || null,
              text: el.textContent,
            },
          ]
        : [];
    });
}

/**
 * An element's text as an ODF reader shows it: `textContent` alone drops the
 * `text:s` elements that hold the spaces ODF would otherwise collapse.
 */
function odfPlain(node: Node): string {
  if (node.nodeType === node.TEXT_NODE) return node.nodeValue ?? "";
  const el = node as Element;
  if (el.namespaceURI === TEXT && el.localName === "s")
    return " ".repeat(Number(el.getAttributeNS(TEXT, "c") || 1));
  if (el.namespaceURI === TEXT && el.localName === "tab") return "\t";
  if (el.namespaceURI === TEXT && el.localName === "line-break") return "\n";
  return [...node.childNodes].map(odfPlain).join("");
}

/** A master page of `styles.xml`, by name. */
const master = (styles: Document, name: string) =>
  all(styles, STYLE, "master-page").find(
    (el) => el.getAttributeNS(STYLE, "name") === name,
  );

describe("the ODT package", () => {
  it("opens with `mimetype`, stored, reading the ODF text type", async () => {
    const { bytes } = await open();
    expect(firstLocalEntry(bytes)).toEqual({
      name: "mimetype",
      method: 0,
      data: "application/vnd.oasis.opendocument.text",
    });
  });

  it.each(LAYOUT_IDS)(
    "is well-formed XML in every part (%s)",
    async (layout) => {
      const { files } = await open({ layout });
      for (const path of Object.keys(files).filter((p) => p.endsWith(".xml")))
        expect(() => parseXml(files[path], path)).not.toThrow();
    },
  );

  it("lists in its manifest exactly the parts it carries", async () => {
    const { files, part } = await open();
    const paths = all(
      part("META-INF/manifest.xml"),
      "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0",
      "file-entry",
    ).map((entry) =>
      entry.getAttributeNS(
        "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0",
        "full-path",
      ),
    );
    expect(paths).toEqual(["/", "content.xml", "styles.xml", "meta.xml"]);
    for (const path of paths.slice(1)) expect(files[path ?? ""]).toBeDefined();
  });

  it("names the book and its author in meta.xml", async () => {
    const { part } = await open();
    const meta = part("meta.xml");
    expect(all(meta, DC, "title")[0].textContent).toBe("The <Book> & “Co”");
    expect(all(meta, DC, "creator")[0].textContent).toBe("Ann Writer");
  });
});

describe("the text", () => {
  it("keeps the writer's words, minus what XML forbids", async () => {
    const { content } = await open();
    const text = odfPlain(all(content, OFFICE, "text")[0]);
    expect(text).toContain(NASTY_CLEAN);
    expect(hasForbidden(text)).toBe(false);
  });

  it("sets an italic run in a text style that is italic", async () => {
    const { content } = await open();
    const span = all(content, TEXT, "span").find(
      (el) => el.textContent === "italic",
    );
    const style = automaticStyles(content).get(
      span?.getAttributeNS(TEXT, "style-name") ?? "",
    );
    expect(
      style &&
        all(style, STYLE, "text-properties")[0].getAttributeNS(
          FO,
          "font-style",
        ),
    ).toBe("italic");
  });

  it("names a defined style on every paragraph it does not style automatically", async () => {
    const { content, styles } = await open();
    const named = new Set([
      ...all(styles, STYLE, "style").map((el) =>
        el.getAttributeNS(STYLE, "name"),
      ),
      ...automaticStyles(content).keys(),
    ]);
    const used = [...all(content, TEXT, "p"), ...all(content, TEXT, "h")].map(
      (el) => el.getAttributeNS(TEXT, "style-name"),
    );
    for (const name of used) expect(named).toContain(name);
  });
});

describe("page structure", () => {
  it.each(LAYOUT_IDS)(
    "starts a page at every chapter and at the writer's own breaks (%s)",
    async (layout) => {
      const { content } = await open({ layout });
      const starts = pageStarts(content);
      // Every chapter starts a page, the first included, since that is how
      // the front matter's master is set; nothing follows the last chapter.
      expect(starts).toHaveLength(
        testDoc({ layout }).chapters.length + IN_TEXT_PAGE_BREAKS,
      );
      expect(starts[0].master).toBe("Front");
      expect(
        starts.slice(1).every((start) => start.breaks || start.master),
      ).toBe(true);
    },
  );

  it("starts the text on its own master, numbered from 1", async () => {
    const { content } = await open({ layout: "book" });
    const body = pageStarts(content).find((start) => start.master === "Body");
    expect(body).toMatchObject({ text: "Part One", pageNumber: "1" });
  });

  it("starts a story's text on the master with no running head", async () => {
    const { content, styles } = await open({
      layout: "manuscriptModern",
      story: true,
    });
    const first = pageStarts(content).find(
      (start) => start.master === "BodyFirst",
    );
    expect(first?.pageNumber).toBe("1");
    const bodyFirst = master(styles, "BodyFirst");
    expect(bodyFirst?.getAttributeNS(STYLE, "next-style-name")).toBe("Body");
    expect(all(bodyFirst as Element, TEXT, "page-number")).toHaveLength(0);
  });

  it.each(["manuscriptModern", "manuscriptClassic"] as const)(
    "gives a manuscript a running head with the page number (%s)",
    async (layout) => {
      const { styles } = await open({ layout });
      const header = all(master(styles, "Body") as Element, STYLE, "header")[0];
      expect(odfPlain(header)).toBe("Writer / The Book / 1");
      expect(all(header, TEXT, "page-number")).toHaveLength(1);
      expect(
        all(master(styles, "Body") as Element, STYLE, "footer"),
      ).toHaveLength(0);
    },
  );

  it("numbers a book's pages at the foot and the review copy's with its count", async () => {
    const book = (await open({ layout: "book" })).styles;
    const bookFooter = all(master(book, "Body") as Element, STYLE, "footer")[0];
    expect(all(bookFooter, TEXT, "page-number")).toHaveLength(1);
    expect(all(master(book, "Body") as Element, STYLE, "header")).toHaveLength(
      0,
    );

    const review = (await open({ layout: "review" })).styles;
    const reviewFooter = all(
      master(review, "Body") as Element,
      STYLE,
      "footer",
    )[0];
    expect(all(reviewFooter, TEXT, "page-count")).toHaveLength(1);
    expect(odfPlain(reviewFooter)).toBe("Draft · 1 October 2026 · page 1 of 1");
  });

  it("numbers lines in the review copy and nowhere else", async () => {
    for (const layout of LAYOUT_IDS) {
      const { styles } = await open({ layout });
      const config = all(styles, TEXT, "linenumbering-configuration")[0];
      expect(config.getAttributeNS(TEXT, "number-lines")).toBe(
        String(layout === "review"),
      );
    }
  });

  // The header and footer paragraph styles opt out of line numbering, or an
  // ODT reader numbers the review copy's footer as a line of text and the
  // margin's count starts in the furniture.
  it("never counts the header or the footer as lines of text", async () => {
    const { styles } = await open({ layout: "review" });
    for (const name of ["Header", "Footer"]) {
      const style = all(styles, STYLE, "style").find(
        (candidate) => candidate.getAttributeNS(STYLE, "name") === name,
      );
      const props = all(style as Element, STYLE, "paragraph-properties")[0];
      expect(props.getAttributeNS(TEXT, "number-lines")).toBe("false");
    }
  });

  it.each([
    ["book", "trade", "mirrored"],
    ["review", "letter", "all"],
  ] as [LayoutId, "trade" | "letter", string][])(
    "sizes the page and mirrors only a trim book (%s on %s)",
    async (layout, page, usage) => {
      const { styles } = await open({ layout, page });
      const pageLayout = all(styles, STYLE, "page-layout").find(
        (el) => el.getAttributeNS(STYLE, "name") === "PMBody",
      ) as Element;
      expect(pageLayout.getAttributeNS(STYLE, "page-usage")).toBe(usage);
      const props = all(pageLayout, STYLE, "page-layout-properties")[0];
      expect(props.getAttributeNS(FO, "page-width")).toBe(
        `${PAGE_SIZES[page].width}pt`,
      );
      expect(props.getAttributeNS(FO, "page-height")).toBe(
        `${PAGE_SIZES[page].height}pt`,
      );
    },
  );
});

describe("breaks and lists", () => {
  /** The test book with its one long chapter's blocks replaced. */
  const withBlocks = async (blocks: Block[]) => {
    const doc = testDoc();
    doc.chapters[3] = { ...doc.chapters[3], blocks };
    const files = unzipText(await odtWriter.write(doc));
    return { doc, content: parseXml(files["content.xml"]) };
  };
  const para = (text: string): Block => ({
    kind: "paragraph",
    inlines: [{ text }],
    align: "left",
  });

  it("keeps a page break that falls just before a list, which cannot carry one itself", async () => {
    const { doc, content } = await withBlocks([
      para("before"),
      { kind: "pageBreak" },
      { kind: "list", ordered: false, start: 1, items: [[para("item")]] },
    ]);
    expect(pageStarts(content)).toHaveLength(doc.chapters.length + 1);
  });

  // `listXml` writes every list-item child with its text, so a quote inside
  // a list item (`- > words`, ordinary in a reference) keeps its words in the
  // ODT as it does in the other formats.
  it("keeps a quote's text inside a list item", async () => {
    const { content } = await withBlocks([
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [
          [para("item"), { kind: "quote", blocks: [para("quoted in a list")] }],
        ],
      },
    ]);
    expect(odfPlain(all(content, OFFICE, "text")[0])).toContain(
      "quoted in a list",
    );
  });
});

describe("odfText", () => {
  it("writes runs of spaces, tabs and line breaks as elements ODF will not collapse", () => {
    expect(odfText("a  b")).toBe(`a <text:s text:c="1"/>b`);
    expect(odfText(" lead")).toBe("<text:s/>lead");
    expect(odfText("a\tb\nc")).toBe("a<text:tab/>b<text:line-break/>c");
    expect(odfText("<&>")).toBe("&lt;&amp;&gt;");
  });
});
