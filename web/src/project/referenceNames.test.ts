// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  nameFieldsOf,
  placeNames,
  sheetAliases,
  type NameFields,
} from "./referenceNames";

// `/where` reads the names a book's people and places go by from one field of
// a character sheet and one field under each place, and nothing else a sheet
// says. The fields are the templates' own; these fixtures spell them
// as the shipped English and Italian templates do.

const FIELDS: NameFields = {
  sheet: ["Names and nicknames:", "Nomi e soprannomi:"],
  place: ["Names:", "Nomi:"],
  placeholders: ["[Location]", "[Luogo]"],
};

/** A field as the templates ship it, answered with these lines or not. */
function field(label: string, ...answers: string[]): string {
  return [
    `- **${label}:**`,
    `  <!-- Hint: think about ${label}. -->`,
    ...(answers.length ? answers.map((one) => `  - ${one}`) : ["  - "]),
  ].join("\n");
}

describe("the names a character sheet records", () => {
  it("reads the answers under the names field, and nothing under any other", () => {
    const sheet = [
      "# Aldo",
      "",
      "## Identity",
      "",
      field("Names and nicknames", "the old man", "*Nonno*"),
      "",
      field("Age and date of birth", "eighty-one"),
      "",
      field("Fears", "the sea"),
    ].join("\n");
    expect(sheetAliases(sheet, FIELDS)).toEqual(["the old man", "Nonno"]);
  });

  it("reads the Italian sheet's own label", () => {
    const sheet = ["# Vera", "", field("Nomi e soprannomi", "la Rossa")].join(
      "\n",
    );
    expect(sheetAliases(sheet, FIELDS)).toEqual(["la Rossa"]);
  });

  it("gives nothing for an unanswered field — the title still names them", () => {
    const sheet = [
      "# Aldo",
      "",
      field("Names and nicknames"),
      "",
      field("Age", "81"),
    ].join("\n");
    expect(sheetAliases(sheet, FIELDS)).toEqual([]);
  });

  it("does not take a hint, a stray marker or a colon for a name", () => {
    const sheet = [
      "# Aldo",
      "",
      "- **Names and nicknames:**",
      "  <!-- Hint: what are they called? -->",
      "  - :",
      "  - -",
    ].join("\n");
    expect(sheetAliases(sheet, FIELDS)).toEqual([]);
  });

  it("accepts the colon outside the bold, and ignores the label's case", () => {
    const sheet = ["# Aldo", "", "- **names and nicknames**:", "  - Al"].join(
      "\n",
    );
    expect(sheetAliases(sheet, FIELDS)).toEqual(["Al"]);
  });

  it("does not read a field inside a code fence", () => {
    const sheet = [
      "# Aldo",
      "",
      "```",
      "- **Names and nicknames:**",
      "  - the old man",
      "```",
    ].join("\n");
    expect(sheetAliases(sheet, FIELDS)).toEqual([]);
  });

  it("gives nothing for a sheet whose names field was renamed", () => {
    const sheet = ["# Aldo", "", field("Called", "the old man")].join("\n");
    expect(sheetAliases(sheet, FIELDS)).toEqual([]);
  });

  it("reads CRLF files as it reads LF ones", () => {
    const sheet = ["# Aldo", "", field("Names and nicknames", "Al")].join(
      "\r\n",
    );
    expect(sheetAliases(sheet, FIELDS)).toEqual(["Al"]);
  });

  // The names field's items and nothing else. A bullet nested under one of
  // them is the writer's note about that name, not a name.
  it("reads the names field's own items, never a note nested under one", () => {
    const sheet = [
      "# Aldo",
      "",
      "- **Names and nicknames:**",
      "  - the old man",
      "    - only the children say it; he hates it",
      "  - Nonno",
      "",
      field("Age", "81"),
    ].join("\n");
    expect(sheetAliases(sheet, FIELDS)).toEqual(["the old man", "Nonno"]);
  });

  // A writer who types the answer on the label's own line, or on the next
  // line without a bullet, has answered the field, and the field is still
  // found; otherwise the aliases would be lost with no sign.
  it("reads an answer written after the label rather than under it as a bullet", () => {
    const inline = [
      "# Aldo",
      "",
      "- **Names and nicknames:** Aldo, the old man",
      "",
      field("Age", "81"),
    ].join("\n");
    const lazy = [
      "# Aldo",
      "",
      "- **Names and nicknames:**",
      "  the old man",
      "",
      field("Age", "81"),
    ].join("\n");
    for (const sheet of [inline, lazy]) {
      const aliases = sheetAliases(sheet, FIELDS).join(" | ");
      expect(aliases).toContain("the old man");
      expect(aliases).not.toContain("81");
    }
  });
});

describe("the places a Locations document records", () => {
  it("gives each place its heading, then the names under it", () => {
    const doc = [
      "# Places in the story",
      "",
      "## The harbour",
      "",
      field("Names", "the Mouth", "Porto Vecchio"),
      "",
      field("Atmosphere", "salt and diesel"),
      "",
      "## The lighthouse",
      "",
      field("Names"),
      "",
      field("Description", "white, cracked"),
    ].join("\n");
    expect(placeNames(doc, FIELDS)).toEqual([
      ["The harbour", "the Mouth", "Porto Vecchio"],
      ["The lighthouse"],
    ]);
  });

  it("skips the template's own placeholder, in either language", () => {
    const doc = [
      "# Luoghi",
      "",
      "## [Luogo]",
      "",
      field("Nomi"),
      "",
      "## [Location]",
      "",
      field("Names"),
      "",
      "## Il molo",
      "",
      field("Nomi", "la Punta"),
    ].join("\n");
    expect(placeNames(doc, FIELDS)).toEqual([["Il molo", "la Punta"]]);
  });

  it("counts a place the writer named and described nothing of", () => {
    expect(placeNames("# Places\n\n## The mill\n", FIELDS)).toEqual([
      ["The mill"],
    ]);
  });

  it("names no place with a heading that has no letter in it", () => {
    expect(placeNames("# Places\n\n## —\n\n## 1\n", FIELDS)).toEqual([["1"]]);
  });

  it("gives a place named twice once", () => {
    const doc = [
      "## The mill",
      "",
      field("Names", "the old mill"),
      "",
      "## The mill",
    ].join("\n");
    expect(placeNames(doc, FIELDS)).toEqual([["The mill", "the old mill"]]);
  });

  it("does not take a ### or a # for a place", () => {
    const doc = ["# Places", "", "### Notes", "", field("Names", "x")].join(
      "\n",
    );
    expect(placeNames(doc, FIELDS)).toEqual([]);
  });

  it("reads a place's Names items, never a note nested under one", () => {
    const doc = [
      "## The harbour",
      "",
      "- **Names:**",
      "  - the Mouth",
      "    - where Aldo hid the body",
    ].join("\n");
    expect(placeNames(doc, FIELDS)).toEqual([["The harbour", "the Mouth"]]);
  });
});

describe("the fields read from a template", () => {
  it("takes the sheet's first field, and the first field under the Locations placeholder", () => {
    const character = [
      "# {{title}}",
      "",
      "## Identity",
      "",
      field("Names and nicknames"),
      "",
      field("Age"),
    ].join("\n");
    const locations = [
      "# Places",
      "",
      "<!-- Hint: copy the section for each place. -->",
      "",
      "## [Location]",
      "",
      field("Names"),
      "",
      field("Description"),
    ].join("\n");
    expect(nameFieldsOf(character, locations)).toEqual({
      sheet: ["Names and nicknames:"],
      place: ["Names:"],
      placeholders: ["[Location]"],
    });
  });

  it("answers empty rather than inventing a field for an empty template", () => {
    expect(nameFieldsOf("", "")).toEqual({
      sheet: [],
      place: [],
      placeholders: [],
    });
  });
});
