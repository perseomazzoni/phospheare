// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  JUDGE_RECIPE_REVISION,
  JUDGEMENTS_KEPT,
  judgementId,
  judgementOf,
  judgementsOf,
  keepJudgements,
  type KeptJudgement,
  digestOf,
} from "./judgement";

const answer = (overrides: Record<string, unknown> = {}) => ({
  verdict: "conflict",
  severity: "major",
  title: " Marta's  eyes ",
  explanation: "Grey, then green.",
  doubt: "",
  ...overrides,
});

const kept = (title: string): KeptJudgement => ({
  ...(judgementOf(answer({ title })) as KeptJudgement),
  model: "ollama/m",
});

describe("judgementOf", () => {
  it("reads a judgement in shape, and nothing else", () => {
    expect(judgementOf(answer())).toEqual({
      verdict: "conflict",
      severity: "major",
      title: "Marta's eyes",
      explanation: "Grey, then green.",
      doubt: "",
    });
    expect(judgementOf(answer({ severity: "fatal" }))?.severity).toBe("minor");
    for (const bad of [
      null,
      "conflict",
      answer({ verdict: "maybe" }),
      answer({ title: " " }),
      answer({ explanation: 3 }),
    ])
      expect(judgementOf(bad)).toBeNull();
  });
});

describe("judgementId", () => {
  it("names the candidate, each text's revision and the question, so any changing asks again", () => {
    const sides = [
      { sourceId: "node:A", revision: "r1" },
      { sourceId: "reference:characters--Marta Neri.md", revision: "r2" },
    ];
    const id = judgementId(
      "marta|eyes||green|grey",
      sides,
      "THE FACT: eyes",
      "ollama/m English",
    );
    expect(id).toBe(
      `marta%7Ceyes%7C%7Cgreen%7Cgrey node%3AA%40r1 reference%3Acharacters--Marta%20Neri.md%40r2 q%3A${digestOf("THE FACT: eyes")} by%3Aollama%2Fm%20English`,
    );
    expect(
      judgementId(
        "marta|eyes||green|grey",
        [
          { sourceId: "node:A", revision: "r3" },
          { sourceId: "reference:characters--Marta Neri.md", revision: "r2" },
        ],
        "THE FACT: eyes",
        "ollama/m English",
      ),
    ).not.toBe(id);
    // The same texts with a different question (a date stated elsewhere, a
    // sheet note added) is another judgement.
    expect(
      judgementId(
        "marta|eyes||green|grey",
        sides,
        "THE FACT: eyes, dated",
        "ollama/m English",
      ),
    ).not.toBe(id);
    // Another judge, another model or the same one answering in another
    // language, is another judgement.
    expect(
      judgementId(
        "marta|eyes||green|grey",
        sides,
        "THE FACT: eyes",
        "ollama/other English",
      ),
    ).not.toBe(id);
    expect(
      judgementId(
        "marta|eyes||green|grey",
        sides,
        "THE FACT: eyes",
        "ollama/m Italian",
      ),
    ).not.toBe(id);
    // And the same question again is the same id: unchanged inputs reuse.
    expect(
      judgementId(
        "marta|eyes||green|grey",
        sides,
        "THE FACT: eyes",
        "ollama/m English",
      ),
    ).toBe(id);
  });

  it("digests a string stably and tells near strings apart", () => {
    expect(digestOf("")).toBe("811c9dc5");
    expect(digestOf("abc")).toBe(digestOf("abc"));
    expect(digestOf("abc")).not.toBe(digestOf("abd"));
    expect(digestOf("x".repeat(10_000))).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("judgementsOf", () => {
  it("reads the kept file, leaving out an entry not in shape", () => {
    expect(
      judgementsOf({
        recipeRevision: "1",
        judgements: {
          a: kept("A"),
          b: { ...kept("B"), model: 3 },
          c: { ...kept("C"), verdict: "maybe" },
          d: null,
        },
      }),
    ).toEqual({ recipeRevision: "1", judgements: { a: kept("A") } });
    for (const bad of [
      null,
      [],
      { judgements: {} },
      { recipeRevision: "1" },
      { recipeRevision: "1", judgements: "x" },
    ])
      expect(judgementsOf(bad)).toBeNull();
  });
});

describe("keepJudgements", () => {
  it("adds the fresh ones as the newest, drops another judge's, and keeps the newest few", () => {
    const first = keepJudgements(null, { a: kept("A"), b: kept("B") });
    expect(first.recipeRevision).toBe(JUDGE_RECIPE_REVISION);
    // Asked again: moved to the end, so what is in use stays.
    const second = keepJudgements(first, { a: kept("A2") });
    expect(Object.keys(second.judgements)).toEqual(["b", "a"]);
    expect(second.judgements.a.title).toBe("A2");
    expect(
      keepJudgements({ ...second, recipeRevision: "0" }, { c: kept("C") })
        .judgements,
    ).toEqual({ c: kept("C") });
    const many = Object.fromEntries(
      Array.from({ length: JUDGEMENTS_KEPT + 3 }, (_, i) => [
        `k${i}`,
        kept(`T${i}`),
      ]),
    );
    const trimmed = Object.keys(keepJudgements(null, many).judgements);
    expect(trimmed).toHaveLength(JUDGEMENTS_KEPT);
    expect(trimmed[0]).toBe("k3");
  });
});
