// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  LEDGER_RECIPE_REVISION,
  amountOf,
  claimOf,
  fixedSpelling,
  ledgerOf,
  normOf,
  relativeDate,
  statedWeekday,
  type SectionLedger,
} from "./ledger";
import { locate } from "./textMatch";

const TEXT =
  "Marta aveva trentaquattro anni.\nI suoi occhi  erano grigi, come quelli della madre.";

const fact = (overrides: Record<string, unknown> = {}) => ({
  entity: "Marta Neri",
  kind: "person",
  status: "stated",
  attribute: "age",
  type: "number",
  value: "trentaquattro anni",
  norm: "34 years",
  since: "",
  quote: "Marta aveva trentaquattro anni.",
  change: false,
  ...overrides,
});

describe("normOf", () => {
  it("holds each value type to its one spelling", () => {
    expect(normOf("number", " 34  Years ")).toBe("34 years");
    expect(normOf("number", "2000.0 metres")).toBe("2000 metres");
    expect(normOf("number", "3")).toBe("3");
    expect(normOf("number", "thirty-four")).toBeNull();
    expect(normOf("number", "-5 seconds")).toBeNull();
    expect(normOf("number", "34 years old")).toBeNull();
    expect(normOf("date", "1998-03-14 sat")).toBe("1998-03-14 sat");
    expect(normOf("date", "--03-14")).toBe("--03-14");
    expect(normOf("date", "1998")).toBe("1998");
    expect(normOf("date", "1998-13-01")).toBeNull();
    expect(normOf("date", "--02-32")).toBeNull();
    expect(normOf("date", "14 March")).toBeNull();
    expect(normOf("day", "1998-03-14")).toBe("1998-03-14");
    expect(normOf("time", "07:30")).toBe("07:30");
    expect(normOf("time", "24:00")).toBeNull();
    expect(normOf("colour", "Grey")).toBe("grey");
    expect(normOf("colour", "teal")).toBeNull();
    expect(normOf("yes-no", "No")).toBe("no");
    expect(normOf("yes-no", "false")).toBeNull();
    expect(normOf("words", "  Train   Driver ")).toBe("train driver");
    expect(normOf("name", "Tata")).toBe("tata");
    expect(normOf("words", "")).toBeNull();
    expect(normOf("words", "x".repeat(81))).toBeNull();
  });

  it("spells a very small or very large number in its digits, a norm it reads back", () => {
    for (const [raw, norm] of [
      ["0.0000005 metres", "0.0000005 metres"],
      ["1000000000000000000000 years", "1000000000000000000000 years"],
      ["007.250", "7.25"],
      ["0.50", "0.5"],
    ]) {
      expect(normOf("number", raw)).toBe(norm);
      expect(amountOf(norm)).not.toBeNull();
    }
    // Two numbers that differ past a double's precision stay two.
    expect(normOf("number", "12345678901234567890123")).not.toBe(
      normOf("number", "12345678901234567890124"),
    );
  });

  it("reads a number's amount and unit", () => {
    expect(amountOf("2000 metres")).toEqual({ amount: 2000, unit: "metres" });
    expect(amountOf("3")).toEqual({ amount: 3, unit: "" });
    expect(amountOf("green")).toBeNull();
  });

  it("reads the weekday a date names", () => {
    expect(statedWeekday("1998-03-14 sat")).toBe(6);
    expect(statedWeekday("--03-16 mon")).toBe(1);
    expect(statedWeekday("1998-03-14")).toBeNull();
  });

  it("reads a day given relative to the last one, in days, weeks, months or years", () => {
    expect(normOf("day", "+3d")).toBe("+3d");
    expect(normOf("day", "+0d tue")).toBe("+0d tue");
    expect(normOf("day", "-2d")).toBe("-2d");
    expect(normOf("day", "+2w")).toBe("+2w");
    expect(normOf("day", "+1m")).toBe("+1m");
    expect(normOf("day", "+10y")).toBe("+10y");
    expect(normOf("day", "next mon")).toBe("next mon");
    expect(normOf("day", "next")).toBeNull();
    expect(normOf("day", "+3h")).toBeNull();
    expect(normOf("day", "3d")).toBeNull();
    // Only the story's own day is ever relative to the last one.
    expect(normOf("date", "+3d")).toBeNull();
    expect(relativeDate("+3d thu")).toEqual({
      offset: { amount: 3, unit: "d" },
      weekday: 4,
    });
    expect(relativeDate("-1d")).toEqual({
      offset: { amount: -1, unit: "d" },
      weekday: null,
    });
    expect(relativeDate("next mon")).toEqual({ offset: null, weekday: 1 });
    expect(relativeDate("2024-09-03")).toBeNull();
  });

  it("tells a fixed spelling from a free one by the type alone", () => {
    expect(fixedSpelling("number")).toBe(true);
    expect(fixedSpelling("colour")).toBe(true);
    expect(fixedSpelling("day")).toBe(true);
    expect(fixedSpelling("words")).toBe(false);
    expect(fixedSpelling("name")).toBe(false);
  });
});

describe("claimOf", () => {
  it("keeps a claim whose quote the text holds, as the text words it", () => {
    const claim = claimOf(
      fact({
        attribute: "Eye Colour",
        type: "colour",
        value: "grigi",
        norm: "grey",
        // Joined spacing, a model's straight apostrophe: still the writer's.
        quote: "I suoi occhi erano grigi",
      }),
      TEXT,
      1_000,
    );
    expect(claim).toEqual({
      entity: "Marta Neri",
      kind: "person",
      status: "stated",
      attribute: "eye colour",
      type: "colour",
      value: "grigi",
      norm: "grey",
      quote: "I suoi occhi  erano grigi",
      at: 1_000 + TEXT.indexOf("I suoi"),
      change: false,
    });
  });

  it("drops a claim it cannot believe or cannot find", () => {
    expect(claimOf(fact(), TEXT)).not.toBeNull();
    for (const bad of [
      null,
      "age",
      fact({ type: "mood" }),
      fact({ attribute: " " }),
      fact({ entity: " " }),
      fact({ value: "" }),
      fact({ norm: "thirty-four" }),
      fact({ norm: 34 }),
      // What the entity is, missing or off the list.
      fact({ kind: undefined }),
      fact({ kind: "robot" }),
      // The label as the value: says nothing.
      fact({ attribute: "mother", type: "words", norm: "Mother" }),
      fact({ quote: "Marta aveva trentacinque anni." }),
      fact({ quote: "Ma" }),
      fact({ quote: `${"a ".repeat(151)}` }),
    ])
      expect(claimOf(bad, TEXT)).toBeNull();
    // A label is lower-case, and never holds the keys' "|".
    expect(
      claimOf(
        fact({ attribute: "Scar | Face", type: "words", norm: "left cheek" }),
        TEXT,
      )?.attribute,
    ).toBe("scar face");
    expect(claimOf(fact({ change: "yes" }), TEXT)?.change).toBe(false);
    // A number of years may count from a date; nothing else does.
    expect(claimOf(fact({ since: "Birth" }), TEXT)?.since).toBe("birth");
    expect(claimOf(fact({ since: "" }), TEXT)).not.toHaveProperty("since");
    expect(
      claimOf(
        fact({ type: "words", norm: "thirty-four", since: "birth" }),
        TEXT,
      ),
    ).not.toHaveProperty("since");
  });

  it("dates a sheet's declared change by the Section it names", () => {
    const sections = ["node:A", "node:B"];
    const from = (overrides: Record<string, unknown>) =>
      claimOf(fact(overrides), TEXT, 0, sections)?.from;
    expect(from({ change: true, section: 2 })).toBe("node:B");
    // No change, no Section; none named, or one off the list: no date.
    expect(from({ change: false, section: 2 })).toBeUndefined();
    expect(from({ change: true, section: 0 })).toBeUndefined();
    expect(from({ change: true, section: 3 })).toBeUndefined();
    expect(from({ change: true, section: "2" })).toBeUndefined();
    expect(claimOf(fact({ change: true, section: 1 }), TEXT)?.from).toBe(
      undefined,
    );
  });
});

describe("locate", () => {
  it("finds a quote folded and across any spacing, or says it is not there", () => {
    expect(locate("Il «Leone» ruggì\n  forte.", '"leone" RUGGI forte')).toEqual(
      {
        start: 3,
        end: 24,
      },
    );
    expect(locate("a (b) c", "(b)")).toEqual({ start: 2, end: 5 });
    expect(locate("text", "  ")).toBeNull();
    expect(locate("text", "other")).toBeNull();
  });
});

describe("ledgerOf", () => {
  const ledger: SectionLedger = {
    sourceId: "node:A",
    contentHash: "h",
    recipeRevision: LEDGER_RECIPE_REVISION,
    model: "ollama/qwen3:8b",
    origin: "prose",
    dropped: 0,
    claims: [
      {
        entity: "Marta",
        kind: "person",
        status: "stated",
        attribute: "age",
        type: "number",
        value: "34",
        norm: "34 years",
        since: "birth",
        quote: "Marta aveva trentaquattro anni.",
        at: 0,
        change: false,
      },
    ],
  };

  // The prose is fresh only against the present it was told, so
  // a stored ledger that lost it would read as stale on every check that
  // names one, and the prose would go back to the model each time.
  it("reads back the story's present the prose was told", () => {
    const told: SectionLedger = { ...ledger, present: "1906" };
    expect(ledgerOf(JSON.parse(JSON.stringify(told)))).toEqual(told);
    expect(ledgerOf({ ...ledger, present: 1906 })).toBeNull();
  });

  it("reads back what was written, and nothing else", () => {
    expect(ledgerOf(JSON.parse(JSON.stringify(ledger)))).toEqual(ledger);
    expect(ledgerOf(null)).toBeNull();
    expect(ledgerOf({ ...ledger, origin: "notes" })).toBeNull();
    expect(ledgerOf({ ...ledger, claims: "none" })).toBeNull();
    expect(ledgerOf({ ...ledger, claims: [null] })).toBeNull();
    expect(
      ledgerOf({ ...ledger, claims: [{ ...ledger.claims[0], norm: "old" }] }),
    ).toBeNull();
    expect(
      ledgerOf({ ...ledger, claims: [{ ...ledger.claims[0], at: "0" }] }),
    ).toBeNull();
    expect(
      ledgerOf({ ...ledger, claims: [{ ...ledger.claims[0], type: "age" }] }),
    ).toBeNull();
    expect(
      ledgerOf({ ...ledger, claims: [{ ...ledger.claims[0], since: 1 }] }),
    ).toBeNull();
    // A sheet's dated change is read back with its Section.
    const dated = {
      ...ledger,
      origin: "sheet" as const,
      claims: [{ ...ledger.claims[0], change: true, from: "node:B" }],
    };
    expect(ledgerOf(JSON.parse(JSON.stringify(dated)))).toEqual(dated);
    expect(
      ledgerOf({ ...dated, claims: [{ ...dated.claims[0], from: 2 }] }),
    ).toBeNull();
  });
});

// ── How the text holds a fact ────────────────────────────────────────────────

describe("a claim's status", () => {
  it("keeps the status the model gave, and believes no claim without one", () => {
    expect(claimOf(fact(), TEXT)?.status).toBe("stated");
    expect(claimOf(fact({ status: "believed" }), TEXT)?.status).toBe(
      "believed",
    );
    expect(claimOf(fact({ status: "planned" }), TEXT)?.status).toBe("planned");
    expect(claimOf(fact({ status: "open" }), TEXT)?.status).toBe("open");
    expect(claimOf(fact({ status: "maybe" }), TEXT)).toBeNull();
    expect(claimOf(fact({ status: undefined }), TEXT)).toBeNull();
  });

  it("reads no stored ledger whose claims carry no status", () => {
    const claim = claimOf(fact(), TEXT);
    expect(claim).not.toBeNull();
    const ledger: SectionLedger = {
      sourceId: "node:A",
      contentHash: "h",
      recipeRevision: LEDGER_RECIPE_REVISION,
      model: "m",
      origin: "prose",
      claims: claim ? [claim] : [],
      dropped: 0,
    };
    expect(ledgerOf(ledger)).toEqual(ledger);
    const { status: _dropped, ...without } = ledger.claims[0];
    expect(ledgerOf({ ...ledger, claims: [without] })).toBeNull();
    expect(
      ledgerOf({ ...ledger, claims: [{ ...ledger.claims[0], status: "x" }] }),
    ).toBeNull();
  });
});

// ── A value's own time ───────────────────────────────────────────────────────

describe("a value's own time", () => {
  it("reads when as a date or as past or future, and drops what is no time", () => {
    expect(claimOf(fact({ when: "1999" }), TEXT)?.when).toBe("1999");
    expect(claimOf(fact({ when: "1999-03-14 sat" }), TEXT)?.when).toBe(
      "1999-03-14",
    );
    expect(claimOf(fact({ when: " Past " }), TEXT)?.when).toBe("past");
    expect(claimOf(fact({ when: "future" }), TEXT)?.when).toBe("future");
    expect(claimOf(fact({ when: "" }), TEXT)).not.toHaveProperty("when");
    expect(claimOf(fact({ when: "present" }), TEXT)).not.toHaveProperty("when");
    expect(claimOf(fact({ when: "now" }), TEXT)).not.toHaveProperty("when");
    expect(claimOf(fact({ when: 1999 }), TEXT)).not.toHaveProperty("when");
    // A time the app cannot place is no scope: the value is compared as of
    // the passage.
    expect(claimOf(fact({ when: "the avalanche" }), TEXT)).not.toHaveProperty(
      "when",
    );
    expect(claimOf(fact(), TEXT)).not.toHaveProperty("when");
  });

  it("never scopes a date to its own year", () => {
    // A date stamped with its own year says it twice, and a value scoped to
    // another time is never held to the present, so the prose's other year
    // would never be put beside it.
    const date = (norm: string, when: string) =>
      fact({ attribute: "date", type: "date", value: norm, norm, when });
    expect(claimOf(date("1904", "1904"), TEXT)).not.toHaveProperty("when");
    expect(claimOf(date("1904-05-02", "1904"), TEXT)).not.toHaveProperty(
      "when",
    );
    // A date stated as of another time keeps it, and so does any other type.
    expect(claimOf(date("1904", "1911"), TEXT)?.when).toBe("1911");
    expect(claimOf(fact({ when: "1999" }), TEXT)?.when).toBe("1999");
  });

  it("reads a stored when back, and refuses one out of its spelling", () => {
    const stored: SectionLedger = {
      sourceId: "node:A",
      contentHash: "h",
      recipeRevision: LEDGER_RECIPE_REVISION,
      model: "m",
      origin: "prose",
      dropped: 0,
      claims: [
        {
          entity: "Hollis",
          kind: "person",
          status: "stated",
          attribute: "age",
          type: "number",
          value: "forty-one",
          norm: "41 years",
          quote: "I was forty-one.",
          at: 0,
          change: false,
          when: "1999",
        },
      ],
    };
    expect(ledgerOf(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    expect(
      ledgerOf({ ...stored, claims: [{ ...stored.claims[0], when: "then" }] }),
    ).toBeNull();
    expect(
      ledgerOf({ ...stored, claims: [{ ...stored.claims[0], when: 1999 }] }),
    ).toBeNull();
  });
});
