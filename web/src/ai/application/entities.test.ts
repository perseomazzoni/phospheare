// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { ENTITY_RECIPE_REVISION, type EntityGroups } from "../domain/entities";
import {
  LEDGER_RECIPE_REVISION,
  type Claim,
  type SectionLedger,
} from "../domain/ledger";
import type { ModelDescriptor, ModelRequest } from "../domain/types";
import type { ModelProvider } from "../ports";
import { groupEntities, groupLabels, groupValues } from "./entities";

const DESCRIPTOR: ModelDescriptor = {
  id: "m",
  providerId: "ollama",
  label: "m",
  kind: "device",
  capabilities: { tools: true, structuredOutput: true },
  contextTokens: 131_072,
};

function model(
  answer: (request: ModelRequest) => unknown,
  seen: ModelRequest[] = [],
): ModelProvider {
  return {
    id: "stub",
    listModels: async () => [],
    describeModel: async () => DESCRIPTOR,
    estimate: async () => ({ tokens: 1, exact: true }),
    generate: async function* (request) {
      seen.push(request);
      yield { type: "text-delta", text: JSON.stringify(answer(request)) };
      yield { type: "completed", reason: "answer" };
    },
  };
}

class Kept {
  file: EntityGroups | null = null;
  async readEntities() {
    return this.file;
  }
  async writeEntities(groups: EntityGroups) {
    this.file = groups;
  }
}

const claim = (entity: string): Claim => ({
  entity,
  kind: "thing",
  status: "stated",
  attribute: "colour",
  type: "colour",
  value: "green",
  norm: "green",
  quote: "green",
  at: 0,
  change: false,
});

const ledger = (...entities: string[]): SectionLedger => ({
  sourceId: "node:A",
  contentHash: "h",
  recipeRevision: LEDGER_RECIPE_REVISION,
  model: "m",
  origin: "prose",
  claims: entities.map(claim),
  dropped: 0,
});

const deps = (provider: ModelProvider, kept = new Kept()) => ({
  model: provider,
  descriptor: DESCRIPTOR,
  modelRef: { providerId: "ollama", modelId: "m" },
  artifacts: kept,
});

const signal = new AbortController().signal;

// Sorted, the names are: 1 "hale's gun", 2 "la pistola", 3 "the back door",
// 4 "the old revolver".
const BOOK = [
  ledger("The old revolver", "The old revolver", "Hale's gun"),
  ledger("la  pistola", "the back door"),
];

describe("groupEntities", () => {
  it("asks once, of the names alone, and stands each group in for its most noted name", async () => {
    const seen: ModelRequest[] = [];
    const kept = new Kept();
    const { grouped, usage } = await groupEntities(
      BOOK,
      deps(
        model(() => ({ groups: [[1, 2, 4]] }), seen),
        kept,
      ),
      signal,
    );
    expect(grouped).toEqual(
      new Map([
        ["hale's gun", "the old revolver"],
        ["la pistola", "the old revolver"],
      ]),
    );
    expect(usage.steps).toBe(1);
    // Each name as the notes first spelt it, numbered; nothing else.
    expect(seen[0].messages[0]?.content).toBe(
      '1. "Hale\'s gun" (thing)\n2. "la  pistola" (thing)\n3. "the back door" (thing)\n4. "The old revolver" (thing)',
    );
    expect(seen[0].output?.name).toBe("group_names");
    // Kept as the question was put, each line as the model saw it, kind and
    // all, and which model, not as a list of keys: the answer to "is this
    // tower a thing" is not the answer to "is this tower a place", though
    // the keys are the same.
    expect(kept.file).toEqual({
      recipeRevision: ENTITY_RECIPE_REVISION,
      names: {
        asked: [
          '"Hale\'s gun" (thing)',
          '"la  pistola" (thing)',
          '"the back door" (thing)',
          '"The old revolver" (thing)',
        ],
        model: "ollama/m",
        groups: [["hale's gun", "la pistola", "the old revolver"]],
      },
      labels: { asked: [], model: "", groups: [] },
      values: { asked: [], model: "", groups: [] },
    });

    // The same names: the kept groups, nothing asked.
    const again = await groupEntities(
      BOOK,
      deps(
        model(() => ({ groups: [] }), seen),
        kept,
      ),
      signal,
    );
    expect(seen).toHaveLength(1);
    expect(again.grouped).toEqual(grouped);

    // A new name: asked again. Another question's groups: asked again.
    await groupEntities(
      [...BOOK, ledger("the front door")],
      deps(
        model(() => ({ groups: [] }), seen),
        kept,
      ),
      signal,
    );
    expect(seen).toHaveLength(2);
    kept.file = { ...(kept.file as EntityGroups), recipeRevision: "0" };
    await groupEntities(
      [...BOOK, ledger("the front door")],
      deps(
        model(() => ({ groups: [] }), seen),
        kept,
      ),
      signal,
    );
    expect(seen).toHaveLength(3);
  });

  it("never lists a person or an animal: only places and things are grouped", async () => {
    const seen: ModelRequest[] = [];
    const people = ledger("Leo", "Leo Bellini", "Poppo");
    people.claims = people.claims.map((claim, at) => ({
      ...claim,
      kind: at === 2 ? "animal" : "person",
    }));
    const { grouped } = await groupEntities(
      [people, ledger("the gate", "the school gate")],
      deps(model(() => ({ groups: [[1, 2]] }), seen)),
      signal,
    );
    expect(seen[0].messages[0]?.content).toBe(
      '1. "the gate" (thing)\n2. "the school gate" (thing)',
    );
    expect(grouped.has("leo")).toBe(false);
  });

  it("asks nothing of fewer than two names", async () => {
    const seen: ModelRequest[] = [];
    const { grouped } = await groupEntities(
      [ledger("Marta", "marta")],
      deps(model(() => ({ groups: [] }), seen)),
      signal,
    );
    expect(grouped.size).toBe(0);
    expect(seen).toHaveLength(0);
  });

  it("groups nothing, and keeps nothing, when the answer has no shape; never fails on the file", async () => {
    const kept = new Kept();
    const shapeless = await groupEntities(
      BOOK,
      deps(
        model(() => "not groups"),
        kept,
      ),
      signal,
    );
    expect(shapeless.grouped.size).toBe(0);
    expect(kept.file).toBeNull();
    const broken = await groupEntities(
      BOOK,
      {
        ...deps(model(() => ({ groups: [[1, 2]] }))),
        artifacts: {
          readEntities: async () => {
            throw new Error("unreadable");
          },
          writeEntities: async () => {
            throw new Error("full");
          },
        },
      },
      signal,
    );
    expect(broken.grouped.size).toBe(1);
  });

  it("groups a fact's wordings of one value, within one kind of fact, and keeps them beside the names", async () => {
    const seen: ModelRequest[] = [];
    const kept = new Kept();
    const said = (
      attribute: string,
      norm: string,
      type: Claim["type"] = "words",
    ): Claim => ({
      ...claim("Marta"),
      kind: "person",
      status: "stated",
      attribute,
      type,
      norm,
    });
    const book: SectionLedger = {
      ...ledger(),
      claims: [
        said("job", "baker"),
        said("job", "baker"),
        said("job", "works in a bakery"),
        said("occupation", "fornaio"),
        // A colour word is listed beside a worded value of its fact.
        said("hair colour", "dark"),
        said("hair colour", "brown", "colour"),
        said("scar", "left cheek"),
        // One value only: nothing to group it with.
        said("home", "rome"),
        // A fact only in fixed spellings, and a name, are never asked about.
        said("age", "34 years", "number"),
        said("age", "35 years", "number"),
        said("nickname", "marta", "name"),
        said("nickname", "martina", "name"),
      ],
    };
    // "occupation" was grouped under "job".
    const labels = new Map([["occupation", "job"]]);
    const { grouped } = await groupValues(
      [book],
      labels,
      deps(
        // A group across two kinds of fact is split, and each half left
        // alone is no group.
        model(
          () => ({
            groups: [
              [1, 4],
              [3, 5],
            ],
          }),
          seen,
        ),
        kept,
      ),
      signal,
    );
    expect(seen[0].messages[0]?.content).toBe(
      [
        '1. hair colour: "brown"',
        '2. hair colour: "dark"',
        '3. job: "baker"',
        '4. job: "fornaio"',
        '5. job: "works in a bakery"',
      ].join("\n"),
    );
    expect(grouped).toEqual(new Map([["job|works in a bakery", "baker"]]));
    expect(kept.file).toMatchObject({
      names: { asked: [], groups: [] },
      values: {
        asked: [
          '1. hair colour: "brown"',
          '2. hair colour: "dark"',
          '3. job: "baker"',
          '4. job: "fornaio"',
          '5. job: "works in a bakery"',
        ].map((line) => line.slice(3)),
        model: "ollama/m",
        groups: [["job|baker", "job|works in a bakery"]],
      },
    });
    // Asked again with the same values: the kept groups, nothing asked;
    // and the names asked after keep the values beside them.
    await groupValues(
      [book],
      labels,
      deps(
        model(() => ({ groups: [] }), seen),
        kept,
      ),
      signal,
    );
    expect(seen).toHaveLength(1);
    await groupEntities(
      BOOK,
      deps(
        model(() => ({ groups: [] }), seen),
        kept,
      ),
      signal,
    );
    expect(kept.file?.values.groups).toEqual([
      ["job|baker", "job|works in a bakery"],
    ]);
  });

  it("groups the labels of one kind of fact, each shown with how its values are spelt", async () => {
    const seen: ModelRequest[] = [];
    const kept = new Kept();
    const said = (attribute: string, type: Claim["type"]): Claim => ({
      ...claim("Marta"),
      attribute,
      type,
    });
    const book: SectionLedger = {
      ...ledger(),
      claims: [
        said("hair colour", "colour"),
        said("hair colour", "colour"),
        said("colour of her hair", "colour"),
        said("hair colour", "words"),
        said("hair style", "words"),
        // A name is compared by its spelling, never by its label.
        said("nickname", "name"),
      ],
    };
    const { grouped } = await groupLabels(
      [book],
      deps(
        model(() => ({ groups: [[1, 2]] }), seen),
        kept,
      ),
      signal,
    );
    expect(seen[0].messages[0]?.content).toBe(
      [
        '1. "colour of her hair" (colour)',
        '2. "hair colour" (colour, words)',
        '3. "hair style" (words)',
      ].join("\n"),
    );
    // The most noted label stands in for its group.
    expect(grouped).toEqual(new Map([["colour of her hair", "hair colour"]]));
    expect(kept.file?.labels.groups).toEqual([
      ["colour of her hair", "hair colour"],
    ]);
  });

  it("stops when asked", async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(
      groupEntities(BOOK, deps(model(() => ({ groups: [] }))), stop.signal),
    ).rejects.toMatchObject({ failure: { code: "cancelled" } });
  });
});

// ── What the grouping may not do ─────────────────────────────────────────────

describe("what the grouping may not do", () => {
  // ── Reuse under the current question ───────────────────────────────────────
  //
  // The kept file is keyed on the question as asked, not on the sorted keys
  // alone. A name reclassified from thing to place, or a label whose values
  // turn from words to numbers, keeps the same keys, and reusing its group
  // would join what a fresh answer splits.
  describe("reuse obeys the current question", () => {
    const colour = (entity: string, kind: Claim["kind"]): Claim => ({
      ...claim(entity),
      kind,
    });
    const typed = (attribute: string, type: Claim["type"], norm: string) => ({
      ...claim("Marta"),
      kind: "person" as const,
      attribute,
      type,
      norm,
      value: norm,
    });

    it("asks again when a name's kind changes, and never joins a place to a thing from the kept file", async () => {
      const seen: ModelRequest[] = [];
      const kept = new Kept();
      const things: SectionLedger = {
        ...ledger(),
        claims: [colour("Tower", "thing"), colour("Bell", "thing")],
      };
      const first = await groupEntities(
        [things],
        deps(
          model(() => ({ groups: [[1, 2]] }), seen),
          kept,
        ),
        signal,
      );
      expect(first.grouped.size).toBe(1);
      // The same names, one now a place: a different question, asked
      // again; and the fresh answer's group is split by kind.
      const moved: SectionLedger = {
        ...ledger(),
        claims: [colour("Tower", "place"), colour("Bell", "thing")],
      };
      const again = await groupEntities(
        [moved],
        deps(
          model(() => ({ groups: [[1, 2]] }), seen),
          kept,
        ),
        signal,
      );
      expect(seen).toHaveLength(2);
      expect(again.grouped.size).toBe(0);
      // A kept file whose groups break the rule — hand-edited, or written
      // by an older question — is read under the same guard as a fresh
      // answer: the guard is a check, not a courtesy to the model.
      kept.file = {
        ...(kept.file as EntityGroups),
        names: {
          ...(kept.file as EntityGroups).names,
          groups: [["tower", "bell"]],
        },
      };
      const tampered = await groupEntities(
        [moved],
        deps(
          model(() => ({ groups: [[1, 2]] }), seen),
          kept,
        ),
        signal,
      );
      expect(seen).toHaveLength(2);
      expect(tampered.grouped.size).toBe(0);
    });

    it("asks again when a label's value types change, and never joins a measured label to a worded one from the kept file", async () => {
      const seen: ModelRequest[] = [];
      const kept = new Kept();
      const worded: SectionLedger = {
        ...ledger(),
        claims: [
          typed("age", "words", "old"),
          typed("eye colour", "colour", "blue"),
        ],
      };
      const first = await groupLabels(
        [worded],
        deps(
          model(() => ({ groups: [[1, 2]] }), seen),
          kept,
        ),
        signal,
      );
      expect(first.grouped.size).toBe(1);
      const measured: SectionLedger = {
        ...ledger(),
        claims: [
          typed("age", "number", "61 years"),
          typed("eye colour", "colour", "blue"),
        ],
      };
      const again = await groupLabels(
        [measured],
        deps(
          model(() => ({ groups: [[1, 2]] }), seen),
          kept,
        ),
        signal,
      );
      expect(seen).toHaveLength(2);
      expect(again.grouped.size).toBe(0);
    });

    it("asks again for another model, and reuses for the same", async () => {
      const seen: ModelRequest[] = [];
      const kept = new Kept();
      await groupEntities(
        BOOK,
        deps(
          model(() => ({ groups: [[1, 2, 4]] }), seen),
          kept,
        ),
        signal,
      );
      await groupEntities(
        BOOK,
        deps(
          model(() => ({ groups: [[1, 2, 4]] }), seen),
          kept,
        ),
        signal,
      );
      expect(seen).toHaveLength(1);
      await groupEntities(
        BOOK,
        {
          ...deps(
            model(() => ({ groups: [[1, 2, 4]] }), seen),
            kept,
          ),
          modelRef: { providerId: "ollama", modelId: "other" },
        },
        signal,
      );
      expect(seen).toHaveLength(2);
    });
  });

  it("never groups a place with a thing, whatever the answer says", async () => {
    const church: SectionLedger = {
      ...ledger("the bell"),
      claims: [
        { ...claim("the bell"), kind: "thing" },
        { ...claim("the church"), kind: "place" },
        { ...claim("the chapel"), kind: "place" },
      ],
    };
    // Sorted: 1 "the bell" (thing), 2 "the chapel" (place), 3 "the church"
    // (place). The answer groups all three; only the two places survive.
    const { grouped } = await groupEntities(
      [church],
      deps(model(() => ({ groups: [[1, 2, 3]] }))),
      signal,
    );
    expect(grouped).toEqual(new Map([["the church", "the chapel"]]));
    // A group of one place and one thing groups nothing at all.
    const { grouped: none } = await groupEntities(
      [{ ...church, claims: church.claims.slice(0, 2) }],
      deps(model(() => ({ groups: [[1, 2]] }))),
      signal,
    );
    expect(none).toEqual(new Map());
  });

  it("never groups a measured label with a worded one, whatever the answer says", async () => {
    const said = (attribute: string, type: Claim["type"]): Claim => ({
      ...claim("Marta"),
      kind: "person",
      attribute,
      type,
    });
    const book: SectionLedger = {
      ...ledger(),
      claims: [
        said("age", "number"),
        said("age", "number"),
        said("years", "number"),
        said("eye colour", "colour"),
        said("eye colour", "colour"),
        said("eyes", "colour"),
      ],
    };
    // Sorted: 1 "age" (number), 2 "eye colour" (colour), 3 "eyes"
    // (colour), 4 "years" (number). The answer makes one fact of all four;
    // a fact measured in numbers is never one with a fact told in words
    // or colours, so two groups survive, one of each.
    const { grouped } = await groupLabels(
      [book],
      deps(model(() => ({ groups: [[1, 2, 3, 4]] }))),
      signal,
    );
    expect(grouped).toEqual(
      new Map([
        ["years", "age"],
        ["eyes", "eye colour"],
      ]),
    );
  });

  it("never makes two different amounts one value, whatever the answer says", async () => {
    const height = (norm: string, type: Claim["type"]): Claim => ({
      ...claim("the tower"),
      attribute: "height",
      type,
      norm,
      value: norm,
    });
    // Sorted: 1 "10 metres", 2 "12 metres", 3 "twelve metres". The answer
    // makes them one value; ten metres and twelve are two amounts, and the
    // worded value can be either, so nothing is grouped.
    const apart = await groupValues(
      [
        {
          ...ledger(),
          claims: [
            height("10 metres", "number"),
            height("12 metres", "number"),
            height("twelve metres", "words"),
          ],
        },
      ],
      new Map(),
      deps(model(() => ({ groups: [[1, 2, 3]] }))),
      signal,
    );
    expect(apart.grouped).toEqual(new Map());
    // One amount, spelt three ways: the group stands, under the most noted.
    const together = await groupValues(
      [
        {
          ...ledger(),
          claims: [
            height("10 metres", "number"),
            height("10 metres", "number"),
            height("10 m", "number"),
            height("ten metres", "words"),
          ],
        },
      ],
      new Map(),
      deps(model(() => ({ groups: [[1, 2, 3]] }))),
      signal,
    );
    expect(together.grouped).toEqual(
      new Map([
        ["height|10 m", "10 metres"],
        ["height|ten metres", "10 metres"],
      ]),
    );
  });
});
