// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import i18next from "i18next";
import en from "../../locales/en.json";
import italianBundle from "../../locales/it.json";
import type { DocumentProperties } from "../../project/types";
import { MAP_SHAPE_IDS } from "../../ai/domain/types";
import { MAP_SHAPES, mapShapeOf } from "../../ai/domain/structureShapes";
import { SHAPE_IDS, partKeysFor } from "../../project/startingShape";
import { GENRE_IDS } from "../../project/genres";
import { GENRE_PACKS } from "../../ai/domain/genres";
import { projectFactsOf } from "./projectFacts";

// Pins the narrowing that carries the book's own facts to a model. The
// bundles are initialized rather than mocked because the beats are resolved
// through the project's language, and a `t` that echoes its key would assert
// nothing.
await i18next.init({
  lng: "en",
  resources: { en: { translation: en }, it: { translation: italianBundle } },
  interpolation: { escapeValue: false },
});

const props = (
  over: Partial<DocumentProperties["document"]> = {},
): DocumentProperties =>
  ({
    schemaVersion: 1,
    document: {
      id: "doc",
      title: "The Grey Port",
      type: "novel",
      structure: null,
      language: "en",
      createdAt: "2026-09-16T00:00:00.000Z",
      updatedAt: "2026-09-16T00:00:00.000Z",
      goal: null,
      genres: [],
      ageCategory: null,
      tropes: [],
      ...over,
    },
  }) as DocumentProperties;

describe("the book's facts, narrowed for the assistant", () => {
  it("carries the declared genres and age, and nothing when none was said", () => {
    expect(
      projectFactsOf(
        props({ genres: ["fantasy", "romance"], ageCategory: "young-adult" }),
      ),
    ).toMatchObject({
      genres: ["fantasy", "romance"],
      ageCategory: "young-adult",
    });
    const unsaid = projectFactsOf(props());
    expect(unsaid?.genres).toBeUndefined();
    expect(unsaid?.ageCategory).toBeUndefined();
  });

  it("carries the declared tropes, and nothing when none were said", () => {
    // The writer's own words, for the readers and the editor.
    expect(
      projectFactsOf(props({ tropes: ["enemies to lovers"] }))?.tropes,
    ).toEqual(["enemies to lovers"]);
    expect(projectFactsOf(props())?.tropes).toBeUndefined();
  });

  it("offers the writer exactly the genres the assistant has a pack for", () => {
    // The AI layer may not import `project/genres.ts`, so this row holds the
    // two lists in step: an id with no pack is a choice that does nothing,
    // and a pack with no id is one nobody can make.
    expect([...GENRE_PACKS.keys()].sort()).toEqual([...GENRE_IDS].sort());
  });

  it("is null before the project's properties have loaded", () => {
    // The thunk is read per turn, and a turn can land mid-open. Absence stays
    // absence: `projectBriefing` renders nothing for null, and a shape full
    // of empty strings would describe a book that does not exist.
    expect(projectFactsOf(null)).toBeNull();
  });

  it("carries the title, the type, the language and a goal that was set", () => {
    expect(projectFactsOf(props({ goal: 90_000 }))).toMatchObject({
      title: "The Grey Port",
      type: "novel",
      language: "English",
      goal: 90_000,
    });
    // Null is no target set, and it does not reach the model as one.
    expect(projectFactsOf(props())?.goal).toBeUndefined();
  });

  it("carries the language code as the file states it, for the search edition only", () => {
    // Passed raw: `wikiLanguage` is its one reader and validates it there.
    // Nothing is made of an empty value.
    expect(projectFactsOf(props({ language: "it-IT" }))?.languageCode).toBe(
      "it-IT",
    );
    expect(
      projectFactsOf(props({ language: "" }))?.languageCode,
    ).toBeUndefined();
  });

  it("treats `empty` and an unknown shape as no declared structure", () => {
    // `empty` is a real choice, "lay nothing out", and not a declared
    // structure. The briefing says opposite things in the two cases, so it
    // reaches the briefing as absence rather than as a shape with no beats.
    expect(
      projectFactsOf(props({ structure: "empty" }))?.structure,
    ).toBeUndefined();
    expect(
      projectFactsOf(props({ structure: null }))?.structure,
    ).toBeUndefined();
    expect(
      projectFactsOf(props({ structure: "spiral" }))?.structure,
    ).toBeUndefined();
  });

  it("expands a declared shape into its label, description and beats", () => {
    const facts = projectFactsOf(props({ structure: "threeact" }));
    expect(facts?.structure?.id).toBe("threeact");
    expect(facts?.structure?.label).toBe(i18next.t("create.shape.threeact"));
    expect(facts?.structure?.description).toBe(
      i18next.t("create.shapeDesc.threeact"),
    );
    expect(facts?.structure?.beats).toHaveLength(3);
    // The chooser's recommendation is for the person picking a shape, not for
    // a model reading one that was picked months ago.
    expect(facts?.structure?.description).not.toContain(
      i18next.t("create.shapeFit.threeact"),
    );
  });

  it("resolves the beats in the PROJECT's language, not the interface's", () => {
    // They are read beside a manifest of the writer's own Part titles, and the
    // comparison is theirs to make in the language they write in. The UI here
    // is English; the book is Italian.
    const facts = projectFactsOf(
      props({ structure: "threeact", language: "it" }),
    );
    // The language reaches the model by its endonym: what the language
    // picker shows the writer, and the one spelling that cannot be read as a
    // request to answer in English.
    expect(facts?.language).toBe("Italiano");
    const italian = i18next.getFixedT("it");
    expect(facts?.structure?.beats).toEqual([
      italian("create.partSetup"),
      italian("create.partConfrontation"),
      italian("create.partResolution"),
    ]);
    expect(facts?.structure?.beats[0]).not.toBe(
      i18next.getFixedT("en")("create.partSetup"),
    );
  });

  it("consults only the primary subtag, so en-GB and en are one bundle", () => {
    expect(
      projectFactsOf(props({ structure: "threeact", language: "en-GB" }))
        ?.structure?.beats,
    ).toEqual(
      projectFactsOf(props({ structure: "threeact", language: "en" }))
        ?.structure?.beats,
    );
  });
});

// `/map` keeps its own table of the declared structures, because the AI core
// may not import the project layer. These rows hold the two in step:
// a shape added to the create dialog with no drawing, or a Part added to a
// scaffold with no beat, fails here rather than as a `/map` that treats a
// declared book as undeclared.
describe("the structures /map knows", () => {
  it("are every declared shape the create dialog offers", () => {
    expect([...MAP_SHAPE_IDS].sort()).toEqual(
      SHAPE_IDS.filter((id) => id !== "empty").sort(),
    );
    for (const id of SHAPE_IDS)
      expect(mapShapeOf(projectFactsOf(props({ structure: id })))).toBe(
        id === "empty" ? null : id,
      );
  });

  it("name one beat per scaffold Part, in the scaffold's order", () => {
    for (const id of MAP_SHAPE_IDS)
      expect(MAP_SHAPES[id].beats.map((beat) => beat.id)).toEqual(
        partKeysFor(id).map((key) =>
          key.replace("create.part", "").toLowerCase(),
        ),
      );
  });
});
