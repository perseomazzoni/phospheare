// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { blockText, type SourceBlock } from "../../domain/source";
import { cleanInlines, typedEmphasis } from "../flowBuilder";
import { txtReader } from "./txt";
import { loadReader } from "./index";

const ctx = { yield: async () => undefined };
const read = async (text: string) =>
  (await txtReader.read(new TextEncoder().encode(text), "book.txt", ctx))
    .flows[0].blocks;
const texts = (blocks: SourceBlock[]) =>
  blocks.map((b) => (b.kind === "para" ? blockText(b) : `<${b.kind}>`));

describe("cleanInlines", () => {
  it("tidies, merges and trims a paragraph's runs", () => {
    expect(
      cleanInlines([
        { text: "  She " },
        { text: " ran", italic: true },
        { text: " far", italic: true },
        { text: ".\t" },
        { text: "" },
      ]),
    ).toEqual([
      { text: "She " },
      { text: "ran far", italic: true },
      { text: "." },
    ]);
  });

  it("never leaves a newline inside a run", () => {
    expect(cleanInlines([{ text: "a\nb" }])).toEqual([{ text: "a b" }]);
  });
});

describe("typedEmphasis", () => {
  it("reads _italic_ and *bold* at word edges", () => {
    expect(typedEmphasis("She was _very_ *sure*.")).toEqual([
      { text: "She was " },
      { text: "very", italic: true },
      { text: " " },
      { text: "sure", bold: true },
      { text: "." },
    ]);
  });

  it("leaves underscores and stars that are not emphasis alone", () => {
    expect(typedEmphasis("my_file_name and 2 * 3 * 4")).toEqual([
      { text: "my_file_name and 2 * 3 * 4" },
    ]);
  });
});

describe("txtReader", () => {
  it("reads one paragraph per line, with every blank line kept", async () => {
    expect(texts(await read("One.\nTwo.\n\nThree.\nFour.\nFive.\n"))).toEqual([
      "One.",
      "Two.",
      "",
      "Three.",
      "Four.",
      "Five.",
    ]);
  });

  it("rejoins hard-wrapped lines when blank lines separate paragraphs", async () => {
    const gutenberg =
      "It was the best of times, it was the worst\nof times, it was the age of wisdom.\n\nThere were a king with a large jaw\nand a queen.\n\n\n\nCHAPTER II\n\nThe Mail.\n";
    expect(texts(await read(gutenberg))).toEqual([
      "It was the best of times, it was the worst of times, it was the age of wisdom.",
      "There were a king with a large jaw and a queen.",
      "",
      "",
      "CHAPTER II",
      "The Mail.",
    ]);
  });

  it("reads our own export back: underlined titles, form feeds, a # break", async () => {
    const exported =
      "The Book\n========\n\nShe was _sure_.\n\n#\n\nAfter.\n\f\nTwo\n---\n\nEnd.\n";
    const blocks = await read(exported);
    expect(texts(blocks)).toEqual([
      "The Book",
      "She was sure.",
      "#",
      "After.",
      "<pageBreak>",
      "Two",
      "End.",
    ]);
    expect(blocks[0]).toMatchObject({ signals: { headingLevel: 1 } });
    expect(blocks[5]).toMatchObject({ signals: { headingLevel: 2 } });
    expect(blocks[1]).toMatchObject({
      inlines: [
        { text: "She was " },
        { text: "sure", italic: true },
        { text: "." },
      ],
    });
  });

  it("reads Windows line endings and a cp1252 file", async () => {
    const bytes = new Uint8Array([
      0x49, 0x74, 0x92, 0x73, 0x0d, 0x0a, 0x4f, 0x6b,
    ]);
    const doc = await txtReader.read(bytes, "a.txt", ctx);
    expect(texts(doc.flows[0].blocks)).toEqual(["It’s", "Ok"]);
    expect(doc.report).toEqual({});
  });

  it("counts the emphasis it kept", async () => {
    const doc = await txtReader.read(
      new TextEncoder().encode("_a_ and _b_ and *c*"),
      "a.txt",
      ctx,
    );
    expect(doc.report).toEqual({ italic: 2, bold: 1 });
  });

  it("is reached through the registry", async () => {
    expect((await loadReader("txt")).format).toBe("txt");
  });

  it("reads an underlined title in a file written line by line", async () => {
    const blocks = await read(
      "Once Dark\n=========\nShe ran.\nPart Two\n--------\nShe stopped.\n",
    );
    expect(texts(blocks)).toEqual([
      "Once Dark",
      "She ran.",
      "Part Two",
      "She stopped.",
    ]);
    expect(blocks[0]).toMatchObject({ signals: { headingLevel: 1 } });
    expect(blocks[2]).toMatchObject({ signals: { headingLevel: 2 } });
  });
});

describe("txtReader", () => {
  it("a sentence over a --- scene break stays a paragraph, and the break stays a break", async () => {
    const blocks = await read(
      "She closed the door behind her and waited for the morning.\n---\nMorning came slowly over the harbour and the boats.\nThe gulls woke first.\n",
    );
    expect(texts(blocks)).toEqual([
      "She closed the door behind her and waited for the morning.",
      "---",
      "Morning came slowly over the harbour and the boats.",
      "The gulls woke first.",
    ]);
    expect(blocks[0]).toMatchObject({ signals: {} });
  });

  it("a question or an exclamation over a --- scene break stays a paragraph", async () => {
    for (const line of ["Where are you going?", "“Get out!”"]) {
      const lines = await read(
        `She looked at him for a long time.\n${line}\n---\nThe next morning it rained.\n`,
      );
      expect(texts(lines)).toEqual([
        "She looked at him for a long time.",
        line,
        "---",
        "The next morning it rained.",
      ]);
      const wrapped = await read(
        `She looked at him.\n\n${line}\n---\n\nThe next morning it rained.\n`,
      );
      expect(texts(wrapped)).toEqual([
        "She looked at him.",
        `${line} ---`,
        "The next morning it rained.",
      ]);
      expect(wrapped[1]).toMatchObject({ signals: {} });
    }
  });
});
