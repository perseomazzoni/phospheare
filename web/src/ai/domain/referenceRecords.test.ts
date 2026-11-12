// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { CATALOGUE } from "./referenceCatalogue";
import { parseReference, recordAt } from "./referenceRecords";

// A reference document as records.

const page = (id: string) => {
  const found = CATALOGUE.get(id);
  if (!found) throw new Error(id);
  return found;
};

const summary = (text: string, id: string, title: string | null = null) =>
  parseReference(text, page(id), title).records.map((one) => [
    one.field?.id ?? null,
    one.role,
    one.entity,
    one.lines.map((line) => line.text).join(" / "),
  ]);

describe("parseReference", () => {
  it("reads a filled character sheet as records about its person, each with its role", () => {
    const text = [
      "# Marta Neri",
      "## Identity",
      "- **Names and nicknames:**",
      "  - Marta",
      "- **Age and date of birth:** 34",
      "## Inner life / psychology",
      "- **Fears:** that she is a fraud",
      "- **Secrets and unacknowledged truths:** she failed the exam once",
    ].join("\n");
    const parsed = parseReference(text, page("character"), "Marta Neri");
    expect(parsed.interpretation).toBe("full");
    expect(summary(text, "character", "Marta Neri")).toEqual([
      ["names", "fact", "Marta Neri", "Marta"],
      ["age", "fact", "Marta Neri", "34"],
      ["fears", "inner", "Marta Neri", "that she is a fraud"],
      ["secrets", "knowledge", "Marta Neri", "she failed the exam once"],
    ]);
    expect(parsed.records.map((one) => one.group)).toEqual([
      "identity",
      "identity",
      "inner",
      "inner",
    ]);
  });

  it("recognises a field by its Italian label on an English project", () => {
    expect(
      summary(
        "- **Paure:** l'acqua\n- **Aspetto:** occhi grigi\n",
        "character",
        "Marta",
      ),
    ).toEqual([
      ["fears", "inner", "Marta", "l'acqua"],
      ["appearance", "fact", "Marta", "occhi grigi"],
    ]);
  });

  it("keeps a renamed field and loose prose as unclassified, and says the page is partly read", () => {
    const text = [
      "- **Looks:** grey eyes",
      "- **Age and date of birth:** 34",
      "",
      "She hates the sea.",
    ].join("\n");
    const parsed = parseReference(text, page("character"), "Marta");
    expect(parsed.interpretation).toBe("partial");
    expect(summary(text, "character", "Marta")).toEqual([
      [null, "unclassified", "Marta", "grey eyes"],
      ["age", "fact", "Marta", "34"],
      [null, "unclassified", "Marta", "She hates the sea."],
    ]);
    expect(parsed.records[0].label).toBe("Looks:");
  });

  it("opens a block instance at a named heading and at the placeholder, each naming its entity", () => {
    const text = [
      "# Places in the story",
      "## The Harbour",
      "- **Names:** the Mouth",
      "- **Description:** a stone quay",
      "## [Location]",
      "- **Names:** Via Nizza",
      "- **Atmosphere:** loud",
    ].join("\n");
    const parsed = parseReference(text, page("world:locations"));
    expect(summary(text, "world:locations")).toEqual([
      ["location.names", "fact", "The Harbour", "the Mouth"],
      ["location.description", "fact", "The Harbour", "a stone quay"],
      ["location.names", "fact", "Via Nizza", "Via Nizza"],
      ["location.atmosphere", "texture", "Via Nizza", "loud"],
    ]);
    expect(parsed.records[0].instance).toEqual({
      block: "location",
      entity: "place",
      heading: "The Harbour",
    });
    expect(parsed.records[2].instance?.heading).toBeNull();
  });

  it("reads a page with top-level fields before its block, and a fixed group after", () => {
    expect(
      summary(
        [
          "- **The story's present:** 2011",
          "## The flood",
          "- **When it happened:** 1951",
          "- **How it is remembered:** as a punishment",
        ].join("\n"),
        "world:timeline",
      ),
    ).toEqual([
      ["present", "fact", null, "2011"],
      ["event.when", "fact", "The flood", "1951"],
      ["event.remembered", "knowledge", "The flood", "as a punishment"],
    ]);
    expect(
      summary(
        "- **How it began:** a drought\n## Power struggles and social tensions\n- **Who holds power?** the guild\n",
        "world:conflict",
      ),
    ).toEqual([
      ["began", "fact", null, "a drought"],
      ["power", "fact", null, "the guild"],
    ]);
  });

  it("reads a notes file, and a page it cannot place, as raw", () => {
    const notes = parseReference("Marta was born in 1989.\n", null, "Notes");
    expect(notes.interpretation).toBe("raw");
    expect(notes.records.map((one) => one.role)).toEqual(["unclassified"]);
    expect(parseReference("", page("arc")).records).toEqual([]);
    expect(parseReference("", page("arc")).interpretation).toBe("raw");
    // A headed notes file opens no block: with no page, nothing is placed.
    const headed = parseReference(
      "## The Harbour\n- **Names:** the Mouth\n",
      null,
      "Notes",
    );
    expect(headed.records.map((one) => [one.role, one.instance])).toEqual([
      ["unclassified", null],
    ]);
  });

  it("skips a field with no answer", () => {
    expect(summary("- **Fears:**\n- **Pronouns:** she\n", "character")).toEqual(
      [["pronouns", "fact", null, "she"]],
    );
  });
});

describe("recordAt", () => {
  // The same words under two fields: a quote belongs to the field whose
  // answer holds it, found by its place, never by its words.
  it("binds a quote to the field whose answer holds it, never by its words", () => {
    const text =
      "- **Appearance:** grey, like her father\n- **Details to remember:** grey, like her father\n";
    const parsed = parseReference(text, page("character"), "Marta");
    const second = text.lastIndexOf("grey, like her father");
    const first = text.indexOf("grey, like her father");
    expect(recordAt(parsed, first, first + 4)?.field?.id).toBe("appearance");
    expect(recordAt(parsed, second, second + 4)?.field?.id).toBe("details");
    // A label is no answer; a span across two records belongs to neither.
    expect(
      recordAt(
        parsed,
        text.indexOf("Appearance"),
        text.indexOf("Appearance") + 5,
      ),
    ).toBeNull();
    expect(recordAt(parsed, first, second + 4)).toBeNull();
    expect(recordAt(parsed, first, first)).toBeNull();
  });

  it("keeps loose prose on either side of a field as two runs, so the field still owns its answer", () => {
    const text = [
      "She hates the sea.",
      "",
      "- **Age and date of birth:** 34",
      "",
      "She never learnt to swim.",
    ].join("\n");
    const parsed = parseReference(text, page("character"), "Marta");
    expect(summary(text, "character", "Marta")).toEqual([
      [null, "unclassified", "Marta", "She hates the sea."],
      ["age", "fact", "Marta", "34"],
      [null, "unclassified", "Marta", "She never learnt to swim."],
    ]);
    const age = text.indexOf("34");
    expect(recordAt(parsed, age, age + 2)?.field?.id).toBe("age");
  });

  it("keeps loose prose under two headings as two runs", () => {
    const text = [
      "## Identity",
      "She hates the sea.",
      "## Inner life / psychology",
      "She never learnt to swim.",
    ].join("\n");
    expect(summary(text, "character", "Marta")).toEqual([
      [null, "unclassified", "Marta", "She hates the sea."],
      [null, "unclassified", "Marta", "She never learnt to swim."],
    ]);
  });

  it("lets a quote run across two answer lines of one field", () => {
    const text = "- **Fears:**\n  - the sea\n  - the dark\n";
    const parsed = parseReference(text, page("character"));
    expect(
      recordAt(parsed, text.indexOf("the sea"), text.indexOf("dark") + 4)?.field
        ?.id,
    ).toBe("fears");
  });
});
