// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { ModelRequest } from "../domain/types";
import { openRouterBody, refuseGeneration } from "./openrouterRequest";

// Request validation is the last boundary before a paid, direct provider call.
// A refusal names the field and never repeats manuscript or credential values.
const request = (overrides: Partial<ModelRequest> = {}): ModelRequest => ({
  model: { providerId: "openrouter", modelId: "vendor/model" },
  instructions: "Be brief.",
  messages: [{ role: "user", content: "Private manuscript" }],
  tools: [],
  limits: { inputTokens: 1_000, outputTokens: 500 },
  ...overrides,
});

const callTurn = (blocks: unknown[]) =>
  request({
    messages: [
      { role: "user", content: "Find it." },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "a", name: "grep", arguments: "{}" }],
        blocks,
      },
      { role: "tool", content: "found", toolCallId: "a" },
    ],
  });

describe("direct generation request boundary", () => {
  it("refuses an empty replay item rather than forwarding arbitrary signed state", () => {
    const refused = refuseGeneration(callTurn([{ replay: [{}] }]));
    expect(refused).toEqual({
      code: "provider-rejected",
      field: "messages.2.replay",
    });
    expect(JSON.stringify(refused)).not.toContain("Private manuscript");
  });

  it("forwards no replay from a turn that made no calls", () => {
    const sent = openRouterBody(
      request({
        messages: [
          {
            role: "assistant",
            content: "Done.",
            blocks: [{ replay: [{ type: "reasoning.text", text: "why" }] }],
          },
        ],
      }),
    );
    const messages = sent.messages as Record<string, unknown>[];
    expect(messages[1]).toEqual({ role: "assistant", content: "Done." });
  });

  it("builds every field itself and fixes the provider privacy control", () => {
    const built = request({
      tools: [
        {
          name: "grep",
          description: "Search.",
          inputSchema: { type: "object" },
        },
      ],
      toolChoice: "none",
      temperature: 0.7,
      effort: "low",
    });
    expect(refuseGeneration(built)).toBeNull();
    const sent = openRouterBody(built);
    expect(sent).toEqual({
      model: "vendor/model",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Private manuscript" },
      ],
      stream: true,
      stream_options: { include_usage: true },
      provider: { data_collection: "deny" },
      max_tokens: 500,
      tools: [
        {
          type: "function",
          function: {
            name: "grep",
            description: "Search.",
            parameters: { type: "object" },
          },
        },
      ],
      tool_choice: "none",
      temperature: 0.7,
      reasoning: { effort: "low" },
    });
  });
});
