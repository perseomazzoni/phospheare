// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { CHARACTERS_PER_TOKEN } from "../domain/ratios";
import type {
  ModelDescriptor,
  ModelEvent,
  ModelRef,
  ModelRequest,
} from "../domain/types";
import type { ModelProvider } from "../ports";

// The demo editor's only model: it answers every turn with one of a fixed set
// of replies, so a visitor sees the chat work with no provider, account or
// key behind it. Every reply ends with the disclaimer that says so, and the
// adapter never reaches the network.
//
// It reports tools, so a turn does not carry the missing-tools notice, and
// never calls one, so every turn ends after its first step. Commands that
// need a tool call or a structured answer get the same text and fail the way
// they fail on any model that does not comply.

/** The words a demo reply is made of, read per answer in the interface language. */
export interface DemoModelCopy {
  replies: readonly string[];
  disclaimer: string;
}

// The model menu shows the model id, so the id is the model's name, ShAIne,
// the same in every language.
export const DEMO_MODEL: ModelRef = { providerId: "demo", modelId: "ShAIne" };

/** Milliseconds between streamed words, so an answer arrives like a real one. */
const WORD_PACE_MS = 18;

export class DemoModelProvider implements ModelProvider {
  readonly id = DEMO_MODEL.providerId;

  constructor(
    private readonly copy: () => DemoModelCopy,
    private readonly pace = WORD_PACE_MS,
  ) {}

  async listModels(signal: AbortSignal): Promise<ModelDescriptor[]> {
    if (signal.aborted) return [];
    return [await this.describeModel(DEMO_MODEL)];
  }

  async describeModel(ref: ModelRef): Promise<ModelDescriptor> {
    return {
      id: ref.modelId,
      providerId: this.id,
      label: ref.modelId,
      kind: "device",
      capabilities: { tools: true, structuredOutput: false },
      contextTokens: 32_000,
    };
  }

  async estimate(
    request: ModelRequest,
  ): Promise<{ tokens: number; exact: boolean }> {
    return {
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
      yield cancelled();
      return;
    }
    yield { type: "started", model: request.model };
    const text = demoReply(this.copy(), request);
    // Split after each run of whitespace, so the deltas join back to the
    // reply character for character, line breaks included.
    for (const word of text.match(/\S+\s*|\s+/g) ?? []) {
      if (this.pace > 0) await wait(this.pace, signal);
      if (signal.aborted) {
        yield cancelled();
        return;
      }
      yield { type: "text-delta", text: word };
    }
    yield {
      type: "usage",
      inputTokens: (await this.estimate(request)).tokens,
      outputTokens: Math.ceil(text.length / CHARACTERS_PER_TOKEN),
    };
    yield { type: "completed", reason: "answer" };
  }
}

/**
 * The reply for a request: the next in the set by how many times the writer
 * has spoken in this conversation, then the disclaimer as its last paragraph.
 */
export function demoReply(copy: DemoModelCopy, request: ModelRequest): string {
  const asked = request.messages.filter(
    (message) => message.role === "user",
  ).length;
  const reply =
    copy.replies.length > 0
      ? copy.replies[Math.max(0, asked - 1) % copy.replies.length]
      : "";
  // An answer renders as Markdown, so the disclaimer is set in italics apart
  // from the reply it qualifies.
  const disclaimer = `_${copy.disclaimer}_`;
  return reply ? `${reply}\n\n${disclaimer}` : disclaimer;
}

function cancelled(): ModelEvent {
  return {
    type: "failed",
    error: {
      code: "cancelled",
      message: "Request cancelled",
      retryable: false,
    },
  };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
