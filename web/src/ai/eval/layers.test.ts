// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { fold } from "../domain/textMatch";
import {
  factsCovered,
  gradeOf,
  LAYER_TASKS,
  referralsIn,
  summarize,
  type LayerRow,
} from "./layers";

// The prompt layers' matched tasks. `scripts/layers-eval.mjs` asks
// them of the real assistant with and without the persona layers. This file
// keeps the tasks answerable, every fact a clean-book task requires being in
// the book, and pins the scoring.

const BOOKS = import.meta.glob("./corpus/**/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const bookText = (language: string) =>
  fold(
    Object.entries(BOOKS)
      .filter(([path]) => path.includes(`/corpus/${language}/`))
      .map(([, text]) => text)
      .join("\n"),
  );

describe("the layer tasks", () => {
  for (const language of ["en", "it"] as const) {
    const tasks = LAYER_TASKS[language];

    it(`asks the same six things in ${language}, one of them across departments`, () => {
      expect(tasks.map((one) => one.id)).toEqual([
        "lookup",
        "continuity",
        "line",
        "structure",
        "character",
        "mixed",
      ]);
      expect(tasks.filter((one) => one.book === "planted")).toHaveLength(1);
      expect(tasks.find((one) => one.id === "continuity")?.facts).toEqual([]);
    });

    it(`requires only facts the clean book states (${language})`, () => {
      const text = bookText(language);
      for (const task of tasks.filter((one) => one.book === "clean"))
        for (const group of task.facts)
          expect(group.some((word) => text.includes(fold(word)))).toBe(true);
    });
  }
});

describe("scoring an answer", () => {
  it("counts the fact groups an answer meets, any word of a group meeting it", () => {
    expect(
      factsCovered("She wore a RED JACKET; she was 61.", [
        ["red jacket"],
        ["hat"],
        ["sixty-one", "61"],
      ]),
    ).toBeCloseTo(2 / 3);
    expect(factsCovered("anything", [])).toBe(1);
  });

  it("names the colleagues an answer refers to, never the one answering", () => {
    expect(
      referralsIn(
        "Structure is Spark's department; Nova, not Novak, does lines.",
        "Nova",
        ["Phos", "Nova", "Spark", "Lumi"],
      ),
    ).toEqual(["Spark"]);
  });

  it("reads a grade of the right shape, and nothing else", () => {
    expect(
      gradeOf(
        JSON.stringify({
          done: "part",
          handedOff: true,
          relevant: "yes",
          why: "It did one of two things.",
        }),
      ),
    ).toEqual({
      done: "part",
      handedOff: true,
      relevant: "yes",
      why: "It did one of two things.",
    });
    expect(
      gradeOf(
        JSON.stringify({ done: "all", handedOff: false, relevant: "yes" }),
      ),
    ).toMatchObject({ why: "" });
    expect(gradeOf("not json")).toBeNull();
    expect(gradeOf("null")).toBeNull();
    expect(
      gradeOf(
        JSON.stringify({ done: "most", handedOff: false, relevant: "yes" }),
      ),
    ).toBeNull();
    expect(
      gradeOf(
        JSON.stringify({ done: "all", handedOff: "no", relevant: "yes" }),
      ),
    ).toBeNull();
    expect(
      gradeOf(
        JSON.stringify({ done: "all", handedOff: false, relevant: "hmm" }),
      ),
    ).toBeNull();
  });

  it("summarises each arm: done and relevant as means, hand-offs and referrals as counts", () => {
    const row = (
      arm: LayerRow["arm"],
      done: "all" | "part" | "none" | null,
      referrals = 0,
    ): LayerRow => ({
      arm,
      task: "t",
      persona: "p",
      room: "general",
      facts: done === "all" ? 1 : 0.5,
      referrals,
      grade: done
        ? { done, handedOff: done === "none", relevant: "yes", why: "" }
        : null,
    });
    expect(
      summarize([
        row("layers", "all", 1),
        row("layers", "part"),
        row("layers", null),
        row("bare", "none"),
      ]),
    ).toEqual([
      {
        arm: "layers",
        answers: 3,
        done: 0.75,
        handedOff: 0,
        relevant: 1,
        facts: 0.667,
        referring: 1,
        ungraded: 1,
      },
      {
        arm: "bare",
        answers: 1,
        done: 0,
        handedOff: 1,
        relevant: 1,
        facts: 0.5,
        referring: 0,
        ungraded: 0,
      },
    ]);
    expect(summarize([], ["bare"])).toEqual([
      {
        arm: "bare",
        answers: 0,
        done: 0,
        handedOff: 0,
        relevant: 0,
        facts: 0,
        referring: 0,
        ungraded: 0,
      },
    ]);
  });
});
