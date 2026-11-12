// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { candidates, type LedgerInBook } from "./candidates";
import {
  LEDGER_RECIPE_REVISION,
  type Claim,
  type SectionLedger,
} from "./ledger";

/** A Section whose text is its sentences, one claim per sentence given. */
function section(
  sourceId: string,
  sentences: (string | [string, Partial<Claim> & { attribute: string }])[],
  origin: SectionLedger["origin"] = "prose",
): LedgerInBook {
  let text = "";
  const claims: Claim[] = [];
  for (const one of sentences) {
    const [sentence, fact] = typeof one === "string" ? [one, null] : one;
    if (fact)
      claims.push({
        entity: "Marta",
        kind: "person",
        status: "stated",
        type: "words",
        value: fact.norm ?? "",
        norm: "",
        quote: sentence,
        at: text.length,
        change: false,
        ...fact,
      });
    text += `${sentence} `;
  }
  return {
    ledger: {
      sourceId,
      contentHash: "h",
      recipeRevision: LEDGER_RECIPE_REVISION,
      model: "m",
      dropped: 0,
      origin,
      claims,
    },
    text,
  };
}

const eyes = (norm: string, more: Partial<Claim> = {}) =>
  ({ attribute: "eye colour", type: "colour", norm, ...more }) as const;
const years = (entity: string, norm: string, more: Partial<Claim> = {}) =>
  ({
    attribute: "age",
    type: "number",
    entity,
    norm: `${norm} years`,
    ...more,
  }) as const;
const day = (entity: string, norm: string) =>
  ({ attribute: "day", type: "day", entity, norm }) as const;
const birth = (entity: string, norm: string) =>
  ({ attribute: "birth", type: "date", entity, norm }) as const;
const hair = (norm: string, more: Partial<Claim> = {}) =>
  ({ attribute: "hair colour", type: "colour", norm, ...more }) as const;

describe("candidates", () => {
  it("finds one fact stated two ways, the rarer value first", () => {
    const book = [
      section("node:A", [["Marta's eyes were grey.", eyes("grey")]]),
      section("node:B", [
        ["Her grey eyes.", eyes("grey")],
        ["Green eyes, Marta's.", eyes("green")],
      ]),
      section("node:C", [["Grey, those eyes.", eyes("grey")]]),
    ];
    const [found, ...rest] = candidates(book);
    expect(rest).toEqual([]);
    expect(found).toMatchObject({
      key: "marta|eye colour|green|grey",
      kind: "conflict",
      entity: "Marta",
      counts: [1, 3],
    });
    // The common side shown is the nearest one, for the judge to read.
    expect(found.sides.map((side) => [side.sourceId, side.norm])).toEqual([
      ["node:B", "green"],
      ["node:B", "grey"],
    ]);
    // Dismissed, it is not found again.
    expect(candidates(book, new Set([found.key]))).toEqual([]);
  });

  it("lets a change the story narrates start a new stretch", () => {
    const book = [
      section("node:A", [
        ["Marta's hair was black.", hair("black")],
        ["Marta dyed her hair red.", hair("red", { change: true })],
        ["Her red hair.", hair("red")],
      ]),
      section("node:B", [["Her black hair shone.", hair("black")]]),
    ];
    const found = candidates(book);
    // Black before the dye is no slip; black after it is.
    expect(found).toHaveLength(1);
    expect(found[0].sides[0]).toMatchObject({
      sourceId: "node:B",
      norm: "black",
    });
  });

  it("holds a sheet against the story as it opens", () => {
    const book = [
      section("reference:marta", [["Eyes: grey", eyes("grey")]], "sheet"),
      section("node:A", [["Her green eyes.", eyes("green")]]),
    ];
    const [found] = candidates(book);
    expect(found).toMatchObject({ kind: "sheet", counts: [1, 1] });
    expect(found.sides.map((side) => side.origin)).toEqual(["prose", "sheet"]);
  });

  it("reads one person under every name the ledgers give them, and never guesses between two", () => {
    const age = (entity: string, norm: string) => years(entity, norm);
    const book = [
      section("node:A", [
        ["Marta Neri was 34.", age("Marta Neri", "34")],
        ["Paolo Neri was 60.", age("Paolo Neri", "60")],
        [
          "They called her Tata.",
          {
            attribute: "nickname",
            type: "name",
            entity: "Marta Neri",
            norm: "tata",
            value: "Tata",
          },
        ],
      ]),
      section("node:B", [
        ["Marta was 35.", age("Marta", "35")],
        ["Tata, 36.", age("Tata", "36")],
        // "Neri" is two people: never merged with either.
        ["Neri was 61.", age("Neri", "61")],
      ]),
    ];
    const keys = candidates(book).map((one) => one.key);
    expect(keys).toContain("marta neri|age|34 years|35 years");
    expect(keys).toContain("marta neri|age|34 years|36 years");
    expect(keys.some((key) => key.includes("61"))).toBe(false);
  });

  it("checks a stated weekday against the calendar, taking a missing year from the last full date", () => {
    const date = (norm: string, entity = norm) => day(entity, norm);
    const book = [
      section("node:A", [
        // 14 March 1998 was a Saturday: right.
        ["Saturday 14 March 1998.", date("1998-03-14 sat", "the wedding")],
        // The same day, without its weekday or its year: the same date.
        ["The wedding, on the 14th.", date("--03-14", "the wedding")],
        ["The wedding, in 1998.", date("1998", "the wedding")],
        // 16 March 1998 was a Monday, not a Tuesday.
        ["Tuesday the 16th.", date("--03-16 tue")],
        // No weekday, or no real day to hold it to: nothing to check.
        ["The 20th.", date("--03-20")],
        ["The 31st of February.", date("1998-02-31 mon")],
      ]),
    ];
    const found = candidates(book);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: "calendar",
      key: "calendar|1998-03-16|tue",
      expected: "mon",
    });
    expect(
      candidates([
        section("node:A", [["Tuesday the 16th.", date("--03-16 tue")]]),
      ]),
    ).toEqual([]);
  });

  it("finds a name spelt once a letter from one the book writes often", () => {
    const book = [
      section("node:A", [
        ["Marta opened the door.", eyes("grey")],
        "Marta laughed. Marta slept. Then Martha woke.",
        // A name the book uses about as often is another person.
        "Leon came. Leo went. Leon and Leo.",
      ]),
    ];
    book[0].ledger.claims.push({
      ...book[0].ledger.claims[0],
      entity: "Leo",
      attribute: "job",
      type: "words",
      norm: "baker",
    });
    const found = candidates(book);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: "name",
      counts: [1, 3],
      key: "marta|name||marta|martha",
    });
    expect(found[0].sides[0]).toMatchObject({ quote: "Martha" });
    expect(found[0].sides[1]).toMatchObject({ quote: "Marta", at: 0 });
  });

  it("compares a free value in two wordings as one, never two numbers, and ranks names before values and fixed before free", () => {
    const job = (norm: string, value: string) =>
      ({ attribute: "job", norm, value }) as const;
    const home = (norm: string, value: string) =>
      ({ attribute: "home", norm, value }) as const;
    const book = [
      section("node:A", [
        // One job the model normed two ways, because the book words it alike.
        ["Era fornaio.", job("baker", "fornaio")],
        ["Il fornaio rise.", job("fornaio", "fornaio")],
        ["Faceva il medico.", job("doctor", "medico")],
        // One home in two wordings, or two homes: the judge's question,
        // never word containment's, so it is raised, last.
        ["Viveva alla villa.", home("villa", "villa")],
        [
          "La villa sulla collina.",
          home("villa on the hill", "villa sulla collina"),
        ],
        ["Aveva 30 anni.", years("Marta", "30")],
        ["Trent'anni: 30.", years("Marta", "30")],
        ["Ne aveva 31.", years("Marta", "31")],
        "Marta, Marta, Marta e Martha.",
      ]),
    ];
    expect(candidates(book).map((one) => `${one.kind}:${one.key}`)).toEqual([
      "name:marta|name||marta|martha",
      "conflict:marta|age|30 years|31 years",
      "conflict:marta|job|baker|doctor",
      "conflict:marta|home|villa|villa on the hill",
    ]);
  });

  it("keeps a negated or qualified wording apart from its opposite, for the judge", () => {
    const job = (norm: string) =>
      ({ attribute: "job", norm, value: norm }) as const;
    const book = [
      section("node:A", [["Marta is a doctor.", job("doctor")]]),
      section("node:B", [["Marta is not a doctor.", job("not doctor")]]),
    ];
    expect(candidates(book).map((one) => `${one.kind}:${one.key}`)).toEqual([
      "conflict:marta|job|doctor|not doctor",
    ]);
  });

  it("holds two sheets against each other when they disagree, for the writer to resolve", () => {
    const job = (norm: string) =>
      ({ attribute: "job", norm, value: norm }) as const;
    const book = [
      section("reference:a", [["Job: doctor", job("doctor")]], "sheet"),
      section("reference:b", [["Job: teacher", job("teacher")]], "sheet"),
    ];
    const [found, ...rest] = candidates(book);
    expect(rest).toEqual([]);
    expect(found).toMatchObject({
      kind: "sheets",
      key: "marta|job|doctor|teacher",
      counts: [1, 1],
    });
    expect(found.sides.map((side) => side.origin)).toEqual(["sheet", "sheet"]);

    // Two sheets that agree raise nothing; a change one sheet dates to a
    // Section is another stretch, not a disagreement with the opening.
    expect(
      candidates([
        section("reference:a", [["Job: doctor", job("doctor")]], "sheet"),
        section("reference:b", [["Job: doctor", job("doctor")]], "sheet"),
      ]),
    ).toEqual([]);
    expect(
      candidates([
        section("node:A", ["Nothing here."]),
        section("node:B", ["Nor here."]),
        section("reference:a", [["Job: doctor", job("doctor")]], "sheet"),
        section(
          "reference:b",
          [
            [
              "Becomes a teacher in chapter two",
              { ...job("teacher"), change: true, from: "node:B" },
            ],
          ],
          "sheet",
        ),
      ]),
    ).toEqual([]);
  });

  it("pairs a distance with a time only within one Section and a page of each other", () => {
    const tower = (attribute: string, norm: string) =>
      ({
        entity: "the tower",
        kind: "thing",
        status: "stated",
        attribute,
        type: "number",
        norm,
        value: norm,
      }) as const;
    const far = "x".repeat(2_500);
    // Its height in one chapter, its bell's ringing in another: no journey.
    expect(
      candidates([
        section("node:A", [
          ["Fifty metres tall.", tower("height", "50 metres")],
        ]),
        section("node:B", [
          ["The bell rang an hour.", tower("ringing", "3600 seconds")],
        ]),
      ]),
    ).toEqual([]);
    // The same Section, a page apart: still no journey.
    expect(
      candidates([
        section("node:A", [
          ["Fifty metres tall.", tower("height", "50 metres")],
          far,
          ["The bell rang an hour.", tower("ringing", "3600 seconds")],
        ]),
      ]),
    ).toEqual([]);
    // Side by side, an impossible speed, of a place: a journey to judge. A
    // thing's metres and seconds are its measure and its duration, never a
    // journey; the tower above raises nothing however close.
    const pass = (attribute: string, norm: string) =>
      ({
        ...tower(attribute, norm),
        entity: "the pass",
        kind: "place",
      }) as const;
    const [found] = candidates([
      section("node:A", [
        ["A hundred kilometres off.", pass("distance", "100000 metres")],
        ["They were there in a minute.", pass("time", "60 seconds")],
      ]),
    ]);
    expect(found).toMatchObject({ kind: "travel", expected: "6000" });
  });

  it("dates each side by the last full date the book states before it", () => {
    const colour = (entity: string, norm: string) =>
      ({ attribute: "colour", type: "colour", entity, norm }) as const;
    const book = [
      section("node:A", [
        ["Tuesday 3 September 2024.", day("the first day", "2024-09-03")],
        ["The gate was green.", colour("the school gate", "green")],
        ["The green gate again.", colour("the school gate", "green")],
      ]),
      section("node:B", [
        ["2 June 1990, long ago.", day("the photo", "1990-06")],
        ["La cancellata marrone.", colour("the school gate", "brown")],
      ]),
    ];
    const [found] = candidates(book);
    expect(found).toMatchObject({
      key: "the school gate|colour|brown|green",
      counts: [1, 2],
    });
    // A partial date is no date to tell story time by: the last full one is.
    expect(found.sides.map((side) => side.dated)).toEqual([
      "2024-09-03",
      "2024-09-03",
    ]);
  });

  it("counts relative dates from the last one, and checks the weekday they name", () => {
    const date = day;
    const book = [
      section("node:A", [
        ["Tuesday 3 September 2024.", date("the first day", "2024-09-03 tue")],
        ["Born in 1990.", birth("Marta", "1990")],
        ["Three days later, a Thursday.", date("the visit", "+3d thu")],
        ["The following Monday.", date("the party", "next mon")],
        ["Two days on, a Tuesday.", date("the trip", "+2d tue")],
      ]),
    ];
    const found = candidates(book);
    // 3 Sep + 3 is Friday the 6th; the birth moves nothing; the next
    // Monday is the 9th, and two days on is Wednesday the 11th.
    expect(found.map((one) => [one.date, one.expected, one.key])).toEqual([
      ["2024-09-06", "fri", "calendar|2024-09-06|thu"],
      ["2024-09-11", "wed", "calendar|2024-09-11|tue"],
    ]);
  });

  it("counts weeks, months, years and days back, and checks no weekday after a day it cannot name", () => {
    const date = day;
    const book = [
      section("node:A", [
        ["Wednesday 31 January 2024.", date("the day", "2024-01-31 wed")],
        ["A month later.", date("the letter", "+1m")],
        // 29 February, reckoned: the next day's weekday goes unchecked.
        ["The next day, a Monday.", date("the reply", "+1d mon")],
        ["Monday 4 March 2024.", date("the trial", "2024-03-04 mon")],
        ["Two weeks on, a Sunday.", date("the verdict", "+2w sun")],
        ["The day before, a Sunday.", date("the eve", "-1d sun")],
        ["A year later.", date("the appeal", "+1y")],
        ["Leo was 25.", years("Leo", "25", { since: "birth" })],
        ["Leo, born 1 June 2000.", birth("Leo", "2000-06-01")],
      ]),
    ];
    const found = candidates(book);
    // 4 March + 2 weeks is Monday the 18th, and the day before it Sunday;
    // a year on is 17 March 2025, when Leo, born in June 2000, is 24.
    expect(found.map((one) => [one.kind, one.date, one.expected])).toEqual([
      ["calendar", "2024-03-18", "mon"],
      ["years", undefined, "24"],
    ]);
  });

  it("holds a sheet's dated change from its Section on, and cuts the prose there", () => {
    const book = [
      section("node:A", [["Her black hair.", hair("black")]]),
      section("node:B", [["Her red hair.", hair("red")]]),
      section("node:C", [
        ["Red hair again.", hair("red")],
        ["Black hair, suddenly.", hair("black")],
      ]),
      section(
        "reference:marta",
        [
          ["Hair: black", hair("black")],
          ["Dyes it red in B", hair("red", { change: true, from: "node:B" })],
          // Dated by no Section, or by one the book lost: never held.
          ["Goes grey one day", hair("grey", { change: true })],
          ["Green in Z", hair("green", { change: true, from: "node:Z" })],
        ],
        "sheet",
      ),
    ];
    const found = candidates(book);
    // Black before B and red from B are two stretches, no slip; black in
    // C is one, against the sheet's red.
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "sheet", counts: [3, 3] });
    expect(found[0].sides.map((side) => [side.sourceId, side.norm])).toEqual([
      ["node:C", "black"],
      ["reference:marta", "red"],
    ]);
    // The fact through the book, each value where the prose first gives it.
    expect(found[0].history?.map((one) => [one.sourceId, one.norm])).toEqual([
      ["node:A", "black"],
      ["node:B", "red"],
      ["node:C", "black"],
    ]);
  });

  it("holds a dated change after the prose narrates it in that Section", () => {
    const book = [
      section("node:A", [["Brown hair.", hair("brown")]]),
      section("node:B", [
        ["Still brown that morning.", hair("brown")],
        ["She dyed it red.", hair("red", { change: true })],
      ]),
      section(
        "reference:marta",
        [
          ["Hair: brown", hair("brown")],
          ["Red from B", hair("red", { change: true, from: "node:B" })],
        ],
        "sheet",
      ),
    ];
    expect(candidates(book)).toEqual([]);
  });

  it("compares two wordings of one value as the one it was grouped under", () => {
    const job = (norm: string) => ({ attribute: "job", norm }) as const;
    const book = [
      section("node:A", [
        ["A baker.", job("baker")],
        ["Il fornaio.", job("fornaio")],
      ]),
    ];
    expect(candidates(book)).toHaveLength(1);
    expect(
      candidates(book, new Set(), {
        values: new Map([["job|fornaio", "baker"]]),
      }),
    ).toEqual([]);
  });

  it("holds an age to a birth date and the story's day", () => {
    const book = [
      section("node:A", [
        ["It was 1 September 2023.", day("the day", "2023-09-01")],
        ["Leo was four.", years("Leo", "4", { since: "birth" })],
        ["Leo was three.", years("Leo", "3", { since: "birth" })],
      ]),
      section(
        "reference:leo",
        [["Born 1 March 2020.", birth("Leo", "2020-03-01")]],
        "sheet",
      ),
    ];
    const ageOf = candidates(book).find((one) => one.kind === "years");
    expect(ageOf).toMatchObject({
      key: "leo|since|birth|4 years|2020-03-01",
      expected: "3",
    });
    expect(ageOf?.sides[0]).toMatchObject({
      quote: "Leo was four.",
      dated: "2023-09-01",
    });
    // A birth with only a year allows either side of the birthday: born in
    // 2019, four or three in September 2023.
    book[1].ledger.claims[0].norm = "2019";
    expect(candidates(book).filter((one) => one.kind === "years")).toEqual([]);
  });

  it("raises a distance and a time no one covers at a walk or a drive", () => {
    const route = (attribute: string, norm: string) =>
      ({
        attribute,
        type: "number",
        entity: "the road to school",
        kind: "place",
        status: "stated",
        norm,
      }) as const;
    const book = [
      section("node:A", [
        ["Eight hundred metres.", route("length", "800 metres")],
        ["Two hours on foot.", route("time on foot", "7200 seconds")],
        ["Ten minutes on foot.", route("time on foot", "600 seconds")],
        // A person's height and a time are no journey.
        ["Marta, 1.7 metres.", years("Marta", "1.7", { norm: "1.7 metres" })],
        ["Marta slept an hour.", years("Marta", "1", { norm: "3600 seconds" })],
      ]),
    ];
    const travel = candidates(book).filter((one) => one.kind === "travel");
    expect(travel.map((one) => [one.key, one.expected])).toEqual([
      ["the road to school|travel|800 metres|7200 seconds", "0.4"],
    ]);
  });

  it("gives a conflict what the sheets say of the same fact, and groups only what it is told", () => {
    const gate = (entity: string, norm: string) =>
      ({
        attribute: "colour",
        type: "colour",
        entity,
        kind: "thing",
        status: "stated",
        norm,
      }) as const;
    const book = [
      section("node:A", [
        ["Grey eyes.", eyes("grey")],
        // A change the story tells: a new stretch, green and then blue.
        ["Lenses: green.", eyes("green", { change: true })],
        ["Green again.", eyes("green")],
        ["Blue eyes.", eyes("blue")],
        ["The gate was green.", gate("the school gate", "green")],
        ["The gate, twice green.", gate("the school gate", "green")],
        ["La cancellata marrone.", gate("la cancellata", "brown")],
      ]),
      section(
        "reference:marta",
        [["Eyes: grey, then green lenses.", eyes("grey")]],
        "sheet",
      ),
    ];
    const conflict = candidates(book).find((one) => one.kind === "conflict");
    // The sheet agrees with the opening, so it raises nothing itself; it
    // rides beside the later conflict for the judge to read.
    expect(conflict?.key).toBe("marta|eye colour|blue|green");
    expect(conflict?.notes?.map((note) => note.quote)).toEqual([
      "Eyes: grey, then green lenses.",
    ]);
    expect(candidates(book).some((one) => one.attribute === "colour")).toBe(
      false,
    );
    const grouped = candidates(book, new Set(), {
      entities: new Map([["la cancellata", "the school gate"]]),
    });
    expect(grouped.find((one) => one.attribute === "colour")?.key).toBe(
      "the school gate|colour|brown|green",
    );
    // Two labels for one kind of fact are compared once grouped.
    book[0].ledger.claims[3].attribute = "colour of her eyes";
    expect(
      candidates(book).find((one) => one.kind === "conflict")?.key,
    ).toBeUndefined();
    expect(
      candidates(book, new Set(), {
        labels: new Map([["colour of her eyes", "eye colour"]]),
      }).find((one) => one.kind === "conflict")?.key,
    ).toBe("marta|eye colour|blue|green");
  });

  it("takes a place's name claim for wording, never for a nickname", () => {
    const book = [
      section("node:A", [
        ["Leo ran.", years("Leo", "3")],
        ["Leo, 3.", years("Leo", "3")],
        ["Leo at 4.", years("Leo", "4")],
        [
          "The house, called Leo.",
          {
            attribute: "name",
            type: "name",
            entity: "the house",
            kind: "place",
            status: "stated",
            norm: "leo",
          },
        ],
      ]),
    ];
    expect(candidates(book).map((one) => one.key)).toEqual([
      "leo|age|3 years|4 years",
    ]);
  });

  it("keeps the story's day through a date without a year, and skips what is no day", () => {
    const date = day;
    const book = [
      section("node:A", [
        // Relative, before any day: nothing to count from.
        ["Two days later.", date("the start", "+2d mon")],
        ["31 February 2024, a Monday.", date("no day", "2024-02-31 mon")],
        ["Tuesday 3 September 2024.", date("the first day", "2024-09-03 tue")],
        ["On 5 September.", date("the fair", "--09-05")],
        ["The next day, a Monday.", date("the party", "+1d mon")],
        ["Leo, 3.", years("Leo", "3", { since: "birth" })],
      ]),
      section(
        "reference:leo",
        [["Born September 2020.", birth("Leo", "2020-09")]],
        "sheet",
      ),
    ];
    const found = candidates(book);
    // 5 September 2024 is Thursday; the next day is Friday, not Monday.
    expect(found.map((one) => [one.kind, one.date, one.expected])).toEqual([
      ["calendar", "2024-09-06", "fri"],
    ]);
    // Born in September 2020, "3" in September 2024 may be either side of
    // the birthday — no candidate — and the age side is dated by the day.
    // Born in October 2020, three until the birthday: still no candidate.
    book[1].ledger.claims[0].norm = "2020-10";
    expect(candidates(book).filter((one) => one.kind === "years")).toEqual([]);
    book[1].ledger.claims[0].norm = "2020-08";
    expect(candidates(book).filter((one) => one.kind === "years")).toEqual([
      expect.objectContaining({ expected: "4" }),
    ]);
  });

  it("leaves a journey with no time, or a stated age with no day, alone", () => {
    const book = [
      section("node:A", [
        [
          "The road, eight hundred metres.",
          {
            attribute: "length",
            type: "number",
            kind: "place",
            status: "stated",
            entity: "the road",
            norm: "800 metres",
          },
        ],
        [
          "No time at all.",
          {
            attribute: "time",
            type: "number",
            kind: "place",
            status: "stated",
            entity: "the road",
            norm: "0 seconds",
          },
        ],
        ["Leo, 3.", years("Leo", "3", { since: "birth" })],
        ["Born in 2020.", birth("Leo", "2020")],
      ]),
    ];
    expect(candidates(book)).toEqual([]);
  });

  it("ranks the calendar, then the sheet, then a lopsided conflict, then kin and jobs", () => {
    const book = [
      section("reference:marta", [["Eyes: grey", eyes("grey")]], "sheet"),
      section("node:A", [
        ["Luca, her brother.", { attribute: "brother", norm: "luca" }],
        ["Paolo, her brother.", { attribute: "brother", norm: "paolo" }],
        // Held against the sheet too: asked once, as the sheet's.
        ["Green eyes.", eyes("green")],
        ["Grey eyes.", eyes("grey")],
        ["Luca was 30.", years("Luca", "30")],
        ["Luca, 30.", years("Luca", "30")],
        ["Luca, 31.", years("Luca", "31")],
        ["Monday 16 March 1998.", day("Marta", "1998-03-16 tue")],
      ]),
    ];
    expect(
      candidates(book).map((one) => one.kind + ":" + one.attribute),
    ).toEqual([
      "calendar:day",
      "sheet:eye colour",
      "conflict:age",
      "conflict:brother",
    ]);
  });
});

// ── Claims the book does not state ───────────────────────────────────────────

describe("a claim's status", () => {
  it("compares stated claims only, and shows the rest to the judge as notes", () => {
    const book = [
      section("node:A", [["Marta's eyes were grey.", eyes("grey")]]),
      section("node:B", [
        // What Luca believes about her eyes is not what the book states.
        [
          "Luca swore her eyes were green.",
          eyes("green", { status: "believed" }),
        ],
      ]),
      section(
        "reference:arc",
        [
          [
            "Maybe her eyes turn green later.",
            eyes("green", { status: "planned" }),
          ],
        ],
        "sheet",
      ),
    ];
    // No conflict, no sheet disagreement: the only stated value is grey.
    expect(candidates(book)).toEqual([]);
    // Beside a real disagreement, the belief and the plan ride as notes.
    const found = candidates([
      ...book,
      section("node:C", [["Her grey eyes, now green.", eyes("green")]]),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("conflict");
    expect(found[0].notes?.map((note) => [note.sourceId, note.status])).toEqual(
      [
        ["node:B", "believed"],
        ["reference:arc", "planned"],
      ],
    );
  });

  // The documented loss: a note, or a field the writer renamed, is
  // the writer's own word, but no field the catalogue placed. It is shown to
  // the judge, never held against the prose, so a note's plain "grey" does
  // not find the prose's green alone. Pinned so recall figures never hide
  // it.
  it("never makes a side of a claim read from a line the catalogue could not place, stated or not", () => {
    const note = section(
      "reference:notes",
      [["Marta's eyes are grey.", eyes("grey", { unclassified: true })]],
      "sheet",
    );
    const prose = section("node:A", [["Her green eyes.", eyes("green")]]);
    expect(candidates([prose, note])).toEqual([]);
    const found = candidates([
      prose,
      note,
      section("node:B", [["Grey eyes, hers.", eyes("grey")]]),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].sides.map((side) => side.sourceId).sort()).toEqual([
      "node:A",
      "node:B",
    ]);
    expect(found[0].notes).toEqual([
      expect.objectContaining({
        sourceId: "reference:notes",
        unclassified: true,
      }),
    ]);
    expect(found[0].notes?.[0]?.status).toBeUndefined();
    // The same claim from a field the catalogue placed is a side, and
    // carries its field to the judge.
    const placed = section(
      "reference:marta",
      [
        [
          "Marta's eyes are grey.",
          eyes("grey", { field: "character/appearance" }),
        ],
      ],
      "sheet",
    );
    expect(candidates([prose, placed])[0]?.sides[1]).toMatchObject({
      sourceId: "reference:marta",
      field: "character/appearance",
    });
  });

  it("lets only a stated name make two spellings one person: a belief, a plan or a question keeps them two", () => {
    const job = (entity: string, norm: string) =>
      ({ attribute: "job", type: "words", entity, norm }) as const;
    const two = [
      section("node:A", [["Marta is a doctor.", job("Marta", "doctor")]]),
      section("node:B", [["Lucia is a teacher.", job("Lucia", "teacher")]]),
    ];
    expect(candidates(two)).toEqual([]);
    // "They wrongly believe Marta is Lucia": the book records a belief,
    // and a belief joins no two people's facts into one question.
    for (const status of ["believed", "planned", "open"] as const)
      expect(
        candidates([
          ...two,
          section("node:C", [
            [
              "They wrongly believe Marta is Lucia.",
              {
                attribute: "alias",
                type: "name",
                entity: "Marta",
                value: "Lucia",
                norm: "Lucia",
                status,
              },
            ],
          ]),
        ]),
      ).toEqual([]);
    // Stated, the alias makes them one, and the two jobs one question.
    const found = candidates([
      ...two,
      section("node:C", [
        [
          "Marta, whom everyone calls Lucia.",
          {
            attribute: "alias",
            type: "name",
            entity: "Marta",
            value: "Lucia",
            norm: "Lucia",
          },
        ],
      ]),
    ]);
    expect(found.map((one) => [one.kind, one.attribute])).toEqual([
      ["conflict", "job"],
    ]);
  });
});

describe("a journey is a place's distance and time", () => {
  const measure = (
    entity: string,
    kind: "place" | "thing",
    attribute: string,
    norm: string,
  ) =>
    ({
      attribute,
      type: "number",
      entity,
      kind,
      status: "stated",
      norm,
    }) as const;

  it("never makes a journey of a thing's measure and its duration, side by side or not", () => {
    // The tower is ten metres tall and rings for a minute: 0.6 km/h of
    // nothing anyone travelled.
    expect(
      candidates([
        section("node:A", [
          [
            "The tower is 10 metres tall.",
            measure("the tower", "thing", "height", "10 metres"),
          ],
          [
            "The tower rings for 60 seconds.",
            measure("the tower", "thing", "ringing", "60 seconds"),
          ],
        ]),
      ]),
    ).toEqual([]);
  });

  it("raises a place's distance and time as a question the judge must first accept as one journey", () => {
    const [found] = candidates([
      section("node:A", [
        [
          "The pass is 100000 metres off.",
          measure("the pass", "place", "distance", "100000 metres"),
        ],
        [
          "They were over it in 60 seconds.",
          measure("the pass", "place", "time", "60 seconds"),
        ],
      ]),
    ]);
    expect(found).toMatchObject({ kind: "travel", expected: "6000" });
  });
});

describe("the book's order carried through a scoped check", () => {
  // A Part review reads B and C; the sheet dates a change to A, before the
  // Part. The book's order places a dated change, never the list of ledgers
  // in hand.
  const order = ["node:A", "node:B", "node:C"];
  const sheet = (from: string, norm = "teacher", more: Partial<Claim> = {}) =>
    section(
      "reference:marta",
      [
        [
          `Becomes a ${norm} from ${from}`,
          {
            attribute: "job",
            type: "words",
            norm,
            change: true,
            from,
            ...more,
          },
        ],
      ],
      "sheet",
    );
  const prose = (id: string, norm: string) =>
    section(id, [
      [`Marta is a ${norm}.`, { attribute: "job", type: "words", norm }],
    ]);

  it("holds a change dated to a Section before the Part against the Part's prose, without that Section's ledger", () => {
    const found = candidates(
      [prose("node:B", "doctor"), sheet("node:A")],
      new Set(),
      {},
      order,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "sheet" });
    expect(found[0].sides.map((side) => [side.sourceId, side.norm])).toEqual([
      ["node:B", "doctor"],
      ["reference:marta", "teacher"],
    ]);
  });

  it("never holds a change dated to a later Section against earlier prose", () => {
    expect(
      candidates(
        [prose("node:B", "doctor"), sheet("node:C")],
        new Set(),
        {},
        order,
      ),
    ).toEqual([]);
  });

  it("holds the latest of two earlier dated states, not the first", () => {
    const wide = ["node:A", "node:A2", "node:B", "node:C"];
    const found = candidates(
      [
        prose("node:B", "doctor"),
        section(
          "reference:marta",
          [
            [
              "Teacher from A",
              {
                attribute: "job",
                type: "words",
                norm: "teacher",
                change: true,
                from: "node:A",
              },
            ],
            [
              "Nurse from A2",
              {
                attribute: "job",
                type: "words",
                norm: "nurse",
                change: true,
                from: "node:A2",
              },
            ],
          ],
          "sheet",
        ),
      ],
      new Set(),
      {},
      wide,
    );
    expect(found.map((one) => one.sides[1].norm)).toEqual(["nurse"]);
  });

  it("still holds a change dated to a Section the book no longer has from nowhere", () => {
    expect(
      candidates(
        [prose("node:B", "doctor"), sheet("node:gone")],
        new Set(),
        {},
        order,
      ),
    ).toEqual([]);
  });

  it("places the prose by the book's order, not by the order the ledgers arrive in", () => {
    // C's ledger first in hand, but B first in the book: a value B states
    // and C changes is no slip, whichever order the ledgers came in.
    const found = candidates(
      [
        section("node:C", [
          [
            "Marta became a doctor.",
            { attribute: "job", type: "words", norm: "doctor", change: true },
          ],
        ]),
        prose("node:B", "teacher"),
      ],
      new Set(),
      {},
      order,
    );
    expect(found).toEqual([]);
  });
});

// ── A value's own time ───────────────────────────────────────────────────────
//
// "This is the avalanche of 1999. I was forty-one." against a sheet's 61 at
// the opening in 2019 is two ages twenty years apart that agree, and must
// not reach the judge as a conflict. A value the text sets in another time
// than the passage's own keeps that time (`Claim.when`), is never a
// present value's conflict, and an age at a dated year is checked by
// arithmetic instead.

describe("a value's own time", () => {
  const then = (entity: string, norm: string, when: string) =>
    ({
      attribute: "age",
      type: "number",
      entity,
      norm: `${norm} years`,
      when,
    }) as const;
  const opening: [string, Partial<Claim> & { attribute: string }] = [
    "Friday 8 March 2019.",
    day("the day", "2019-03-08"),
  ];

  it("never holds an age the text sets in an earlier year against the present one when the arithmetic agrees", () => {
    const book = [
      section("node:A", [
        opening,
        ["She was sixty-one years old.", years("Hollis", "61")],
      ]),
      section("node:B", [
        [
          "This is the avalanche of 1999. I was forty-one.",
          then("Hollis", "41", "1999"),
        ],
      ]),
      section(
        "reference:hollis",
        [["- 61 years old", years("Hollis", "61")]],
        "sheet",
      ),
    ];
    expect(candidates(book)).toEqual([]);
  });

  it("raises the years when an age at an earlier year cannot be, with the range it could", () => {
    const book = [
      section("node:A", [
        opening,
        ["She was sixty-one years old.", years("Hollis", "61")],
      ]),
      section("node:B", [
        ["In 1999 I was thirty.", then("Hollis", "30", "1999")],
      ]),
    ];
    const [found, ...rest] = candidates(book);
    expect(rest).toEqual([]);
    expect(found).toMatchObject({
      kind: "years",
      key: "hollis|then|1999|30 years|61 years",
      expected: "40-42",
      date: "1999",
    });
    expect(found.sides.map((side) => side.norm)).toEqual([
      "30 years",
      "61 years",
    ]);
    expect(found.sides[0].when).toBe("1999");
  });

  it("holds a sheet's opening value as of the story's first day for that arithmetic", () => {
    const book = [
      section("node:A", [opening]),
      section("node:B", [
        ["In 1999 I was thirty.", then("Hollis", "30", "1999")],
      ]),
      section(
        "reference:hollis",
        [["- 61 years old", years("Hollis", "61")]],
        "sheet",
      ),
    ];
    expect(candidates(book).map((one) => one.kind)).toEqual(["years"]);
  });

  it("compares nothing with a value of an undated other time, and shows it to the judge beside the fact", () => {
    const book = [
      section("node:A", [
        ["Her eyes were grey.", eyes("grey")],
        ["Once, her eyes had been green.", eyes("green", { when: "past" })],
      ]),
      section("node:B", [["Green eyes.", eyes("green")]]),
    ];
    const [found, ...rest] = candidates(book);
    expect(rest).toEqual([]);
    expect(found).toMatchObject({
      key: "marta|eye colour|green|grey",
      counts: [1, 1],
    });
    expect(found.notes?.map((note) => [note.norm, note.when])).toEqual([
      ["green", "past"],
    ]);
    expect(found.history?.map((one) => one.norm)).toEqual(["grey", "green"]);
  });

  it("holds two values the text sets at the same earlier time against each other", () => {
    const book = [
      section("node:A", [
        ["In 1999 I was thirty.", then("Hollis", "30", "1999")],
      ]),
      section("node:B", [
        ["In 1999 I was forty.", then("Hollis", "40", "1999")],
      ]),
    ];
    expect(candidates(book)).toMatchObject([
      { kind: "conflict", key: "hollis|age|30 years|40 years" },
    ]);
  });

  it("counts a sheet's dated change from its Section's day, an exact day to one number, and nothing with no day", () => {
    // A dated change: the sheet says she is 61 from Section B on, whose day
    // is 8 March 2019; an age at an exact earlier day has one answer.
    const book = [
      section("node:A", [
        ["Long before, in 1998.", day("the day", "1998-05-01")],
      ]),
      section("node:B", [
        opening,
        [
          "In 1999, on 8 March, I was thirty.",
          then("Hollis", "30", "1999-03-08"),
        ],
        ["That May I was thirty.", then("Hollis", "30", "1999-05")],
      ]),
      section(
        "reference:hollis",
        [
          [
            "- 61 from the pass on",
            years("Hollis", "61", { change: true, from: "node:B" }),
          ],
        ],
        "sheet",
      ),
    ];
    const found = candidates(book, new Set(), {}, ["node:A", "node:B"]);
    expect(
      found.filter((one) => one.kind === "years").map((one) => one.expected),
    ).toEqual(["41", "41-42"]);
    // With no day anywhere, the arithmetic has nothing to count from.
    const undated = [
      section("node:A", [["She was sixty-one.", years("Hollis", "61")]]),
      section("node:B", [
        ["In 1999 I was thirty.", then("Hollis", "30", "1999")],
      ]),
    ];
    expect(candidates(undated)).toEqual([]);
  });
});

// ── One person's names ───────────────────────────────────────────────────────

describe("one person's names", () => {
  const tenure = (entity: string, norm: string) =>
    ({
      attribute: "tenure",
      type: "number",
      entity,
      norm: `${norm} years`,
    }) as const;

  it("holds the father's tenure on the sheet against the prose, whatever his daughter's sheet says of him", () => {
    // "Daughter of Amos, who kept the hut for thirty-eight years" reads as
    // Hollis's `father | name | Amos` beside `Amos | tenure`, and the
    // resolver must not make Amos his daughter while the prose's Amos Wren
    // stays himself. "Amos" is a word of "Amos Wren's logbook" too, which is
    // a thing, not a second Amos.
    const book = [
      section("node:A", [
        [
          "Amos Wren had kept the hut for twenty-seven years.",
          tenure("Amos Wren", "27"),
        ],
        [
          "The ink in Amos Wren's logbook had gone brown.",
          {
            attribute: "ink colour",
            type: "colour",
            entity: "Amos Wren's logbook",
            kind: "thing",
            norm: "brown",
          },
        ],
        [
          "Hollis's father was called Amos Wren.",
          {
            attribute: "name",
            type: "name",
            entity: "Hollis's father",
            norm: "amos wren",
            value: "Amos Wren",
          },
        ],
      ]),
      section(
        "reference:hollis",
        [
          [
            "- daughter of Amos, who kept the hut for thirty-eight years",
            {
              attribute: "father",
              type: "name",
              entity: "Hollis Wren",
              norm: "amos",
              value: "Amos",
            },
          ],
          [
            "- daughter of Amos, who kept the hut for thirty-eight years",
            tenure("Amos", "38"),
          ],
        ],
        "sheet",
      ),
    ];
    const found = candidates(book);
    expect(found.map((one) => one.key)).toEqual([
      "amos wren|tenure|27 years|38 years",
    ]);
    expect(found[0].kind).toBe("sheet");
  });

  it("lets a role said of a person, and a thing named after them, leave the one-word alias alone", () => {
    const book = [
      section("node:A", [
        ["Hollis Wren was sixty-one.", years("Hollis Wren", "61")],
        [
          "Hollis's father kept the hut.",
          {
            attribute: "job",
            type: "words",
            entity: "Hollis's father",
            norm: "hut keeper",
          },
        ],
        [
          "Hollis Wren's hat was black.",
          {
            attribute: "colour",
            type: "colour",
            entity: "Hollis Wren's hat",
            kind: "thing",
            norm: "black",
          },
        ],
      ]),
      section("node:B", [["Hollis was fifty.", years("Hollis", "50")]]),
    ];
    expect(candidates(book).map((one) => one.key)).toEqual([
      "hollis wren|age|50 years|61 years",
    ]);
  });

  it("still makes a name the book gives someone in one place one person with its use in another", () => {
    // The nickname's own claims live in another Section: that is what the
    // name claim is for, and the same-reading guard does not touch it.
    const book = [
      section("node:A", [
        ["Marta Neri was 34.", years("Marta Neri", "34")],
        [
          "They called her Tata.",
          {
            attribute: "nickname",
            type: "name",
            entity: "Marta Neri",
            norm: "tata",
            value: "Tata",
          },
        ],
      ]),
      section("node:B", [["Tata, 36.", years("Tata", "36")]]),
    ];
    expect(candidates(book).map((one) => one.key)).toEqual([
      "marta neri|age|34 years|36 years",
    ]);
  });
});

// ── Days, names and labels ───────────────────────────────────────────────────
//
// The remaining candidate rules.

describe("the calendar's first day", () => {
  it("seeds the calendar from a full date of the prose that names its weekday, when no day has", () => {
    // The English book's opening, which a model types `date`: without it no
    // later partial day has a year, and no weekday is ever checked.
    const arrival = {
      attribute: "bus arrival date",
      type: "date",
      entity: "the pass",
      norm: "2019-03-08 fri",
    } as const;
    const book = [
      section("node:A", [["Friday 8 March 2019, just before dusk.", arrival]]),
      // 11 March 2019 was a Monday.
      section("node:B", [
        [
          "The storm came on Thursday 11 March.",
          day("the storm", "--03-11 thu"),
        ],
      ]),
    ];
    expect(candidates(book)).toMatchObject([
      { kind: "calendar", key: "calendar|2019-03-11|thu", expected: "mon" },
    ]);
    // A date that names no weekday (a birth) seeds nothing; nor does a
    // dated day of another time; nor a sheet's.
    for (const seed of [
      { ...arrival, norm: "1961-05-03" },
      { ...arrival, norm: "2019-03-08 fri", when: "1999" },
    ])
      expect(
        candidates([
          section("node:A", [["Some date.", seed]]),
          section("node:B", [
            ["Thursday 11 March.", day("the storm", "--03-11 thu")],
          ]),
        ]),
      ).toEqual([]);
    expect(
      candidates([
        section(
          "reference:x",
          [["- 8 March 2019, a Friday", arrival]],
          "sheet",
        ),
        section("node:B", [
          ["Thursday 11 March.", day("the storm", "--03-11 thu")],
        ]),
      ]),
    ).toEqual([]);
  });
});

describe("the story's own day is the calendar's, never a conflict", () => {
  it("raises no conflict between two passages' days, typed day or date, and keeps a fixed date's", () => {
    // The Italian book: the ferry docks on Friday 14 October, the next
    // morning is Saturday 15 October. Two prose passages, two days: the
    // story moved. Typed `day` or `date`, the pair is the calendar's and no
    // conflict, so the judge is never asked whether the 15th contradicts the
    // 14th.
    for (const type of ["day", "date"] as const) {
      const passage = (norm: string) =>
        ({ attribute: "date", type, entity: "the passage day", norm }) as const;
      const found = candidates([
        section("node:A", [
          [
            "Il traghetto attraccò venerdì 14 ottobre 2022.",
            passage("2022-10-14 fri"),
          ],
        ]),
        section("node:B", [
          ["La mattina dopo, sabato 15 ottobre.", passage("--10-15 sat")],
        ]),
      ]);
      expect(found).toEqual([]);
    }
    // A date of anything else stays a fact of its entity: two births a day
    // apart are one conflict.
    const birth = (norm: string) =>
      ({
        attribute: "birth date",
        type: "date",
        entity: "Marta",
        norm,
      }) as const;
    expect(
      candidates([
        section("node:A", [
          ["Marta was born on 3 May 1961.", birth("1961-05-03")],
        ]),
        section("node:B", [["Born 4 May 1961.", birth("1961-05-04")]]),
      ]),
    ).toMatchObject([
      { kind: "conflict", key: "marta|birth date|1961-05-03|1961-05-04" },
    ]);
  });
});

describe("a value that names a person, in whichever of their names", () => {
  it("raises no conflict between two names of one man as two values of the same relation", () => {
    // `Hollis Wren | father | amos | amos wren` must not reach the judge as
    // a conflict. The resolver knows Amos is Amos Wren; a value that names
    // him is him.
    const tenure = (entity: string, norm: string) =>
      ({ attribute: "tenure", type: "number", entity, norm }) as const;
    const father = (norm: string) =>
      ({
        attribute: "father",
        type: "words",
        entity: "Hollis Wren",
        norm,
      }) as const;
    const book = [
      section("node:A", [
        [
          "Amos Wren had kept the hut for twenty-seven years.",
          tenure("Amos Wren", "27 years"),
        ],
        ["The entries were her father's, Amos Wren's.", father("amos wren")],
        ["Hollis Wren read them.", years("Hollis Wren", "61")],
      ]),
      section(
        "reference:hollis",
        [
          [
            "- daughter of Amos, who kept the hut for twenty-seven years",
            father("amos"),
          ],
          [
            "- daughter of Amos, who kept the hut for twenty-seven years",
            tenure("Amos", "27 years"),
          ],
        ],
        "sheet",
      ),
    ];
    expect(candidates(book)).toEqual([]);
    // Two different fathers are still two values.
    book[1].ledger.claims[0].norm = "elias";
    expect(candidates(book).map((one) => one.key)).toEqual([
      "hollis wren|father|amos wren|elias",
    ]);
  });
});

describe("a relation said of a person is no second name of theirs", () => {
  it("still knows the one-word name, when the ledgers also hold 'father of' the full one", () => {
    // The extractor can write "father of Marta Neri" as a person of his own.
    // Counted as a second full name holding "Marta", it would stop "Marta"
    // being told to be Marta Neri, and her eyes, grey in one chapter and
    // brown in the next, would never be compared.
    const eyes = (entity: string, norm: string) =>
      ({ attribute: "eye colour", type: "colour", entity, norm }) as const;
    const book = [
      section("node:A", [
        ["Marta Neri had her father's grey eyes.", eyes("Marta Neri", "grey")],
        ["Her father's grey eyes.", eyes("father of Marta Neri", "grey")],
      ]),
      section("node:B", [["The same brown eyes.", eyes("Marta", "brown")]]),
    ];
    expect(candidates(book).map((one) => one.key)).toEqual([
      "marta neri|eye colour|brown|grey",
    ]);
  });
});

describe("a misspelling the ledgers took for a person", () => {
  it("still asks whether a rare spelling is the common name, when the extractor made an entity of it", () => {
    const job = (entity: string, norm: string) =>
      ({ attribute: "job", type: "words", entity, norm }) as const;
    const book = [
      section("node:A", [
        [
          "Giacomo Marchi kept the light.",
          job("Giacomo Marchi", "lighthouse keeper"),
        ],
        "Giacomo wrote every evening. Giacomo slept little.",
      ]),
      section("node:B", [
        [
          "Gaicomo walked two kilometres.",
          {
            attribute: "distance walked",
            type: "number",
            entity: "Gaicomo",
            norm: "2000 metres",
          },
        ],
      ]),
    ];
    const names = candidates(book).filter((one) => one.kind === "name");
    expect(names).toHaveLength(1);
    expect(names[0]).toMatchObject({
      key: "giacomo marchi|name||gaicomo|giacomo",
      counts: [1, 3],
    });
    expect(names[0].sides[0]).toMatchObject({
      sourceId: "node:B",
      quote: "Gaicomo",
    });
  });

  it("counts the writer's sheet among the common spelling's mentions, when the extractor corrected the slip in silence", () => {
    // The Italian book writes Giacomo three times in the prose, and the
    // plant takes one of them; the extractor reads "Gaicomo" and writes the
    // entity as "Giacomo", so no ledger names the rare spelling. Two prose
    // mentions are one short of the common bar, so the character sheet, the
    // writer's most deliberate spelling, is counted with them.
    const job = (entity: string, norm: string) =>
      ({ attribute: "job", type: "words", entity, norm }) as const;
    const prose = [
      section("node:A", [
        [
          "Giacomo Marchi kept the light.",
          job("Giacomo Marchi", "lighthouse keeper"),
        ],
        "Giacomo wrote every evening.",
      ]),
      section("node:B", [
        [
          "Gaicomo walked two kilometres.",
          {
            attribute: "distance walked",
            type: "number",
            entity: "Giacomo",
            norm: "2000 metres",
          },
        ],
      ]),
    ];
    const sheet = section(
      "reference:ottavia",
      [
        [
          "- daughter of Giacomo, keeper for forty-one years",
          job("Giacomo", "keeper"),
        ],
      ],
      "sheet",
    );
    expect(candidates(prose).filter((one) => one.kind === "name")).toEqual([]);
    const names = candidates([...prose, sheet]).filter(
      (one) => one.kind === "name",
    );
    expect(names).toHaveLength(1);
    expect(names[0]).toMatchObject({
      key: "giacomo marchi|name||gaicomo|giacomo",
      counts: [1, 3],
    });
    // The places the judge reads are the prose's, the slip and the first
    // spelling: a sheet line is never a name's witness.
    expect(names[0].sides[1]).toMatchObject({ sourceId: "node:A", at: 0 });
  });
});

describe("a value that only names its label", () => {
  it("never compares 'her father' under 'father' with the father's name", () => {
    // Hollis's sheet names her father, and the storm scene says "my father",
    // which a ledger can read as a second value of `father`. That says whom
    // the fact is about, not what it is, and the judge could only call it
    // unsure.
    const book = [
      section(
        "node:A",
        [
          [
            "Daughter of Amos Wren.",
            { attribute: "father", norm: "amos wren" },
          ],
        ],
        "sheet",
      ),
      section("node:B", [
        [
          '"My father built this hut," Marta said.',
          { attribute: "father", norm: "her father" },
        ],
      ]),
      section("node:C", [
        [
          "The father, a fisherman.",
          { attribute: "father", norm: "the father" },
        ],
      ]),
    ];
    expect(candidates(book)).toEqual([]);
    // A name is still a value: two names disagree.
    const named = [
      book[0],
      section("node:B", [
        [
          '"My father, Tomas Wren," Marta said.',
          { attribute: "father", norm: "tomas wren" },
        ],
      ]),
    ];
    expect(candidates(named)).toHaveLength(1);
  });
});

// ── The story's present year ─────────────────────────────────────────────────
//
// "Twenty-six that autumn of 1911" on the sheet and "in the winter of 1911
// she was twenty-two" in the prose, in a book whose timeline puts its
// present in 1911: the extractor stamps a value in the story's own year with
// the year in one reading and with nothing or `past` in the next, and a
// stamped value meets an unstamped one only with a story day to count from.
// A value stamped with the year the writer's timeline gives as the present
// is a value of the present.

describe("the story's present year", () => {
  const present = (norm: string) =>
    [
      norm,
      {
        entity: "the story",
        kind: "thing",
        attribute: "date",
        type: "date",
        norm,
        field: "world:timeline/present",
      },
    ] as [string, Partial<Claim> & { attribute: string }];
  const book = (
    timeline: [string, Partial<Claim> & { attribute: string }][],
  ) => [
    section("node:A", [
      ["In the winter of 1911 Ilse was twenty-two.", years("Ilse", "22")],
    ]),
    section(
      "reference:ilse",
      [
        [
          "- Twenty-six in the autumn of 1911.",
          years("Ilse", "26", { when: "1911" }),
        ],
      ],
      "sheet",
    ),
    section("reference:timeline", timeline, "sheet"),
  ];

  it("holds a value stamped with the present year to the present", () => {
    const found = candidates(book([present("1911")]));
    expect(found).toHaveLength(1);
    expect(found[0].sides.map((side) => side.norm).sort()).toEqual([
      "22 years",
      "26 years",
    ]);
    // Shown as of the present, not as of another time.
    expect(found[0].sides.every((side) => side.when === undefined)).toBe(true);
  });

  it("changes nothing without a present the timeline states", () => {
    expect(candidates(book([]))).toEqual([]);
  });

  it("changes nothing when the timeline's present spans more than one year", () => {
    // The two dates are a candidate of their own; no age is.
    const found = candidates(book([present("1911"), present("1913")]));
    expect(found.filter((one) => one.attribute === "age")).toEqual([]);
  });

  it("keeps another year another time", () => {
    const other = [
      section("node:A", [
        ["In the winter of 1911 Ilse was twenty-two.", years("Ilse", "22")],
      ]),
      section(
        "reference:ilse",
        [["- Twelve in 1897.", years("Ilse", "12", { when: "1897" })]],
        "sheet",
      ),
      section("reference:timeline", [present("1911")], "sheet"),
    ];
    expect(candidates(other)).toEqual([]);
  });
});

describe("a weekday in an old calendar", () => {
  it("takes a weekday the Julian calendar gives before Britain took the Gregorian", () => {
    // 12 October 1492 was a Friday as the Julian calendar counts it, a
    // Wednesday as the Gregorian would.
    expect(
      candidates([
        section("node:A", [
          ["Friday 12 October 1492.", day("the landing", "1492-10-12 fri")],
        ]),
      ]),
    ).toEqual([]);
    // A weekday neither calendar gives is still a slip, told in the Julian.
    expect(
      candidates([
        section("node:A", [
          ["Monday 12 October 1492.", day("the landing", "1492-10-12 mon")],
        ]),
      ]),
    ).toMatchObject([
      { kind: "calendar", key: "calendar|1492-10-12|mon", expected: "fri" },
    ]);
    // After the change only the Gregorian weekday holds.
    expect(
      candidates([
        section("node:A", [
          ["Thursday 14 March 1900.", day("the fair", "1900-03-14 thu")],
        ]),
      ]),
    ).toMatchObject([{ kind: "calendar", expected: "wed" }]);
  });

  it("reads a year below 100 as that year, never as one of the 1900s", () => {
    // 14 March of the year 50 was a Monday (Gregorian) or a Saturday
    // (Julian); 14 March 1950 was a Tuesday.
    expect(
      candidates([
        section("node:A", [
          ["Monday the 14th.", day("the games", "0050-03-14 mon")],
        ]),
      ]),
    ).toEqual([]);
    expect(
      candidates([
        section("node:A", [
          ["Tuesday the 14th.", day("the games", "0050-03-14 tue")],
        ]),
      ]),
    ).toMatchObject([{ kind: "calendar", key: "calendar|0050-03-14|tue" }]);
  });
});
