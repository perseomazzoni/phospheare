// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { LAYOUTS, headingStyle } from "../../domain/layout";
import { tocEntries } from "../../domain/model";
import {
  blocksToHtml,
  chapterToHtml,
  inlinesToHtml,
  nestedList,
  stylesheet,
  tocTree,
} from "./markup";
import { NASTY_CLEAN, parseXml, testDoc } from "./document.fixture";

// Pins the markup the HTML file and the EPUB share. Every row parses the
// output as XML, because an EPUB content document that is not well-formed is
// rejected whole, and string matching would pass a `<p>` that never closes.

const book = LAYOUTS.book;
const review = LAYOUTS.review;

/** The fragment, wrapped so it parses as one element. */
const parse = (html: string) =>
  parseXml(`<root>${html}</root>`).documentElement;

describe("inlinesToHtml", () => {
  it("nests a run's marks with the link outermost", () => {
    expect(
      inlinesToHtml([
        {
          text: "x",
          bold: true,
          italic: true,
          mono: true,
          strike: true,
          href: "https://example.com",
        },
      ]),
    ).toBe(
      `<a href="https://example.com"><strong><em><del><code>x</code></del></em></strong></a>`,
    );
  });

  it("escapes text and href, and turns a line break into <br/>", () => {
    const html = inlinesToHtml([
      { text: "a<b\nc" },
      { text: "l", href: "https://e.com/?a=1&b=2" },
    ]);
    expect(html).toBe(`a&lt;b<br/>c<a href="https://e.com/?a=1&amp;b=2">l</a>`);
  });
});

describe("blocksToHtml", () => {
  const section = testDoc().chapters[3];

  it("is well-formed, and keeps the writer's text minus the forbidden characters", () => {
    const root = parse(blocksToHtml(section.blocks, book));
    expect(root.textContent).toContain(NASTY_CLEAN);
    expect(root.textContent).not.toContain("\u0001");
    expect(root.getElementsByTagName("script")).toHaveLength(0);
  });

  it("marks openers and writes a blank paragraph as a visible non-breaking space", () => {
    const root = parse(blocksToHtml(section.blocks, book));
    const paragraphs = [...root.getElementsByTagName("p")];
    expect(paragraphs.some((el) => el.getAttribute("class") === "opener")).toBe(
      true,
    );
    // An empty `<p>` collapses to nothing in every reader; the blank line the
    // writer left still takes a line.
    const blank = paragraphs.find((el) => el.getAttribute("class") === "blank");
    expect(blank?.textContent).toBe("\u00A0");
  });

  it("aligns by the layout: justify survives a book and becomes left in the review copy", () => {
    const styles = (layout: typeof book) =>
      [...parse(blocksToHtml(section.blocks, layout)).getElementsByTagName("p")]
        .map((el) => el.getAttribute("style"))
        .filter(Boolean);
    expect(styles(book)).toEqual([
      "text-align:center",
      "text-align:right",
      "text-align:justify",
    ]);
    expect(styles(review)).toEqual(["text-align:center", "text-align:right"]);
  });

  it("writes an ordered list's start only when it is not 1, and nests lists in items", () => {
    const root = parse(blocksToHtml(section.blocks, book));
    const ol = root.getElementsByTagName("ol")[0];
    expect(ol.getAttribute("start")).toBe("3");
    expect(
      ol.getElementsByTagName("li")[1].getElementsByTagName("ul"),
    ).toHaveLength(1);
    expect(
      blocksToHtml(
        [
          {
            kind: "list",
            ordered: true,
            start: 1,
            items: [
              [{ kind: "paragraph", inlines: [{ text: "a" }], align: "left" }],
            ],
          },
        ],
        book,
      ),
    ).toMatch(/^<ol>/);
  });

  it("prints the layout's scene glyph, never an empty element", () => {
    for (const layout of [book, review]) {
      const breaks = [
        ...parse(blocksToHtml(section.blocks, layout)).getElementsByTagName(
          "p",
        ),
      ].filter((el) => el.getAttribute("class") === "scene-break");
      expect(breaks).toHaveLength(1);
      expect(breaks[0].textContent).toBe(layout.sceneGlyph);
    }
  });

  it("escapes code, and writes facts as a definition list", () => {
    expect(blocksToHtml([{ kind: "code", text: "a < b && c" }], book)).toBe(
      "<pre><code>a &lt; b &amp;&amp; c</code></pre>",
    );
    const facts = parse(blocksToHtml(testDoc().chapters[0].blocks, book));
    expect(
      [...facts.getElementsByTagName("dt")].map((el) => el.textContent),
    ).toEqual(["Title", "Words"]);
    expect(facts.getElementsByTagName("dd")[0].textContent).toBe(
      "The <Book> & Co",
    );
  });
});

describe("chapterToHtml", () => {
  const doc = testDoc();

  it("wraps a chapter in a section carrying its id, kind and epub:type", () => {
    const html = chapterToHtml(
      doc.chapters[3],
      doc,
      (id) => `#${id}`,
      "chapter",
    );
    const section = parseXml(
      `<root xmlns:epub="http://www.idpf.org/2007/ops">${html}</root>`,
    ).documentElement.firstElementChild;
    expect(section?.getAttribute("id")).toBe("c4");
    expect(section?.getAttribute("class")).toBe("chapter chapter-section");
    expect(section?.getAttribute("epub:type")).toBe("chapter");
    expect(section?.getElementsByTagName("h2")[0].textContent).toBe(
      "Chapter <One> & “Two”",
    );
  });

  it("writes no heading for a chapter without a title", () => {
    const untitled = { ...doc.chapters[4], title: null };
    expect(chapterToHtml(untitled, doc, (id) => id)).not.toMatch(/<h[1-6]/);
  });

  it("renders the contents chapter as a nav of links to every entry", () => {
    const root = parse(chapterToHtml(doc.chapters[1], doc, (id) => `#${id}`));
    const links = [...root.getElementsByTagName("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(links).toEqual(["#c3", "#c4", "#c5"]);
  });
});

describe("stylesheet", () => {
  // The HTML and EPUB headings are sized by the same table the paged writers
  // read, so a level-3 heading is the same size in every format.
  it("sizes each heading level from the layout's heading style", () => {
    const css = stylesheet(testDoc({ layout: "book" }));
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const rule = css
        .split("\n")
        .find((line) => line.startsWith(`h${level} {`));
      const style = headingStyle(book, level);
      expect(rule).toContain(`font-size: ${style.scale}em;`);
      expect(rule?.includes("text-align: center")).toBe(style.centred);
      expect(rule?.includes("font-style: italic")).toBe(style.italic);
    }
  });
});

describe("tocTree and nestedList", () => {
  it("hangs a level-2 entry under the level-1 entry before it", () => {
    const tree = tocTree(tocEntries(testDoc()));
    expect(tree).toHaveLength(1);
    expect(tree[0].entry.id).toBe("c3");
    expect(tree[0].children.map((child) => child.id)).toEqual(["c4", "c5"]);
  });

  it("stands a Section with no Part at the top level", () => {
    const tree = tocTree([
      { id: "a", title: "A", level: 2 },
      { id: "b", title: "B", level: 1 },
      { id: "c", title: "C", level: 2 },
    ]);
    expect(tree.map((node) => node.entry.id)).toEqual(["a", "b"]);
    expect(tree[1].children.map((child) => child.id)).toEqual(["c"]);
  });

  it("escapes titles and hrefs", () => {
    expect(
      nestedList([{ id: "x", title: "<T&>", level: 1 }], () => "a&b"),
    ).toBe(`<ol><li><a href="a&amp;b">&lt;T&amp;&gt;</a></li></ol>`);
  });
});

describe("stylesheet", () => {
  it("breaks a page after every chapter but the last", () => {
    const css = stylesheet(testDoc());
    expect(css).toContain(".chapter { break-after: page;");
    expect(css).toContain(".chapter:last-child { break-after: auto;");
  });

  it("sets openers flush in a book and indented in a manuscript", () => {
    expect(stylesheet(testDoc())).toContain("p.opener { text-indent: 0; }");
    expect(stylesheet(testDoc({ layout: "manuscriptModern" }))).toContain(
      "p.opener { text-indent: 1.5em; }",
    );
  });
});
