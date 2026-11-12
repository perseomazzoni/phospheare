// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Candidate, LedgerInBook } from "../domain/candidates";
import { entityKey } from "../domain/entities";
import {
  LEDGER_RECIPE_REVISION,
  type Claim,
  type EntityKind,
  type ValueType,
} from "../domain/ledger";

// Adversarial grouping. The fact check asks a model three grouping
// questions before any candidate exists (`application/entities.ts`): which
// place and thing names are one thing, which labels are one fact, which
// free-word values are one value. A wrong merge there removes a genuine
// disagreement before the judge, or invents one, and no judging recovers
// it. The code refuses the merges it can recognise; a same-kind merge of
// two different things only a model's reading decides.
//
// These cases are built to tempt that merge. Each is a pair of claims in two
// Sections, with `join` and `conflict` fixed in advance. A wrong merge is
// scored as the model answered it (`raw`), as the code kept it after its
// guards (`kept`), and by its effect on the candidates.
//
// Fixtures and pure scoring only; `scripts/grouping-eval.mjs` runs the real
// grouping over them against a real model.

/** Which grouping question a case is aimed at. */
export type GroupingPart = "names" | "labels" | "values";

/**
 * One side of a case: a claim, reduced to what grouping and candidates read.
 */
export interface CaseClaim {
  entity: string;
  kind: EntityKind;
  attribute: string;
  type: ValueType;
  norm: string;
  /** The sentence the claim stands for; unique across a set. */
  quote: string;
}

export interface GroupingCase {
  id: string;
  part: GroupingPart;
  /** Whether the two sides name one thing, label or value. */
  join: boolean;
  /**
   * Whether the book disagrees across the pair, so a candidate belongs
   * there.
   */
  conflict: boolean;
  /** A wrong merge the code's own guard refuses, whatever the model says. */
  guarded?: true;
  a: CaseClaim;
  b: CaseClaim;
}

const claim = (
  entity: string,
  kind: EntityKind,
  attribute: string,
  type: ValueType,
  norm: string,
  quote: string,
): CaseClaim => ({ entity, kind, attribute, type, norm, quote });

/**
 * The labels and values sets are the same in both books: the extractor
 * writes labels and free-word values in English whatever the book's
 * language (`application/ledger.ts`), so only the names, in the book's own
 * spelling, differ.
 */
function labelsAndValues(people: readonly string[]): GroupingCase[] {
  const [
    tenure,
    headwear,
    married,
    hair,
    work,
    body,
    dress,
    dates,
    age,
    keeper,
    bread,
    ward,
    town,
    far,
    home,
  ] = people;
  return [
    // Two label merges a model can miss: one person's tenure under two
    // labels, one cap's colour under two. And a label a careless reader
    // would fold into "age".
    {
      id: "l-tenure",
      part: "labels",
      join: true,
      conflict: true,
      a: claim(
        tenure,
        "person",
        "tenure",
        "number",
        "27 years",
        `${tenure} had kept the light for twenty-seven years.`,
      ),
      b: claim(
        tenure,
        "person",
        "job duration",
        "number",
        "38 years",
        `${tenure} was keeper for thirty-eight years.`,
      ),
    },
    {
      id: "l-cap-hat",
      part: "labels",
      join: true,
      conflict: true,
      a: claim(
        headwear,
        "person",
        "cap colour",
        "colour",
        "grey",
        `${headwear} wore a grey cap.`,
      ),
      b: claim(
        headwear,
        "person",
        "hat colour",
        "colour",
        "brown",
        `${headwear} took off her brown hat.`,
      ),
    },
    {
      id: "l-age-married",
      part: "labels",
      join: false,
      conflict: false,
      a: claim(
        married,
        "person",
        "age",
        "number",
        "61 years",
        `${married} was sixty-one.`,
      ),
      b: claim(
        married,
        "person",
        "age at marriage",
        "number",
        "22 years",
        `${married} had married at twenty-two.`,
      ),
    },
    {
      id: "l-hair",
      part: "labels",
      join: true,
      conflict: true,
      a: claim(
        hair,
        "person",
        "hair colour",
        "colour",
        "black",
        `${hair} had black hair.`,
      ),
      b: claim(
        hair,
        "person",
        "colour of her hair",
        "colour",
        "red",
        `${hair}'s hair was red.`,
      ),
    },
    {
      id: "l-job",
      part: "labels",
      join: true,
      conflict: true,
      a: claim(
        work,
        "person",
        "job",
        "words",
        "painter",
        `${work} was a painter.`,
      ),
      b: claim(
        work,
        "person",
        "occupation",
        "words",
        "teacher",
        `${work} worked as a teacher.`,
      ),
    },
    {
      id: "l-height-weight",
      part: "labels",
      join: false,
      conflict: false,
      a: claim(
        body,
        "person",
        "height",
        "number",
        "1.8 metres",
        `${body} was one metre eighty.`,
      ),
      b: claim(
        body,
        "person",
        "weight",
        "number",
        "80 kilograms",
        `${body} weighed eighty kilos.`,
      ),
    },
    {
      id: "l-eye-coat",
      part: "labels",
      join: false,
      conflict: false,
      a: claim(
        dress,
        "person",
        "eye colour",
        "colour",
        "green",
        `${dress} had green eyes.`,
      ),
      b: claim(
        dress,
        "person",
        "coat colour",
        "colour",
        "grey",
        `${dress} wore a grey coat.`,
      ),
    },
    {
      id: "l-dates",
      part: "labels",
      join: false,
      conflict: false,
      a: claim(
        dates,
        "person",
        "birth date",
        "date",
        "1961-05-03",
        `${dates} was born on 3 May 1961.`,
      ),
      b: claim(
        dates,
        "person",
        "wedding date",
        "date",
        "1990-06-12",
        `${dates} married on 12 June 1990.`,
      ),
    },
    {
      id: "l-age-group",
      part: "labels",
      join: false,
      conflict: false,
      guarded: true,
      a: claim(
        age,
        "person",
        "age",
        "number",
        "34 years",
        `${age} was thirty-four.`,
      ),
      b: claim(
        age,
        "person",
        "age group",
        "words",
        "young adult",
        `${age} was a young adult.`,
      ),
    },
    {
      id: "v-keeper",
      part: "values",
      join: true,
      conflict: false,
      a: claim(
        keeper,
        "person",
        "job",
        "words",
        "lighthouse keeper",
        `${keeper} was the lighthouse keeper.`,
      ),
      b: claim(
        keeper,
        "person",
        "job",
        "words",
        "keeper of the lighthouse",
        `${keeper}, keeper of the lighthouse.`,
      ),
    },
    {
      id: "v-baker",
      part: "values",
      join: false,
      conflict: true,
      a: claim(
        bread,
        "person",
        "job",
        "words",
        "baker",
        `${bread} was a baker.`,
      ),
      b: claim(
        bread,
        "person",
        "job",
        "words",
        "banker",
        `${bread} was a banker.`,
      ),
    },
    {
      id: "v-nurse",
      part: "values",
      join: false,
      conflict: true,
      a: claim(
        ward,
        "person",
        "job",
        "words",
        "nurse",
        `${ward} was a nurse on the ward.`,
      ),
      b: claim(
        ward,
        "person",
        "job",
        "words",
        "doctor",
        `${ward} was the ward's doctor.`,
      ),
    },
    {
      id: "v-genoa",
      part: "values",
      join: true,
      conflict: false,
      a: claim(
        town,
        "person",
        "hometown",
        "words",
        "genoa",
        `${town} came from Genoa.`,
      ),
      b: claim(
        town,
        "person",
        "hometown",
        "words",
        "genova",
        `${town} was born in Genova.`,
      ),
    },
    {
      id: "v-austria",
      part: "values",
      join: false,
      conflict: true,
      a: claim(
        far,
        "person",
        "hometown",
        "words",
        "austria",
        `${far} grew up in Austria.`,
      ),
      b: claim(
        far,
        "person",
        "hometown",
        "words",
        "australia",
        `${far} grew up in Australia.`,
      ),
    },
    {
      id: "v-harbour",
      part: "values",
      join: true,
      conflict: false,
      a: claim(
        home,
        "person",
        "home",
        "words",
        "a flat above the harbour",
        `${home} lived in a flat above the harbour.`,
      ),
      b: claim(
        home,
        "person",
        "home",
        "words",
        "a flat over the port",
        `${home}'s flat looked over the port.`,
      ),
    },
  ];
}

/** The two sets, one per book language. */
export const GROUPING_CASES: Readonly<
  Record<"en" | "it", readonly GroupingCase[]>
> = {
  en: [
    {
      id: "n-lighthouse",
      part: "names",
      join: true,
      conflict: true,
      a: claim(
        "the lighthouse",
        "place",
        "height",
        "number",
        "30 metres",
        "The lighthouse stood thirty metres above the rocks.",
      ),
      b: claim(
        "the Punta Grigia lighthouse",
        "place",
        "height",
        "number",
        "40 metres",
        "The Punta Grigia lighthouse was forty metres tall.",
      ),
    },
    {
      id: "n-logbook",
      part: "names",
      join: true,
      conflict: true,
      a: claim(
        "the logbook",
        "thing",
        "cover colour",
        "colour",
        "green",
        "The logbook had a green cover.",
      ),
      b: claim(
        "the log book",
        "thing",
        "cover colour",
        "colour",
        "red",
        "The log book's cover was red.",
      ),
    },
    {
      id: "n-towers",
      part: "names",
      join: false,
      conflict: false,
      a: claim(
        "the north tower",
        "place",
        "height",
        "number",
        "20 metres",
        "The north tower was twenty metres high.",
      ),
      b: claim(
        "the south tower",
        "place",
        "height",
        "number",
        "35 metres",
        "The south tower rose thirty-five metres.",
      ),
    },
    {
      id: "n-notebooks",
      part: "names",
      join: false,
      conflict: false,
      a: claim(
        "the red notebook",
        "thing",
        "number of pages",
        "number",
        "80",
        "The red notebook had eighty pages.",
      ),
      b: claim(
        "the blue notebook",
        "thing",
        "number of pages",
        "number",
        "120",
        "The blue notebook had a hundred and twenty pages.",
      ),
    },
    {
      id: "n-anchor",
      part: "names",
      join: false,
      conflict: false,
      guarded: true,
      a: claim(
        "the Anchor Inn",
        "place",
        "age",
        "number",
        "200 years",
        "The Anchor Inn was two hundred years old.",
      ),
      b: claim(
        "the anchor",
        "thing",
        "age",
        "number",
        "40 years",
        "The anchor was forty years old.",
      ),
    },
    {
      id: "n-lanes",
      part: "names",
      join: false,
      conflict: false,
      a: claim(
        "Mill Lane",
        "place",
        "length",
        "number",
        "300 metres",
        "Mill Lane ran for three hundred metres.",
      ),
      b: claim(
        "Mill Road",
        "place",
        "length",
        "number",
        "800 metres",
        "Mill Road ran for eight hundred metres.",
      ),
    },
    ...labelsAndValues([
      "Amos",
      "Hollis",
      "Wanda",
      "Marta",
      "Elena",
      "Luca",
      "Sara",
      "Paolo",
      "Tomas",
      "Giacomo",
      "Nina",
      "Rosa",
      "Ada",
      "Ivo",
      "Bruno",
    ]),
  ],
  it: [
    {
      id: "n-lighthouse",
      part: "names",
      join: true,
      conflict: true,
      a: claim(
        "il faro",
        "place",
        "height",
        "number",
        "30 metres",
        "Il faro si alzava trenta metri sopra gli scogli.",
      ),
      b: claim(
        "il faro di Punta Grigia",
        "place",
        "height",
        "number",
        "40 metres",
        "Il faro di Punta Grigia era alto quaranta metri.",
      ),
    },
    {
      id: "n-logbook",
      part: "names",
      join: true,
      conflict: true,
      a: claim(
        "il diario di bordo",
        "thing",
        "cover colour",
        "colour",
        "green",
        "Il diario di bordo aveva la copertina verde.",
      ),
      b: claim(
        "il giornale di bordo",
        "thing",
        "cover colour",
        "colour",
        "red",
        "La copertina del giornale di bordo era rossa.",
      ),
    },
    {
      id: "n-towers",
      part: "names",
      join: false,
      conflict: false,
      a: claim(
        "la torre nord",
        "place",
        "height",
        "number",
        "20 metres",
        "La torre nord era alta venti metri.",
      ),
      b: claim(
        "la torre sud",
        "place",
        "height",
        "number",
        "35 metres",
        "La torre sud arrivava a trentacinque metri.",
      ),
    },
    {
      id: "n-notebooks",
      part: "names",
      join: false,
      conflict: false,
      a: claim(
        "il quaderno rosso",
        "thing",
        "number of pages",
        "number",
        "80",
        "Il quaderno rosso aveva ottanta pagine.",
      ),
      b: claim(
        "il quaderno blu",
        "thing",
        "number of pages",
        "number",
        "120",
        "Il quaderno blu aveva centoventi pagine.",
      ),
    },
    {
      id: "n-anchor",
      part: "names",
      join: false,
      conflict: false,
      guarded: true,
      a: claim(
        "la Locanda dell'Ancora",
        "place",
        "age",
        "number",
        "200 years",
        "La Locanda dell'Ancora aveva duecento anni.",
      ),
      b: claim(
        "l'ancora",
        "thing",
        "age",
        "number",
        "40 years",
        "L'ancora aveva quarant'anni.",
      ),
    },
    {
      id: "n-lanes",
      part: "names",
      join: false,
      conflict: false,
      a: claim(
        "via del Mulino",
        "place",
        "length",
        "number",
        "300 metres",
        "Via del Mulino era lunga trecento metri.",
      ),
      b: claim(
        "vicolo del Mulino",
        "place",
        "length",
        "number",
        "800 metres",
        "Il vicolo del Mulino era lungo ottocento metri.",
      ),
    },
    ...labelsAndValues([
      "Amos",
      "Ottavia",
      "Wanda",
      "Marta",
      "Elena",
      "Luca",
      "Sara",
      "Paolo",
      "Tommaso",
      "Giacomo",
      "Nina",
      "Rosa",
      "Ada",
      "Ivo",
      "Bruno",
    ]),
  ],
};

/**
 * The cases as a book of two Sections, every case's first side in the
 * first and its second in the second: what grouping and the candidates
 * read. Each claim's quote is its own sentence of its Section's text.
 */
export function groupingBook(cases: readonly GroupingCase[]): LedgerInBook[] {
  return (["a", "b"] as const).map((side, at) => {
    let text = "";
    const claims: Claim[] = cases.map((one) => {
      const said = one[side];
      const placed: Claim = {
        entity: said.entity,
        kind: said.kind,
        status: "stated",
        attribute: said.attribute,
        type: said.type,
        value: said.norm,
        norm: said.norm,
        quote: said.quote,
        at: text.length,
        change: false,
      };
      text += `${said.quote} `;
      return placed;
    });
    return {
      ledger: {
        sourceId: `node:grouping-${at + 1}`,
        contentHash: `grouping-${at + 1}`,
        recipeRevision: LEDGER_RECIPE_REVISION,
        model: "fixture",
        origin: "prose",
        claims,
        dropped: 0,
      },
      text,
    };
  });
}

/**
 * A grouping question's key for one side of a case, as
 * `application/entities.ts` keys it.
 */
export function keyOf(
  part: GroupingPart,
  said: CaseClaim,
  labels: ReadonlyMap<string, string> = new Map(),
): string {
  if (part === "names") return entityKey(said.entity);
  if (part === "labels") return said.attribute;
  return `${labels.get(said.attribute) ?? said.attribute}|${said.norm}`;
}

/**
 * A line of a grouping question (`application/entities.ts`) back to its
 * key: `"The old revolver" (thing)` is a name, `"hair colour" (colour)` a
 * label, `job: "baker"` a value. Null for a line of no known shape.
 */
export function keyOfLine(part: GroupingPart, line: string): string | null {
  try {
    if (part === "values") {
      const value = /^(.+?): (".*")$/u.exec(line);
      return value ? `${value[1]}|${JSON.parse(value[2]) as string}` : null;
    }
    const named = /^(".*") \([^()]*\)$/u.exec(line);
    if (!named) return null;
    const said = JSON.parse(named[1]) as string;
    return part === "names" ? entityKey(said) : said;
  } catch {
    return null;
  }
}

/**
 * The model's own answer to one grouping question, as groups of keys: the
 * numbered lines it was shown and the `{groups}` it returned, before any
 * guard of the code's. Numbers off the list are dropped; an answer of no
 * shape is no groups.
 */
export function rawGroups(
  part: GroupingPart,
  question: string,
  answer: string,
): string[][] {
  const lines = new Map<number, string>();
  for (const row of question.split("\n")) {
    const numbered = /^(\d+)\. (.*)$/u.exec(row);
    const key = numbered && keyOfLine(part, numbered[2]);
    if (numbered && key !== null) lines.set(Number(numbered[1]), key);
  }
  let groups: unknown;
  try {
    groups = (JSON.parse(answer) as { groups?: unknown }).groups;
  } catch {
    return [];
  }
  if (!Array.isArray(groups)) return [];
  return groups
    .filter((group): group is unknown[] => Array.isArray(group))
    .map((group) =>
      group.flatMap((at) =>
        typeof at === "number" && lines.has(at)
          ? [lines.get(at) as string]
          : [],
      ),
    )
    .filter((group) => group.length >= 2);
}

export interface ScoredCase {
  id: string;
  part: GroupingPart;
  join: boolean;
  conflict: boolean;
  guarded: boolean;
  /** The model put the two sides in one group. */
  joinedRaw: boolean;
  /** The code kept them as one after its guards. */
  joinedKept: boolean;
  /** A candidate was raised on the pair. */
  raised: boolean;
  /** The grouping was right as kept: joined if and only if the pair is one. */
  groupedRight: boolean;
  /** The candidates were right: raised if and only if the book disagrees. */
  candidateRight: boolean;
}

/** What one run of the three grouping questions did to each case. */
export interface GroupingOutcome {
  /** The model's own groups per question, as keys (`rawGroups`). */
  raw: Readonly<Record<GroupingPart, readonly (readonly string[])[]>>;
  /** What the code kept: each question's alias map (member → lead). */
  kept: Readonly<Record<GroupingPart, ReadonlyMap<string, string>>>;
  candidates: readonly Pick<Candidate, "sides">[];
}

/** Each case scored against one run's grouping and candidates. */
export function scoreGrouping(
  cases: readonly GroupingCase[],
  outcome: GroupingOutcome,
): ScoredCase[] {
  return cases.map((one) => {
    const labels = outcome.kept.labels;
    const a = keyOf(one.part, one.a, labels);
    const b = keyOf(one.part, one.b, labels);
    const joinedRaw = outcome.raw[one.part].some(
      (group) => group.includes(a) && group.includes(b),
    );
    // A member maps to its lead; a lead is in no map and stands for itself.
    // The values map leads to the lead's value, not its key
    // (`groupValues`), so a value that maps nowhere stands as its value.
    const kept = outcome.kept[one.part];
    const lead = (key: string, said: CaseClaim) =>
      kept.get(key) ?? (one.part === "values" ? said.norm : key);
    const joinedKept = lead(a, one.a) === lead(b, one.b);
    const raised = outcome.candidates.some(
      (candidate) =>
        candidate.sides.some((side) => side.quote === one.a.quote) &&
        candidate.sides.some((side) => side.quote === one.b.quote),
    );
    return {
      id: one.id,
      part: one.part,
      join: one.join,
      conflict: one.conflict,
      guarded: one.guarded === true,
      joinedRaw,
      joinedKept,
      raised,
      groupedRight: joinedKept === one.join,
      candidateRight: raised === one.conflict,
    };
  });
}
