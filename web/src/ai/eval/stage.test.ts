// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { Candidate } from "../domain/candidates";
import { valueKey } from "../domain/candidates";
import { ENTITY_RECIPE_REVISION, type EntityGroups } from "../domain/entities";
import type { Claim, SectionLedger } from "../domain/ledger";
import type { Plant } from "./plant";
import type { ScoredPlant } from "./score";
import { stageOf, type StageArtifacts, type StageResult } from "./stage";

// The stage a missed plant was lost at, read off the run's own ledgers, kept
// groupings and candidates. Recall work aims where the loss
// is, so the stage tells a grouping loss from an extraction loss: a fact
// noted under two label wordings the grouping did not unite is a grouping
// loss, not an extraction loss. Claims pair as the pipeline paired them, not
// as a looser reading would.

function claim(
  entity: string,
  attribute: string,
  norm: string,
  quote: string,
  extra: Partial<Claim> = {},
): Claim {
  return {
    entity,
    kind: "person",
    status: "stated",
    attribute,
    type: "number",
    value: norm,
    norm,
    quote,
    at: 0,
    change: false,
    ...extra,
  };
}

function ledger(
  sourceId: string,
  origin: SectionLedger["origin"],
  claims: Claim[],
): SectionLedger {
  return {
    sourceId,
    contentHash: "h",
    recipeRevision: "r",
    model: "m",
    origin,
    claims,
    dropped: 0,
  };
}

const SHEET = "reference:character--ottavia.md";
const PROSE = "node:section--01-il-faro.md";
const WITNESS = "Aveva cinquantadue anni e le mani screpolate.";

/** The sheet's age planted from 52 to 76, witnessed by the prose. */
const PLANT: Plant = {
  kind: "sheet",
  sourceId: SHEET,
  before: "52",
  after: "76",
  offset: 2,
  witnesses: [{ sourceId: PROSE, quote: WITNESS }],
};

const missed = (plant: Plant = PLANT): ScoredPlant => ({
  plant,
  found: false,
  witnessed: false,
  diagnosis: "missed",
});

const nothingRaised: StageResult = {
  raised: [],
  unresolved: [],
  deferred: [],
};

function groupings(parts: Partial<EntityGroups> = {}): EntityGroups {
  const none = { asked: [], model: "m", groups: [] };
  return {
    recipeRevision: ENTITY_RECIPE_REVISION,
    names: none,
    labels: none,
    values: none,
    ...parts,
  };
}

function artifacts(
  ledgers: SectionLedger[],
  kept: EntityGroups | null = groupings(),
): StageArtifacts {
  return {
    ledgers: new Map(ledgers.map((one) => [one.sourceId, one])),
    groupings: kept,
  };
}

const plantedSheet = ledger(SHEET, "sheet", [
  claim("Ottavia", "age", "76", "- 76 anni"),
]);

describe("stageOf", () => {
  it("names a plant a finding quoted as found", () => {
    expect(
      stageOf(
        { ...missed(), found: true, diagnosis: "contact-only" },
        artifacts([]),
        nothingRaised,
      ),
    ).toEqual({ stage: "found", detail: expect.any(String) });
  });

  it("is an extraction loss when the plant's source has no ledger", () => {
    expect(stageOf(missed(), artifacts([]), nothingRaised)).toMatchObject({
      stage: "extraction",
      detail: "no ledger for its source",
    });
  });

  it("is an extraction loss when no claim holds the planted words", () => {
    const sheet = ledger(SHEET, "sheet", [
      claim("Ottavia", "eyes", "grey", "- occhi grigi", { type: "colour" }),
    ]);
    expect(stageOf(missed(), artifacts([sheet]), nothingRaised)).toMatchObject({
      stage: "extraction",
      detail: "the planted words are in no claim",
    });
  });

  it("is an extraction loss when the planted words are only in a claim's quote, never its value", () => {
    // One sheet line is quoted by every claim read from it. "golden" in the
    // hair colour's quote does not make the hair golden; pairing by quotes
    // would pair different facts read from one line.
    const plant: Plant = {
      kind: "sheet",
      sourceId: SHEET,
      before: "black",
      after: "golden",
      offset: 0,
      witnesses: [{ sourceId: PROSE, quote: "She wore a black wool hat." }],
    };
    const sheet = ledger(SHEET, "sheet", [
      claim("Hollis", "hair colour", "white", "- white hair, golden hat", {
        type: "colour",
      }),
    ]);
    expect(
      stageOf(missed(plant), artifacts([sheet]), nothingRaised),
    ).toMatchObject({
      stage: "extraction",
      detail: expect.stringContaining("no claim's value"),
    });
  });

  it("is a judgment loss, told three ways, once a candidate held the plant", () => {
    const candidate = {
      key: "ottavia|age|52|76",
      kind: "sheet",
      entity: "Ottavia",
      attribute: "age",
      type: "number",
      sides: [
        {
          sourceId: SHEET,
          origin: "sheet",
          at: 0,
          quote: "- 76 anni",
          value: "76",
          norm: "76",
        },
        {
          sourceId: PROSE,
          origin: "prose",
          at: 0,
          quote: WITNESS,
          value: "52",
          norm: "52",
        },
      ],
      counts: [1, 1],
    } as Candidate;
    const art = artifacts([plantedSheet]);
    expect(
      stageOf(missed(), art, {
        raised: [candidate],
        unresolved: [candidate],
        deferred: [],
      }),
    ).toMatchObject({ stage: "judgment", detail: "answered in no shape" });
    expect(
      stageOf(missed(), art, {
        raised: [candidate],
        unresolved: [],
        deferred: [candidate],
      }),
    ).toMatchObject({ stage: "judgment", detail: "deferred past the cap" });
    expect(
      stageOf(missed(), art, {
        raised: [candidate],
        unresolved: [],
        deferred: [],
      }),
    ).toMatchObject({ stage: "judgment", detail: "raised, judged no slip" });
  });

  it("is a candidate loss when a weekday is in the ledger and no calendar candidate was raised", () => {
    const plant: Plant = {
      kind: "weekday",
      sourceId: PROSE,
      before: "sabato",
      after: "lunedì",
      offset: 0,
      selfVerifying: true,
    };
    const prose = ledger(PROSE, "prose", [
      claim("the story", "date", "2022-10-14 mon", "lunedì 14 ottobre 2022", {
        kind: "thing",
        type: "date",
        value: "lunedì 14 ottobre 2022",
      }),
    ]);
    expect(
      stageOf(missed(plant), artifacts([prose]), nothingRaised),
    ).toMatchObject({
      stage: "candidate",
      detail: expect.stringContaining("no calendar candidate"),
    });
  });

  it("is a GROUPING loss when the counterpart is noted under a label wording the grouping did not unite", () => {
    // The prose noted the same age under "age at the story's start"; the
    // kept label groups do not join the two wordings, so `candidates` keyed
    // them as two facts and raised nothing. Differing attribute strings are
    // not "no counterpart claim", which would read as an extraction loss.
    const prose = ledger(PROSE, "prose", [
      claim("Ottavia", "age at the story's start", "52", WITNESS),
    ]);
    expect(
      stageOf(missed(), artifacts([plantedSheet, prose]), nothingRaised),
    ).toMatchObject({
      stage: "grouping",
      detail: expect.stringMatching(
        /labels not united.*"age".*"age at the story's start"/u,
      ),
    });
  });

  it("is a GROUPING loss when a place is noted under two names the grouping did not unite", () => {
    const plant: Plant = {
      kind: "number",
      sourceId: PROSE,
      before: "trenta",
      after: "quaranta",
      offset: 0,
      witnesses: [
        {
          sourceId: "node:section--02.md",
          quote: "La torre del faro misura trenta metri.",
        },
      ],
    };
    const first = ledger(PROSE, "prose", [
      claim("il faro", "height", "40", "Il faro è alto quaranta metri.", {
        kind: "place",
        value: "quaranta metri",
      }),
    ]);
    const second = ledger("node:section--02.md", "prose", [
      claim(
        "la torre del faro",
        "height",
        "30",
        "La torre del faro misura trenta metri.",
        { kind: "place", value: "trenta metri" },
      ),
    ]);
    expect(
      stageOf(missed(plant), artifacts([first, second]), nothingRaised),
    ).toMatchObject({
      stage: "grouping",
      detail: expect.stringMatching(
        /names not united.*"il faro".*"la torre del faro"/u,
      ),
    });
  });

  it("is a CANDIDATE loss when the kept groups unite both sides and nothing was raised", () => {
    const prose = ledger(PROSE, "prose", [
      claim("Ottavia", "age at the story's start", "52", WITNESS),
    ]);
    const kept = groupings({
      labels: {
        asked: [],
        model: "m",
        groups: [["age", "age at the story's start"]],
      },
    });
    expect(
      stageOf(missed(), artifacts([plantedSheet, prose], kept), nothingRaised),
    ).toMatchObject({
      stage: "candidate",
      detail: expect.stringContaining("one fact, two values"),
    });
  });

  it("is a CANDIDATE loss when the resolver named one person apart from himself", () => {
    // The sheet's "daughter of Amos" is a name-typed claim with the
    // attribute `father`, and `entityResolver` reads every stated name claim
    // on a person as the entity's own name. So "Amos" becomes "Hollis Wren"
    // while the prose's "Amos Wren" stays himself, and the two tenures are
    // never one fact. The grouping question is not asked of people, so this
    // is the candidate construction's loss.
    const plant: Plant = {
      kind: "number",
      sourceId: PROSE,
      before: "thirty-eight",
      after: "twenty-seven",
      offset: 0,
      witnesses: [
        {
          sourceId: SHEET,
          quote: "- daughter of Amos, who kept the hut for thirty-eight years",
        },
      ],
    };
    const prose = ledger(PROSE, "prose", [
      claim(
        "Amos Wren",
        "tenure",
        "27 years",
        "Amos Wren had kept the hut for twenty-seven years.",
        { value: "twenty-seven years" },
      ),
      // A second person holding the word, so the resolver guesses between
      // neither. A thing named after Amos does not count.
      claim("Amos Hale", "job", "guide", "Amos Hale guided the party.", {
        type: "words",
      }),
    ]);
    const sheet = ledger(SHEET, "sheet", [
      claim(
        "Hollis Wren",
        "father",
        "amos",
        "- daughter of Amos, who kept the hut for thirty-eight years",
        { type: "name", value: "Amos" },
      ),
      claim(
        "Amos",
        "tenure",
        "38 years",
        "- daughter of Amos, who kept the hut for thirty-eight years",
        { value: "thirty-eight years" },
      ),
    ]);
    expect(
      stageOf(missed(plant), artifacts([prose, sheet]), nothingRaised),
    ).toMatchObject({
      stage: "candidate",
      detail: expect.stringMatching(
        /resolver named them apart.*"Amos" as "amos"/u,
      ),
    });
  });

  it("is UNPAIRED when the two statements share neither a name nor a label the pipeline could unite", () => {
    // The sheet's hat colour was read as the hat's `colour`, the prose's as
    // Hollis's `hat colour`: a person and a thing, two labels. No grouping
    // question could have made them one; a reader decides whether the
    // extractor decomposed one fact two ways or the witness is another.
    const plant: Plant = {
      kind: "sheet",
      sourceId: SHEET,
      before: "black",
      after: "golden",
      offset: 0,
      witnesses: [
        { sourceId: PROSE, quote: "a red jacket and a black wool hat" },
      ],
    };
    const sheet = ledger(SHEET, "sheet", [
      claim("Hollis Wren's hat", "colour", "yellow", "- golden hat", {
        kind: "thing",
        type: "colour",
        value: "golden",
      }),
    ]);
    const prose = ledger(PROSE, "prose", [
      claim(
        "Hollis Wren",
        "hat colour",
        "black",
        "a red jacket and a black wool hat",
        { type: "colour" },
      ),
    ]);
    expect(
      stageOf(missed(plant), artifacts([sheet, prose]), nothingRaised),
    ).toMatchObject({
      stage: "unpaired",
      detail: expect.stringContaining("neither name nor label united"),
    });
  });

  it("is a GROUPING loss when the value grouping made the two values one", () => {
    const plant: Plant = {
      kind: "colour",
      sourceId: PROSE,
      before: "green",
      after: "brown",
      offset: 0,
      witnesses: [{ sourceId: SHEET, quote: "- coat: dark green" }],
    };
    const prose = ledger(PROSE, "prose", [
      claim("Marta", "coat colour", "brown", "Her brown coat.", {
        type: "colour",
      }),
    ]);
    const sheet = ledger(SHEET, "sheet", [
      claim("Marta", "coat colour", "dark green", "- coat: dark green", {
        type: "words",
      }),
    ]);
    const kept = groupings({
      values: {
        asked: [],
        model: "m",
        groups: [
          [
            valueKey("coat colour", "brown"),
            valueKey("coat colour", "dark green"),
          ],
        ],
      },
    });
    expect(
      stageOf(missed(plant), artifacts([prose, sheet], kept), nothingRaised),
    ).toMatchObject({
      stage: "grouping",
      detail: expect.stringContaining("grouped as one"),
    });
  });

  it("is an extraction loss when the witness sentence yielded no claim of the fact", () => {
    // The prose ledger exists and holds the old number, but about someone
    // else, outside the witness sentence. Another entity's 52 is no
    // counterpart.
    const prose = ledger(PROSE, "prose", [
      claim("Tommaso", "age", "52", "Tommaso aveva cinquantadue anni."),
    ]);
    expect(
      stageOf(missed(), artifacts([plantedSheet, prose]), nothingRaised),
    ).toMatchObject({
      stage: "extraction",
      detail: expect.stringContaining("witness sentence yielded no claim"),
    });
  });

  it("is an extraction loss when the witness sentence yielded claims, none with the old value", () => {
    const prose = ledger(PROSE, "prose", [
      claim("Ottavia", "hands", "screpolate", WITNESS, { type: "words" }),
    ]);
    expect(
      stageOf(missed(), artifacts([plantedSheet, prose]), nothingRaised),
    ).toMatchObject({
      stage: "extraction",
      detail: expect.stringContaining("none with the old value"),
    });
  });

  it("is an extraction loss when the planted value was read as its counterpart's", () => {
    // The value holds the planted 76 but the extractor normalised it to
    // 52: the change never reached the value the candidates compare.
    const sheet = ledger(SHEET, "sheet", [
      claim("Ottavia", "age", "52", "- 76 anni", { value: "76 anni" }),
    ]);
    const prose = ledger(PROSE, "prose", [
      claim("Ottavia", "age", "52", WITNESS),
    ]);
    expect(
      stageOf(missed(), artifacts([sheet, prose]), nothingRaised),
    ).toMatchObject({
      stage: "extraction",
      detail: expect.stringContaining("same value"),
    });
  });

  it("is a candidate loss when the counterpart is noted as a belief, which is never compared", () => {
    const prose = ledger(PROSE, "prose", [
      claim("Ottavia", "age", "52", WITNESS, { status: "believed" }),
    ]);
    expect(
      stageOf(missed(), artifacts([plantedSheet, prose]), nothingRaised),
    ).toMatchObject({
      stage: "candidate",
      detail: expect.stringContaining('"believed"'),
    });
  });

  it("is a GROUPING loss when one person's fact wears two labels and the resolver parted his names too", () => {
    // The prose's "Giacomo Marchi | years as lighthouse keeper" against the
    // sheet's "Giacomo | job duration". The label question parted them
    // first; that the resolver also read "Giacomo" as his daughter is said
    // beside it.
    const plant: Plant = {
      kind: "number",
      sourceId: PROSE,
      before: "quarantuno",
      after: "ventinove",
      offset: 0,
      witnesses: [
        {
          sourceId: SHEET,
          quote: "- figlia di Giacomo, guardiano del faro per quarantuno anni",
        },
      ],
    };
    const prose = ledger(PROSE, "prose", [
      claim(
        "Giacomo Marchi",
        "years as lighthouse keeper",
        "29 years",
        "che aveva tenuto il faro per ventinove anni",
        {
          value: "ventinove anni",
        },
      ),
    ]);
    const sheet = ledger(SHEET, "sheet", [
      // A second person holding the word keeps the resolver from making
      // "Giacomo" "Giacomo Marchi" on its own.
      claim("Giacomo Rossi", "job", "fisherman", "Giacomo Rossi pescava.", {
        type: "words",
      }),
      claim(
        "Ottavia Marchi",
        "father",
        "giacomo",
        "- figlia di Giacomo, guardiano del faro per quarantuno anni",
        {
          type: "name",
          value: "Giacomo",
        },
      ),
      claim(
        "Giacomo",
        "job duration",
        "41 years",
        "- figlia di Giacomo, guardiano del faro per quarantuno anni",
        {
          value: "quarantuno anni",
        },
      ),
    ]);
    expect(
      stageOf(missed(plant), artifacts([prose, sheet]), nothingRaised),
    ).toMatchObject({
      stage: "grouping",
      detail: expect.stringMatching(
        /labels not united.*"job duration"; and the resolver named them apart/u,
      ),
    });
  });

  it("is a CANDIDATE loss, by design, when one side is of another time and the other of the present", () => {
    const plant: Plant = {
      kind: "number",
      sourceId: PROSE,
      before: "quarantuno",
      after: "ventinove",
      offset: 0,
      witnesses: [
        { sourceId: SHEET, quote: "- guardiano del faro per quarantuno anni" },
      ],
    };
    const prose = ledger(PROSE, "prose", [
      claim(
        "Giacomo",
        "job duration",
        "29 years",
        "che aveva tenuto il faro per ventinove anni",
        {
          value: "ventinove anni",
          when: "past",
        },
      ),
    ]);
    const sheet = ledger(SHEET, "sheet", [
      claim(
        "Giacomo",
        "job duration",
        "41 years",
        "- guardiano del faro per quarantuno anni",
        {
          value: "quarantuno anni",
        },
      ),
    ]);
    expect(
      stageOf(missed(plant), artifacts([prose, sheet]), nothingRaised),
    ).toMatchObject({
      stage: "candidate",
      detail: expect.stringContaining("of another time"),
    });
  });

  it("says a dated other time is held only by the years' arithmetic", () => {
    const plant: Plant = {
      kind: "number",
      sourceId: PROSE,
      before: "forty-one",
      after: "thirty",
      offset: 0,
      witnesses: [{ sourceId: SHEET, quote: "- forty-one at the avalanche" }],
    };
    const prose = ledger(PROSE, "prose", [
      claim("Hollis", "age", "30 years", "In 1999 I was thirty.", {
        value: "thirty",
        when: "1999",
      }),
    ]);
    const sheet = ledger(SHEET, "sheet", [
      claim("Hollis", "age", "41 years", "- forty-one at the avalanche", {
        value: "forty-one",
      }),
    ]);
    expect(
      stageOf(missed(plant), artifacts([prose, sheet]), nothingRaised),
    ).toMatchObject({
      stage: "candidate",
      detail: expect.stringContaining("held only by the years' arithmetic"),
    });
  });
});
