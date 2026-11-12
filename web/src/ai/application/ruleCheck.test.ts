// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { CATALOGUE } from "../domain/referenceCatalogue";
import { parseReference } from "../domain/referenceRecords";
import type { RuleChecks, RuleDocument, RuleSection } from "../domain/rules";
import type { ModelDescriptor, ModelRequest } from "../domain/types";
import type { ModelProvider } from "../ports";
import {
  checkKnowledge,
  checkRules,
  KNOWLEDGE_FINDING,
  KNOWLEDGE_INSTRUCTIONS,
  RULE_FINDING,
  RULE_INSTRUCTIONS,
  RULE_MAX,
} from "./ruleCheck";

// ── Holding prose to the writer's rules ──────────────────────────────────────
//
// The rule check holds each Section to the writer's recorded rules.

const DESCRIPTOR: ModelDescriptor = {
  id: "m",
  providerId: "ollama",
  label: "m",
  kind: "device",
  capabilities: { tools: true, structuredOutput: true },
  contextTokens: 131_072,
};

function reader(
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
  file: RuleChecks | null = null;
  async readRuleChecks() {
    return this.file;
  }
  async writeRuleChecks(checks: RuleChecks) {
    this.file = checks;
  }
}

const deps = (
  model: ModelProvider,
  kept = new Kept(),
  language = "English",
) => ({
  model,
  descriptor: DESCRIPTOR,
  modelRef: { providerId: "ollama", modelId: "m" },
  language,
  artifacts: kept,
});

const RULES_TEXT = [
  "- **What is impossible:** no one crosses the strait by night",
  "- **Costs and limitations:** the ferryman's lamp allows one crossing a year",
].join("\n");

const rules = (text = RULES_TEXT): RuleDocument => ({
  sourceId: "reference:world--rules.md",
  title: "World rules",
  revision: "w1",
  text,
  parsed: parseReference(text, CATALOGUE.get("world:rules") ?? null),
});

const CHAPTER =
  "The bells rang midnight. Aldo crossed the strait by night in a stolen boat, and nobody stopped him.";
const SECTIONS: RuleSection[] = [
  { sourceId: "node:A", title: "Chapter A", revision: "a1", text: CHAPTER },
  {
    sourceId: "node:B",
    title: "Chapter B",
    revision: "b1",
    text: "Bread, and the smell of rain.",
  },
];

const breaks = (quote = "Aldo crossed the strait by night") => ({
  passages: [
    {
      passage: 1,
      explanation: "He crosses by night with no lamp.",
      quote,
      verdict: "breaks",
      severity: "major",
    },
  ],
});

const signal = new AbortController().signal;

describe("checkRules", () => {
  it("reports one breach once, when the rule's own exception is a rule too", async () => {
    // "Costs and limitations" qualifies the impossibility and is a rule of
    // its own, so both are asked about the same crossing. One place in the
    // prose is one finding, not one per rule that bears on it.
    const text = [
      "- **What is impossible:** no one crosses the strait by night",
      "- **Costs and limitations:** only the ferryman crosses the strait by night",
    ].join("\n");
    const seen: ModelRequest[] = [];
    const checked = await checkRules(
      [rules(text)],
      SECTIONS,
      deps(reader(() => breaks(), seen)),
      signal,
    );
    expect(seen).toHaveLength(2);
    expect(checked.findings.map((one) => one.title)).toEqual([
      "What is impossible",
    ]);
  });

  it("finds a rule broken where no two places state a fact two ways, with the rule and the passage as evidence", async () => {
    const seen: ModelRequest[] = [];
    const checked = await checkRules(
      [rules()],
      SECTIONS,
      deps(reader(() => breaks(), seen)),
      signal,
    );
    // The impossibility, asked with the cost that qualifies it; the cost
    // is a rule of its own, which no passage here bears on.
    const question = seen[0].messages[0]?.content ?? "";
    expect(question).toContain("no one crosses the strait by night");
    expect(question).toContain(
      'WHAT QUALIFIES IT, as the writer recorded it:\n- "World rules", "Costs and limitations": the ferryman\'s lamp allows one crossing a year',
    );
    expect(question).toContain('1. From "Chapter A"');
    expect(question).not.toContain("Bread");
    expect(seen[0].instructions).toContain(RULE_INSTRUCTIONS);
    expect(seen[0].instructions).toContain(
      "Write the explanations in English.",
    );
    expect(checked.findings).toHaveLength(1);
    expect(checked.findings[0]).toMatchObject({
      severity: "major",
      title: "What is impossible",
      explanation: "He crosses by night with no lamp.",
      evidence: [
        {
          sourceId: "reference:world--rules.md",
          revision: "w1",
          quote: "no one crosses the strait by night",
          // Set by the check, where the record is known.
          field: "world:rules/impossible",
        },
        {
          sourceId: "node:A",
          revision: "a1",
          quote: "Aldo crossed the strait by night",
        },
      ],
    });
    expect(checked.findings[0].id.startsWith(RULE_FINDING)).toBe(true);
    expect(checked.rules.map((one) => [one.label, one.coverage])).toEqual([
      ["What is impossible", "checked"],
      ["Costs and limitations", "unmatched"],
    ]);
  });

  it("never asks about a rule no passage matched, and says it was not checked", async () => {
    const seen: ModelRequest[] = [];
    const checked = await checkRules(
      [rules("- **What is impossible:** dragons breathing underwater")],
      SECTIONS,
      deps(reader(() => breaks(), seen)),
      signal,
    );
    expect(seen).toEqual([]);
    expect(checked.findings).toEqual([]);
    expect(checked.rules).toEqual([
      {
        sourceId: "reference:world--rules.md",
        label: "What is impossible",
        entity: null,
        coverage: "unmatched",
        examined: 0,
        unanswered: false,
      },
    ]);
  });

  it("keeps an unclear passage as an observation, a kept one as nothing, and a quote it cannot find as nothing", async () => {
    for (const [answer, expected] of [
      [
        {
          passages: [{ ...breaks().passages[0], verdict: "unclear" }],
        },
        [
          {
            severity: "observation",
            uncertainty: "He crosses by night with no lamp.",
          },
        ],
      ],
      [{ passages: [{ ...breaks().passages[0], verdict: "keeps" }] }, []],
      [breaks("Aldo flew over the strait"), []],
      [breaks("by"), []],
    ] as const) {
      const checked = await checkRules(
        [rules("- **What is impossible:** no one crosses the strait by night")],
        SECTIONS,
        deps(reader(() => answer)),
        signal,
      );
      expect(checked.findings).toMatchObject(expected);
    }
  });

  it("asks about a person's limit as theirs, says when nothing qualifies it, and writes in the book's language by default", async () => {
    const text =
      "- **Abilities and limitations:**\n  - She cannot swim a stroke";
    const sheet: RuleDocument = {
      sourceId: "reference:character--ilse.md",
      title: "Ilse",
      revision: "i1",
      text,
      parsed: parseReference(text, CATALOGUE.get("character") ?? null, "Ilse"),
    };
    const seen: ModelRequest[] = [];
    const { language: _, ...noLanguage } = deps(
      reader(() => breaks("Ilse dived from the pier and swam out"), seen),
    );
    const checked = await checkRules(
      [sheet],
      [
        {
          sourceId: "node:A",
          title: "Chapter A",
          revision: "a1",
          text: "At dawn Ilse dived from the pier and swam out.",
        },
      ],
      noLanguage,
      signal,
    );
    const question = seen[0].messages[0]?.content ?? "";
    expect(question).toContain('"Abilities and limitations", about Ilse:');
    expect(question).toContain("The writer recorded no exception to it.");
    expect(seen[0].instructions).toContain(
      "Write the explanations in the language of the book.",
    );
    expect(checked.findings[0]?.title).toBe("Abilities and limitations (Ilse)");
  });

  it("reports every rule as not checked when no Section is in scope, and asks nothing", async () => {
    const seen: ModelRequest[] = [];
    const checked = await checkRules(
      [rules()],
      [],
      deps(reader(() => breaks(), seen)),
      signal,
    );
    expect(seen).toEqual([]);
    expect(checked.rules.map((one) => one.coverage)).toEqual([
      "unmatched",
      "unmatched",
    ]);
  });

  it("checks with a cache it cannot read and keeps the finding when the cache cannot be written", async () => {
    // The cache saves a question; it never decides whether one is asked
    // or answered: an unreadable file is an empty one, and a failed write
    // costs the next check a question, never this one its finding.
    const broken = {
      readRuleChecks: async () => {
        throw new Error("unreadable");
      },
      writeRuleChecks: async () => {
        throw new Error("unwritable");
      },
    };
    const checked = await checkRules(
      [rules()],
      SECTIONS,
      { ...deps(reader(() => breaks())), artifacts: broken },
      signal,
    );
    expect(checked.findings).toHaveLength(1);
  });

  it("checks with no cache at all when the project keeps none", async () => {
    const checked = await checkRules(
      [rules()],
      SECTIONS,
      { ...deps(reader(() => breaks())), artifacts: {} },
      signal,
    );
    expect(checked.findings).toHaveLength(1);
  });

  it("reports a question answered in no shape as unanswered, never as kept", async () => {
    const checked = await checkRules(
      [rules("- **What is impossible:** no one crosses the strait by night")],
      SECTIONS,
      deps(reader(() => "not a list")),
      signal,
    );
    expect(checked.findings).toEqual([]);
    expect(checked.rules[0]).toMatchObject({
      coverage: "checked",
      unanswered: true,
    });
  });

  it("asks again only when what the question is changes: an exception, the language, a Section", async () => {
    const kept = new Kept();
    const seen: ModelRequest[] = [];
    const model = reader(() => breaks(), seen);
    await checkRules([rules()], SECTIONS, deps(model, kept), signal);
    const asked = seen.length;
    // The same question: answered from the kept answers.
    const again = await checkRules(
      [rules()],
      SECTIONS,
      deps(model, kept),
      signal,
    );
    expect(seen).toHaveLength(asked);
    expect(again.findings).toHaveLength(1);
    // Only an exception edited: asked again.
    await checkRules(
      [
        rules(
          RULES_TEXT.replace("one crossing a year", "one crossing a month"),
        ),
      ],
      SECTIONS,
      deps(model, kept),
      signal,
    );
    expect(seen.length).toBeGreaterThan(asked);
    const afterException = seen.length;
    // Another language: asked again.
    await checkRules([rules()], SECTIONS, deps(model, kept, "Italian"), signal);
    expect(seen.length).toBeGreaterThan(afterException);
    const afterLanguage = seen.length;
    // Another revision of the Section: asked again.
    await checkRules(
      [rules()],
      [{ ...SECTIONS[0], revision: "a2" }, SECTIONS[1]],
      deps(model, kept),
      signal,
    );
    expect(seen.length).toBeGreaterThan(afterLanguage);
  });

  it("asks about at most RULE_MAX rules, and reports the rest as not asked", async () => {
    const many = Array.from(
      { length: RULE_MAX + 2 },
      (_, at) =>
        `- **Fundamental rules:** rule ${at}: no one crosses the strait by night`,
    );
    const seen: ModelRequest[] = [];
    const checked = await checkRules(
      // One fundamental-rules field holds one record: many documents, one
      // rule each.
      many.map((line, at) => ({
        ...rules(line),
        sourceId: `reference:world--rules-${at}.md`,
      })),
      SECTIONS,
      deps(reader(() => ({ passages: [] }), seen)),
      signal,
    );
    expect(seen).toHaveLength(RULE_MAX);
    expect(
      checked.rules.filter(
        (one) => one.coverage === "partial" && one.examined === 0,
      ),
    ).toHaveLength(2);
  });
});

// ── Who knows what, and when ─────────────────────────────────────────────────
//
// The knowledge check holds the prose to who learns what, and where.

describe("checkKnowledge", () => {
  // The sheet says Tom learns it only in section 5, and section 3 has him
  // know. No two places state one fact two ways, so the fact check cannot
  // raise it.
  const SHEET_TEXT = [
    "- **Secrets and unacknowledged truths:** She knows the harbour master takes money to look away from the night boats. Tom learns it from her only in section 5.",
    "- **Abilities and limitations:** She cannot swim; deep water frightens her.",
  ].join("\n");
  const sheet: RuleDocument = {
    sourceId: "reference:character--ilse.md",
    title: "Ilse",
    revision: "i1",
    text: SHEET_TEXT,
    parsed: parseReference(SHEET_TEXT, CATALOGUE.get("character") ?? null),
  };
  const KNEW =
    "Tom already knew what the harbour master was paid to look away from the night boats.";
  const BOOK: RuleSection[] = [
    {
      sourceId: "node:3",
      title: "The night boat",
      revision: "n3",
      text: KNEW,
      position: { at: 3, of: 5 },
    },
    {
      sourceId: "node:4",
      title: "The pier",
      revision: "n4",
      text: "Bread, and the smell of rain.",
      position: { at: 4, of: 5 },
    },
  ];

  it("asks about a note on who knows what with each passage's place in the book, and files a knowing too early", async () => {
    const seen: ModelRequest[] = [];
    const checked = await checkKnowledge(
      [sheet],
      BOOK,
      deps(
        reader(
          () => breaks("Tom already knew what the harbour master was paid"),
          seen,
        ),
      ),
      signal,
    );
    expect(seen).toHaveLength(1);
    const question = seen[0].messages[0]?.content ?? "";
    expect(question).toContain(
      'THE NOTE ON WHO KNOWS WHAT — from the writer\'s "Ilse", "Secrets and unacknowledged truths"',
    );
    expect(question).toContain("Tom learns it from her only in section 5.");
    // Only its place can hold the passage to "only in section 5".
    expect(question).toContain('1. From "The night boat" (Section 3 of 5)');
    expect(question).not.toContain("Bread");
    // A note has no exceptions to report missing.
    expect(question).not.toContain("recorded no exception");
    expect(seen[0].instructions).toContain(KNOWLEDGE_INSTRUCTIONS);
    expect(checked.findings).toHaveLength(1);
    expect(checked.findings[0].id.startsWith(KNOWLEDGE_FINDING)).toBe(true);
    expect(checked.findings[0].evidence).toMatchObject([
      {
        sourceId: "reference:character--ilse.md",
        field: "character/secrets",
      },
      {
        sourceId: "node:3",
        quote: "Tom already knew what the harbour master was paid",
      },
    ]);
    // The sheet's limits are a rule, not a note on who knows what.
    expect(checked.rules.map((one) => [one.label, one.coverage])).toEqual([
      ["Secrets and unacknowledged truths", "checked"],
    ]);
  });

  it("leaves the rule check as it was: rules only, and no place beside a passage", async () => {
    const seen: ModelRequest[] = [];
    const swim: RuleSection = {
      ...BOOK[1],
      text: "Ilse, who cannot swim, dived into the deep water after the rope.",
    };
    const checked = await checkRules(
      [sheet],
      [BOOK[0], swim],
      deps(reader(() => ({ passages: [] }), seen)),
      signal,
    );
    expect(checked.rules.map((one) => one.label)).toEqual([
      "Abilities and limitations",
    ]);
    const question = seen[0]?.messages[0]?.content ?? "";
    expect(question).toContain("THE RULE — ");
    expect(question).not.toContain("(Section ");
    expect(seen[0]?.instructions).toContain(RULE_INSTRUCTIONS);
  });
});

describe("a quote whose words the Section holds more than once", () => {
  it("is anchored in the passage the model judged, not at the first time the words appear", async () => {
    const filler = "Bread, and the smell of rain. ".repeat(40);
    const text = `First: Aldo crossed the strait by night. ${filler}Second: Aldo crossed the strait by night.`;
    const checked = await checkRules(
      [rules()],
      [{ sourceId: "node:A", title: "Chapter A", revision: "a1", text }],
      deps(
        reader(() => ({
          passages: [
            {
              passage: 2,
              explanation: "He crosses by night with no lamp.",
              quote: "Aldo crossed the strait by night",
              verdict: "breaks",
              severity: "major",
            },
          ],
        })),
      ),
      signal,
    );
    expect(checked.findings).toHaveLength(1);
    expect(checked.findings[0].evidence[1]?.prefix).toMatch(/Second: $/u);
  });
});

describe("a quote that reaches the edge of its passage", () => {
  it("still finds its place when the model copies the passage's cut mark", async () => {
    // A model that quotes up to where its passage was cut copies the "…"
    // the excerpt adds, which is no part of the Section. The quote must
    // still be found, or a correct finding is dropped.
    const long = `Aldo crossed the strait by night in a stolen boat, ${"and the water was black and the wind was cold ".repeat(12)}and nobody stopped him.`;
    const seen: ModelRequest[] = [];
    const checked = await checkRules(
      [rules()],
      [{ sourceId: "node:A", title: "Chapter A", revision: "a1", text: long }],
      deps(
        reader((request) => {
          const question = String(request.messages[0]?.content ?? "");
          const shown = JSON.parse(
            /1\. From "Chapter A": (".*")$/mu.exec(question)?.[1] ?? '""',
          ) as string;
          // The passage was cut, and the model quotes through the cut.
          expect(shown.endsWith("…")).toBe(true);
          return breaks(shown.slice(-120));
        }, seen),
      ),
      signal,
    );
    expect(seen).toHaveLength(1);
    expect(checked.findings).toHaveLength(1);
    expect(checked.findings[0].evidence[1]?.quote.includes("…")).toBe(false);
  });
});
