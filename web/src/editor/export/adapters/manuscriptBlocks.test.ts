// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { manuscriptParser } from "./manuscriptBlocks";

// Pins how the export reads the manuscript dialect. The engine's codec does
// the parsing, so the export never reads `{align:center}` or an escaped `\*`
// differently from the editor. The rows pin the mapping: the dialect's four
// block shapes onto the export model with alignment carried, and the three
// run formats onto inline marks. Nothing is invented (no `strike`, no
// `href`; the dialect has neither), and no empty run survives as an inline
// that prints as nothing.

const parse = (text: string) => manuscriptParser.parse(text);

describe("manuscriptParser", () => {
  it("maps the two heading levels, keeping their alignment", () => {
    expect(parse("{align:center}# Act One\n\n## The Storm")).toEqual([
      {
        kind: "heading",
        level: 1,
        inlines: [{ text: "Act One" }],
        align: "center",
      },
      {
        kind: "heading",
        level: 2,
        inlines: [{ text: "The Storm" }],
        align: "left",
      },
    ]);
  });

  it("maps a paragraph's alignment, every one the dialect can say", () => {
    const aligns = parse(
      "{align:right}R\n\n{align:justify}J\n\n{align:center}C\n\nL",
    ).map((block) => (block.kind === "paragraph" ? block.align : null));
    expect(aligns).toEqual(["right", "justify", "center", "left"]);
  });

  it("maps a page break the writer put in the text", () => {
    expect(parse("Before.\n\n{pagebreak}\n\nAfter.")).toEqual([
      { kind: "paragraph", inlines: [{ text: "Before." }], align: "left" },
      { kind: "pageBreak" },
      { kind: "paragraph", inlines: [{ text: "After." }], align: "left" },
    ]);
  });

  it("maps bold, italic and monospace runs onto inline marks", () => {
    expect(
      parse("She ran **fast** and *far*, ***both***, past `the gate`."),
    ).toEqual([
      {
        kind: "paragraph",
        align: "left",
        inlines: [
          { text: "She ran " },
          { text: "fast", bold: true },
          { text: " and " },
          { text: "far", italic: true },
          { text: ", " },
          { text: "both", bold: true, italic: true },
          { text: ", past " },
          { text: "the gate", mono: true },
          { text: "." },
        ],
      },
    ]);
  });

  // The escape is the codec's promise that typed text never becomes markup;
  // an export that undid it would print a writer's asterisks as italics.
  it("keeps escaped markers as the characters the writer typed", () => {
    expect(parse("\\*not italic\\* and \\{pagebreak}")).toEqual([
      {
        kind: "paragraph",
        align: "left",
        inlines: [{ text: "*not italic* and {pagebreak}" }],
      },
    ]);
  });

  it("drops empty runs, so an empty paragraph carries no inline at all", () => {
    expect(parse("")).toEqual([
      { kind: "paragraph", inlines: [], align: "left" },
    ]);
  });
});
