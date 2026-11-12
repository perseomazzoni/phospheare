// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { ScriptedModelProvider } from "./adapters/scripted";
import { OpenRouterDirectProvider } from "./adapters/openrouterDirect";
import type { ModelProvider } from "./ports";
import type { ModelEvent, ModelRequest } from "./domain/types";

const request: ModelRequest = {
  model: { providerId: "ollama", modelId: "scripted/test" },
  instructions: "Answer directly.",
  messages: [{ role: "user", content: "Is it sharp?" }],
  tools: [],
  limits: { inputTokens: 8_000, outputTokens: 1_000 },
};

/**
 * OpenRouter as the browser meets it: the catalogue and one short streamed
 * completion. It speaks the vendor's wire (`GET /models`, server-sent
 * events from `/chat/completions`) rather than mocking the adapter's own
 * calls, so the contract checked is the protocol, not this file's idea of it.
 */
const openRouterFetch: typeof fetch = async (input) => {
  const url = String(input);

  if (url.endsWith("/models"))
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "scripted/test",
            name: "Scripted Test",
            context_length: 128_000,
            top_provider: { max_completion_tokens: 4_096 },
            architecture: { output_modalities: ["text"] },
            supported_parameters: ["tools", "structured_outputs"],
            pricing: { prompt: "0.000001", completion: "0.000002" },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  const frames = [
    { choices: [{ delta: { role: "assistant", content: "It is " } }] },
    { choices: [{ delta: { content: "sharp." } }] },
    {
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.00002 },
    },
  ];
  return new Response(
    frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") +
      "data: [DONE]\n\n",
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
};

async function collect(provider: ModelProvider): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of provider.generate(
    request,
    new AbortController().signal,
  ))
    events.push(event);
  return events;
}

/**
 * @param answer the reply the adapter's fake streams, written out whole so
 * the joined deltas are checked against text this file did not split.
 */
function runModelContract(
  label: string,
  make: () => ModelProvider,
  answer: string,
): void {
  describe(`model contract — ${label}`, () => {
    it("describes a model and declares which SIDE of the port it is on", async () => {
      const provider = make();
      const descriptor = await provider.describeModel(
        request.model,
        new AbortController().signal,
      );
      expect(descriptor.id).toBe(request.model.modelId);
      // A descriptor says whose it is, and the routing provider finds a
      // model's adapter by that id, so it must be the adapter's own.
      expect(descriptor.providerId).toBe(provider.id);
      // The shared body runs for every adapter, a remote one included, so it
      // pins that a descriptor declares the axis, not which value it picks.
      expect(["device", "remote"]).toContain(descriptor.kind);
      expect(descriptor.capabilities.tools).toBeTypeOf("boolean");
    });

    it("streams ordered typed events through the neutral provider port", async () => {
      const events = await collect(make());
      const types = events.map((event) => event.type);

      // One start, first; one ending, last; so no text arrives outside a run.
      expect(types.indexOf("started")).toBe(0);
      expect(types.lastIndexOf("started")).toBe(0);
      expect(events[events.length - 1]).toEqual({
        type: "completed",
        reason: "answer",
      });
      expect(
        types.filter((type) => type === "completed" || type === "failed"),
      ).toHaveLength(1);

      const text = events
        .map((event) => (event.type === "text-delta" ? event.text : ""))
        .join("");
      expect(text).toBe(answer);
    });
  });
}

runModelContract(
  "scripted",
  () => new ScriptedModelProvider("A deterministic reply."),
  "A deterministic reply.",
);

// The direct adapter against the vendor's own frames: it must turn them
// into the same ordered events every other adapter emits.
runModelContract(
  "openrouter",
  () =>
    new OpenRouterDirectProvider("openrouter", {
      fetcher: openRouterFetch,
      apiKey: () => "sk-or-v1-test",
      attribution: { title: "Test" },
      timeouts: {
        metadataMs: 50,
        firstOutputMs: 50,
        inactivityMs: 50,
        stepMs: 200,
      },
    }),
  "It is sharp.",
);

describe("provider construction", () => {
  it("lists, estimates, and cancels through the same provider contract", async () => {
    const provider = new ScriptedModelProvider("A deterministic reply.");
    await expect(
      provider.listModels(new AbortController().signal),
    ).resolves.toEqual([
      expect.objectContaining({ id: "scripted/test", kind: "device" as const }),
    ]);
    await expect(provider.estimate(request)).resolves.toMatchObject({
      exact: false,
      tokens: expect.any(Number),
    });
    const controller = new AbortController();
    controller.abort();
    const events: ModelEvent[] = [];
    for await (const event of provider.generate(request, controller.signal))
      events.push(event);
    expect(events).toEqual([
      {
        type: "failed",
        error: {
          code: "cancelled",
          message: "Request cancelled",
          retryable: false,
        },
      },
    ]);
  });
});
