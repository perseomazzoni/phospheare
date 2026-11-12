// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { OllamaProvider } from "./ollama";
import type { ModelEvent, ModelRef, ModelRequest } from "../domain/types";

// Live protocol check against the writer's real Ollama, never part of
// ordinary CI. The deterministic suites pin the adapter against synthetic
// streams; this file is skipped unless the operator sets:
//
//   $env:PHOSPHEARE_OLLAMA_LIVE = "1"
//   $env:PHOSPHEARE_OLLAMA_URL  = "http://localhost:11434"   (optional)
//   $env:PHOSPHEARE_OLLAMA_MODEL = "qwen3:8b"                (optional)
//   npx vitest run src/ai/adapters/ollama.live.test.ts
//
// The prompts are synthetic and read no project content, so the run is a
// protocol check, not a manuscript exposure.

// The web tsconfig carries no Node types, so the environment is read through
// a guarded global rather than `process`. The file runs only under Vitest on
// an operator's machine.
const env =
  (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env ?? {};

const live = env.PHOSPHEARE_OLLAMA_LIVE === "1";
const endpoint = env.PHOSPHEARE_OLLAMA_URL ?? "http://localhost:11434";
const model = env.PHOSPHEARE_OLLAMA_MODEL ?? "qwen3:8b";
const ref: ModelRef = { providerId: "ollama", modelId: model };

async function collect(
  provider: OllamaProvider,
  request: ModelRequest,
): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of provider.generate(
    request,
    new AbortController().signal,
  ))
    events.push(event);
  return events;
}

describe.skipIf(!live)("Ollama live qualification", () => {
  const provider = new OllamaProvider(endpoint);

  it("lists the installed model and reports its capabilities", async () => {
    const models = await provider.listModels(new AbortController().signal);
    expect(models.map((one) => one.id)).toContain(model);
    const descriptor = await provider.describeModel(
      ref,
      new AbortController().signal,
    );
    expect(descriptor.kind).toBe("device");
    expect(descriptor.capabilities.tools).toBe(true);
  }, 120_000);

  it("passes the synthetic tool probe", async () => {
    const descriptor = await provider.describeModel(
      ref,
      new AbortController().signal,
    );
    expect(
      await provider.probeTools(
        { ...ref, modelRevision: descriptor.revision },
        new AbortController().signal,
      ),
    ).toBe(true);
  }, 300_000);

  it("completes a native tool round trip and a final answer", async () => {
    const request: ModelRequest = {
      model: ref,
      instructions:
        "You are a synthetic protocol probe. Call the supplied tool once, then answer with the word DONE.",
      messages: [{ role: "user", content: "Call the probe tool." }],
      tools: [
        {
          name: "list_sources",
          description: "Synthetic probe; performs no project access.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ],
      limits: { inputTokens: 4_000, outputTokens: 1_536 },
    };
    const first = await collect(provider, request);
    const call = first.find((event) => event.type === "tool-call-ready");
    expect(call).toBeDefined();
    if (call?.type !== "tool-call-ready") throw new Error("no tool call");

    const second = await collect(provider, {
      ...request,
      messages: [
        ...request.messages,
        { role: "assistant", content: "", toolCalls: [call.call] },
        {
          role: "tool",
          toolCallId: call.call.id,
          toolName: call.call.name,
          content: JSON.stringify({ sources: [] }),
        },
      ],
    });
    expect(second.some((event) => event.type === "text-delta")).toBe(true);
    expect(
      second.some(
        (event) =>
          event.type === "completed" &&
          (event.reason === "answer" || event.reason === "tools"),
      ),
    ).toBe(true);
  }, 600_000);
});
