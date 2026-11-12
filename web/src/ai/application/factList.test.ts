// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { SectionLedger } from "../domain/ledger";
import type {
  ModelDescriptor,
  ModelRequest,
  SourceDescriptor,
} from "../domain/types";
import type { ModelProvider, ProjectSources } from "../ports";
import {
  bookFactCheck,
  checkFacts,
  factCheckMessage,
  type FactCheckDependencies,
} from "./factList";
import { ledgerTexts } from "./ledger";

const section = (id: string, order: number): SourceDescriptor => ({
  id: `node:${id}`,
  kind: "manuscript",
  title: `Chapter ${id}`,
  path: `document/${id}.md`,
  nodeId: id,
  nodeKind: "section",
  order,
  authority: "manuscript",
});
const sheet = (id: string, title: string): SourceDescriptor => ({
  id: `reference:${id}`,
  kind: "reference",
  title,
  path: `reference/${id}`,
  group: "characters",
  authority: "reference",
});

const MARTA = sheet("marta", "Marta");
const LEO = sheet("leo", "Leo");
// Listed out of reading order: the check puts the book in order itself.
const CATALOG = [section("B", 1), MARTA, section("A", 0), LEO];
const TEXTS: Record<string, string> = {
  "node:A": "Marta had grey eyes. Leo was tall.",
  "node:B": "Marta's green eyes. Leo was short.",
  // Filled as the character template is: a line the catalogue
  // cannot place is context only, and no side of a candidate.
  "reference:marta": "- **Appearance:** eyes of grey",
  "reference:leo": "- **Appearance:** short for his age",
};

class Sources implements ProjectSources {
  reads: string[] = [];
  async list() {
    return CATALOG;
  }
  async read(id: string) {
    this.reads.push(id);
    return {
      text: TEXTS[id] ?? "",
      revision: `r-${id}`,
      origin: "project-file" as const,
    };
  }
  async allowedReaderSources() {
    return new Set<string>();
  }
  async knownNames() {
    return [];
  }
}

const claim = (
  entity: string,
  attribute: string,
  norm: string,
  quote: string,
) => ({
  entity,
  kind: "person",
  status: "stated",
  attribute,
  type: "words",
  value: norm,
  norm,
  quote,
  change: false,
});

/** Every fact of this file's texts, and a judge that calls each a slip. */
function model(seen: ModelRequest[] = []): ModelProvider {
  return {
    id: "stub",
    listModels: async () => [],
    describeModel: async () => DESCRIPTOR,
    estimate: async () => ({ tokens: 1, exact: true }),
    generate: async function* (request) {
      seen.push(request);
      const text = request.messages[0]?.content ?? "";
      const answer =
        request.output?.name === "submit_judgement"
          ? {
              verdict:
                text.includes("Height") || text.includes("height")
                  ? "unsure"
                  : "conflict",
              severity: "minor",
              title: text.includes("eyes") ? "Marta's eyes" : "Leo's height",
              explanation: "Two ways.",
              doubt: "",
            }
          : {
              facts: [
                claim("Marta", "eyes", "grey", "Marta had grey eyes"),
                claim("Marta", "eyes", "green", "Marta's green eyes"),
                claim("Marta", "eyes", "grey", "eyes of grey"),
                claim("Leo", "height", "tall", "Leo was tall"),
                claim("Leo", "height", "short", "Leo was short"),
                claim("Leo", "height", "short", "short for his age"),
              ],
            };
      yield { type: "text-delta", text: JSON.stringify(answer) };
      yield { type: "completed", reason: "answer" };
    },
  };
}

const DESCRIPTOR: ModelDescriptor = {
  id: "m",
  providerId: "ollama",
  label: "m",
  kind: "device",
  capabilities: { tools: true, structuredOutput: true },
  contextTokens: 131_072,
};

function deps(
  sources: ProjectSources,
  provider = model(),
): FactCheckDependencies {
  const ledgers = new Map<string, SectionLedger>();
  return {
    sources,
    artifacts: {
      readLedger: async (id) => ledgers.get(id) ?? null,
      writeLedger: async (ledger) => {
        ledgers.set(ledger.sourceId, ledger);
      },
      readJudgements: async () => null,
      writeJudgements: async () => undefined,
      readEntities: async () => null,
      writeEntities: async () => undefined,
    },
    model: provider,
    descriptor: DESCRIPTOR,
    modelRef: { providerId: "ollama", modelId: "m" },
  };
}

const signal = new AbortController().signal;
const ALL = new Set(CATALOG.map((one) => one.id));
const keys = (check: { findings: { id: string }[] }) =>
  check.findings.map((one) => one.id).sort();

describe("checkFacts", () => {
  it("holds the book against itself and the sheets for /continuity, and against the sheets alone for /canon", async () => {
    const sources = new Sources();
    const texts = await ledgerTexts(sources, CATALOG, signal);
    const continuity = await checkFacts(
      { task: "continuity", texts },
      deps(sources),
      signal,
    );
    expect(keys(continuity)).toEqual([
      "fact:leo|height|short|tall",
      "fact:marta|eyes|green|grey",
    ]);
    // The unsure one carries its doubt, the slip does not.
    expect(
      continuity.findings.find((one) => one.id.includes("leo")),
    ).toMatchObject({
      severity: "observation",
    });
    expect(continuity).toMatchObject({ candidates: 2, judged: 2, unread: [] });
    const canon = await checkFacts(
      { task: "consistency", texts, sheets: new Set([MARTA.id]) },
      deps(sources),
      signal,
    );
    // Leo's sheet was not named: only Marta's disagreement is asked.
    expect(keys(canon)).toEqual(["fact:marta|eyes|green|grey"]);
  });

  it("tells the judge where each Section stands in the book", async () => {
    // A guidebook rule such as "compare odd chapters only with odd chapters"
    // is about position. A judge shown each place by its title alone cannot
    // apply it and lets a slip inside one life go, so the request carries the
    // book's order.
    const sources = new Sources();
    const texts = await ledgerTexts(sources, CATALOG, signal);
    const seen: ModelRequest[] = [];
    await checkFacts(
      {
        task: "continuity",
        texts,
        book: [section("A", 0), section("B", 1)],
      },
      deps(sources, model(seen)),
      signal,
    );
    const questions = seen
      .filter((one) => one.output?.name === "submit_judgement")
      .map((one) => one.messages[0]?.content ?? "");
    expect(questions.length).toBeGreaterThan(0);
    // Every manuscript place carries its position, each where it stands.
    for (const question of questions)
      expect(question).not.toMatch(/the manuscript, "/u);
    const all = questions.join(" | ");
    expect(all).toContain('the manuscript, Section 1 of 2, "Chapter A"');
    expect(all).toContain('the manuscript, Section 2 of 2, "Chapter B"');
    // A sheet stands outside the book's order and says so by being a sheet.
    expect(questions.some((one) => one.includes("reference sheet"))).toBe(true);
    for (const question of questions)
      expect(question).not.toMatch(/Section \d+ of \d+, "Marta"/u);
  });

  it("keeps to what touches the focus", async () => {
    const sources = new Sources();
    const texts = await ledgerTexts(sources, CATALOG, signal);
    const focused = await checkFacts(
      { task: "continuity", texts, focus: new Set(["node:Z"]) },
      deps(sources),
      signal,
    );
    expect(focused.findings).toEqual([]);
  });
});

describe("bookFactCheck", () => {
  it("reads only the sheets a name narrows it to, and says what it found", async () => {
    const sources = new Sources();
    const { message } = await bookFactCheck(
      sources,
      CATALOG,
      ALL,
      { task: "consistency", sheets: new Set([MARTA.id]) },
      deps(sources),
      signal,
    );
    expect(sources.reads).not.toContain(LEO.id);
    expect(message).toContain("THE APP'S FACT CHECK");
    expect(message).toContain(
      '- SLIP: "Marta\'s eyes" — "Two ways." Places: "Marta\'s green eyes" in "Chapter B" (node:B); "eyes of grey" in "Marta" (reference:marta)',
    );
  });
});

describe("factCheckMessage", () => {
  const base = {
    rules: [],
    knowing: [],
    usage: { steps: 0 },
    read: 2,
    candidates: 0,
    judged: 0,
    raised: [],
    unresolved: [],
    deferred: [],
  };
  it("names the rules it could not vouch for, and never calls one kept that no passage matched", () => {
    const rule = (over: Record<string, unknown>) => ({
      sourceId: "reference:world--rules.md",
      label: "What is impossible",
      entity: null,
      coverage: "checked" as const,
      examined: 2,
      unanswered: false,
      ...over,
    });
    const message = factCheckMessage(
      {
        ...base,
        findings: [],
        unread: [],
        rules: [
          rule({}),
          rule({ label: "Limits", coverage: "unmatched", examined: 0 }),
          rule({
            label: "What it cannot do",
            entity: "Teleportation",
            coverage: "partial",
            examined: 4,
          }),
          rule({ label: "Laws and justice", unanswered: true }),
        ],
      },
      new Map(),
    );
    expect(message).toContain(
      "It held the passages likeliest to bear on 3 of the writer's 4 rules to them.",
    );
    expect(message).toContain(
      `1 of the writer's rules matched no passage in what was checked, so they were not checked at all (not found kept): "Limits".`,
    );
    expect(message).toContain(
      'These rules were checked only in part — in their likeliest passages, or not asked this time: "What it cannot do (Teleportation)".',
    );
    expect(message).toContain(
      'These rules could not be checked, the reader answering in no shape; hold the prose to them yourself: "Laws and justice".',
    );
    // The notes on who knows what are counted and named apart.
    const knowing = factCheckMessage(
      {
        ...base,
        findings: [],
        unread: [],
        rules: [rule({})],
        knowing: [
          rule({ label: "Secrets and unacknowledged truths", examined: 1 }),
          rule({
            label: "Discoveries and revelations",
            coverage: "unmatched",
            examined: 0,
          }),
        ],
      },
      new Map(),
    );
    expect(knowing).toContain(
      "It held the passages likeliest to bear on 1 of the writer's 2 notes on who knows what, and from when, to it.",
    );
    expect(knowing).toContain(
      `1 of the writer's notes on who knows what matched no passage in what was checked, so they were not checked at all (not found kept): "Discoveries and revelations".`,
    );
    // Every rule checked in full, nothing found: a clean check says nothing.
    expect(
      factCheckMessage(
        { ...base, findings: [], unread: [], rules: [rule({})] },
        new Map(),
      ),
    ).toBe("");
  });

  it("is empty for a clean check, and names what it could not read", () => {
    expect(
      factCheckMessage({ ...base, findings: [], unread: [] }, new Map()),
    ).toBe("");
    expect(
      factCheckMessage(
        { ...base, findings: [], unread: [section("A", 0)] },
        new Map(),
      ),
    ).toBe(
      'THE APP\'S FACT CHECK read 2 sources into its fact ledgers and found 0 places where two of them state one fact differently; 0 of them were judged by a reader of both places. None of those judged is a slip. The app could not read these into its fact check; check them yourself: "Chapter A" (node:A).',
    );
  });

  it("says what it did in its own counts, never that every fact was compared", () => {
    const message = factCheckMessage(
      {
        ...base,
        read: 3,
        candidates: 2,
        judged: 2,
        findings: [
          {
            id: "fact:x",
            severity: "minor",
            title: "T",
            explanation: "E",
            evidence: [{ sourceId: "node:A", quote: "q" }],
            status: "open",
          },
        ],
        unread: [],
      },
      new Map(),
    );
    expect(message).toContain("read 3 sources into its fact ledgers");
    expect(message).toContain("found 2 places");
    expect(message).toContain("not proof that every fact holds");
    expect(message).not.toContain("every fact the book states was compared");
  });

  it("names the candidates the judge could not answer, instead of a clean bill", () => {
    const unresolved = factCheckMessage(
      {
        ...base,
        candidates: 1,
        judged: 0,
        unresolved: [
          {
            key: "marta|job|doctor|teacher",
            kind: "conflict",
            entity: "Marta",
            attribute: "job",
            type: "words",
            sides: [
              {
                sourceId: "node:A",
                origin: "prose",
                at: 0,
                quote: "q",
                value: "doctor",
                norm: "doctor",
              },
              {
                sourceId: "node:B",
                origin: "prose",
                at: 0,
                quote: "q",
                value: "teacher",
                norm: "teacher",
              },
            ],
            counts: [1, 1],
          },
        ],
        findings: [],
        unread: [],
      },
      new Map([
        ["node:A", "Chapter A"],
        ["node:B", "Chapter B"],
      ]),
    );
    expect(unresolved).not.toBe("");
    // The message names which fact and where: an instruction to read it is
    // no use without the name.
    expect(unresolved).toContain(
      '1 of them could not be judged and stay unresolved: read those facts yourself — Marta, job ("Chapter A", "Chapter B").',
    );
    // Unresolved is not "not checked": the two counts stay apart, and
    // nothing claims the one asked about was judged.
    expect(unresolved).not.toContain("were asked about");
    expect(unresolved).toContain("0 of them were judged");
    expect(unresolved).not.toContain("each one asked about was judged");
  });

  it("says when the judge stopped short of every candidate, names what waits, and that the next check continues", () => {
    const waiting = (i: number) => ({
      key: `marta|fact ${i}|a|b`,
      kind: "conflict" as const,
      entity: "Marta",
      attribute: `fact ${i}`,
      type: "words" as const,
      sides: [
        {
          sourceId: "node:A",
          origin: "prose" as const,
          at: 0,
          quote: "q",
          value: "a",
          norm: "a",
        },
        {
          sourceId: "node:B",
          origin: "prose" as const,
          at: 0,
          quote: "q",
          value: "b",
          norm: "b",
        },
      ],
      counts: [1, 1] as [number, number],
    });
    const message = factCheckMessage(
      {
        ...base,
        candidates: 50,
        judged: 40,
        deferred: Array.from({ length: 10 }, (_, i) => waiting(i)),
        unread: [],
        findings: [
          {
            id: "fact:x",
            severity: "observation",
            title: "T",
            explanation: "E",
            uncertainty: "D",
            evidence: [{ sourceId: "node:A", quote: "q" }],
            status: "open",
          },
        ],
      },
      new Map(),
    );
    // The unjudged ten are not "not checked": they wait, by name, and the
    // next check picks them up, because the forty verdicts are kept.
    expect(message).toContain(
      "Only the 40 most likely of 50 were asked about this time; 10 wait for the next check, which continues from them: Marta, fact 0; Marta, fact 1; Marta, fact 2; Marta, fact 3; Marta, fact 4; Marta, fact 5; Marta, fact 6; Marta, fact 7; and 2 more.",
    );
    expect(message).not.toContain("the rest were not checked");
    expect(message).toContain(
      '- UNSURE: "T" — "E" Could not tell: "D" Places: "q" in "node:A" (node:A)',
    );
  });
});
