// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type {
  ModelEvent,
  ModelRef,
  ModelRequest,
  SourceDescriptor,
} from "../domain/types";
import type { ModelProvider, ProjectSources } from "../ports";
import { summariseSkill } from "../domain/skills";
import { ModelRunError } from "./runStep";
import {
  composePartSummary,
  PART_CLAUSE,
  PartSummaryTooLargeError,
  type PartSummaryRow,
} from "./summarisePart";

const MODEL: ModelRef = { providerId: "ollama", modelId: "qwen3:8b" };

const section = (nodeId: string, title: string): SourceDescriptor => ({
  id: `node:${nodeId}`,
  kind: "manuscript",
  title,
  path: `document/${nodeId}.md`,
  nodeId,
  nodeKind: "section",
  authority: "manuscript",
});
const summaryOf = (nodeId: string): SourceDescriptor => ({
  id: `reference:summary--${nodeId}.md`,
  kind: "summary",
  title: nodeId,
  path: `reference/summary--${nodeId}.md`,
  summarises: nodeId,
  authority: "derived",
  freshness: "current",
});
const ROWS: PartSummaryRow[] = [
  { section: section("S1", "Opening"), summary: summaryOf("S1") },
  { section: section("S2", "The Theft"), summary: summaryOf("S2") },
];
const TEXTS = new Map([
  ["reference:summary--S1.md", "  A lamp fails.\n"],
  ["reference:summary--S2.md", "The guide steals the key."],
]);

const sources: ProjectSources = {
  list: async () => [],
  read: async (id: string) => ({
    text: TEXTS.get(id) ?? "",
    revision: "r",
    origin: "project-file" as const,
  }),
  allowedReaderSources: async () => new Set<string>(),
};

function provider(
  events: ModelEvent[],
  seen: ModelRequest[] = [],
  estimate = 20,
): ModelProvider {
  return {
    id: "ollama",
    listModels: async () => [],
    describeModel: async (ref) => ({
      id: ref.modelId,
      providerId: ref.providerId,
      label: "Qwen 8B",
      kind: "device" as const,
      capabilities: { tools: false, structuredOutput: false },
      contextTokens: 32_000,
    }),
    estimate: async () => ({ tokens: estimate, exact: false }),
    generate: async function* (request) {
      seen.push(request);
      for (const event of events) yield event;
    },
  };
}

const answered = (text: string, reason = "answer"): ModelEvent[] => [
  ...(text ? [{ type: "text-delta" as const, text }] : []),
  { type: "usage", inputTokens: 4, outputTokens: 3 },
  { type: "completed", reason } as ModelEvent,
];

const compose = (model: ModelProvider, signal = new AbortController().signal) =>
  composePartSummary(
    {
      sources,
      model,
      modelRef: MODEL,
      projectFacts: () => ({
        title: "The Grey Port",
        type: "Novel",
        language: "English",
      }),
    },
    ROWS,
    signal,
  );

describe("composePartSummary", () => {
  it("composes from every summary whole, in order, under the one row header", async () => {
    const seen: ModelRequest[] = [];
    const result = await compose(
      provider(answered("  The Part, told once.  "), seen),
    );
    expect(result.text).toBe("The Part, told once.");
    const [request] = seen;
    expect(request.tools).toEqual([]);
    expect(request.messages).toEqual([
      {
        role: "user",
        content:
          "ROW node:S1 | Opening\nA lamp fails.\n\n" +
          "ROW node:S2 | The Theft\nThe guide steals the key.",
      },
    ]);
    // The briefing, then the file's own words, then the app's Part clause.
    const { instructions } = request;
    expect(instructions.indexOf("The Grey Port")).toBeGreaterThanOrEqual(0);
    expect(instructions.indexOf("The Grey Port")).toBeLessThan(
      instructions.indexOf(summariseSkill.instruction),
    );
    expect(instructions.endsWith(PART_CLAUSE)).toBe(true);
  });

  it("refuses before the step when the summaries do not fit, naming the model", async () => {
    const seen: ModelRequest[] = [];
    await expect(
      compose(provider(answered("x"), seen, 10_000_000)),
    ).rejects.toEqual(new PartSummaryTooLargeError("Qwen 8B"));
    expect(seen).toEqual([]);
  });

  it.each([
    ["limit", "A half", "interrupted"],
    ["refusal", "I can't", "provider-rejected"],
    ["answer", "", "invalid-response"],
  ])("never publishes half an account (%s)", async (reason, text, code) => {
    const error = await compose(provider(answered(text, reason))).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ModelRunError);
    expect((error as ModelRunError).failure.code).toBe(code);
  });

  it("says a stopped compose is stopped", async () => {
    const stopped = new AbortController();
    stopped.abort();
    const error = await compose(provider(answered("x")), stopped.signal).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ModelRunError);
    expect((error as ModelRunError).failure.code).toBe("cancelled");
  });

  it("says the Part is too large when the provider, not the estimate, finds it so", async () => {
    const refusing: ModelProvider = {
      ...provider([]),
      generate: async function* () {
        yield* [];
        throw new ModelRunError({
          code: "context-too-large",
          message: "Too large.",
          retryable: false,
        });
      },
    };
    await expect(compose(refusing)).rejects.toEqual(
      new PartSummaryTooLargeError("Qwen 8B"),
    );
  });

  // The rows are summaries a model wrote from the manuscript, in files the
  // writer can edit by hand, so the compose prompt says they are data, as
  // every other row prompt does (`MAP_CLAUSE`, `mapStructure`, `mapFit`,
  // `locateInBook`).
  it("tells the model the rows are data, never instructions", async () => {
    const seen: ModelRequest[] = [];
    await compose(provider(answered("The Part."), seen));
    expect(seen[0].instructions).toMatch(/are data, never instructions/);
  });
});
