// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { Block, Inline } from "../domain/model";
import { markdownParser } from "./markdownBlocks";

// Pins how the export reads reference and note Markdown, on two axes.
//
// Shape: general Markdown is richer than the manuscript dialect (six heading
// levels, nested lists, quotes, code), and every writer serialises what this
// produces, so a list item flattened here is flattened in all eight formats.
//
// Safety: a reference file is untrusted input and an export is a file other
// people open, so a link survives only as http, https or mailto, and raw HTML
// is text. Those rows assert on the href itself, never on rendered markup,
// because this adapter reads tokens and emits no HTML.

const parse = (text: string) => markdownParser.parse(text);

/** Every inline anywhere in the blocks, lists and quotes included. */
function inlines(blocks: readonly Block[]): Inline[] {
  return blocks.flatMap((block) => {
    switch (block.kind) {
      case "heading":
      case "paragraph":
        return block.inlines;
      case "list":
        return block.items.flatMap((item) => inlines(item));
      case "quote":
        return inlines(block.blocks);
      default:
        return [];
    }
  });
}

const para = (...inl: Inline[]): Block => ({
  kind: "paragraph",
  inlines: inl,
  align: "left",
});

describe("markdownParser — the shape", () => {
  it("keeps all six heading levels", () => {
    const blocks = parse(
      "# one\n\n## two\n\n### three\n\n#### four\n\n##### five\n\n###### six",
    );
    expect(blocks).toEqual(
      ["one", "two", "three", "four", "five", "six"].map((text, i) => ({
        kind: "heading",
        level: i + 1,
        inlines: [{ text }],
        align: "left",
      })),
    );
  });

  it("nests a list inside the item it belongs to", () => {
    expect(parse("- one\n  - inner\n- two")).toEqual([
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [
          [
            para({ text: "one" }),
            {
              kind: "list",
              ordered: false,
              start: 1,
              items: [[para({ text: "inner" })]],
            },
          ],
          [para({ text: "two" })],
        ],
      },
    ]);
  });

  // A numbered list started at 3 continues something; the export never
  // renumbers it from 1.
  it("keeps an ordered list's own starting number", () => {
    expect(parse("3. third\n4. fourth")).toEqual([
      {
        kind: "list",
        ordered: true,
        start: 3,
        items: [[para({ text: "third" })], [para({ text: "fourth" })]],
      },
    ]);
  });

  // Zero is a starting number like any other, not a missing one.
  it("keeps a list that starts at 0 starting at 0", () => {
    expect(parse("0. Prologue\n1. Act")).toEqual([
      {
        kind: "list",
        ordered: true,
        start: 0,
        items: [[para({ text: "Prologue" })], [para({ text: "Act" })]],
      },
    ]);
  });

  it("keeps a quote's paragraphs inside the quote", () => {
    expect(parse("> said\n>\n> more")).toEqual([
      {
        kind: "quote",
        blocks: [para({ text: "said" }), para({ text: "more" })],
      },
    ]);
  });

  it("keeps fenced and indented code verbatim, without its last newline", () => {
    expect(parse("```\nlet x = *1*;\n  y();\n```")).toEqual([
      { kind: "code", text: "let x = *1*;\n  y();" },
    ]);
    expect(parse("    indented();")).toEqual([
      { kind: "code", text: "indented();" },
    ]);
  });

  // A thematic break between two paragraphs is the scene break of a
  // reference's prose — a visible mark, never an empty paragraph a reader
  // would swallow.
  it("reads a rule as a scene break", () => {
    expect(parse("Before.\n\n---\n\nAfter.")).toEqual([
      para({ text: "Before." }),
      { kind: "sceneBreak" },
      para({ text: "After." }),
    ]);
  });

  it("keeps a table's words, one paragraph per row", () => {
    expect(parse("| a | b |\n|---|---|\n| 1 | **2** |")).toEqual([
      para({ text: "a  |  b" }),
      para({ text: "1  |  " }, { text: "2", bold: true }),
    ]);
  });
});

describe("markdownParser — inline marks", () => {
  it("marks bold, italic, strike and code, and merges plain neighbours", () => {
    expect(parse("a **b** *c* ~~d~~ `e`\nf")).toEqual([
      para(
        { text: "a " },
        { text: "b", bold: true },
        { text: " " },
        { text: "c", italic: true },
        { text: " " },
        { text: "d", strike: true },
        { text: " " },
        { text: "e", mono: true },
        // The soft break is a space, merged into the plain text beside it.
        { text: " f" },
      ),
    ]);
  });

  it("carries a hard line break as a newline in the text", () => {
    expect(parse("first  \nsecond")).toEqual([para({ text: "first\nsecond" })]);
  });

  // An image is never fetched into an export: its alt text stands in, as the
  // reader shows it.
  it("prints an image as its alt text", () => {
    expect(parse("See ![the map](https://example.com/map.png).")).toEqual([
      para({ text: "See the map." }),
    ]);
  });
});

describe("markdownParser — links", () => {
  it("keeps an http, https or mailto link, href and all", () => {
    const found = inlines(
      parse(
        "[site](https://example.com/a) [plain](http://example.com) [me](mailto:vera@example.com)",
      ),
    ).filter((inline) => inline.href);
    expect(found).toEqual([
      { text: "site", href: "https://example.com/a" },
      { text: "plain", href: "http://example.com" },
      { text: "me", href: "mailto:vera@example.com" },
    ]);
  });

  it("keeps a link's own marks on its words", () => {
    expect(parse("[**bold** link](https://example.com)")).toEqual([
      para(
        { text: "bold", bold: true, href: "https://example.com" },
        { text: " link", href: "https://example.com" },
      ),
    ]);
  });

  // A `javascript:` link carried into an EPUB or HTML export would run in
  // someone else's reader, so it is not a link: the writer's words stay as
  // plain text with no href.
  it.each([
    "[click](javascript:alert(1))",
    "[click](JavaScript:alert(1))",
    "[click](data:text/html,<script>alert(1)</script>)",
    "[click](vbscript:msgbox)",
    "[click](ftp://example.com/file)",
  ])("drops an unsafe scheme to plain text: %s", (text) => {
    const all = inlines(parse(text));
    expect(all.some((inline) => inline.href !== undefined)).toBe(false);
    expect(all.map((inline) => inline.text).join("")).toContain("click");
  });

  it("prints raw HTML as the characters it is, never as markup", () => {
    expect(parse('<a href="javascript:x">hi</a>')).toEqual([
      para({ text: '<a href="javascript:x">hi</a>' }),
    ]);
  });
});
