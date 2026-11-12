// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { modelText, withoutAsides } from "../../editor/assistant/sourceText";
import { pageOf } from "../domain/referenceCatalogue";
import { parseReference } from "../domain/referenceRecords";
import { fold } from "../domain/textMatch";
import { scoreExpectations, type Expectation } from "./score";

// The guided book, the one book in the eval set with a guidebook
// page: two lives of one woman told in turn, the page saying they contradict
// each other by design, and one contradiction inside a single life the page
// does not excuse. `scripts/fact-eval.mjs --corpus guided` runs the real
// check over it with and without the page. This file pins that every word
// `expect.json` scores by is in the Sections it names, that no reference
// states a fact a ledger could hold against the prose, and the scoring the
// runner reports with.
//
// The references are the app's own templates, filled as a writer fills them:
// the continuity page, a character sheet and a timeline, hints and
// unanswered questions left in. A page of free prose would parse as one
// unclassified record, and measure a guidebook no writer of this app has
// instead of its fields.

const FILES = import.meta.glob("./guided/**/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const EXPECT = import.meta.glob("./guided/*/expect.json", {
  eager: true,
  import: "default",
}) as Record<string, Expectation[]>;

function textOf(language: string, sourceId: string): string {
  const name = sourceId.replace(/^[a-z]+:/u, "");
  const text = FILES[`./guided/${language}/${name}`];
  if (text === undefined) throw new Error(`no ${name} in ${language}`);
  return text;
}

describe("the guided book's fixture", () => {
  for (const language of ["en", "it"]) {
    const expectations = EXPECT[`./guided/${language}/expect.json`];

    it(`states every disagreement ${language} expects, on both sides, in the Sections it names`, () => {
      expect(expectations.map((one) => one.id)).toEqual([
        "work",
        "city",
        "eyes",
      ]);
      expect(expectations.filter((one) => one.explained)).toHaveLength(2);
      for (const expectation of expectations)
        for (const side of expectation.sides)
          expect(
            side.sources.some((sourceId) =>
              side.words.some((word) =>
                fold(textOf(language, sourceId)).includes(fold(word)),
              ),
            ),
          ).toBe(true);
    });

    it(`keeps the unexplained disagreement inside one life, and the explained ones across the two (${language})`, () => {
      // Odd Sections are one life, even the other: the page's own rule.
      const life = (sourceId: string) =>
        Number(/section--(\d+)/u.exec(sourceId)?.[1]) % 2;
      for (const expectation of expectations) {
        const lives = expectation.sides.map(
          (side) => new Set(side.sources.map(life)),
        );
        const across = lives[0].size === 1 && lives[1].size === 1;
        expect(across && [...lives[0]][0] !== [...lives[1]][0]).toBe(
          expectation.explained,
        );
      }
    });

    it(`reads every reference as a filled template, field by field (${language})`, () => {
      // Read as the port reads it, then parsed as the ledger and the judge
      // parse it: a label the catalogue does not know would turn a record
      // into context only, and the measurement would be of that.
      const pages = [
        [
          "guidebook--continuity.md",
          { group: "guidebook", sectionId: "continuity" },
        ],
        ["character--marta.md", { group: "characters" }],
        ["world--timeline.md", { group: "world", sectionId: "timeline" }],
      ] as const;
      for (const [name, shelf] of pages) {
        const text = FILES[`./guided/${language}/${name}`];
        const parsed = parseReference(
          modelText("reference", withoutAsides(text)),
          pageOf({ kind: "reference", ...shelf }),
          "Marta",
        );
        expect(parsed.interpretation, name).toBe("full");
        expect(parsed.records.length, name).toBeGreaterThan(0);
        expect(
          parsed.records.filter((one) => one.field === null),
          name,
        ).toEqual([]);
      }
    });

    it(`has references that name no colour and no Section's facts (${language})`, () => {
      const page = FILES[`./guided/${language}/guidebook--continuity.md`];
      expect(page).toMatch(/^# /u);
      // Every reference is read as a sheet too (`declaredLedgerText`): a fact
      // on one would raise a sheet candidate of its own, and the measurement
      // would be of that, not of the guidance.
      const references = [
        page,
        FILES[`./guided/${language}/character--marta.md`],
        FILES[`./guided/${language}/world--timeline.md`],
      ].join("\n");
      for (const word of [
        "grey",
        "brown",
        "grigi",
        "castani",
        "turin",
        "genoa",
        "torino",
        "genova",
        "doctor",
        "medico",
        "latin",
        "latino",
      ])
        expect(fold(references)).not.toContain(word);
    });
  }
});

describe("scoring a book's written disagreements", () => {
  const EYES: Expectation = {
    id: "eyes",
    explained: false,
    sides: [
      { sources: ["node:a"], words: ["grey"] },
      { sources: ["node:c"], words: ["brown"] },
    ],
  };
  const WORK: Expectation = {
    id: "work",
    explained: true,
    sides: [
      { sources: ["node:a", "node:c"], words: ["doctor"] },
      { sources: ["node:b"], words: ["Latin", "taught"] },
    ],
  };

  it("matches a finding that quotes both sides from the Sections that state them, whatever the case", () => {
    const scored = scoreExpectations(
      [EYES, WORK],
      [
        {
          evidence: [
            { sourceId: "node:a", quote: "It was GREY, like her eyes." },
            { sourceId: "node:c", quote: "kind brown eyes" },
          ],
        },
        {
          evidence: [
            { sourceId: "node:c", quote: "the doctor on the ward" },
            { sourceId: "node:b", quote: "She taught Latin" },
          ],
        },
      ],
    );
    expect(scored).toEqual({
      expectations: [
        { id: "eyes", explained: false, findings: 1 },
        { id: "work", explained: true, findings: 1 },
      ],
      unexpected: 0,
    });
  });

  it("carries a disagreement the check is known not to find, so a report shows it apart from recall", () => {
    const scored = scoreExpectations(
      [{ ...EYES, known: "loss" }],
      [
        {
          evidence: [
            { sourceId: "node:a", quote: "grey" },
            { sourceId: "node:c", quote: "brown" },
          ],
        },
      ],
    );
    expect(scored.expectations).toEqual([
      { id: "eyes", explained: false, known: "loss", findings: 1 },
    ]);
  });

  it("counts a finding that quotes one side only, or the right words from the wrong Section, as about something else", () => {
    const scored = scoreExpectations(
      [EYES],
      [
        { evidence: [{ sourceId: "node:a", quote: "grey eyes" }] },
        {
          evidence: [
            { sourceId: "node:b", quote: "grey" },
            { sourceId: "node:c", quote: "brown" },
          ],
        },
      ],
    );
    expect(scored).toEqual({
      expectations: [{ id: "eyes", explained: false, findings: 0 }],
      unexpected: 2,
    });
  });
});
