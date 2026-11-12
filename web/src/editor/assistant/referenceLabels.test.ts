// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  CATALOGUE,
  REFERENCE_LOCALES,
} from "../../ai/domain/referenceCatalogue";
import {
  parseReference,
  templateMismatches,
} from "../../ai/domain/referenceRecords";
import { stripUnansweredQuestions } from "../../project/referenceAnswers";
import { stripAsides } from "../../project/asides";
import {
  TEMPLATE_LOCALE_IDS,
  templateLocale,
} from "../reference/referenceTemplates";

// Pins the shipped templates against the reference catalogue. The
// catalogue (`ai/domain/references/*.md`) states every field's label in every
// language, so the role a writer's answer is given never depends on a field's
// position in a template. Every template, in every language, lists the
// catalogue's headings and labels in the catalogue's order, and a template
// with two fields swapped, which a count check cannot see, fails.

function pageNamed(id: string) {
  const page = CATALOGUE.get(id);
  if (!page) throw new Error(id);
  return page;
}

function templateOf(locale: string, pageId: string): string {
  const assets = templateLocale(locale);
  if (!assets) throw new Error(locale);
  if (pageId === "character") return assets.character;
  if (pageId === "arc") return assets.arc;
  const [group, section] = pageId.split(":") as ["guidebook" | "world", string];
  return assets.sections[group][section] ?? "";
}

describe("the shipped templates and the catalogue", () => {
  it("ships exactly the catalogue's languages", () => {
    expect(TEMPLATE_LOCALE_IDS).toEqual([...REFERENCE_LOCALES].sort());
  });

  for (const locale of REFERENCE_LOCALES)
    it(`lists every catalogue heading and label, in order, in ${locale}`, () => {
      const mismatches = [...CATALOGUE.values()].flatMap((page) =>
        templateMismatches(templateOf(locale, page.id), page, locale),
      );
      expect(mismatches).toEqual([]);
    });

  it("fails a template whose two fields were swapped, though the count still matches", () => {
    const page = pageNamed("guidebook:continuity");
    const template = templateOf("en", page.id);
    const swapped = template
      .replace("**Open questions:**", "**@@:**")
      .replace("**Contradictions to resolve:**", "**Open questions:**")
      .replace("**@@:**", "**Contradictions to resolve:**");
    expect(swapped).not.toBe(template);
    expect(templateMismatches(swapped, page, "en")).toHaveLength(2);
    // A heading moved out of its place fails too.
    const character = pageNamed("character");
    const moved = templateOf("en", "character").replace(
      "## Identity",
      "## Identità",
    );
    expect(templateMismatches(moved, character, "en")).toHaveLength(1);
  });

  it("never lets one page repeat a label, in any language", () => {
    for (const page of CATALOGUE.values())
      for (const locale of REFERENCE_LOCALES) {
        const labels = page.fields.map((one) =>
          one.labels[locale].toLowerCase(),
        );
        expect(new Set(labels).size, `${page.id} ${locale}`).toBe(
          labels.length,
        );
      }
  });

  // An untouched template, as the port hands it to a model, is no records at
  // all: the hints and the unanswered questions are gone, and
  // nothing the template says may be read as something the writer wrote.
  it("reads an untouched template, after the port's strip, as no records", () => {
    for (const locale of REFERENCE_LOCALES)
      for (const page of CATALOGUE.values()) {
        const read = stripUnansweredQuestions(
          stripAsides(templateOf(locale, page.id)),
        );
        expect(
          parseReference(read, page, "Marta").records.map((one) => one.label),
          `${page.id} ${locale}`,
        ).toEqual([]);
      }
  });
});
