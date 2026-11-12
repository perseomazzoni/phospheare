// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { CATALOGUE } from "./referenceCatalogue";
import { parseReference } from "./referenceRecords";
import {
  keepRuleChecks,
  RULE_CHECK_RECIPE_REVISION,
  RULE_CHECKS_KEPT,
  RULE_PASSAGES,
  ruleAnswerOf,
  recordText,
  ruleChecksOf,
  RULE_PASSAGE_SIDE,
  RULE_PASSAGE_SPAN,
  rulePassages,
  rulesOf,
  type RuleDocument,
  type RuleSection,
} from "./rules";

// The writer's rules, and where the prose may meet them.

const document = (
  sourceId: string,
  page: string,
  text: string,
  title = sourceId,
): RuleDocument => ({
  sourceId,
  title,
  revision: "r1",
  text,
  parsed: parseReference(text, CATALOGUE.get(page) ?? null, title),
});

const SYSTEMS = document(
  "reference:world--systems.md",
  "world:systems",
  [
    "## Teleportation",
    "- **What it cannot do:** no one teleports across open water",
    "- **Known exceptions and uncertainties:** the temple gates carry a person across the strait",
    "## Weather craft",
    "- **Known exceptions and uncertainties:** storms answer no one",
  ].join("\n"),
);

const section = (sourceId: string, text: string): RuleSection => ({
  sourceId,
  title: sourceId,
  revision: "s1",
  text,
});

describe("rulesOf", () => {
  it("joins each rule with the exceptions of its own block, never another block's", () => {
    const [rule, ...rest] = rulesOf([SYSTEMS]);
    expect(rest).toEqual([]);
    expect(rule.entity).toBe("Teleportation");
    expect(recordText(rule.record)).toBe("no one teleports across open water");
    expect(rule.exceptions.map((one) => recordText(one.record))).toEqual([
      "the temple gates carry a person across the strait",
    ]);
  });

  it("lets a page's costs qualify its other rules, and be a rule itself", () => {
    const rules = rulesOf([
      document(
        "reference:world--rules.md",
        "world:rules",
        [
          "- **What is impossible:** raising the dead",
          "- **Costs and limitations:** every spell costs a year of life",
        ].join("\n"),
      ),
    ]);
    expect(
      rules.map((one) => [
        recordText(one.record),
        one.exceptions.map((other) => recordText(other.record)),
      ]),
    ).toEqual([
      ["raising the dead", ["every spell costs a year of life"]],
      ["every spell costs a year of life", []],
    ]);
  });

  it("joins an exception on another page only when it names the rule's entity", () => {
    const sheet = document(
      "reference:characters--marta.md",
      "character",
      "- **Abilities and limitations:** cannot swim",
      "Marta",
    );
    const style = document(
      "reference:guidebook--prose-style.md",
      "guidebook:prose-style",
      [
        "- **Deliberate departures from convention:** chapter nine breaks the rules on purpose",
        "- **Point of view and tense:** close third",
      ].join("\n"),
    );
    const naming = document(
      "reference:guidebook--prose-style-2.md",
      "guidebook:prose-style",
      "- **Deliberate departures from convention:** Marta swims once, in a dream",
    );
    const [rule] = rulesOf([sheet, style, naming]);
    expect(rule.entity).toBe("Marta");
    expect(rule.exceptions.map((one) => recordText(one.record))).toEqual([
      "Marta swims once, in a dream",
    ]);
  });
});

describe("rulePassages", () => {
  const [rule] = rulesOf([SYSTEMS]);

  it("finds the places where the rule's words meet, and says every one was examined", () => {
    const found = rulePassages(rule, [
      section(
        "node:A",
        "She teleports across the open water to the far shore.",
      ),
      section("node:B", "Bread, and the smell of rain."),
    ]);
    expect(found.coverage).toBe("checked");
    expect(found.passages.map((one) => one.sourceId)).toEqual(["node:A"]);
    expect(found.passages[0].text).toContain("teleports across the open");
  });

  it("says a rule no passage mentions was not checked, never kept", () => {
    expect(
      rulePassages(rule, [section("node:A", "Bread, and the smell of rain.")]),
    ).toEqual({ passages: [], coverage: "unmatched" });
  });

  it("examines the likeliest passages only, and says the rest were not", () => {
    const filler = " Nothing happens here at all.".repeat(40);
    const many = Array.from({ length: RULE_PASSAGES + 2 }, (_, at) =>
      section(
        `node:${at}`,
        `${filler} Someone teleports over water again.${filler}`,
      ),
    );
    const found = rulePassages(rule, [
      ...many,
      ...Array.from({ length: 4 }, (_, at) =>
        section(`node:other${at}`, "Bread, and the smell of rain."),
      ),
    ]);
    expect(found.coverage).toBe("partial");
    expect(found.passages).toHaveLength(RULE_PASSAGES);
  });

  it("finds a person's limit where the prose names the person beside one of its words", () => {
    // One rule word alone matches no passage; the person's name beside it
    // does, since the limit is theirs.
    const sheet = document(
      "reference:character--ilse.md",
      "character",
      "- **Abilities and limitations:**\n  - She cannot swim a stroke",
      "Ilse Varga",
    );
    const [limit] = rulesOf([sheet]);
    expect(limit.entity).toBe("Ilse Varga");
    const found = rulePassages(limit, [
      section("node:A", "At dawn Ilse dived from the pier and swam out."),
      section("node:B", "The swim was long, and nobody watched."),
    ]);
    expect(found.passages.map((one) => one.sourceId)).toEqual(["node:A"]);
  });

  it("never passes over a match it did not show", () => {
    // A passage that ends early must not let the matches after its end count
    // as covered: a match between it and the next passage shown would never
    // reach the reader.
    const gap = " The tide came in and the boats rocked at the quay.".repeat(7);
    const text = `Someone teleports over the water at dawn.${gap} Later she teleports over open water again, laughing.`;
    const found = rulePassages(rule, [section("node:A", text)]);
    expect(found.passages.map((one) => one.text).join(" ")).toContain(
      "teleports over open water again",
    );
  });

  it("ends a passage at its span when the rule's words run through a whole scene", () => {
    // Matches every sentence for two thousand characters: one passage would
    // be the scene, so past `RULE_PASSAGE_SPAN` the next match opens another.
    const scene = "She teleports over the water, and the water parts. ".repeat(
      40,
    );
    const found = rulePassages(rule, [section("node:A", scene)]);
    expect(found.passages.length).toBeGreaterThan(1);
    for (const one of found.passages)
      expect(one.text.length).toBeLessThanOrEqual(
        RULE_PASSAGE_SPAN + RULE_PASSAGE_SIDE * 2 + 120,
      );
  });

  it("does not search by a word most of the scope uses", () => {
    // "water" is in every Section: it says nothing of where the rule applies,
    // and alone it matches no passage.
    const sections = Array.from({ length: 5 }, (_, at) =>
      section(`node:${at}`, "The water was calm. The water was grey."),
    );
    expect(rulePassages(rule, sections).coverage).toBe("unmatched");
  });
});

describe("the kept rule answers", () => {
  const answer = {
    passage: 1,
    explanation: "Crosses by night.",
    quote: "by night",
    verdict: "breaks" as const,
    severity: "minor" as const,
  };

  it("reads back what it keeps, drops a malformed entry, and refuses another recipe", () => {
    // Keys are digests (`digestOf`), as the check writes them.
    const a = "0000000a";
    const kept = keepRuleChecks(null, { [a]: [answer] });
    expect(ruleChecksOf(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
    expect(
      ruleChecksOf({
        recipeRevision: RULE_CHECK_RECIPE_REVISION,
        answers: { [a]: [answer], "0000000b": "nonsense" },
      })?.answers,
    ).toEqual({ [a]: [answer] });
    expect(
      ruleChecksOf({ recipeRevision: "0", answers: { [a]: [answer] } }),
    ).toBeNull();
    expect(ruleChecksOf(null)).toBeNull();
  });

  it("keeps no key that is not a digest, so an edited file cannot re-parent the answers", () => {
    const read = ruleChecksOf(
      JSON.parse(
        `{"recipeRevision":"${RULE_CHECK_RECIPE_REVISION}","answers":{"__proto__":[${JSON.stringify(answer)}],"not a digest":[${JSON.stringify(answer)}]}}`,
      ),
    );
    expect(read?.answers).toEqual({});
    expect(Object.getPrototypeOf(read?.answers)).toBe(Object.prototype);
  });

  it("drops every answer that is not one: no number, a number below one, an unknown verdict or severity", () => {
    expect(ruleAnswerOf({ passages: "nonsense" })).toBeNull();
    expect(ruleAnswerOf(null)).toBeNull();
    expect(
      ruleAnswerOf({
        passages: [
          answer,
          null,
          "a line",
          { ...answer, passage: 0 },
          { ...answer, passage: 1.5 },
          { ...answer, explanation: 3 },
          { ...answer, quote: null },
          { ...answer, verdict: "maybe" },
          { ...answer, severity: "grave" },
        ],
      }),
    ).toEqual([answer]);
    expect(
      ruleChecksOf({ recipeRevision: RULE_CHECK_RECIPE_REVISION }),
    ).toBeNull();
    expect(ruleChecksOf("a file")).toBeNull();
  });

  it("keeps the newest answers when it holds too many", () => {
    const fresh = Object.fromEntries(
      Array.from({ length: RULE_CHECKS_KEPT + 3 }, (_, at) => [
        `k${at}`,
        [answer],
      ]),
    );
    const kept = keepRuleChecks(null, fresh);
    expect(Object.keys(kept.answers)).toHaveLength(RULE_CHECKS_KEPT);
    expect(kept.answers.k0).toBeUndefined();
    expect(kept.answers[`k${RULE_CHECKS_KEPT + 2}`]).toBeDefined();
  });

  it("keeps a digest of digits alone by its age, though an object lists such a key first", () => {
    const hex = (at: number) => `a${at.toString(16).padStart(7, "0")}`;
    const full = keepRuleChecks(
      null,
      Object.fromEntries(
        Array.from({ length: RULE_CHECKS_KEPT }, (_, at) => [
          hex(at),
          [answer],
        ]),
      ),
    );
    const through = (checks: typeof full) =>
      ruleChecksOf(JSON.parse(JSON.stringify(checks)));
    // The newest answer is a digest of digits alone.
    const digits = keepRuleChecks(through(full), { "12345678": [answer] });
    expect(digits.answers["12345678"]).toBeDefined();
    expect(digits.answers[hex(0)]).toBeUndefined();
    // Read back and joined by one more, it is still not the oldest.
    const next = keepRuleChecks(through(digits), { bbbbbbbb: [answer] });
    expect(next.answers["12345678"]).toBeDefined();
    expect(next.answers[hex(1)]).toBeUndefined();
    // An answer asked again is the newest again.
    const again = keepRuleChecks(through(next), { [hex(2)]: [answer] });
    const after = keepRuleChecks(through(again), { cccccccc: [answer] });
    expect(after.answers[hex(2)]).toBeDefined();
    expect(after.answers[hex(3)]).toBeUndefined();
  });
});
