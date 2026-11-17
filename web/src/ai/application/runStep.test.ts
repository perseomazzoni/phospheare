// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { ModelEvent, ModelRequest } from "../domain/types";
import type { ModelProvider } from "../ports";
import {
  ModelRunError,
  mergeUsage,
  runStep,
  throwIfCancelled,
} from "./runStep";

const request: ModelRequest = {
  model: { providerId: "ollama", modelId: "test" },
  instructions: "Answer.",
  messages: [{ role: "user", content: "Question" }],
  tools: [],
  limits: { inputTokens: 1_000, outputTokens: 100 },
};

function provider(events: ModelEvent[]): ModelProvider {
  return {
    id: "stub",
    listModels: async () => [],
    describeModel: async (ref) => ({
      id: ref.modelId,
      providerId: ref.providerId,
      label: ref.modelId,
      kind: "device" as const,
      capabilities: { tools: false, structuredOutput: false },
    }),
    estimate: async () => ({ tokens: 1, exact: true }),
    generate: async function* () {
      for (const event of events) yield event;
    },
  };
}

describe("runStep", () => {
  it("records how full ONE request made the window, and merges to the fullest", async () => {
    // The panel's context reading. `inputTokens` sums every step, so a run
    // that read three sources would read as three windows' worth; the
    // reading is the largest single request instead.
    const result = await runStep(
      provider([
        { type: "usage", inputTokens: 3, outputTokens: 4 },
        { type: "completed", reason: "answer" },
      ]),
      request,
      new AbortController().signal,
    );
    expect(result.usage.contextTokens).toBe(7);

    const merged = mergeUsage(
      { steps: 1, inputTokens: 100, outputTokens: 10, contextTokens: 110 },
      {
        steps: 1,
        inputTokens: 300,
        outputTokens: 20,
        contextTokens: 320,
        contextWindow: 8_192,
      },
    );
    expect(merged.inputTokens).toBe(400);
    expect(merged.contextTokens).toBe(320);
    expect(merged.contextWindow).toBe(8_192);
    // Unknown stays unknown, never zero.
    expect(mergeUsage({ steps: 0 }, { steps: 1 })).not.toHaveProperty(
      "contextTokens",
    );
    // The cached part of the prompt sums like the prompt, and stays absent
    // where no step reported it.
    expect(
      mergeUsage(
        { steps: 1, inputTokens: 100, cachedInputTokens: 80 },
        { steps: 1, inputTokens: 120 },
      ).cachedInputTokens,
    ).toBe(80);
    expect(mergeUsage({ steps: 1 }, { steps: 1 })).not.toHaveProperty(
      "cachedInputTokens",
    );
  });

  it("claims no context reading when the provider reported no prompt", async () => {
    const result = await runStep(
      provider([{ type: "completed", reason: "answer" }]),
      request,
      new AbortController().signal,
    );
    expect(result.usage.contextTokens).toBeUndefined();
  });

  it("accumulates text and usage and reports the terminal reason", async () => {
    const seen: string[] = [];
    const result = await runStep(
      provider([
        { type: "started", model: { providerId: "ollama", modelId: "test" } },
        { type: "text-delta", text: "One " },
        { type: "text-delta", text: "two." },
        { type: "usage", inputTokens: 3, outputTokens: 4, durationMs: 5 },
        { type: "completed", reason: "answer" },
      ]),
      request,
      new AbortController().signal,
      { onText: (text) => void seen.push(text) },
    );
    expect(result.text).toBe("One two.");
    expect(result.reason).toBe("answer");
    expect(result.usage).toMatchObject({
      inputTokens: 3,
      outputTokens: 4,
      totalTokens: 7,
      durationMs: 5,
      steps: 1,
    });
    expect(seen).toEqual(["One ", "One two."]);
  });

  it("collects provider blocks without reading them", async () => {
    // A reasoning block is opaque: the app never inspects one. A provider
    // that emits them requires them echoed unmodified inside a tool loop, so
    // an adapter must be able to hand them back verbatim on the next step.
    // The step carries them beside the text, never in the answer the writer
    // reads.
    const result = await runStep(
      provider([
        { type: "started", model: { providerId: "ollama", modelId: "test" } },
        { type: "block", block: { thinking: "Weigh the evidence." } },
        { type: "text-delta", text: "It holds." },
        { type: "completed", reason: "answer" },
      ]),
      request,
      new AbortController().signal,
      {},
    );
    expect(result.blocks).toEqual([{ thinking: "Weigh the evidence." }]);
    expect(result.text).toBe("It holds.");
  });

  it("hands the working to its own callback, never into the answer", async () => {
    // The working is shown to the writer apart from the answer, so it must
    // not reach `text`, which history, summaries and evidence read. An empty
    // piece (encrypted reasoning, a liveness signal) gets no callback.
    const pieces: string[] = [];
    const result = await runStep(
      provider([
        { type: "started", model: { providerId: "ollama", modelId: "test" } },
        { type: "reasoning-delta", text: "Weigh " },
        { type: "reasoning-delta", text: "" },
        { type: "reasoning-delta", text: "the evidence." },
        { type: "text-delta", text: "It holds." },
        { type: "completed", reason: "answer" },
      ]),
      request,
      new AbortController().signal,
      { onReasoning: (piece) => void pieces.push(piece) },
    );
    expect(pieces).toEqual(["Weigh ", "the evidence."]);
    expect(result.text).toBe("It holds.");
    expect(JSON.stringify(result)).not.toContain("Weigh");
  });

  it("says the model is thinking once, on its first reasoning event of any length", async () => {
    // An encrypted think arrives as empty pieces only: the model is thinking
    // and nothing readable comes through. `onReasoning` never sees an empty
    // piece; `onThinking` hears it.
    const run = async (events: ModelEvent[]) => {
      let thinking = 0;
      const pieces: string[] = [];
      await runStep(provider(events), request, new AbortController().signal, {
        onThinking: () => void (thinking += 1),
        onReasoning: (piece) => void pieces.push(piece),
      });
      return { thinking, pieces };
    };
    expect(
      await run([
        { type: "reasoning-delta", text: "" },
        { type: "reasoning-delta", text: "" },
        { type: "text-delta", text: "Done." },
        { type: "completed", reason: "answer" },
      ]),
    ).toEqual({ thinking: 1, pieces: [] });
    expect(
      await run([
        { type: "reasoning-delta", text: "a" },
        { type: "reasoning-delta", text: "b" },
        { type: "completed", reason: "answer" },
      ]),
    ).toEqual({ thinking: 1, pieces: ["a", "b"] });
    expect(
      await run([
        { type: "text-delta", text: "No working shown." },
        { type: "completed", reason: "answer" },
      ]),
    ).toEqual({ thinking: 0, pieces: [] });
  });

  it("collects completed tool calls", async () => {
    const result = await runStep(
      provider([
        {
          type: "tool-call-ready",
          call: { id: "a", name: "list_sources", arguments: {} },
        },
        { type: "completed", reason: "tools" },
      ]),
      request,
      new AbortController().signal,
    );
    expect(result.calls).toHaveLength(1);
    expect(result.reason).toBe("tools");
  });

  it("treats a stream without a terminal event as interrupted", async () => {
    await expect(
      runStep(
        provider([{ type: "text-delta", text: "half" }]),
        request,
        new AbortController().signal,
      ),
    ).rejects.toThrow(ModelRunError);
  });

  it("throws provider failures and returns cancellation as an outcome", async () => {
    await expect(
      runStep(
        provider([
          {
            type: "failed",
            error: { code: "connection", message: "down", retryable: true },
          },
        ]),
        request,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ failure: { code: "connection" } });

    const cancelled = await runStep(
      provider([
        { type: "text-delta", text: "partial" },
        {
          type: "failed",
          error: { code: "cancelled", message: "stop", retryable: false },
        },
      ]),
      request,
      new AbortController().signal,
    );
    expect(cancelled.reason).toBe("cancelled");
    expect(cancelled.text).toBe("partial");
  });

  it("merges usage and refuses work after an abort", () => {
    expect(
      mergeUsage(
        { inputTokens: 1, outputTokens: 2, steps: 1, durationMs: 3 },
        { inputTokens: 4, outputTokens: 5, steps: 2, durationMs: 6 },
      ),
    ).toEqual({
      inputTokens: 5,
      outputTokens: 7,
      totalTokens: 12,
      durationMs: 9,
      steps: 3,
    });
    const controller = new AbortController();
    controller.abort();
    expect(() => throwIfCancelled(controller.signal)).toThrow(ModelRunError);
    expect(() => throwIfCancelled(new AbortController().signal)).not.toThrow();
  });
});

describe("a model failure in the app's log", () => {
  it("gives its code and whether it may be retried, never the provider's words", () => {
    const error = new ModelRunError({
      code: "provider-rejected",
      message: "The model refused: 'Chapter One of My Secret Novel'",
      retryable: true,
    });
    expect(error.toLog()).toEqual({
      code: "provider-rejected",
      retryable: true,
    });
  });
});
