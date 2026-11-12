// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  DETECTORS,
  PER_DETECTOR,
  TOTAL_CANDIDATES,
  detectSignals,
  type DetectorId,
} from "./detect";
import { ENGLISH, ITALIAN, lexiconFor } from "./lexicons";

const only = (text: string, id: DetectorId, lexicon = ENGLISH) =>
  detectSignals(text, lexicon, [id]).candidates.map((one) => one.quote);

describe("the signal pre-pass", () => {
  it("picks a lexicon by the project's language code, or none", () => {
    expect(lexiconFor("it")).toBe(ITALIAN);
    expect(lexiconFor("en-GB")).toBe(ENGLISH);
    expect(lexiconFor("fr")).toBeNull();
    expect(lexiconFor(undefined)).toBeNull();
  });

  it("finds filter verbs after a subject, in narration only", () => {
    const text =
      'She saw the lights go out. The saw lay on the bench.\n\n"I saw nothing," he said.';
    expect(only(text, "perception-verbs")).toEqual([
      "She saw the lights go out.",
    ]);
    // Italian drops the subject, so the forms stand alone.
    expect(
      only("Vide la luce spegnersi.", "perception-verbs", ITALIAN),
    ).toEqual(["Vide la luce spegnersi."]);
  });

  it("finds hedges, attempts and manner adverbs outside speech", () => {
    expect(only("It was almost dark. Nothing else.", "hedges")).toEqual([
      "It was almost dark.",
    ]);
    expect(only("He tried to open it.", "attempt-verbs")).toEqual([
      "He tried to open it.",
    ]);
    expect(
      only("She walked slowly home. It was only late.", "manner-adverbs"),
    ).toEqual(["She walked slowly home."]);
    expect(
      only("Camminò lentamente. La mente vagava.", "manner-adverbs", ITALIAN),
    ).toEqual(["Camminò lentamente."]);
    expect(only('"Quickly," she said.', "manner-adverbs")).toEqual([]);
  });

  it("finds loud dialogue tags only where there is speech", () => {
    expect(
      only('"Go," he hissed.\n\nThe snake hissed.', "dialogue-tags"),
    ).toEqual(['"Go," he hissed.']);
    expect(only("— Vai, — sibilò.", "dialogue-tags", ITALIAN)).toEqual([
      "— Vai, — sibilò.",
    ]);
  });

  it("finds numbers and units in narration", () => {
    expect(
      only("The wall was 12 metres high.", "numbers-in-narration"),
    ).toEqual(["The wall was 12 metres high."]);
    expect(only('"I have 3," she said.', "numbers-in-narration")).toEqual([]);
  });

  it("finds long runs of bare dialogue", () => {
    const lines = Array.from({ length: 9 }, (_, i) => `"Line ${i}."`);
    expect(only(lines.join("\n\n"), "dialogue-runs")).toEqual(['"Line 0."']);
    const broken = [
      ...lines.slice(0, 4),
      "He crossed the room slowly and sat.",
      ...lines.slice(4),
    ];
    expect(only(broken.join("\n\n"), "dialogue-runs")).toEqual([]);
  });

  it("finds the minority dialogue mark when a book mixes them", () => {
    const text = ["«Uno.»", "«Due.»", "— Tre.", "«Quattro.»"].join("\n\n");
    expect(only(text, "dialogue-marks", ITALIAN)).toEqual(["— Tre."]);
    expect(only("«Uno.»\n\n«Due.»", "dialogue-marks", ITALIAN)).toEqual([]);
  });

  it("finds monotone rhythm and echoes, but not names", () => {
    const same = Array.from(
      { length: 5 },
      (_, i) => `The long road ran on for miles today ${i}.`,
    ).join(" ");
    expect(only(same, "sentence-rhythm")).toHaveLength(1);
    expect(
      only("She crossed the garden. The garden was cold.", "word-echo"),
    ).toEqual(["The garden was cold."]);
    expect(only("Marion left. Marion returned.", "word-echo")).toEqual([]);
    expect(only("Because I said so, because.", "word-echo")).toEqual([]);
  });

  it("skips headings, and cuts a long sentence to a window that is still exact", () => {
    const long = `She saw ${"very ".repeat(80)}far.`;
    const [quote] = only(`# Title\n\n${long}`, "perception-verbs");
    expect(quote.length).toBeLessThanOrEqual(220);
    expect(long.includes(quote)).toBe(true);
  });

  it("caps per detector and overall, densest paragraphs first", () => {
    const busy = Array.from({ length: 10 }, () => "It was almost dark.").join(
      " ",
    );
    const one = "Later it was almost over.";
    const report = detectSignals(`${one}\n\n${busy}`, ENGLISH, ["hedges"]);
    expect(report.found.get("hedges")).toBe(11);
    // Each quote once: the ten identical sentences are one candidate.
    expect(report.candidates.map((c) => c.quote)).toEqual([
      "It was almost dark.",
      one,
    ]);

    const many = Array.from(
      { length: 40 },
      (_, i) =>
        `He tried to go ${i}. It was almost ${i}. She walked slowly ${i}. He hissed ${i}.`,
    ).join("\n\n");
    const all = detectSignals(many, ENGLISH, [...DETECTORS]);
    expect(all.candidates.length).toBeLessThanOrEqual(TOTAL_CANDIDATES);
    for (const id of DETECTORS)
      expect(
        all.candidates.filter((c) => c.detector === id).length,
      ).toBeLessThanOrEqual(PER_DETECTOR);
    for (const candidate of all.candidates)
      expect(many.includes(candidate.quote)).toBe(true);
  });
});
