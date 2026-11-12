// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { normalLabel, outlineOf } from "./referenceOutline";

// A reference document's outline, with exact places.

/** Every answer's text, checking that its offsets hold that text. */
function answers(text: string) {
  return outlineOf(text).fields.map((field) => {
    for (const line of field.answers)
      expect(text.slice(line.start, line.end)).toBe(line.text);
    return [field.label, field.answers.map((line) => line.text)];
  });
}

describe("outlineOf", () => {
  it("reads the title, the headings and each field's answers, with their offsets", () => {
    const text = [
      "# Marta Neri",
      "",
      "## Identity",
      "",
      "- **Names and nicknames:**",
      "  - Marta",
      "  - la dottoressa",
      "- **Age and date of birth:** 34, born 1989",
      "",
      "## Inner life / psychology",
      "",
      "- **Fears:**",
      "  - Being found out.",
    ].join("\n");
    const outline = outlineOf(text);
    expect(outline.title).toBe("Marta Neri");
    expect(outline.headings.map((one) => [one.level, one.text])).toEqual([
      [2, "Identity"],
      [2, "Inner life / psychology"],
    ]);
    expect(answers(text)).toEqual([
      ["Names and nicknames:", ["Marta", "la dottoressa"]],
      ["Age and date of birth:", ["34, born 1989"]],
      ["Fears:", ["Being found out."]],
    ]);
    expect(outline.fields.map((one) => one.heading?.text)).toEqual([
      "Identity",
      "Identity",
      "Inner life / psychology",
    ]);
    const age = outline.fields[1];
    expect(text.slice(age.start, age.end)).toBe(
      "- **Age and date of birth:** 34, born 1989",
    );
  });

  it("keeps exact offsets under CRLF line endings", () => {
    const text =
      "- **Names:**\r\n  - the Mouth\r\n- **Description:** a harbour\r\n";
    expect(answers(text)).toEqual([
      ["Names:", ["the Mouth"]],
      ["Description:", ["a harbour"]],
    ]);
  });

  it("reads a colon outside the bold run, and an answer on the label's own line", () => {
    expect(answers("- **Names**: Aldo\n- **Role**:\n  the old man\n")).toEqual([
      ["Names", ["Aldo"]],
      ["Role", ["the old man"]],
    ]);
  });

  it("keeps a nested note with its indentation, and a filled formula as an answer, never a field", () => {
    const text = [
      "- **The story in a sentence:**",
      "  - **Marta**, a doctor, wants to stay",
      "    - only in the first life",
    ].join("\n");
    const [field] = outlineOf(text).fields;
    expect(outlineOf(text).fields).toHaveLength(1);
    expect(field.answers.map((one) => [one.text, one.indent])).toEqual([
      ["**Marta**, a doctor, wants to stay", 2],
      ["only in the first life", 4],
    ]);
  });

  it("gives a flush-left answer to the field above it", () => {
    expect(answers("- **Fears:**\n- the dark\n- water\n")).toEqual([
      ["Fears:", ["the dark", "water"]],
    ]);
  });

  // An ordered list's number is the writer's text: on a timeline, the year.
  it("keeps an ordered item's number, which on a timeline is the year", () => {
    expect(
      answers("- **Events:**\n  1850. The flood.\n  1851. The bridge.\n"),
    ).toEqual([["Events:", ["1850. The flood.", "1851. The bridge."]]]);
    const outline = outlineOf("1850.\n");
    expect(outline.loose.map((one) => one.text)).toEqual(["1850."]);
  });

  it("reads a field written as a paragraph, without a bullet", () => {
    expect(answers("**Distances:** two days by road\n")).toEqual([
      ["Distances:", ["two days by road"]],
    ]);
  });

  it("keeps what sits under no field as loose lines, with the heading above", () => {
    const text = [
      "## [Location]",
      "",
      "Some prose the writer added.",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "- a list under no label",
      "",
      "> a quote",
      "",
      "```",
      "code line",
      "```",
    ].join("\n");
    const outline = outlineOf(text);
    expect(outline.fields).toEqual([]);
    for (const line of outline.loose)
      expect(text.slice(line.start, line.end)).toBe(line.text);
    expect(outline.loose.map((one) => one.text)).toEqual([
      "Some prose the writer added.",
      "| a | b |",
      "| 1 | 2 |",
      "a list under no label",
      "a quote",
      "code line",
    ]);
    expect(outline.loose[0].heading?.text).toBe("[Location]");
  });

  it("lets a later # close the heading above rather than open one", () => {
    const outline = outlineOf("# T\n## A\n- **X:** 1\n# Second\n- **Y:** 2\n");
    expect(outline.title).toBe("T");
    expect(outline.fields.map((one) => one.heading?.text ?? null)).toEqual([
      "A",
      null,
    ]);
  });

  it("makes nothing of an empty document, and never throws on odd input", () => {
    expect(outlineOf("")).toEqual({
      title: null,
      headings: [],
      fields: [],
      loose: [],
    });
    expect(() => outlineOf("- **\n**:\n* * *\n1) **A**\n")).not.toThrow();
  });
});

describe("normalLabel", () => {
  it("reads the markup a writer's editor may leave: tabs, underscores, inline code, a line break", () => {
    const text = [
      "- __Names and nicknames:__ Ilse `Varga`",
      "\t- Isa",
      "- **Age and",
      "date of birth:** twenty-six  ",
      "  and a half",
    ].join("\n");
    const outline = outlineOf(text);
    // A break inside the bold run ends the label at the break.
    expect(outline.fields.map((one) => one.label)).toEqual([
      "Names and nicknames:",
      "Age and",
    ]);
    expect(answers(text)[0]).toEqual([
      "Names and nicknames:",
      ["Ilse `Varga`", "Isa"],
    ]);
    // A tab indents as four spaces.
    expect(outline.fields[0].answers[1].indent).toBe(4);
  });

  it("never reads bold that does not open its line as a label, nor a bold run with no words", () => {
    const text = [
      "- the **Harbour** at dawn",
      "- ** ** nothing here",
      "- **unclosed label",
    ].join("\n");
    const outline = outlineOf(text);
    expect(outline.fields).toEqual([]);
    expect(outline.loose.map((one) => one.text)).toEqual([
      "the **Harbour** at dawn",
      "** ** nothing here",
      "**unclosed label",
    ]);
  });

  it("reads a heading with inline code, and keeps a table and a quote as the writer's loose lines", () => {
    const text = [
      "## The `Varga` ferry",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "> a quoted line",
    ].join("\n");
    const outline = outlineOf(text);
    expect(outline.headings.map((one) => one.text)).toEqual([
      "The Varga ferry",
    ]);
    expect(outline.loose.map((one) => one.text)).toContain("| 1 | 2 |");
    expect(outline.loose.map((one) => one.text)).toContain("a quoted line");
  });

  it("reads a heading's bold words as words, and a bold run of punctuation as no label", () => {
    const outline = outlineOf(
      ["## The **old** harbour", "", "- **!!** a loose remark"].join("\n"),
    );
    expect(outline.headings.map((one) => one.text)).toEqual([
      "The old harbour",
    ]);
    expect(outline.fields).toEqual([]);
    expect(outline.loose.map((one) => one.text)).toEqual([
      "**!!** a loose remark",
    ]);
  });

  it("gives a loose list's flush-left answers to the field above, and never its blank lines", () => {
    // A loose list (items apart by blank lines) gives each item a range
    // that carries the blank line after it.
    expect(
      answers(
        ["- **Fears:**", "", "- the sea", "", "- **Looks:** grey"].join("\n"),
      ),
    ).toEqual([
      ["Fears:", ["the sea"]],
      ["Looks:", ["grey"]],
    ]);
  });

  it("compares labels by their words alone", () => {
    expect(normalLabel("Names  and\nnicknames:")).toBe("names and nicknames");
    expect(normalLabel("Names :")).toBe("names");
    expect(normalLabel("What kind of experience?")).toBe(
      "what kind of experience?",
    );
  });
});
