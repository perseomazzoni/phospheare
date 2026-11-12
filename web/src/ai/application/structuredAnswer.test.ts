// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { ModelEvent, ModelRequest } from "../domain/types";
import type { ModelProvider } from "../ports";
import {
  structuredAnswer,
  type StructuredAnswerShape,
} from "./structuredAnswer";

const request: Omit<ModelRequest, "tools" | "output"> = {
  model: { providerId: "ollama", modelId: "test" },
  instructions: "Answer.",
  messages: [{ role: "user", content: "Question" }],
  limits: { inputTokens: 1_000, outputTokens: 100 },
};

const answer: StructuredAnswerShape<{ n: number }> = {
  name: "submit_verdict",
  description: "Say the number.",
  inputSchema: {
    type: "object",
    properties: { n: { type: "number" } },
    required: ["n"],
    additionalProperties: false,
  },
  validate: (value) => {
    const n = (value as { n?: unknown } | null)?.n;
    return typeof n === "number" ? { n } : null;
  },
};

function provider(events: ModelEvent[], seen: ModelRequest[]): ModelProvider {
  return {
    id: "stub",
    listModels: async () => [],
    describeModel: async () => {
      throw new Error("unused");
    },
    estimate: async () => ({ tokens: 1, exact: true }),
    generate: async function* (sent) {
      seen.push(sent);
      for (const event of events) yield event;
    },
  };
}

const native = { capabilities: { tools: true, structuredOutput: true } };
const toolOnly = { capabilities: { tools: true, structuredOutput: false } };

describe("structuredAnswer", () => {
  it("asks natively where the model can hold a schema, and reads the text as JSON", async () => {
    const seen: ModelRequest[] = [];
    const result = await structuredAnswer(
      provider(
        [
          { type: "text-delta", text: '{"n":' },
          { type: "text-delta", text: "3}" },
          { type: "completed", reason: "answer" },
        ],
        seen,
      ),
      native,
      request,
      answer,
      new AbortController().signal,
    );
    expect(result.value).toEqual({ n: 3 });
    expect(result.reason).toBe("answer");
    // One carrier, never both: a model offered a tool and a grammar may
    // answer on either, and the reader would have to guess which.
    expect(seen[0].output).toEqual({
      name: "submit_verdict",
      schema: answer.inputSchema,
    });
    expect(seen[0].tools).toEqual([]);
  });

  it("offers the one tool where it cannot, and reads that call's arguments", async () => {
    const seen: ModelRequest[] = [];
    const result = await structuredAnswer(
      provider(
        [
          { type: "text-delta", text: "Some prose first." },
          {
            type: "tool-call-ready",
            call: { id: "c1", name: "submit_verdict", arguments: { n: 5 } },
          },
          { type: "completed", reason: "tools" },
        ],
        seen,
      ),
      toolOnly,
      request,
      answer,
      new AbortController().signal,
    );
    expect(result.value).toEqual({ n: 5 });
    expect(seen[0].output).toBeUndefined();
    expect(seen[0].tools.map((tool) => tool.name)).toEqual(["submit_verdict"]);
    // The tool carries the definition, never the validator.
    expect(Object.keys(seen[0].tools[0]).sort()).toEqual([
      "description",
      "inputSchema",
      "name",
    ]);
  });

  it("answers null for what is not the answer, and never guesses", async () => {
    for (const [descriptor, events] of [
      // Cut off mid-object at the output limit.
      [
        native,
        [
          { type: "text-delta", text: '{"n":' },
          { type: "completed", reason: "limit" },
        ],
      ],
      // Prose where JSON was asked for.
      [
        native,
        [
          { type: "text-delta", text: "The number is 3." },
          { type: "completed", reason: "answer" },
        ],
      ],
      // Valid JSON of the wrong shape.
      [
        native,
        [
          { type: "text-delta", text: '{"n":"3"}' },
          { type: "completed", reason: "answer" },
        ],
      ],
      // A different tool, or none.
      [
        toolOnly,
        [
          {
            type: "tool-call-ready",
            call: { id: "c1", name: "read_source", arguments: { n: 1 } },
          },
          { type: "completed", reason: "tools" },
        ],
      ],
      [toolOnly, [{ type: "completed", reason: "answer" }]],
    ] as const) {
      const result = await structuredAnswer(
        provider([...events] as ModelEvent[], []),
        descriptor,
        request,
        answer,
        new AbortController().signal,
      );
      expect(result.value).toBeNull();
    }
  });

  it("tells the caller the model is thinking, and never streams the answer as prose", async () => {
    let thinking = 0;
    const result = await structuredAnswer(
      provider(
        [
          { type: "reasoning-delta", text: "Hmm." },
          { type: "text-delta", text: '{"n":1}' },
          { type: "usage", inputTokens: 10, outputTokens: 4 },
          { type: "completed", reason: "answer" },
        ],
        [],
      ),
      native,
      request,
      answer,
      new AbortController().signal,
      {
        onThinking: () => {
          thinking += 1;
        },
        // A caller that passed more than the pick cannot reach the text
        // stream of `runStep` through here.
        ...({ onText: () => expect.unreachable() } as object),
      },
    );
    expect(thinking).toBe(1);
    expect(result.value).toEqual({ n: 1 });
    expect(result.usage).toMatchObject({ steps: 1, inputTokens: 10 });
  });
});
