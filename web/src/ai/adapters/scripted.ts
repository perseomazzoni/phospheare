// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ModelProvider } from "../ports";
import { CHARACTERS_PER_TOKEN } from "../domain/ratios";
import type {
  ModelDescriptor,
  ModelEvent,
  ModelRef,
  ModelRequest,
} from "../domain/types";

/** Deterministic adapter for port contracts and application tests. */
export class ScriptedModelProvider implements ModelProvider {
  readonly id = "scripted";

  constructor(private readonly reply = "Scripted test model response.") {}

  async listModels(signal?: AbortSignal): Promise<ModelDescriptor[]> {
    if (signal?.aborted) return [];
    return [
      await this.describeModel({
        providerId: this.id,
        modelId: "scripted/test",
      }),
    ];
  }

  async describeModel(ref: ModelRef): Promise<ModelDescriptor> {
    return {
      id: ref.modelId,
      providerId: this.id,
      label: ref.modelId,
      kind: "device" as const,
      capabilities: { tools: true, structuredOutput: true },
      contextTokens: 32_000,
    };
  }

  async estimate(
    request: ModelRequest,
  ): Promise<{ tokens: number; exact: boolean }> {
    return {
      // The shared ratio: a test double looser than the context guard would
      // hide the guard's refusal in every test that runs through it.
      tokens: Math.ceil(
        (request.instructions.length +
          request.messages.reduce(
            (sum, message) => sum + message.content.length,
            0,
          )) /
          CHARACTERS_PER_TOKEN,
      ),
      exact: false,
    };
  }

  async *generate(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent> {
    if (signal.aborted) {
      yield {
        type: "failed",
        error: {
          code: "cancelled",
          message: "Request cancelled",
          retryable: false,
        },
      };
      return;
    }
    yield { type: "started", model: request.model };
    const middle = Math.ceil(this.reply.length / 2);
    yield { type: "text-delta", text: this.reply.slice(0, middle) };
    yield { type: "text-delta", text: this.reply.slice(middle) };
    yield { type: "usage", inputTokens: 1, outputTokens: 2 };
    yield { type: "completed", reason: "answer" };
  }
}
