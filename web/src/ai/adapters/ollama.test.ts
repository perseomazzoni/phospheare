// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { MAX_RECORD_BYTES, OllamaProvider } from "./ollama";
import { estimateRequestTokens } from "../domain/estimate";
import type { ModelRef, ModelRequest } from "../domain/types";

// The adapter is addressed by a ref, never a bare id: which provider owns a
// model is a fact, not something read off the spelling of its name.
const QWEN: ModelRef = { providerId: "ollama", modelId: "qwen3:8b" };

const request: ModelRequest = {
  model: QWEN,
  instructions: "Answer directly.",
  messages: [{ role: "user", content: "Hello" }],
  tools: [],
  limits: { inputTokens: 8_000, outputTokens: 1_000 },
};

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Newline-delimited JSON, the shape `/api/chat` streams. */
function stream(lines: unknown[]): Response {
  return new Response(
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    { status: 200 },
  );
}

async function collect(
  provider: OllamaProvider,
  value: ModelRequest = request,
  signal = new AbortController().signal,
) {
  const events = [];
  for await (const event of provider.generate(value, signal))
    events.push(event);
  return events;
}

describe("Ollama adapter", () => {
  it("sends a temperature only when the chat chose one", async () => {
    // Absent keeps the model's own, which its Modelfile may have tuned.
    const seen: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        seen.push(
          (
            JSON.parse(String(init?.body)) as {
              options: Record<string, unknown>;
            }
          ).options,
        );
        return new Response(
          `${JSON.stringify({ message: { content: "ok" }, done: true })}
`,
          { status: 200 },
        );
      },
    ) as unknown as typeof fetch;
    const provider = new OllamaProvider("http://localhost:11434", fetcher);
    await collect(provider);
    await collect(provider, { ...request, temperature: 0.2 });
    expect(seen[0]).not.toHaveProperty("temperature");
    expect(seen[1].temperature).toBe(0.2);
  });

  it("says effort as `think` only when asked: false for none, the level otherwise", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        seen.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          `${JSON.stringify({ message: { content: "ok" }, done: true })}
`,
          { status: 200 },
        );
      },
    ) as unknown as typeof fetch;
    const provider = new OllamaProvider("http://localhost:11434", fetcher);
    await collect(provider);
    await collect(provider, { ...request, effort: "none" });
    await collect(provider, { ...request, effort: "low" });
    await collect(provider, { ...request, effort: "medium" });
    expect(seen[0]).not.toHaveProperty("think");
    expect(seen.slice(1).map((body) => body.think)).toEqual([
      false,
      "low",
      "medium",
    ]);
  });

  it("lists local models and filters Ollama cloud entries", async () => {
    const fetcher = vi.fn(async () =>
      json({
        models: [
          { name: "qwen3:8b", digest: "one" },
          { name: "cloud/model", remote_model: "provider/model" },
        ],
      }),
    ) as unknown as typeof fetch;
    const models = await new OllamaProvider(
      "http://127.0.0.1:11434",
      fetcher,
    ).listModels(new AbortController().signal);
    expect(models.map((model) => model.id)).toEqual(["qwen3:8b"]);
  });

  it("accepts either local model id field and safely ignores malformed or remote rows", async () => {
    const fetcher = vi.fn(async () =>
      json({
        models: [
          { model: "gemma:local", digest: 42 },
          { name: 7 },
          { name: "remote-host", remote_host: "https://cloud.example" },
        ],
      }),
    ) as unknown as typeof fetch;
    const provider = new OllamaProvider("http://localhost:11434", fetcher);
    await expect(
      provider.listModels(new AbortController().signal),
    ).resolves.toEqual([
      {
        id: "gemma:local",
        providerId: "ollama",
        label: "gemma:local",
        revision: undefined,
        kind: "device" as const,
        capabilities: { tools: false, structuredOutput: false },
      },
    ]);
    const empty = vi.fn(async () => json({})) as unknown as typeof fetch;
    await expect(
      new OllamaProvider("http://localhost:11434", empty).listModels(
        new AbortController().signal,
      ),
    ).resolves.toEqual([]);
  });

  it("discovers tool and context capabilities", async () => {
    const fetcher = vi.fn(async () =>
      json({
        capabilities: ["completion", "tools"],
        model_info: { "qwen.context_length": 32768 },
      }),
    ) as unknown as typeof fetch;
    const model = await new OllamaProvider(
      "http://localhost:11434",
      fetcher,
    ).describeModel(QWEN, new AbortController().signal);
    expect(model.capabilities).toEqual({
      tools: true,
      structuredOutput: true,
      reasoning: false,
    });
    expect(model.contextTokens).toBe(32768);
  });

  it("reports reasoning support, and carries a thinking block back unchanged", async () => {
    // Ollama returns a thinking model's reasoning in its own `thinking` field
    // beside `content`. Dropped, it is invisible on a single answer, but a
    // tool loop then asks the model to continue from a turn it cannot
    // remember taking. The app never looks inside the block; it only replays
    // it (`ModelMessage.blocks`).
    const shown = vi.fn(async () =>
      json({ capabilities: ["completion", "tools", "thinking"] }),
    ) as unknown as typeof fetch;
    const described = await new OllamaProvider(
      "http://localhost:11434",
      shown,
    ).describeModel(QWEN, new AbortController().signal);
    expect(described.capabilities.reasoning).toBe(true);

    const sent: string[] = [];
    const streaming = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        // The adapter also reads `/api/ps` once after a model's first answer;
        // this row is about the chat requests alone.
        if (String(url).endsWith("/api/ps"))
          return new Response("{}", { status: 404 });
        sent.push(String(init?.body ?? ""));
        return stream([
          { message: { thinking: "Weigh " } },
          { message: { thinking: "the evidence." } },
          { message: { content: "It goes dark." } },
          { done: true },
        ]);
      },
    ) as unknown as typeof fetch;
    const provider = new OllamaProvider("http://localhost:11434", streaming);

    const blocks: unknown[] = [];
    const pieces: string[] = [];
    let answer = "";
    for await (const event of provider.generate(
      {
        model: QWEN,
        instructions: "x",
        messages: [{ role: "user", content: "what happens?" }],
        tools: [],
        limits: { inputTokens: 1_000, outputTokens: 100 },
      },
      new AbortController().signal,
    )) {
      if (event.type === "block") blocks.push(event.block);
      if (event.type === "reasoning-delta") pieces.push(event.text);
      if (event.type === "text-delta") answer += event.text;
    }
    // Accumulated across deltas into one block, and never mixed into the
    // answer the writer reads.
    expect(blocks).toEqual([{ thinking: "Weigh the evidence." }]);
    // Also streamed piece by piece for the writer's fold, apart from the
    // answer.
    expect(pieces).toEqual(["Weigh ", "the evidence."]);
    expect(answer).toBe("It goes dark.");

    for await (const event of provider.generate(
      {
        model: QWEN,
        instructions: "x",
        messages: [
          { role: "user", content: "what happens?" },
          { role: "assistant", content: "", blocks },
        ],
        tools: [],
        limits: { inputTokens: 1_000, outputTokens: 100 },
      },
      new AbortController().signal,
    ))
      // Drained, not inspected: the assertion below is on the request this
      // second call sends.
      void event;
    expect(JSON.parse(sent[1] ?? "{}").messages[2]).toMatchObject({
      role: "assistant",
      thinking: "Weigh the evidence.",
    });
  });

  it('refuses a non-loopback endpoint, which is what makes kind "device" true', () => {
    // The descriptors hardcode `kind: "device"`, the axis a privacy gate
    // branches on. That is true only because the constructor
    // normalizes the endpoint before it stores it and allows this machine
    // alone; this row keeps the two from drifting apart.
    for (const hostile of [
      "http://evil.example.com:11434",
      "http://169.254.169.254",
      "http://10.0.0.5:11434",
    ])
      expect(() => new OllamaProvider(hostile)).toThrow("loopback-only");
    expect(() => new OllamaProvider("http://localhost:11434")).not.toThrow();
  });

  it("rejects cloud-backed models and tolerates incomplete capability metadata", async () => {
    const cloud = vi.fn(async () =>
      json({ remote_model: "vendor/model" }),
    ) as unknown as typeof fetch;
    await expect(
      new OllamaProvider("http://localhost:11434", cloud).describeModel(
        { providerId: "ollama", modelId: "cloud" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("ollama-cloud-model");

    const sparse = vi.fn(async () =>
      json({
        capabilities: "completion",
        model_info: { "x.context_length": "large" },
      }),
    ) as unknown as typeof fetch;
    await expect(
      new OllamaProvider("http://localhost:11434", sparse).describeModel(
        { providerId: "ollama", modelId: "local" },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      capabilities: { tools: false, structuredOutput: false },
      contextTokens: undefined,
    });
  });

  it("estimates request size without sending prose anywhere", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const estimate = await new OllamaProvider(
      "http://localhost:11434",
      fetcher,
    ).estimate(request);
    expect(estimate.exact).toBe(false);
    expect(estimate.tokens).toBeGreaterThan(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("counts tool schemas, names and prior tool calls in the estimate", async () => {
    const provider = new OllamaProvider(
      "http://localhost:11434",
      vi.fn() as unknown as typeof fetch,
    );
    const bare = await provider.estimate(request);
    const withTools = await provider.estimate({
      ...request,
      tools: [
        {
          name: "list_sources",
          description: "List every source the chat may read.",
          inputSchema: {
            type: "object",
            properties: { kind: { type: "string" } },
          },
        },
      ],
    });
    expect(withTools.tokens).toBeGreaterThan(bare.tokens);
    const withCalls = await provider.estimate({
      ...request,
      messages: [
        ...request.messages,
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "c1",
              name: "list_sources",
              arguments: { kind: "reference" },
            },
          ],
        },
        { role: "tool", content: "[]", toolName: "list_sources" },
      ],
    });
    expect(withCalls.tokens).toBeGreaterThan(bare.tokens);
  });

  it("learns a digest from one lazy listing when describeModel is called cold", async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      urls.push(String(url));
      if (String(url).endsWith("/api/tags"))
        return json({ models: [{ name: "qwen3:8b", digest: "digest-1" }] });
      return json({ capabilities: ["tools"], model_info: {} });
    }) as unknown as typeof fetch;
    const provider = new OllamaProvider("http://localhost:11434", fetcher);
    const signal = new AbortController().signal;

    // Cold: the editor's provider has never listed models, and the artifact's
    // provenance still needs the exact weights.
    const first = await provider.describeModel(QWEN, signal);
    expect(first.revision).toBe("digest-1");
    expect(urls.filter((url) => url.endsWith("/api/tags"))).toHaveLength(1);

    // Warm: the digest is known, so the listing is not asked again.
    const second = await provider.describeModel(QWEN, signal);
    expect(second.revision).toBe("digest-1");
    expect(urls.filter((url) => url.endsWith("/api/tags"))).toHaveLength(1);
  });

  it("streams NDJSON and omits the tools field for chat-only models", async () => {
    const wire = `${JSON.stringify({ message: { content: "Hel" }, done: false })}\n${JSON.stringify({ message: { content: "lo" }, done: true, prompt_eval_count: 3, eval_count: 2 })}\n`;
    const fetcher = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).not.toHaveProperty("tools");
        expect(init?.credentials).toBe("omit");
        return new Response(wire, { status: 200 });
      },
    ) as unknown as typeof fetch;
    const events = [];
    for await (const event of new OllamaProvider(
      "http://localhost:11434",
      fetcher,
    ).generate(request, new AbortController().signal))
      events.push(event);
    expect(
      events
        .filter((event) => event.type === "text-delta")
        .map((event) => (event.type === "text-delta" ? event.text : ""))
        .join(""),
    ).toBe("Hello");
    expect(events[events.length - 1]).toEqual({
      type: "completed",
      reason: "answer",
    });
  });

  it("allocates num_ctx for the prompt and the generation together", async () => {
    // `num_ctx` is the total KV allocation, not the prompt's share. Sending
    // the input allowance alone subtracts the output reserve twice, and
    // Ollama then drops tokens off the front of the prompt with no error and
    // nothing in the response to show it.
    let options: { num_ctx?: number; num_predict?: number } = {};
    const fetcher = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        options = (
          JSON.parse(String(init?.body)) as {
            options: { num_ctx?: number; num_predict?: number };
          }
        ).options;
        return new Response(
          `${JSON.stringify({ message: { content: "ok" }, done: true })}
`,
          { status: 200 },
        );
      },
    ) as unknown as typeof fetch;
    await collect(new OllamaProvider("http://localhost:11434", fetcher));
    expect(options.num_predict).toBe(1_000);
    expect(options.num_ctx).toBe(9_000);
  });

  it("maps tool messages and streams tool calls with measured usage", async () => {
    const wire = `${JSON.stringify({
      message: {
        content: "",
        tool_calls: [
          {
            function: {
              name: "read_source",
              arguments: { sourceId: "node:S1" },
            },
          },
          { function: { name: 3 } },
        ],
      },
      done: true,
      prompt_eval_count: 9,
      eval_count: 4,
      total_duration: 2_000_000,
    })}\n`;
    const fetcher = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toHaveProperty("tools");
        const serialized = JSON.stringify(body);
        // Native tool results key on the function name; the app's call id
        // must never be sent as `tool_name`.
        expect(serialized).toContain('"tool_name":"read_source"');
        expect(serialized).not.toContain('"tool_name":"one"');
        expect(serialized).toContain("tool_calls");
        return new Response(wire, { status: 200 });
      },
    ) as unknown as typeof fetch;
    const withTools: ModelRequest = {
      ...request,
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "one", name: "read_source", arguments: {} }],
        },
        {
          role: "tool",
          content: "{}",
          toolCallId: "one",
          toolName: "read_source",
        },
      ],
      tools: [
        {
          name: "read_source",
          description: "Read one source",
          inputSchema: { type: "object" },
        },
      ],
    };
    const events = await collect(
      new OllamaProvider("http://localhost:11434", fetcher),
      withTools,
    );
    expect(events.some((event) => event.type === "tool-call-ready")).toBe(true);
    expect(events).toContainEqual({
      type: "usage",
      inputTokens: 9,
      outputTokens: 4,
      durationMs: 2,
    });
    expect(events[events.length - 1]).toEqual({
      type: "completed",
      reason: "tools",
    });
  });

  it("classifies request failures without leaking credentials", async () => {
    const rejected = vi.fn(
      async () => new Response("no", { status: 503 }),
    ) as unknown as typeof fetch;
    expect(
      await collect(new OllamaProvider("http://localhost:11434", rejected)),
    ).toContainEqual({
      type: "failed",
      error: {
        code: "provider-rejected",
        message: "ollama-503",
        retryable: true,
      },
    });

    const offline = vi.fn(async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    expect(
      await collect(new OllamaProvider("http://localhost:11434", offline)),
    ).toContainEqual({
      type: "failed",
      error: { code: "connection", message: "offline", retryable: true },
    });

    const controller = new AbortController();
    controller.abort("writer stopped");
    expect(
      await collect(
        new OllamaProvider("http://localhost:11434", offline),
        request,
        controller.signal,
      ),
    ).toContainEqual({
      type: "failed",
      error: {
        code: "cancelled",
        message: "Request cancelled",
        retryable: false,
      },
    });
  });

  it("classifies missing, truncated, and malformed streams", async () => {
    const missing = vi.fn(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch;
    expect(
      await collect(new OllamaProvider("http://localhost:11434", missing)),
    ).toContainEqual({
      type: "failed",
      error: {
        code: "invalid-response",
        message: "Ollama returned no stream",
        retryable: true,
      },
    });

    const truncated = vi.fn(
      async () =>
        new Response(
          `${JSON.stringify({ message: { content: "partial" } })}\n`,
          {
            status: 200,
          },
        ),
    ) as unknown as typeof fetch;
    expect(
      await collect(new OllamaProvider("http://localhost:11434", truncated)),
    ).toContainEqual({
      type: "failed",
      error: {
        code: "interrupted",
        message: "Ollama stream ended before completion",
        retryable: true,
      },
    });

    const malformed = vi.fn(
      async () => new Response("not-json\n", { status: 200 }),
    ) as unknown as typeof fetch;
    expect(
      await collect(new OllamaProvider("http://localhost:11434", malformed)),
    ).toContainEqual({
      type: "failed",
      error: expect.objectContaining({
        code: "invalid-response",
        retryable: true,
      }),
    });
  });

  it("reports an answer cut at the output allowance as `limit`", async () => {
    const fetcher = vi.fn(async () =>
      stream([
        { message: { content: "It was a dark and" }, done: false },
        { message: { content: "" }, done: true, done_reason: "length" },
      ]),
    ) as unknown as typeof fetch;
    const events = await collect(
      new OllamaProvider("http://localhost:11434", fetcher),
    );
    expect(events[events.length - 1]).toEqual({
      type: "completed",
      reason: "limit",
    });
  });

  it("reads Ollama's own error record instead of calling the stream cut", async () => {
    const fetcher = vi.fn(async () =>
      stream([
        { message: { content: "Once" }, done: false },
        {
          error:
            "model requires more system memory (9.1 GiB) than is available (4.0 GiB)",
        },
      ]),
    ) as unknown as typeof fetch;
    const events = await collect(
      new OllamaProvider("http://localhost:11434", fetcher),
    );
    expect(events[events.length - 1]).toEqual({
      type: "failed",
      error: {
        code: "resource-exhausted",
        message:
          "model requires more system memory (9.1 GiB) than is available (4.0 GiB)",
        retryable: true,
      },
    });

    const refused = vi.fn(async () =>
      stream([{ error: "an error was encountered while running the model" }]),
    ) as unknown as typeof fetch;
    expect(
      await collect(new OllamaProvider("http://localhost:11434", refused)),
    ).toContainEqual({
      type: "failed",
      error: {
        code: "provider-rejected",
        message: "an error was encountered while running the model",
        retryable: true,
      },
    });
  });

  it("sends no tools to a step that may call none", async () => {
    // Ollama has no switch that declares tools without letting the model
    // call one, so the closing step after a ceiling is sent none.
    const bodies: Record<string, unknown>[] = [];
    const fetcher = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith("/api/ps"))
          return new Response("{}", { status: 404 });
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          `${JSON.stringify({ message: { content: "Done." }, done: true })}\n`,
          { status: 200 },
        );
      },
    ) as unknown as typeof fetch;
    const provider = new OllamaProvider("http://localhost:11434", fetcher);
    const grep = {
      name: "grep" as const,
      description: "Search",
      inputSchema: { type: "object", properties: {} },
    };
    await collect(provider, { ...request, tools: [grep] });
    await collect(provider, {
      ...request,
      tools: [grep],
      toolChoice: "none",
    });
    expect(bodies[0]).toHaveProperty("tools");
    expect(bodies[1]).not.toHaveProperty("tools");
  });

  it("sends structured-output schemas and never forwards cookies or follows redirects", async () => {
    const schema = {
      type: "object",
      properties: { findings: { type: "array" } },
    };
    let seen: RequestInit | undefined;
    const fetcher = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        // The adapter also reads `/api/ps` once after a model's first answer;
        // this row is about the chat requests alone.
        if (String(url).endsWith("/api/ps"))
          return new Response("{}", { status: 404 });
        seen = init;
        return new Response(
          `${JSON.stringify({ message: { content: "{}" }, done: true })}\n`,
          { status: 200 },
        );
      },
    ) as unknown as typeof fetch;
    await collect(new OllamaProvider("http://localhost:11434", fetcher), {
      ...request,
      output: { name: "findings", schema },
    });
    const body = JSON.parse(String(seen?.body)) as Record<string, unknown>;
    expect(body.format).toEqual(schema);
    expect(seen?.credentials).toBe("omit");
    expect(seen?.redirect).toBe("error");
  });

  it("rejects an oversized NDJSON record instead of buffering it", async () => {
    const oversized = vi.fn(
      async () =>
        new Response(`${"x".repeat(2 * 1024 * 1024 + 1)}\n`, { status: 200 }),
    ) as unknown as typeof fetch;
    expect(
      await collect(new OllamaProvider("http://localhost:11434", oversized)),
    ).toContainEqual({
      type: "failed",
      error: expect.objectContaining({
        code: "invalid-response",
        retryable: true,
      }),
    });
  });

  // The record and stream caps hold on the raw bytes before a chunk is
  // kept, so a runtime that never ends a line is refused at the cap, not at
  // a deadline.
  describe("stream bounds without a newline", () => {
    /** `count` chunks of `size` bytes each, no newline anywhere. */
    function unterminated(count: number, size: number) {
      let pulled = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulled++ < count)
            controller.enqueue(new Uint8Array(size).fill(0x78));
          else controller.close();
        },
      });
      const fetcher = vi.fn(
        async () => new Response(body, { status: 200 }),
      ) as unknown as typeof fetch;
      return { fetcher, pulled: () => pulled };
    }

    it("refuses an unterminated record past the record cap and stops reading", async () => {
      const chunk = 1024 * 1024;
      const { fetcher, pulled } = unterminated(8, chunk);
      const events = await collect(
        new OllamaProvider("http://localhost:11434", fetcher),
      );
      expect(events[events.length - 1]).toMatchObject({
        type: "failed",
        error: { code: "invalid-response", message: "record-too-large" },
      });
      // Three chunks reach the cap; the rest of the stream is cancelled, so
      // at most the one chunk pulled ahead is read.
      expect(pulled()).toBeLessThanOrEqual(5);
    });

    it("refuses a record that only ends past the cap, before the newline", async () => {
      // A single record spread over chunks and ended by a newline in the
      // last: the pending count refuses it on the byte that passes the cap,
      // not on the per-line check that would follow the newline.
      const half = MAX_RECORD_BYTES / 2;
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent === 2) {
            controller.enqueue(new TextEncoder().encode("x\n"));
            controller.close();
            return;
          }
          sent++;
          controller.enqueue(new Uint8Array(half).fill(0x78));
        },
      });
      const fetcher = vi.fn(
        async () => new Response(body, { status: 200 }),
      ) as unknown as typeof fetch;
      const events = await collect(
        new OllamaProvider("http://localhost:11434", fetcher),
      );
      expect(events[events.length - 1]).toMatchObject({
        type: "failed",
        error: { code: "invalid-response", message: "record-too-large" },
      });
    });

    it("keeps a record whose chunks end exactly at the cap", async () => {
      // Two halves and the newline in a third chunk: the record is exactly
      // the cap and is parsed; the stream then ends without `done: true`.
      const half = MAX_RECORD_BYTES / 2 - 1;
      const record = `{"message":{"content":"${"x".repeat(2 * half - 24)}"}}`;
      expect(new TextEncoder().encode(record).byteLength).toBe(
        MAX_RECORD_BYTES,
      );
      const bytes = new TextEncoder().encode(record);
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent === 0) controller.enqueue(bytes.subarray(0, half));
          else if (sent === 1) controller.enqueue(bytes.subarray(half));
          else if (sent === 2)
            controller.enqueue(new TextEncoder().encode("\n"));
          else controller.close();
          sent++;
        },
      });
      const fetcher = vi.fn(
        async () => new Response(body, { status: 200 }),
      ) as unknown as typeof fetch;
      const events = await collect(
        new OllamaProvider("http://localhost:11434", fetcher),
      );
      expect(events).toContainEqual({
        type: "text-delta",
        text: "x".repeat(2 * half - 24),
      });
      expect(events[events.length - 1]).toMatchObject({
        type: "failed",
        error: { code: "interrupted" },
      });
    });

    it("refuses a stream past the stream cap even in small records", async () => {
      // Each record passes the record cap; together they pass the stream
      // cap. The chunk is one record plus its newline, repeated.
      const record = new TextEncoder().encode(
        `${JSON.stringify({ message: { thinking: "t".repeat(1024 * 1024 - 64) } })}\n`,
      );
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent++ < 70) controller.enqueue(record);
          else controller.close();
        },
      });
      const fetcher = vi.fn(
        async () => new Response(body, { status: 200 }),
      ) as unknown as typeof fetch;
      const events = await collect(
        new OllamaProvider("http://localhost:11434", fetcher),
      );
      expect(events[events.length - 1]).toMatchObject({
        type: "failed",
        error: { code: "invalid-response", message: "stream-too-large" },
      });
      expect(sent).toBeLessThan(70);
    });
  });

  it("reports a network-level failure as a connection problem", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(
      await collect(new OllamaProvider("http://localhost:11434", offline)),
    ).toContainEqual({
      type: "failed",
      error: expect.objectContaining({
        code: "connection",
        retryable: true,
      }),
    });
  });

  it("retries metadata discovery once for a transient failure only", async () => {
    let calls = 0;
    const flaky = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return json({ models: [{ name: "qwen3:8b" }] });
    }) as unknown as typeof fetch;
    expect(
      await new OllamaProvider("http://localhost:11434", flaky).listModels(
        new AbortController().signal,
      ),
    ).toHaveLength(1);
    expect(calls).toBe(2);

    const rejected = vi.fn(
      async () => new Response("no", { status: 503 }),
    ) as unknown as typeof fetch;
    await expect(
      new OllamaProvider("http://localhost:11434", rejected).listModels(
        new AbortController().signal,
      ),
    ).rejects.toThrow("ollama-503");
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it("probes tool support with a synthetic round trip, cached by digest", async () => {
    let probeBudget = 0;
    const withTool = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          options?: { num_predict?: number };
        };
        probeBudget = body.options?.num_predict ?? 0;
        return new Response(
          `${JSON.stringify({
            message: {
              content: "",
              tool_calls: [
                { function: { name: "list_sources", arguments: { value: 1 } } },
              ],
            },
            done: true,
          })}\n`,
          { status: 200 },
        );
      },
    ) as unknown as typeof fetch;
    const provider = new OllamaProvider("http://localhost:11434", withTool);
    expect(
      await provider.probeTools(
        { providerId: "ollama", modelId: "m", modelRevision: "digest-1" },
        new AbortController().signal,
      ),
    ).toBe(true);
    // A thinking model spends output tokens before its tool call; a probe
    // budget too small for that mislabels a capable model as chat-only.
    expect(probeBudget).toBeGreaterThanOrEqual(512);
    expect(
      await provider.probeTools(
        { providerId: "ollama", modelId: "m", modelRevision: "digest-1" },
        new AbortController().signal,
      ),
    ).toBe(true);
    // The probe sends one chat request; `/api/ps` is the keep_alive read
    // after a model's first answer, not a second probe.
    expect(
      vi
        .mocked(withTool)
        .mock.calls.filter(([url]) => String(url).endsWith("/api/chat")),
    ).toHaveLength(1);

    const chatOnly = vi.fn(
      async () =>
        new Response(
          `${JSON.stringify({ message: { content: "no tool" }, done: true })}\n`,
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    expect(
      await new OllamaProvider("http://localhost:11434", chatOnly).probeTools(
        { providerId: "ollama", modelId: "m", modelRevision: "digest-2" },
        new AbortController().signal,
      ),
    ).toBe(false);
  });

  it("applies stage deadlines from its configuration", async () => {
    const hang = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;
    await expect(
      new OllamaProvider("http://localhost:11434", hang, {
        metadataMs: 5,
      }).listModels(new AbortController().signal),
    ).rejects.toThrow();

    const events = await collect(
      new OllamaProvider("http://localhost:11434", hang, {
        coldFirstOutputMs: 5,
      }),
    );
    expect(events).toContainEqual({
      type: "failed",
      error: expect.objectContaining({ code: "timeout", retryable: true }),
    });
  });

  it("gives a cold model the longer window and a warm one the ordinary window", async () => {
    let calls = 0;
    const onceThenHang = vi.fn(
      (url: string | URL | Request, init?: RequestInit) => {
        // The adapter also reads `/api/ps` once after a model's first answer;
        // this row is about the chat requests alone.
        if (String(url).endsWith("/api/ps"))
          return Promise.resolve(new Response("{}", { status: 404 }));
        calls += 1;
        if (calls === 1)
          return Promise.resolve(
            new Response(
              `${JSON.stringify({ message: { content: "warm" }, done: true })}\n`,
              { status: 200 },
            ),
          );
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      },
    ) as unknown as typeof fetch;
    const provider = new OllamaProvider(
      "http://localhost:11434",
      onceThenHang,
      {
        coldFirstOutputMs: 60_000,
        firstOutputMs: 5,
      },
    );
    const warm = await collect(provider);
    expect(warm).toContainEqual({ type: "completed", reason: "answer" });
    // The same model, now warm: the 5ms ordinary window applies, not the
    // 60s cold one.
    const stalled = await collect(provider);
    expect(stalled).toContainEqual({
      type: "failed",
      error: expect.objectContaining({ code: "timeout" }),
    });
    expect(calls).toBe(2);
  });

  // Nothing streams while the runtime reads the prompt, at about 25 tokens a
  // second on a CPU, so a flat window cuts off a long prompt before its first
  // token. Each window grows by the prompt at `prefillTokensPerSecond`, and
  // the step deadline bounds it.
  describe("the first-output window allows for reading the prompt", () => {
    const answer = () =>
      new Response(
        `${JSON.stringify({ message: { content: "ok" }, done: true })}
`,
        { status: 200 },
      );
    /**
     * Answers the first call immediately, which warms the model, and later
     * ones after `ms`.
     */
    function warmThenAfter(ms: number, where: "headers" | "body") {
      let calls = 0;
      return vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        calls += 1;
        if (calls === 1) return Promise.resolve(answer());
        if (where === "headers")
          return new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => resolve(answer()), ms);
            init?.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const timer = setTimeout(() => {
              controller.enqueue(
                new TextEncoder().encode(
                  `${JSON.stringify({ message: { content: "ok" }, done: true })}
`,
                ),
              );
              controller.close();
            }, ms);
            init?.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              controller.error(new DOMException("aborted", "AbortError"));
            });
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      }) as unknown as typeof fetch;
    }
    // A rate at which this request's prompt takes ~300 ms to read.
    const slow = (estimateRequestTokens(request).tokens * 1000) / 300;

    for (const where of ["headers", "body"] as const) {
      it(`waits on a warm model for its prompt, at the ${where}`, async () => {
        const provider = new OllamaProvider(
          "http://localhost:11434",
          warmThenAfter(60, where),
          { firstOutputMs: 5, prefillTokensPerSecond: slow },
        );
        await collect(provider);
        expect(await collect(provider)).toContainEqual({
          type: "completed",
          reason: "answer",
        });
      });
    }

    it("still times out a warm model on the base window when the prompt reads at once", async () => {
      const provider = new OllamaProvider(
        "http://localhost:11434",
        warmThenAfter(60, "body"),
        { firstOutputMs: 5, prefillTokensPerSecond: 1e12 },
      );
      await collect(provider);
      expect(await collect(provider)).toContainEqual({
        type: "failed",
        error: expect.objectContaining({ code: "timeout" }),
      });
    });

    // The step deadline, not this window, bounds a prompt too long to read.
    it("still ends a prompt too long to read at the step", async () => {
      const provider = new OllamaProvider(
        "http://localhost:11434",
        warmThenAfter(60_000, "body"),
        { firstOutputMs: 5, prefillTokensPerSecond: 1e-6, stepMs: 30 },
      );
      await collect(provider);
      expect(await collect(provider)).toContainEqual({
        type: "failed",
        error: expect.objectContaining({ code: "timeout" }),
      });
    });

    it("gives the step after a tools probe the cold window", async () => {
      // The probe runs at its own small `num_ctx`, so Ollama loads the model
      // again for the next real step.
      let calls = 0;
      const fetcher = vi.fn(
        (_url: string | URL | Request, init?: RequestInit) => {
          calls += 1;
          if (calls <= 2)
            return Promise.resolve(
              new Response(
                `${JSON.stringify({
                  message: {
                    content: "",
                    tool_calls: [
                      { function: { name: "list_sources", arguments: {} } },
                    ],
                  },
                  done: true,
                })}
`,
                { status: 200 },
              ),
            );
          // The real step: its headers take 60 ms, past the 5 ms warm window
          // and inside the cold one.
          return new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => resolve(answer()), 60);
            init?.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        },
      ) as unknown as typeof fetch;
      const provider = new OllamaProvider("http://localhost:11434", fetcher, {
        firstOutputMs: 5,
        coldFirstOutputMs: 5_000,
        prefillTokensPerSecond: 1e12,
      });
      await collect(provider);
      await provider.probeTools(
        { providerId: "ollama", modelId: request.model.modelId },
        new AbortController().signal,
      );
      expect(await collect(provider)).toContainEqual({
        type: "completed",
        reason: "answer",
      });
    });
  });

  // Ollama unloads a model idle past its keep_alive, so "warm" lasts only that
  // long after the model's last output, not for the process.
  it("gives a model idle past its keep_alive the cold window again", async () => {
    let clock = 0;
    let calls = 0;
    const fetcher = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) => {
        calls += 1;
        if (calls === 1)
          return Promise.resolve(
            new Response(
              `${JSON.stringify({ message: { content: "warm" }, done: true })}
`,
              { status: 200 },
            ),
          );
        // Later requests answer after 60 ms: past the 5 ms warm window,
        // inside the cold one.
        return new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              resolve(
                new Response(
                  `${JSON.stringify({ message: { content: "ok" }, done: true })}
`,
                  { status: 200 },
                ),
              ),
            60,
          );
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      },
    ) as unknown as typeof fetch;
    const provider = new OllamaProvider(
      "http://localhost:11434",
      fetcher,
      {
        firstOutputMs: 5,
        coldFirstOutputMs: 5_000,
        prefillTokensPerSecond: 1e12,
        keepAliveMs: 300_000,
      },
      () => clock,
    );
    await collect(provider);
    // Four minutes on: still loaded, so the warm window cuts the slow answer.
    clock = 240_000;
    expect(await collect(provider)).toContainEqual({
      type: "failed",
      error: expect.objectContaining({ code: "timeout" }),
    });
    // Six minutes on: unloaded, so the cold window lets the load finish.
    clock = 360_000;
    expect(await collect(provider)).toContainEqual({
      type: "completed",
      reason: "answer",
    });
  });

  // The writer's keep_alive is read from `/api/ps` after the model's first
  // answer, so an `OLLAMA_KEEP_ALIVE` the browser cannot see decides when the
  // model counts as cold.
  describe("keep_alive as Ollama reports it", () => {
    function running(ps: unknown) {
      let chats = 0;
      const fetcher = vi.fn(
        (url: string | URL | Request, init?: RequestInit) => {
          if (String(url).endsWith("/api/ps"))
            return Promise.resolve(
              new Response(JSON.stringify(ps), { status: 200 }),
            );
          chats += 1;
          const body = `${JSON.stringify({ message: { content: "ok" }, done: true })}
`;
          if (chats === 1)
            return Promise.resolve(new Response(body, { status: 200 }));
          // Later answers take 60 ms: past the 5 ms warm window, inside
          // the cold one.
          return new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(
              () => resolve(new Response(body, { status: 200 })),
              60,
            );
            init?.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        },
      ) as unknown as typeof fetch;
      let clock = 0;
      const provider = new OllamaProvider(
        "http://localhost:11434",
        fetcher,
        {
          firstOutputMs: 5,
          coldFirstOutputMs: 5_000,
          prefillTokensPerSecond: 1e12,
          keepAliveMs: 300_000,
        },
        () => clock,
      );
      return {
        provider,
        at: (ms: number) => {
          clock = ms;
        },
      };
    }
    // The read is never awaited by the answer; let it land.
    const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

    it("keeps a model warm for the keep_alive Ollama reports, past the default", async () => {
      const { provider, at } = running({
        models: [
          {
            name: request.model.modelId,
            expires_at: new Date(3_600_000).toISOString(),
          },
        ],
      });
      await collect(provider);
      await settle();
      // Six minutes idle, under the writer's hour: still loaded, so the
      // warm window applies and cuts the slow answer.
      at(360_000);
      expect(await collect(provider)).toContainEqual({
        type: "failed",
        error: expect.objectContaining({ code: "timeout" }),
      });
    });

    it("treats a model Ollama has already unloaded as cold at once", async () => {
      const { provider } = running({ models: [] });
      await collect(provider);
      await settle();
      // keep_alive 0: gone the moment it answered, so no time has to pass.
      expect(await collect(provider)).toContainEqual({
        type: "completed",
        reason: "answer",
      });
    });
  });

  describe("once the answer is streaming", () => {
    /**
     * A body that sends one delta and then holds, as a local model does
     * between tokens, and errors when its request's signal aborts, as a real
     * `fetch` does to a body already being read. A fake that finishes or
     * hangs before the headers cannot show Stop failing after them.
     */
    function firstTokenThenHold() {
      const fetcher = vi.fn(
        async (_url: string | URL | Request, init?: RequestInit) => {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  `${JSON.stringify({ message: { content: "Half" } })}
`,
                ),
              );
              init?.signal?.addEventListener("abort", () =>
                controller.error(new DOMException("aborted", "AbortError")),
              );
            },
          });
          return new Response(body, { status: 200 });
        },
      ) as unknown as typeof fetch;
      return fetcher;
    }

    it("stops when the writer presses Stop after the first token", async () => {
      // The caller's abort must keep reaching the request after the headers
      // arrive. Otherwise Stop reaches nothing while the answer streams, the
      // stream runs to its end, and an edit's Undo waits for it.
      const stop = new AbortController();
      const events: unknown[] = [];
      for await (const event of new OllamaProvider(
        "http://localhost:11434",
        firstTokenThenHold(),
      ).generate(request, stop.signal)) {
        events.push(event);
        if ((event as { type: string }).type === "text-delta")
          stop.abort("writer stopped");
      }
      expect(events).toContainEqual({ type: "text-delta", text: "Half" });
      expect(events).toContainEqual({
        type: "failed",
        error: expect.objectContaining({ code: "cancelled", retryable: false }),
      });
    });

    it("gives up on a stream that stalls mid-answer", async () => {
      // The inactivity deadline aborts the same controller, so it must reach
      // the body too.
      const events = await collect(
        // Both idle windows short: which one the first chunk arms belongs to
        // `StreamDeadlines`, and this row asks only whether any deadline
        // reaches the body.
        new OllamaProvider("http://localhost:11434", firstTokenThenHold(), {
          coldFirstOutputMs: 5,
          inactivityMs: 5,
        }),
      );
      expect(events).toContainEqual({
        type: "failed",
        error: expect.objectContaining({ code: "timeout", retryable: true }),
      });
    });
  });
});
