// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { candidates } from "../domain/candidates";
import {
  GROUPING_CASES,
  groupingBook,
  keyOf,
  keyOfLine,
  rawGroups,
  scoreGrouping,
  type GroupingCase,
  type GroupingOutcome,
  type GroupingPart,
} from "./grouping";

// The adversarial grouping set. `scripts/grouping-eval.mjs` runs the
// real grouping questions over these cases against a real model. This file
// pins that each case's `conflict` is what the real candidate builder raises
// when the grouping is right, and that a wrong grouping shows as a wrong
// candidate, so a live miss is the model's and never the fixture's.

/** The grouping a perfect reader would answer, as the code keeps it. */
function perfect(
  cases: readonly GroupingCase[],
): Record<GroupingPart, Map<string, string>> {
  const names = new Map<string, string>();
  const labels = new Map<string, string>();
  const values = new Map<string, string>();
  for (const one of cases.filter((each) => each.join)) {
    if (one.part === "names")
      names.set(keyOf("names", one.b), keyOf("names", one.a));
    if (one.part === "labels") labels.set(one.b.attribute, one.a.attribute);
  }
  for (const one of cases.filter((each) => each.join && each.part === "values"))
    values.set(keyOf("values", one.b, labels), one.a.norm);
  return { names, labels, values };
}

function outcome(
  cases: readonly GroupingCase[],
  kept: GroupingOutcome["kept"],
): GroupingOutcome {
  return {
    raw: { names: [], labels: [], values: [] },
    kept,
    candidates: candidates(groupingBook(cases), new Set(), {
      entities: kept.names,
      labels: kept.labels,
      values: kept.values,
    }),
  };
}

const NONE: GroupingOutcome["kept"] = {
  names: new Map(),
  labels: new Map(),
  values: new Map(),
};

describe("the adversarial grouping set", () => {
  for (const language of ["en", "it"] as const) {
    const cases = GROUPING_CASES[language];

    it(`is well formed (${language}): unique ids and quotes, every part tempted both ways`, () => {
      expect(new Set(cases.map((one) => one.id)).size).toBe(cases.length);
      const quotes = cases.flatMap((one) => [one.a.quote, one.b.quote]);
      expect(new Set(quotes).size).toBe(quotes.length);
      for (const part of ["names", "labels", "values"] as GroupingPart[]) {
        const mine = cases.filter((one) => one.part === part);
        expect(mine.some((one) => one.join)).toBe(true);
        expect(mine.some((one) => !one.join)).toBe(true);
      }
      // The two sets ask the same questions.
      expect(cases.map((one) => one.id)).toEqual(
        GROUPING_CASES.en.map((one) => one.id),
      );
    });

    it(`raises a candidate on exactly the pairs that disagree when the grouping is right (${language})`, () => {
      const scored = scoreGrouping(cases, outcome(cases, perfect(cases)));
      expect(scored.filter((one) => !one.groupedRight)).toEqual([]);
      expect(scored.filter((one) => !one.candidateRight)).toEqual([]);
    });

    it(`shows a missed merge as a lost or invented candidate (${language})`, () => {
      const scored = scoreGrouping(cases, outcome(cases, NONE));
      const wrong = scored
        .filter((one) => !one.candidateRight)
        .map((one) => one.id)
        .sort();
      // Every pair that is one: a disagreement it hid (n-lighthouse,
      // n-logbook, l-hair, l-job) or a sameness it turned into one
      // (v-keeper, v-genoa, v-harbour).
      expect(wrong).toEqual(
        cases
          .filter((one) => one.join)
          .map((one) => one.id)
          .sort(),
      );
    });
  }

  it("shows a wrong merge as a candidate the book does not hold", () => {
    const cases = GROUPING_CASES.en;
    const kept = perfect(cases);
    const towers = cases.find((one) => one.id === "n-towers") as GroupingCase;
    kept.names.set(keyOf("names", towers.b), keyOf("names", towers.a));
    const baker = cases.find((one) => one.id === "v-baker") as GroupingCase;
    kept.values.set(keyOf("values", baker.b, kept.labels), baker.a.norm);
    const scored = scoreGrouping(cases, outcome(cases, kept));
    expect(
      scored.filter((one) => !one.candidateRight).map((one) => one.id),
    ).toEqual(["n-towers", "v-baker"]);
    expect(scored.find((one) => one.id === "n-towers")).toMatchObject({
      joinedKept: true,
      groupedRight: false,
      raised: true,
    });
  });

  it("scores the model's own merge apart from what the code kept", () => {
    const cases = GROUPING_CASES.en;
    const anchor = cases.find((one) => one.id === "n-anchor") as GroupingCase;
    const scored = scoreGrouping(cases, {
      ...outcome(cases, perfect(cases)),
      raw: {
        names: [[keyOf("names", anchor.a), keyOf("names", anchor.b)]],
        labels: [],
        values: [],
      },
    });
    expect(scored.find((one) => one.id === "n-anchor")).toMatchObject({
      guarded: true,
      joinedRaw: true,
      joinedKept: false,
      groupedRight: true,
    });
  });
});

describe("reading a grouping question and its answer back", () => {
  it("keys a line of each question as the grouping step keys it", () => {
    expect(keyOfLine("names", '"The Old  Revolver" (thing)')).toBe(
      "the old revolver",
    );
    expect(keyOfLine("labels", '"hair colour" (colour, words)')).toBe(
      "hair colour",
    );
    expect(keyOfLine("values", 'job: "lighthouse keeper"')).toBe(
      "job|lighthouse keeper",
    );
    expect(keyOfLine("names", "a line of no shape")).toBeNull();
    expect(keyOfLine("values", 'job: "unterminated')).toBeNull();
    expect(keyOfLine("labels", '"broken (thing)')).toBeNull();
  });

  it("maps the model's numbered groups to keys, dropping what is off the list", () => {
    const question = [
      '1. "the lighthouse" (place)',
      '2. "the Punta Grigia lighthouse" (place)',
      '3. "the anchor" (thing)',
    ].join("\n");
    expect(
      rawGroups(
        "names",
        question,
        JSON.stringify({
          groups: [
            [1, 2],
            [3, 9],
          ],
        }),
      ),
    ).toEqual([["the lighthouse", "the punta grigia lighthouse"]]);
    expect(rawGroups("names", question, "not json")).toEqual([]);
    expect(rawGroups("names", question, JSON.stringify({ groups: 3 }))).toEqual(
      [],
    );
    expect(
      rawGroups("names", question, JSON.stringify({ groups: [1, ["x", 2]] })),
    ).toEqual([]);
  });

  it("builds the set as two Sections whose ledgers quote their own text", () => {
    const book = groupingBook(GROUPING_CASES.it);
    expect(book.map((one) => one.ledger.sourceId)).toEqual([
      "node:grouping-1",
      "node:grouping-2",
    ]);
    for (const { ledger, text } of book)
      for (const claim of ledger.claims)
        expect(text.slice(claim.at, claim.at + claim.quote.length)).toBe(
          claim.quote,
        );
  });
});
