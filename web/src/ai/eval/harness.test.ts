// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  PLANT_KINDS,
  numberWord,
  plantErrors,
  seededRandom,
  slipOf,
  type EvalSource,
  type Plant,
  type PlantKind,
} from "./plant";
import { recallByKind, scoreFindings } from "./score";

// The seeded-defect harness's gate. Two invented books (`corpus/it`,
// `corpus/en`: a lighthouse, a mountain hut, nothing like any writer's
// manuscript) are planted at random over many seeds. The same code runs over
// a real project on disk through `scripts/plant-eval.mjs`. This file pins
// that the planter plants what it says it does, and that a finding is scored
// the way the live runs score it. The model's ledgers are measured live, on a
// seeded copy, not here.

const FILES = import.meta.glob("./corpus/**/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

function book(language: "it" | "en"): EvalSource[] {
  return Object.entries(FILES)
    .filter(([path]) => path.includes(`/corpus/${language}/`))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, text]) => {
      const name = path.split("/").pop() ?? path;
      const sheet = name.startsWith("character--");
      return {
        id: sheet ? `reference:${name}` : `node:${name}`,
        title: name.replace(/^[a-z]+--/, "").replace(/\.md$/, ""),
        text,
        ...(sheet ? { group: "characters" } : {}),
      };
    });
}

/** How many seeds a planter row tries. */
const SEEDS = 30;

describe("the planter", () => {
  it("plants every kind the book gives it, the same way for the same seed", () => {
    for (const language of ["it", "en"] as const) {
      const first = plantErrors(book(language), language, { seed: 7 });
      const again = plantErrors(book(language), language, { seed: 7 });
      expect(again.plants).toEqual(first.plants);
      expect(new Set(first.plants.map((plant) => plant.kind))).toEqual(
        new Set(PLANT_KINDS),
      );
      const other = plantErrors(book(language), language, { seed: 8 });
      expect(other.plants).not.toEqual(first.plants);
    }
  });

  it("puts each plant where its key says, and changes nothing else", () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const original = book("it");
      const planted = plantErrors(original, "it", { seed, perKind: 2 });
      for (const plant of planted.plants) {
        const text = planted.sources.find(
          (one) => one.id === plant.sourceId,
        )?.text;
        expect(
          text?.slice(plant.offset, plant.offset + plant.after.length),
        ).toBe(plant.after);
        expect(plant.after).not.toBe(plant.before);
      }
      // Every change is a plant: the texts differ by the key and nothing else.
      for (const source of planted.sources) {
        const mine = planted.plants
          .filter((plant) => plant.sourceId === source.id)
          .sort((a, b) => b.offset - a.offset);
        let restored = source.text;
        for (const plant of mine)
          restored =
            restored.slice(0, plant.offset) +
            plant.before +
            restored.slice(plant.offset + plant.after.length);
        expect(restored).toBe(
          original.find((one) => one.id === source.id)?.text,
        );
      }
    }
  });

  it("never plants in a template's hint", () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const planted = plantErrors(book("it"), "it", { seed, kinds: ["sheet"] });
      for (const plant of planted.plants) {
        const text =
          planted.sources.find((one) => one.id === plant.sourceId)?.text ?? "";
        expect(
          text.lastIndexOf("<!--", plant.offset) >
            text.lastIndexOf("-->", plant.offset),
        ).toBe(false);
      }
    }
  });

  it("slips a name inside the word, never at its ends", () => {
    const random = seededRandom(3);
    for (let run = 0; run < 200; run += 1) {
      const slip = slipOf("Ottavia", random);
      expect(slip).not.toBe("Ottavia");
      expect(slip[0]).toBe("O");
      expect(slip.slice(-1)).toBe("a");
    }
  });

  it("writes numbers the way each language does", () => {
    expect(numberWord(21, "it")).toBe("ventuno");
    expect(numberWord(38, "it")).toBe("trentotto");
    expect(numberWord(52, "it")).toBe("cinquantadue");
    expect(numberWord(120, "it")).toBe("centoventi");
    expect(numberWord(300, "it")).toBe("trecento");
    expect(numberWord(61, "en")).toBe("sixty-one");
    expect(numberWord(40, "en")).toBe("forty");
    expect(numberWord(13, "en-GB")).toBe("thirteen");
    expect(numberWord(120, "en")).toBeNull();
    expect(numberWord(0, "it")).toBeNull();
    expect(numberWord(5, "de")).toBeNull();
  });

  it("plants a changed fact only where the book states it somewhere else too", () => {
    const plantsIn = (texts: string[]) =>
      new Set(
        Array.from({ length: 20 }, (_, seed) =>
          plantErrors(
            texts.map((text, at) => ({ id: `s${at}`, title: `S${at}`, text })),
            "it",
            { seed: seed + 1, kinds: ["number", "colour", "weekday"] },
          ).plants.map((plant) => `${plant.kind}:${plant.before}`),
        ).flat(),
      );
    // Said once each: a different number, colour or day is just different.
    expect(
      plantsIn([
        "Aveva un cappotto verde. Camminò per tre chilometri.",
        "Arrivò lunedì 4 marzo, con il vento.",
      ]),
    ).toEqual(new Set());
    // Said twice, or pinned by a year the book gives: a change is a slip.
    expect(
      plantsIn([
        "Aveva un cappotto verde. Camminò per tre chilometri. Era il 2 marzo 2020.",
        "Il cappotto verde era bagnato. Dopo tre chilometri si fermò. Arrivò lunedì 4 marzo.",
      ]),
    ).toEqual(new Set(["number:tre", "colour:verde", "weekday:lunedì"]));
  });

  it("takes a colour's witness from the thing it colours, not from any word near it", () => {
    const plantsIn = (texts: string[]) =>
      Array.from(
        { length: 10 },
        (_, seed) =>
          plantErrors(
            texts.map((text, at) => ({ id: `s${at}`, title: `S${at}`, text })),
            "en",
            { seed: seed + 1, kinds: ["colour"] },
          ).plants,
      ).flat();
    // "with a blue" on both sides does not make the sledge's runner a witness
    // of the notebook's cover: two things, one colour, no fact stated twice.
    expect(
      plantsIn([
        "She wrote everything down in a new notebook with a blue cover.",
        "He had drawn a sledge with a blue runner and a name beside it.",
      ]),
    ).toEqual([]);
    // The hat, said black twice, is a fact stated twice, and the witness is
    // the other hat, not the black ink that had gone brown.
    const hats = plantsIn([
      "Hollis was waiting in a red jacket and a black wool hat.",
      "Hollis took off her black hat. The black ink had gone brown.",
    ]);
    expect(hats.length).toBeGreaterThan(0);
    for (const plant of hats)
      for (const witness of plant.witnesses ?? []) {
        expect(witness.quote).toContain("hat");
        expect(witness.quote).not.toContain("ink");
      }
  });

  it("holds a sheet's fact to the prose, never to another sheet", () => {
    const sheet = (id: string, text: string): EvalSource => ({
      id,
      title: id,
      text,
      group: "characters",
    });
    const plants = (sources: EvalSource[]) =>
      Array.from(
        { length: 20 },
        (_, seed) =>
          plantErrors(sources, "it", { seed: seed + 1, kinds: ["sheet"] })
            .plants,
      ).flat();
    expect(
      plants([
        sheet("a", "- **Età:** 40 anni"),
        sheet("b", "- **Età:** 40 anni"),
        { id: "p", title: "P", text: "Nessuno sapeva quanti anni avesse." },
      ]),
    ).toEqual([]);
    expect(
      plants([
        sheet("a", "- **Età:** 40 anni"),
        { id: "p", title: "P", text: "Aveva quaranta anni, ormai." },
      ]).map((plant) => plant.sourceId),
    ).toContain("a");
  });

  it("plants nothing in a language it has no words for but names", () => {
    const planted = plantErrors(
      [
        {
          id: "a",
          title: "A",
          text: "Dann kam Friedrich. Wir sahen Friedrich, und Friedrich lachte. Später rief Friedrich an.",
        },
      ],
      "de",
      { seed: 1 },
    );
    expect(planted.plants.map((plant) => plant.kind)).toEqual(["name"]);
  });
});

describe("scoring a plant", () => {
  const plant: Plant = {
    kind: "colour",
    sourceId: "node:a",
    before: "verde",
    after: "rosso",
    offset: 10,
  };

  it("counts a finding only when it quotes the planted words from their source", () => {
    const found = (quote: string, sourceId = "node:a") =>
      scoreFindings([plant], [{ evidence: [{ sourceId, quote }] }])[0].found;
    expect(found("il cappotto Rosso")).toBe(true);
    expect(found("il cappotto verde")).toBe(false);
    expect(found("il cappotto rosso", "node:b")).toBe(false);
    // A project cites its own ids: the map is the caller's.
    expect(
      scoreFindings(
        [plant],
        [{ evidence: [{ sourceId: "node:EL4", quote: "rosso" }] }],
        () => "node:EL4",
      )[0].found,
    ).toBe(true);
  });

  it("tells touching a plant from witnessing it: the other place is the WITNESS the planter recorded, not any quote of the old word", () => {
    // The planter knows where else the book states the fact, the witness
    // sites a plant was chosen against, and records each one's sentence on
    // the plant. A finding has the slip when it quotes the plant and a
    // witness. A second quote that only contains the old word ("her scarf is
    // green", against a gate turned brown) is a different fact and no
    // diagnosis.
    const witnessed: Plant = {
      ...plant,
      witnesses: [
        { sourceId: "node:a", quote: "Il cappotto verde era bagnato." },
        {
          sourceId: "node:b",
          quote: "Il suo cappotto, verde come sempre, pendeva dal chiodo.",
        },
      ],
    };
    const scored = (
      evidence: Array<{ sourceId: string; quote: string }>,
      of: Plant = witnessed,
    ) => scoreFindings([of], [{ evidence }])[0];
    // One place only: contact, not a diagnosis.
    expect(
      scored([{ sourceId: "node:a", quote: "il cappotto rosso" }]),
    ).toMatchObject({
      found: true,
      witnessed: false,
      diagnosis: "contact-only",
    });
    // The plant beside its witness, elsewhere in its source…
    expect(
      scored([
        { sourceId: "node:a", quote: "il cappotto rosso" },
        { sourceId: "node:a", quote: "il cappotto verde" },
      ]),
    ).toMatchObject({ found: true, witnessed: true, diagnosis: "witness" });
    // …or in another source, quoted in part or whole.
    expect(
      scored([
        { sourceId: "node:a", quote: "il cappotto rosso" },
        { sourceId: "node:b", quote: "verde come sempre" },
      ]),
    ).toMatchObject({ witnessed: true, diagnosis: "witness" });
    // A second anchor on the plant itself is still one place.
    expect(
      scored([
        { sourceId: "node:a", quote: "il cappotto rosso" },
        { sourceId: "node:a", quote: "rosso" },
      ]),
    ).toMatchObject({ found: true, witnessed: false });
    // A second place that says nothing of the fact is no diagnosis…
    expect(
      scored([
        { sourceId: "node:a", quote: "il cappotto rosso" },
        { sourceId: "node:b", quote: "pioveva sul porto" },
      ]),
    ).toMatchObject({
      found: true,
      witnessed: false,
      diagnosis: "contact-only",
    });
    // …and nor is one that states another fact in the old colour: the
    // scarf's green is not the coat's.
    expect(
      scored([
        { sourceId: "node:a", quote: "il cappotto rosso" },
        { sourceId: "node:b", quote: "La sua sciarpa era verde." },
      ]),
    ).toMatchObject({
      found: true,
      witnessed: false,
      diagnosis: "contact-only",
    });
    // Contact in one finding and the witness in another is no diagnosis.
    expect(
      scoreFindings(
        [witnessed],
        [
          { evidence: [{ sourceId: "node:a", quote: "rosso" }] },
          { evidence: [{ sourceId: "node:b", quote: "verde come sempre" }] },
        ],
      )[0],
    ).toMatchObject({ found: true, witnessed: false });
    // A plant that records no witness can only ever be touched: the
    // scorer never guesses a diagnosis from the old word alone.
    expect(
      scored(
        [
          { sourceId: "node:a", quote: "il cappotto rosso" },
          { sourceId: "node:b", quote: "verde come sempre" },
        ],
        plant,
      ),
    ).toMatchObject({
      found: true,
      witnessed: false,
      diagnosis: "contact-only",
    });
    // Missed altogether.
    expect(
      scored([{ sourceId: "node:b", quote: "verde come sempre" }]),
    ).toMatchObject({ found: false, witnessed: false, diagnosis: "missed" });
  });

  it("lets a self-verifying plant stand on one citation, and reads the explanation apart from the evidence", () => {
    // A weekday the calendar pins needs no second place: the date itself
    // is the witness. The scorer says so, rather than asking for a quote
    // the book cannot give.
    const weekday: Plant = {
      kind: "weekday",
      sourceId: "node:a",
      before: "lunedì",
      after: "giovedì",
      offset: 0,
      selfVerifying: true,
    };
    expect(
      scoreFindings(
        [weekday],
        [{ evidence: [{ sourceId: "node:a", quote: "giovedì 4 marzo" }] }],
      )[0],
    ).toMatchObject({ found: true, diagnosis: "self-verifying" });
    // Whether the finding's own words name both sides is read apart from
    // its quotes: two findings with the same evidence, one explaining the
    // slip and one explaining something else, are told apart.
    const witnessed: Plant = {
      ...plant,
      witnesses: [{ sourceId: "node:b", quote: "verde come sempre" }],
    };
    const evidence = [
      { sourceId: "node:a", quote: "il cappotto rosso" },
      { sourceId: "node:b", quote: "verde come sempre" },
    ];
    expect(
      scoreFindings(
        [witnessed],
        [
          {
            evidence,
            title: "Il colore del cappotto",
            explanation: "Rosso in un capitolo, verde nell'altro.",
          },
        ],
      )[0],
    ).toMatchObject({ diagnosis: "witness", explained: true });
    expect(
      scoreFindings(
        [witnessed],
        [{ evidence, title: "Pioggia", explanation: "Il tempo cambia." }],
      )[0],
    ).toMatchObject({ diagnosis: "witness", explained: false });
  });

  it("records each plant's witnesses when it plants, and marks the pinned ones self-verifying", () => {
    const planted = plantErrors(
      [
        {
          id: "a",
          title: "A",
          text: "Aveva un cappotto verde. Camminò per tre chilometri. Era il 2 marzo 2020.",
        },
        {
          id: "b",
          title: "B",
          text: "Il cappotto verde era bagnato. Dopo tre chilometri si fermò. Arrivò lunedì 4 marzo.",
        },
      ],
      "it",
      { seed: 3, kinds: ["colour", "weekday"] },
    );
    const colour = planted.plants.find((one) => one.kind === "colour");
    const weekday = planted.plants.find((one) => one.kind === "weekday");
    // The coat's other statement, as a sentence of the other source, is the
    // colour plant's witness; the weekday is pinned by the year.
    expect(colour?.witnesses?.map((one) => one.sourceId)).toEqual([
      colour?.sourceId === "a" ? "b" : "a",
    ]);
    expect(colour?.witnesses?.[0]?.quote).toMatch(/cappotto verde/u);
    expect(weekday?.selfVerifying).toBe(true);
  });

  it("sums recall per kind, leaving out a kind nothing was planted of", () => {
    const kinds: readonly PlantKind[] = ["name", "colour"];
    expect(recallByKind([{ plant, hit: true }], kinds)).toEqual([
      { kind: "colour", planted: 1, hit: 1 },
    ]);
  });
});
