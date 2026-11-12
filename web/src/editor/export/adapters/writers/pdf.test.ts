// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LAYOUT_IDS, type LayoutId } from "../../domain/layout";
import { createPdfWriter, fontFiles, pdfDefinition } from "./pdf";
import { PRODUCT } from "../../../../product";
import {
  IN_TEXT_PAGE_BREAKS,
  NASTY_CLEAN,
  hasForbidden,
  testDoc,
  type TestDocOptions,
} from "./document.fixture";

// What a PDF says is decided by `pdfDefinition`, a pure function, so the
// suite reads the definition (sections, page breaks, furniture callbacks,
// metadata) rather than a rendered file nobody can diff. One smoke test per
// layout renders for real with the fonts the app ships, because a definition
// pdfmake cannot lay out only looks right.

type Node = Record<string, unknown>;

interface Section {
  section: Node[];
  header: ((page: number) => Node | null) | null;
  footer: ((page: number, pages: number) => Node) | null;
}

function definitionOf(options: TestDocOptions = {}) {
  const { definition, fonts } = pdfDefinition(testDoc(options));
  return { definition, fonts, sections: definition.content as Section[] };
}

/** Every string anywhere in a definition. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(strings);
  return [];
}

describe("pdfDefinition", () => {
  it.each(LAYOUT_IDS)(
    "breaks the page once per chapter boundary, plus the writer's own (%s)",
    (layout) => {
      const { sections } = definitionOf({ layout });
      // The front matter and the text are separate sections, and a section
      // starts a page: that boundary is the break there, counted once.
      expect(sections).toHaveLength(2);
      const breaks = sections
        .flatMap((section) => section.section)
        .filter((node) => node.pageBreak === "before").length;
      expect(breaks + sections.length - 1).toBe(
        testDoc({ layout }).chapters.length - 1 + IN_TEXT_PAGE_BREAKS,
      );
      // A break only ever comes before a node, so the last chapter never
      // pushes a blank page after itself.
      expect(
        sections
          .flatMap((section) => section.section)
          .some((node) => node.pageBreak === "after"),
      ).toBe(false);
    },
  );

  it("describes the book in the PDF's info dictionary", () => {
    const { definition } = definitionOf();
    expect(definition.info).toEqual({
      title: "The <Book> & “Co”",
      author: "Ann Writer",
      subject: "Fantasy, Mystery",
      creator: PRODUCT.name,
      producer: PRODUCT.name,
    });
    expect(definition.language).toBe("en");
  });

  it("sizes the page, and sets a trim's spine margin on both sides", () => {
    // Worked out by hand, not read from the layout tables: a trade page is
    // 6 × 9 inches, and its spine margin is three quarters of an inch, at
    // 72 points to the inch.
    const { definition } = definitionOf({ layout: "book", page: "trade" });
    expect(definition.pageSize).toEqual({ width: 432, height: 648 });
    const margins = definition.pageMargins as number[];
    expect(margins[0]).toBe(54);
    expect(margins[2]).toBe(54);
  });

  it("leaves the front matter without furniture", () => {
    for (const layout of LAYOUT_IDS) {
      const [front] = definitionOf({ layout }).sections;
      expect(front.header).toBeNull();
      expect(front.footer).toBeNull();
    }
  });

  // pdfmake calls the furniture page by page, in order, from the text's first
  // page; the page numbers here (3, 4, 5 of 5) follow the two front pages,
  // and the printed numbers start again at 1.
  it("numbers a book's pages from 1 at the foot, with no running head", () => {
    const [, body] = definitionOf({ layout: "book" }).sections;
    expect(body.header).toBeNull();
    expect([3, 4, 5].map((page) => body.footer?.(page, 5).text)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it.each(["manuscriptModern", "manuscriptClassic"] as LayoutId[])(
    "runs a manuscript's head with the page number and prints no footer (%s)",
    (layout) => {
      const [, body] = definitionOf({ layout }).sections;
      expect(body.footer).toBeNull();
      expect([3, 4].map((page) => body.header?.(page)?.text)).toEqual([
        "Writer / The Book / 1",
        "Writer / The Book / 2",
      ]);
    },
  );

  it("leaves a story's first text page without the running head", () => {
    const [, body] = definitionOf({
      layout: "manuscriptModern",
      story: true,
    }).sections;
    expect(body.header?.(3)).toBeNull();
    expect(body.header?.(4)?.text).toBe("Writer / The Book / 2");
  });

  it("prints the review copy's draft line with the text's own page count", () => {
    const [, body] = definitionOf({ layout: "review" }).sections;
    expect(body.footer?.(3, 5).text).toBe(
      "Draft · 1 October 2026 · page 1 of 3",
    );
  });

  it("numbers the review copy's paragraphs in the margin, and no other layout's", () => {
    const numbered = (layout: LayoutId) =>
      definitionOf({ layout })
        .sections.flatMap((section) => section.section)
        .filter(
          (node) => Array.isArray(node.columns) && node.marginLeft === -28,
        ).length;
    expect(numbered("review")).toBeGreaterThan(0);
    for (const layout of [
      "book",
      "manuscriptModern",
      "manuscriptClassic",
    ] as const)
      expect(numbered(layout)).toBe(0);
  });

  it("anchors every chapter heading, and lists only the book's own chapters", () => {
    const { sections } = definitionOf();
    const nodes = sections.flatMap((section) => section.section);
    const headings = nodes.filter((node) => typeof node.id === "string");
    expect(headings.map((node) => node.id)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
    ]);
    expect(
      headings.filter((node) => node.tocItem).map((node) => node.id),
    ).toEqual(["c3", "c4", "c5"]);
    expect(nodes.some((node) => node.toc !== undefined)).toBe(true);
  });

  it("keeps the writer's words, minus what a PDF string cannot carry", () => {
    const all = strings(definitionOf().definition);
    expect(all).toContain(NASTY_CLEAN);
    expect(hasForbidden(all.join(""))).toBe(false);
  });

  it("asks for the monospace face only beside the body face, once", () => {
    expect(definitionOf({ layout: "book" }).fonts).toEqual([
      "newsreader",
      "cousine",
    ]);
    expect(definitionOf({ layout: "manuscriptClassic" }).fonts).toEqual([
      "courierPrime",
      "cousine",
    ]);
  });
});

describe("fontFiles", () => {
  it("names the four faces by the family's file stem", () => {
    expect(fontFiles("tinos")).toEqual({
      normal: "Tinos-Regular.ttf",
      bold: "Tinos-Bold.ttf",
      italics: "Tinos-Italic.ttf",
      bolditalics: "Tinos-BoldItalic.ttf",
    });
  });
});

describe("createPdfWriter", () => {
  // The fonts the app ships, through Vite rather than `node:fs`, because the
  // workspace carries no Node types. Each value is a base64 data URL.
  const FONTS = import.meta.glob("../../../../../public/fonts/export/*.ttf", {
    query: "?inline",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  /** The page objects in a PDF; `\b` keeps `/Type /Pages`, the tree, out. */
  const pageCount = (raw: string) =>
    (raw.match(/\/Type \/Page\b/g) ?? []).length;

  /**
   * The info dictionary's title: a literal string, UTF-16BE behind a byte
   * order mark, as pdfkit writes any text outside ASCII.
   */
  const infoTitle = (raw: string): string | null => {
    const ref = /\/Title (\d+) 0 R/.exec(raw)?.[1];
    if (ref === undefined) return null;
    const object = raw.indexOf(`\n${ref} 0 obj`);
    const open = raw.indexOf("(", object);
    const units: number[] = [];
    for (let i = open + 1; raw[i] !== ")"; i++) {
      const char = raw[i] === "\\" ? raw[++i] : raw[i];
      units.push(
        { n: 10, r: 13, t: 9, b: 8, f: 12 }[char] ?? char.charCodeAt(0),
      );
    }
    const bytes = Uint8Array.from(units);
    return bytes[0] === 0xfe && bytes[1] === 0xff
      ? new TextDecoder("utf-16be").decode(bytes.subarray(2))
      : new TextDecoder("latin1").decode(bytes);
  };

  const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

  /**
   * The text of each page, read from the file as a PDF reader does: every
   * font pdfkit writes shows glyph numbers, and its ToUnicode map turns
   * them back into characters. Only what pdfkit writes is read, which is
   * Flate-compressed streams and maps made of bfrange arrays; spaces
   * between text objects are folded into one.
   */
  async function pageTexts(bytes: Uint8Array): Promise<string[]> {
    const raw = latin1(bytes);
    const object = (id: string | undefined) => {
      const at = raw.indexOf(`\n${id} 0 obj`);
      return { at, text: raw.slice(at, raw.indexOf("endobj", at)) };
    };
    const ref = (text: string, key: string) =>
      new RegExp(`/${key} (\\d+) 0 R`).exec(text)?.[1];
    const stream = async (id: string | undefined) => {
      const { at, text } = object(id);
      const start = at + text.indexOf("stream\n") + "stream\n".length;
      const length = Number(/\/Length (\d+)/.exec(text)?.[1]);
      const inflated = new Blob([bytes.slice(start, start + length)])
        .stream()
        .pipeThrough(new DecompressionStream("deflate"));
      return latin1(new Uint8Array(await new Response(inflated).arrayBuffer()));
    };
    // A ToUnicode entry is UTF-16BE: four hex digits a unit, and a
    // ligature such as "fi" is two characters in one entry.
    const utf16 = (hex: string) =>
      String.fromCodePoint(
        ...(hex.replace(/\s/g, "").match(/.{4}/g) ?? []).map((unit) =>
          parseInt(unit, 16),
        ),
      );
    const glyphsOf = async (font: string | undefined) => {
      const cmap = await stream(ref(object(font).text, "ToUnicode"));
      const glyphs = new Map<number, string>();
      for (const [, low, list] of cmap.matchAll(
        /<([0-9a-f]+)>\s*<[0-9a-f]+>\s*\[([^\]]*)\]/gi,
      ))
        [...list.matchAll(/<([0-9a-f\s]+)>/gi)].forEach((entry, k) =>
          glyphs.set(parseInt(low, 16) + k, utf16(entry[1])),
        );
      return glyphs;
    };
    const pages: string[] = [];
    for (const [, id] of raw.matchAll(/\n(\d+) 0 obj\n<<\n\/Type \/Page\n/g)) {
      const page = object(id).text;
      const fonts = new Map<string, Map<number, string>>();
      for (const [, name, font] of object(ref(page, "Resources")).text.matchAll(
        /\/(F\d+) (\d+) 0 R/g,
      ))
        fonts.set(name, await glyphsOf(font));
      let glyphs = new Map<number, string>();
      let text = "";
      const content = await stream(ref(page, "Contents"));
      for (const [op, name, shown] of content.matchAll(
        /\bBT\b|\/(F\d+) [\d.]+ Tf|\[([^\]]*)\]\s*TJ/g,
      )) {
        if (op === "BT") text += " ";
        else if (name !== undefined) glyphs = fonts.get(name) ?? glyphs;
        else
          for (const [, hex] of shown.matchAll(/<([0-9a-f]*)>/gi))
            for (const glyph of hex.match(/.{4}/g) ?? [])
              text += glyphs.get(parseInt(glyph, 16)) ?? "�";
      }
      pages.push(text.replace(/\s+/g, " ").trim());
    }
    return pages;
  }

  const loadFont = async (file: string) => {
    const url = Object.entries(FONTS).find(([path]) =>
      path.endsWith(`/${file}`),
    )?.[1];
    if (url === undefined) throw new Error(`no shipped font ${file}`);
    const binary = atob(url.slice(url.indexOf(",") + 1));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  };

  it("finds every face it is asked for among the shipped fonts", () => {
    // 4 families × 4 faces; a missing one would fail the render below with
    // a far less legible error.
    expect(Object.keys(FONTS)).toHaveLength(16);
  });

  it.each(LAYOUT_IDS)(
    "renders a real PDF with the shipped fonts (%s)",
    async (layout) => {
      const doc = testDoc({ layout });
      const bytes = await createPdfWriter(loadFont).write(doc);
      expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
      // Read back from the file itself, not from the definition: every
      // chapter opens a page, and the document's title is the book's,
      // markup characters and curly quotes included. The book layout's
      // text is read back below.
      const raw = latin1(bytes);
      expect(pageCount(raw)).toBeGreaterThanOrEqual(doc.chapters.length);
      expect(infoTitle(raw)).toBe(doc.meta.title);
    },
    30_000,
  );

  it("prints the writer's words, in order, on the pages they belong to (book)", async () => {
    const pages = await pageTexts(
      await createPdfWriter(loadFont).write(testDoc({ layout: "book" })),
    );
    // The writer's own page break: the inline formatting and the escaped
    // markup end one page, and the next opens on the accented letter and
    // the curly quotes. The shipped faces carry no emoji or CJK, so this
    // reads only up to them.
    const broken = pages.findIndex((page) =>
      page.includes("gone {brace} back\\slash"),
    );
    expect(broken).toBeGreaterThan(-1);
    expect(pages[broken]).toContain("Plain italic and bold both");
    expect(pages[broken]).toContain("Justified line");
    expect(pages[broken + 1]).toMatch(/^è “quotes” /);
    expect(pages[broken + 1]).toContain("After a blank line.");
    // The last chapter opens its own page, and closes the book.
    expect(pages[pages.length - 1]).toMatch(/^Chapter Two The last words\. /);
  }, 30_000);
});
