// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  GUIDEBOOK_SECTION_IDS,
  WORLD_SECTION_IDS,
} from "../../project/referenceSections";
import { placeNames, sheetAliases } from "../../project/referenceNames";
import {
  NAME_FIELDS,
  SECTION_TEMPLATES,
  TEMPLATE_LOCALE_IDS,
  arcTemplateFor,
  characterTemplateFor,
  sectionTemplate,
  substituteTitle,
  templateLocale,
} from "./referenceTemplates";
import { PRODUCT } from "../../product";

// The catalogue and the assets must never drift: every id has a template, and
// every template belongs to an id. A section that exists in the picker but
// writes an empty file — or an asset nobody can create — is the failure this
// suite exists to make impossible.

describe("the section assets", () => {
  it("has a non-empty template for every catalogue id", () => {
    for (const [group, ids] of [
      ["guidebook", GUIDEBOOK_SECTION_IDS],
      ["world", WORLD_SECTION_IDS],
    ] as const) {
      for (const id of ids) {
        const template = SECTION_TEMPLATES[group][id];
        expect(template, `${group}/${id}`).toBeTruthy();
      }
    }
  });

  it("keeps every template key inside the catalogue", () => {
    expect(Object.keys(SECTION_TEMPLATES.guidebook).sort()).toEqual(
      [...GUIDEBOOK_SECTION_IDS].sort(),
    );
    expect(Object.keys(SECTION_TEMPLATES.world).sort()).toEqual(
      [...WORLD_SECTION_IDS].sort(),
    );
  });
});

describe("the hand-named templates", () => {
  it("carries the title token, so no hidden second name can disagree", () => {
    const en = templateLocale("en");
    expect(en?.character).toContain("{{title}}");
    expect(en?.arc).toContain("{{title}}");
  });

  it("substitutes the writer's name everywhere the token appears", () => {
    const filled = substituteTitle(
      "# {{title}}\n\n{{title}} — Arc",
      "Maren Voss",
    );
    expect(filled).toBe("# Maren Voss\n\nMaren Voss — Arc");
    expect(filled).not.toContain("{{title}}");
  });
});

describe("the locale assets", () => {
  // A template is written into the writer's own folder, so the
  // product it names is the public one from `product.json` — never the
  // internal name, and never an unfilled `{{product}}`.
  it("names the product by its public name, filled in", () => {
    const blurbs = TEMPLATE_LOCALE_IDS.map(
      (locale) => templateLocale(locale)?.sections.guidebook.blurb ?? "",
    );
    for (const blurb of blurbs) expect(blurb).toContain(PRODUCT.name);
    for (const locale of TEMPLATE_LOCALE_IDS) {
      const assets = templateLocale(locale);
      const every = [
        assets?.character ?? "",
        assets?.arc ?? "",
        ...Object.values(assets?.sections.guidebook ?? {}),
        ...Object.values(assets?.sections.world ?? {}),
      ];
      for (const text of every) {
        expect(text).not.toMatch(/phospheare/i);
        expect(text).not.toContain("{{product}}");
      }
    }
  });

  it("keeps every language's section keys inside the catalogue", () => {
    for (const locale of TEMPLATE_LOCALE_IDS) {
      const assets = templateLocale(locale);
      expect(Object.keys(assets?.sections.guidebook ?? {}).sort()).toEqual(
        [...GUIDEBOOK_SECTION_IDS].sort(),
      );
      expect(Object.keys(assets?.sections.world ?? {}).sort()).toEqual(
        [...WORLD_SECTION_IDS].sort(),
      );
    }
  });

  it("carries the title token in every language's hand-named kinds", () => {
    for (const locale of TEMPLATE_LOCALE_IDS) {
      const assets = templateLocale(locale);
      expect(assets?.character, `${locale} character`).toContain("{{title}}");
      expect(assets?.arc, `${locale} arc`).toContain("{{title}}");
    }
  });
});

// ── The language dimension ───────────────────────────────────────────────────
//
// The assets are keyed by the project's language. English and Italian
// both ship complete; every other language falls back to English,
// because an empty template is a blank document, which reads to
// a writer as a broken app rather than as a missing translation.

describe("the language dimension", () => {
  it("serves English for an English project", () => {
    expect(sectionTemplate("guidebook", "theme", "en")).toBe(
      SECTION_TEMPLATES.guidebook.theme,
    );
    expect(characterTemplateFor("en")).toBe(templateLocale("en")?.character);
    expect(arcTemplateFor("en")).toBe(templateLocale("en")?.arc);
  });

  it("serves Italian for an Italian project, not the English fallback", () => {
    const italian = templateLocale("it");
    expect(sectionTemplate("guidebook", "theme", "it")).toBe(
      italian?.sections.guidebook.theme,
    );
    expect(sectionTemplate("guidebook", "theme", "it")).not.toBe(
      SECTION_TEMPLATES.guidebook.theme,
    );
    expect(characterTemplateFor("it")).toBe(italian?.character);
    expect(arcTemplateFor("it")).toBe(italian?.arc);
  });

  it("falls back to English for a language with no assets", () => {
    for (const language of ["fr", "ja"]) {
      expect(sectionTemplate("guidebook", "theme", language)).toBe(
        SECTION_TEMPLATES.guidebook.theme,
      );
      expect(characterTemplateFor(language)).toBe(
        templateLocale("en")?.character,
      );
      expect(arcTemplateFor(language)).toBe(templateLocale("en")?.arc);
    }
  });

  // `document.language` is a hand-editable string from the properties file, so
  // the fallback must fail closed for inherited Object names: a plain lookup
  // answers `constructor`, `__proto__` and `toString` with truthy
  // non-templates, and `characterTemplateFor("constructor")` must return the
  // English sheet rather than throw.
  it("falls back to English for inherited Object names, not their values", () => {
    for (const language of ["constructor", "__proto__", "toString"]) {
      expect(characterTemplateFor(language)).toBe(
        templateLocale("en")?.character,
      );
      expect(arcTemplateFor(language)).toBe(templateLocale("en")?.arc);
    }
  });

  it("reads only the primary subtag, so a region keeps its language", () => {
    expect(sectionTemplate("world", "economy", "en-GB")).toBe(
      SECTION_TEMPLATES.world.economy,
    );
    expect(sectionTemplate("world", "economy", "EN-US")).toBe(
      SECTION_TEMPLATES.world.economy,
    );
  });

  it("falls back when the project has no language recorded", () => {
    for (const language of [null, undefined, ""]) {
      expect(sectionTemplate("guidebook", "logline", language)).toBe(
        SECTION_TEMPLATES.guidebook.logline,
      );
    }
  });

  it("still answers empty for an id outside the catalogue", () => {
    expect(sectionTemplate("guidebook", "not-a-section", "it")).toBe("");
  });
});

// `/where` reads names from the fields the templates ship, and the
// labels are read from the templates, so a template edit that moves the names
// field is caught here rather than by a writer whose nicknames stop working.
describe("the names fields, as every shipped template spells them", () => {
  it("finds one sheet label, one place label and one placeholder per language", () => {
    expect(NAME_FIELDS.sheet).toEqual(
      expect.arrayContaining(["Names and nicknames:", "Nomi e soprannomi:"]),
    );
    expect(NAME_FIELDS.place).toEqual(
      expect.arrayContaining(["Names:", "Nomi:"]),
    );
    expect(NAME_FIELDS.placeholders).toEqual(
      expect.arrayContaining(["[Location]", "[Luogo]"]),
    );
    expect(NAME_FIELDS.sheet).toHaveLength(TEMPLATE_LOCALE_IDS.length);
  });

  it("reads a sheet and a Locations document filled in on the shipped templates", () => {
    for (const id of TEMPLATE_LOCALE_IDS) {
      // The first empty bullet of a sheet is its first field's: the names.
      const sheet = substituteTitle(characterTemplateFor(id), "Aldo").replace(
        /^(\s*)- *$/m,
        "$1- the old man",
      );
      expect(sheetAliases(sheet, NAME_FIELDS)).toEqual(["the old man"]);
      // The unfilled template names no place: its heading is the placeholder.
      const locations = sectionTemplate("world", "locations", id);
      expect(placeNames(locations, NAME_FIELDS)).toEqual([]);
    }
  });
});
