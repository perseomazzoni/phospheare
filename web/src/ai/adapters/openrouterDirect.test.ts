// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { OpenRouterDirectProvider } from "./openrouterDirect";
import type { OpenRouterDirectOptions } from "./openrouterDirect";
import { directInit } from "./directWire";
import type { ModelProvider } from "../ports";
import type { ModelEvent, ModelFailure, ModelRequest } from "../domain/types";
import { isFreeModel } from "../domain/types";
import { ModelRunError } from "../application/runStep";

// Pins what only this adapter has: the body it builds and the gate that
// refuses before sending, the refusal table read off a status, the SSE
// stream decoded in the tab with its deadlines, and the account hooks. The
// fetcher speaks the vendor's wire, so what is checked is the protocol.

const TIMEOUTS = {
  metadataMs: 50,
  firstOutputMs: 60,
  inactivityMs: 60,
  stepMs: 400,
};

const MODELS = {
  data: [
    {
      id: "vendor/some-model",
      name: "Vendor: Some Model",
      context_length: 128_000,
      architecture: { output_modalities: ["text"] },
      top_provider: { max_completion_tokens: 16_384 },
      supported_parameters: ["tools", "structured_outputs", "temperature"],
      pricing: { prompt: "0.0000001", completion: "0.0000005" },
    },
    {
      id: "vendor/thinker:free",
      name: "",
      context_length: null,
      top_provider: { max_completion_tokens: 200_000 },
      supported_parameters: ["reasoning", "tools"],
      reasoning: {
        supported_efforts: ["max", "high", "medium", "low", "turbo"],
        default_effort: "medium",
      },
      pricing: { prompt: "0", completion: "0" },
    },
    {
      id: "vendor/painter",
      architecture: { output_modalities: ["image"] },
      supported_parameters: [],
    },
    { id: "vendor/online:online", supported_parameters: [] },
    { id: "@preset/mine", supported_parameters: [] },
    { id: "vendor/bad id", supported_parameters: [] },
    {
      id: "vendor/half-price",
      pricing: { prompt: "0.1" },
      supported_parameters: ["temperature"],
    },
    {
      id: "vendor/odd-price",
      pricing: { prompt: "free", completion: "0" },
      supported_parameters: [],
    },
    {
      id: "vendor/huge-price",
      pricing: { prompt: "1e400", completion: "0" },
      supported_parameters: [],
    },
  ],
};

const KEY = "sk-or-v1-test";

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    model: { providerId: "openrouter", modelId: "vendor/some-model" },
    instructions: "Answer directly.",
    messages: [{ role: "user", content: "Is it sharp?" }],
    tools: [],
    limits: { inputTokens: 8_000, outputTokens: 1_000 },
    ...overrides,
  };
}

const encoder = new TextEncoder();
const frame = (body: unknown) => `data: ${JSON.stringify(body)}\n\n`;
const delta = (
  d: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => frame({ model: "vendor/some-model", choices: [{ delta: d, ...extra }] });
const DONE = "data: [DONE]\n\n";

/** An SSE body, its chunks delivered in order and each ended chunk honoured. */
function sse(...chunks: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

const ANSWER = [
  delta({ content: "It is " }),
  delta({ content: "sharp." }, { finish_reason: "stop" }),
  frame({
    choices: [],
    usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.0002 },
  }),
  DONE,
];

interface Call {
  url: string;
  init: RequestInit;
}

type Answer = (init: RequestInit, url: string) => Response | Promise<Response>;

/**
 * A vendor that answers the catalogue and the key-info route normally and
 * the chat as told. It honours `signal` as a browser does: the fetch rejects
 * when the signal is already aborted.
 */
function vendor(
  chat: Answer,
  options: Partial<OpenRouterDirectOptions> & { keyInfo?: Answer } = {},
) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (init.signal?.aborted)
      throw new DOMException("The operation was aborted.", "AbortError");
    if (url.endsWith("/models"))
      return new Response(JSON.stringify(MODELS), { status: 200 });
    if (url.endsWith("/key"))
      return options.keyInfo
        ? options.keyInfo(init, url)
        : new Response(JSON.stringify({ data: { limit: 5 } }), { status: 200 });
    return chat(init, url);
  };
  const provider = new OpenRouterDirectProvider("openrouter", {
    fetcher,
    apiKey: () => KEY,
    attribution: { title: "Phospheare" },
    timeouts: TIMEOUTS,
    ...options,
  });
  const chats = () =>
    calls.filter((call) => call.url.endsWith("/chat/completions"));
  return { calls, chats, provider };
}

async function collect(
  provider: ModelProvider,
  req = request(),
  signal = new AbortController().signal,
): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of provider.generate(req, signal)) events.push(event);
  return events;
}

const last = (events: ModelEvent[]) => events[events.length - 1];
const sentBody = (call: Call | undefined) =>
  JSON.parse(new TextDecoder().decode(call?.init.body as Uint8Array)) as Record<
    string,
    unknown
  >;

// ── Where the bytes go ───────────────────────────────────────────────────────

describe("which side of the port the provider is on", () => {
  it("is remote, going straight to the vendor's API", async () => {
    const { provider } = vendor(() => sse(...ANSWER));
    expect(provider.destination).toEqual({
      via: "direct",
      endpoint: "https://openrouter.ai/api/v1",
    });
    expect(provider.upstreamHost).toBe("openrouter.ai");
    const models = await provider.listModels(new AbortController().signal);
    expect(models.every((model) => model.kind === "remote")).toBe(true);
  });

  it("has no probeTools, because absence is the answer", () => {
    const { provider } = vendor(() => sse(...ANSWER));
    expect((provider as ModelProvider).probeTools).toBeUndefined();
  });
});

// ── The catalogue ────────────────────────────────────────────────────────────

describe("the catalogue", () => {
  it("offers only what a request may name, with a text output", async () => {
    const { provider } = vendor(() => sse(...ANSWER));
    const ids = (await provider.listModels(new AbortController().signal)).map(
      (model) => model.id,
    );
    expect(ids).toEqual([
      "vendor/some-model",
      "vendor/thinker:free",
      "vendor/half-price",
      "vendor/odd-price",
      "vendor/huge-price",
    ]);
  });

  it("projects each model's capabilities, limits and price", async () => {
    const { provider } = vendor(() => sse(...ANSWER));
    const signal = new AbortController().signal;
    expect(await provider.describeModel(request().model, signal)).toEqual({
      id: "vendor/some-model",
      providerId: "openrouter",
      label: "Vendor: Some Model",
      kind: "remote",
      capabilities: { tools: true, structuredOutput: true, reasoning: false },
      contextTokens: 128_000,
      maxOutputTokens: 16_384,
      pricing: {
        promptUsdPerMillion: expect.closeTo(0.1, 12),
        completionUsdPerMillion: expect.closeTo(0.5, 12),
      },
    });
    const thinker = await provider.describeModel(
      { providerId: "openrouter", modelId: "vendor/thinker:free" },
      signal,
    );
    expect(thinker).toMatchObject({
      label: "vendor/thinker:free",
      contextTokens: undefined,
      maxOutputTokens: 32_000,
      capabilities: {
        tools: true,
        structuredOutput: false,
        reasoning: true,
        fixedTemperature: true,
        efforts: ["low", "medium", "high", "max"],
        defaultEffort: "medium",
      },
    });
    expect(isFreeModel(thinker)).toBe(true);
  });

  it("states no price rather than half of one, or one that is not a number", async () => {
    const { provider } = vendor(() => sse(...ANSWER));
    const signal = new AbortController().signal;
    for (const modelId of [
      "vendor/half-price",
      "vendor/odd-price",
      "vendor/huge-price",
    ]) {
      const model = await provider.describeModel(
        { providerId: "openrouter", modelId },
        signal,
      );
      expect(model.pricing).toBeUndefined();
      expect(isFreeModel(model)).toBe(false);
    }
  });

  it("refuses to describe a model it does not list", async () => {
    const { provider } = vendor(() => sse(...ANSWER));
    await expect(
      provider.describeModel(
        { providerId: "openrouter", modelId: "vendor/online:online" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("openrouter-unknown-model");
  });

  it("asks once, with the key and the three controls, and remembers", async () => {
    const { calls, provider } = vendor(() => sse(...ANSWER));
    const signal = new AbortController().signal;
    await provider.listModels(signal);
    await provider.listModels(signal);
    await provider.describeModel(request().model, signal);
    const reads = calls.filter((call) => call.url.endsWith("/models"));
    expect(reads).toHaveLength(1);
    expect(reads[0]?.url).toBe("https://openrouter.ai/api/v1/models");
    expect(reads[0]?.init).toMatchObject({
      method: "GET",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Authorization: `Bearer ${KEY}` },
    });
  });

  it("asks with no credential when there is no key", async () => {
    const { calls, provider } = vendor(() => sse(...ANSWER), {
      apiKey: () => null,
    });
    await provider.listModels(new AbortController().signal);
    expect(calls[0]?.init.headers).toBeUndefined();
  });

  it("answers no models when the read fails, and asks again only after a backoff", async () => {
    let now = 1_000;
    let up = false;
    const fetcher: typeof fetch = async () =>
      up
        ? new Response(JSON.stringify(MODELS), { status: 200 })
        : new Response("down", { status: 503 });
    const spy = vi.fn(fetcher);
    const provider = new OpenRouterDirectProvider("openrouter", {
      fetcher: spy,
      apiKey: () => KEY,
      attribution: { title: "t" },
      timeouts: TIMEOUTS,
      now: () => now,
    });
    const signal = new AbortController().signal;

    expect(await provider.listModels(signal)).toEqual([]);
    up = true;
    expect(await provider.listModels(signal)).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
    now += 30_001;
    expect(await provider.listModels(signal)).toHaveLength(5);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("describes a turn's model by reading again, whatever the list's backoff", async () => {
    let up = false;
    const spy = vi.fn<typeof fetch>(async () =>
      up
        ? new Response(JSON.stringify(MODELS), { status: 200 })
        : new Response("down", { status: 503 }),
    );
    const provider = new OpenRouterDirectProvider("openrouter", {
      fetcher: spy,
      apiKey: () => KEY,
      attribution: { title: "t" },
      timeouts: TIMEOUTS,
      now: () => 1_000,
    });
    const signal = new AbortController().signal;

    expect(await provider.listModels(signal)).toEqual([]);
    up = true;
    // The list waits out its backoff; a turn waiting on its model does not.
    await expect(
      provider.describeModel(request().model, signal),
    ).resolves.toMatchObject({ id: "vendor/some-model" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("fails a turn whose catalogue cannot be read as a connection, never as an unknown model", async () => {
    const spy = vi.fn<typeof fetch>(
      async () => new Response("down", { status: 503 }),
    );
    const provider = new OpenRouterDirectProvider("openrouter", {
      fetcher: spy,
      apiKey: () => KEY,
      attribution: { title: "t" },
      timeouts: TIMEOUTS,
      now: () => 1_000,
    });
    const signal = new AbortController().signal;

    for (const attempt of [1, 2]) {
      const error = await provider
        .describeModel(request().model, signal)
        .catch((caught: unknown) => caught);
      // `ModelRunError` is what the turn reads its failure code from.
      expect(error).toBeInstanceOf(ModelRunError);
      expect((error as ModelRunError).failure).toMatchObject({
        code: "connection",
        retryable: true,
      });
      expect(String((error as Error).message)).not.toContain("unknown-model");
      // No failure is remembered: each turn asks again.
      expect(spy).toHaveBeenCalledTimes(attempt);
    }
  });

  it("reads the public catalogue without a key the vendor refuses", async () => {
    const calls: RequestInit[] = [];
    const provider = new OpenRouterDirectProvider("openrouter", {
      fetcher: async (_input, init = {}) => {
        calls.push(init);
        return init.headers
          ? new Response("", { status: 401 })
          : new Response(JSON.stringify(MODELS), { status: 200 });
      },
      apiKey: () => KEY,
      attribution: { title: "t" },
      timeouts: TIMEOUTS,
    });

    // A revoked key still has to reach the custody check, which offers the
    // renewal; failing the catalogue would end the turn before it.
    await expect(
      provider.describeModel(request().model, new AbortController().signal),
    ).resolves.toMatchObject({ id: "vendor/some-model" });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers).toEqual({ Authorization: `Bearer ${KEY}` });
    expect(calls[1]?.headers).toBeUndefined();
  });

  it("answers no models for an empty or shapeless list, and for a silent vendor", async () => {
    for (const answer of [{ data: [] }, { models: [] }, []]) {
      const provider = new OpenRouterDirectProvider("openrouter", {
        fetcher: async () =>
          new Response(JSON.stringify(answer), { status: 200 }),
        apiKey: () => KEY,
        attribution: { title: "t" },
        timeouts: TIMEOUTS,
      });
      expect(await provider.listModels(new AbortController().signal)).toEqual(
        [],
      );
    }
    const silent = new OpenRouterDirectProvider("openrouter", {
      fetcher: (_input, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("x", "AbortError")),
          ),
        ),
      apiKey: () => KEY,
      attribution: { title: "t" },
      timeouts: TIMEOUTS,
    });
    expect(await silent.listModels(new AbortController().signal)).toEqual([]);
  });

  it("still rejects when the caller abandons the read", async () => {
    const provider = new OpenRouterDirectProvider("openrouter", {
      fetcher: (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          const fail = () =>
            reject(new DOMException(String(signal?.reason), "AbortError"));
          // A browser rejects at once for a signal already aborted.
          if (signal?.aborted) fail();
          else signal?.addEventListener("abort", fail);
        }),
      apiKey: () => KEY,
      attribution: { title: "t" },
      timeouts: TIMEOUTS,
    });
    const caller = new AbortController();
    const listing = provider.listModels(caller.signal);
    caller.abort("the pane closed");
    await expect(listing).rejects.toThrow("the pane closed");
  });
});

// ── What leaves ──────────────────────────────────────────────────────────────

describe("what this adapter sends", () => {
  it("builds the vendor's streamed body, every field written out", async () => {
    const { chats, provider } = vendor(() => sse(...ANSWER));
    await collect(provider);
    expect(chats()).toHaveLength(1);
    expect(chats()[0]?.url).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    expect(sentBody(chats()[0])).toEqual({
      model: "vendor/some-model",
      messages: [
        { role: "system", content: "Answer directly." },
        { role: "user", content: "Is it sharp?" },
      ],
      stream: true,
      stream_options: { include_usage: true },
      provider: { data_collection: "deny" },
      max_tokens: 1_000,
    });
  });

  it("carries the key, the stream, the attribution and the three controls", async () => {
    const { chats, provider } = vendor(() => sse(...ANSWER), {
      attribution: {
        title: "Phospheare\r\nWriting Desk\u0000" + "x".repeat(80),
        referer: "https://phospheare.example/app/?book=x#y",
      },
    });
    await collect(provider);
    const init = chats()[0]?.init;
    expect(init).toMatchObject({
      method: "POST",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Accept).toBe("text/event-stream");
    expect(headers["X-Title"]).toMatch(/^Phospheare Writing Desk x+$/);
    expect(Array.from(headers["X-Title"] ?? "")).toHaveLength(60);
    expect(headers["HTTP-Referer"]).toBe("https://phospheare.example/app/");
  });

  it("keeps the title to what a header can carry, and sends none when nothing is left", async () => {
    // `fetch` rejects a header value outside Latin-1, which would fail every
    // request before it left.
    const named = vendor(() => sse(...ANSWER), {
      attribution: { title: "Café Studio ✨" },
    });
    await collect(named.provider);
    expect(named.chats()[0]?.init.headers).toMatchObject({
      "X-Title": "Café Studio",
    });

    const blank = vendor(() => sse(...ANSWER), {
      attribution: { title: "✨\r\n" },
    });
    expect(last(await collect(blank.provider))).toEqual({
      type: "completed",
      reason: "answer",
    });
    expect(blank.chats()[0]?.init.headers).not.toHaveProperty("X-Title");
  });

  it("sends no referer unless one is given and is http(s)", async () => {
    for (const referer of [undefined, "", "javascript:alert(1)", "not a url"]) {
      const { chats, provider } = vendor(() => sse(...ANSWER), {
        attribution: { title: "T", referer },
      });
      await collect(provider);
      expect(chats()[0]?.init.headers).not.toHaveProperty("HTTP-Referer");
    }
  });

  it("keeps the three controls even when a caller hands in its own", () => {
    const hostile = {
      credentials: "include",
      redirect: "follow",
      referrerPolicy: "unsafe-url",
    } as RequestInit;
    expect(directInit(hostile)).toMatchObject({
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  });

  it("adds a temperature only when chosen, and an effort as the vendor's object", async () => {
    const { chats, provider } = vendor(() => sse(...ANSWER));
    await collect(provider, request({ temperature: 0.3, effort: "high" }));
    expect(sentBody(chats()[0])).toMatchObject({
      temperature: 0.3,
      reasoning: { effort: "high" },
    });
    expect(sentBody(chats()[0])).not.toHaveProperty("reasoning_effort");
  });

  it("declares tools, forbids calling them when the step may call none, and keeps {} a schema", async () => {
    const tools = [
      {
        name: "list_sources" as const,
        description: "List them.",
        inputSchema: {},
      },
    ];
    const { chats, provider } = vendor(() => sse(...ANSWER));
    await collect(provider, request({ tools, toolChoice: "none" }));
    expect(sentBody(chats()[0])).toMatchObject({
      tools: [
        {
          type: "function",
          function: {
            name: "list_sources",
            description: "List them.",
            parameters: {},
          },
        },
      ],
      tool_choice: "none",
    });
    await collect(provider, request({ tools }));
    expect(sentBody(chats()[1])).not.toHaveProperty("tool_choice");
    await collect(provider);
    expect(sentBody(chats()[2])).not.toHaveProperty("tools");
  });

  it("asks for a strict schema only when the step has one", async () => {
    const { chats, provider } = vendor(() => sse(...ANSWER));
    const schema = {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    };
    await collect(provider, request({ output: { name: "verdict", schema } }));
    expect(sentBody(chats()[0]).response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "verdict", strict: true, schema },
    });
  });

  it("replays a tool loop: calls as strings, results by id, working as reasoning.* only", async () => {
    const { chats, provider } = vendor(() => sse(...ANSWER));
    await collect(
      provider,
      request({
        tools: [
          {
            name: "grep",
            description: "Search.",
            inputSchema: { type: "object" },
          },
        ],
        messages: [
          { role: "user", content: "Find it." },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "c1", name: "grep", arguments: { q: "x" } }],
            blocks: [
              {
                replay: [
                  { type: "reasoning.text", text: "why", index: 0 },
                  { type: "vendor.secret", data: "no" },
                ],
              },
              { role: "system" },
            ],
          },
          {
            role: "tool",
            content: "found",
            toolCallId: "c1",
            toolName: "grep",
          },
        ],
      }),
    );
    const messages = sentBody(chats()[0]).messages as Record<string, unknown>[];
    expect(messages[2]).toEqual({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "c1",
          type: "function",
          function: { name: "grep", arguments: '{"q":"x"}' },
        },
      ],
      reasoning_details: [{ type: "reasoning.text", text: "why", index: 0 }],
    });
    expect(messages[3]).toEqual({
      role: "tool",
      content: "found",
      tool_call_id: "c1",
    });
  });

  it("sends no reasoning_details when nothing of the replay is reasoning", async () => {
    const { chats, provider } = vendor(() => sse(...ANSWER));
    await collect(
      provider,
      request({
        messages: [
          { role: "user", content: "Find it." },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "c1", name: "grep", arguments: "{}" }],
            blocks: [{ replay: [{ type: "vendor.secret", data: "no" }] }],
          },
          { role: "tool", content: "found", toolCallId: "c1" },
        ],
      }),
    );
    const messages = sentBody(chats()[0]).messages as Record<string, unknown>[];
    expect(messages[2]).not.toHaveProperty("reasoning_details");
    expect(messages[2]).not.toHaveProperty("replay");
  });
});

// ── Refused before anything leaves ───────────────────────────────────────────

describe("refused before sending", () => {
  it.each([
    "vendor/x:online",
    "vendor/x:nitro",
    "@preset/mine",
    "vendor/x:free:batch",
    "vendor/x y",
    "a".repeat(201),
  ])("refuses the model id %j without a fetch", async (modelId) => {
    const { chats, provider } = vendor(() => sse(...ANSWER));
    const events = await collect(
      provider,
      request({ model: { providerId: "openrouter", modelId } }),
    );
    expect(chats()).toHaveLength(0);
    expect(events).toEqual([
      {
        type: "failed",
        error: {
          code: "provider-rejected",
          message: "The request could not be sent: model.",
          retryable: false,
        },
      },
    ]);
  });

  it("forwards the listed variants", async () => {
    for (const modelId of [
      "vendor/x:free",
      "vendor/x:batch",
      "~vendor/x-latest",
    ]) {
      const { chats, provider } = vendor(() => sse(...ANSWER));
      await collect(
        provider,
        request({ model: { providerId: "openrouter", modelId } }),
      );
      expect(chats()).toHaveLength(1);
    }
  });

  it.each([
    [{ limits: { inputTokens: 1, outputTokens: 32_001 } }, "max_tokens"],
    [{ limits: { inputTokens: 1, outputTokens: 0 } }, "max_tokens"],
    [{ temperature: 2.5 }, "temperature"],
    [{ effort: "turbo" }, "reasoning_effort"],
    [
      { messages: [{ role: "user" as const, content: "  " }] },
      "messages.1.content",
    ],
    [{ instructions: "" }, "messages.0.content"],
  ])("refuses %j, naming %s", async (overrides, field) => {
    const { chats, provider } = vendor(() => sse(...ANSWER));
    const events = await collect(
      provider,
      request(overrides as Partial<ModelRequest>),
    );
    expect(chats()).toHaveLength(0);
    expect(last(events)).toMatchObject({
      type: "failed",
      error: {
        code: "provider-rejected",
        message: `The request could not be sent: ${field}.`,
      },
    });
  });

  it("refuses a conversation past its size as too large", async () => {
    const { chats, provider } = vendor(() => sse(...ANSWER));
    const events = await collect(
      provider,
      request({ messages: [{ role: "user", content: "x".repeat(1_500_001) }] }),
    );
    expect(chats()).toHaveLength(0);
    expect(last(events)).toMatchObject({
      type: "failed",
      error: { code: "context-too-large", retryable: false },
    });
  });

  it("refuses a replay that is not a short list of flat items", async () => {
    const { chats, provider } = vendor(() => sse(...ANSWER));
    const events = await collect(
      provider,
      request({
        messages: [
          { role: "user", content: "Find it." },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "c1", name: "grep", arguments: "{}" }],
            blocks: [
              { replay: [{ type: "reasoning.text", nested: { deep: 1 } }] },
            ],
          },
          { role: "tool", content: "found", toolCallId: "c1" },
        ],
      }),
    );
    expect(chats()).toHaveLength(0);
    expect(last(events)).toMatchObject({
      type: "failed",
      error: { message: "The request could not be sent: messages.2.replay." },
    });
  });

  it("says not-configured when there is no key, and sends nothing", async () => {
    for (const apiKey of [
      () => null,
      () => "  ",
      () => Promise.resolve(null),
      () => {
        throw new Error("vault");
      },
    ]) {
      const { calls, provider } = vendor(() => sse(...ANSWER), { apiKey });
      expect(await collect(provider)).toEqual([
        {
          type: "failed",
          error: {
            code: "not-configured",
            message: "No model provider is connected.",
            retryable: false,
          },
        },
      ]);
      expect(calls).toHaveLength(0);
    }
  });

  it("refuses by the host's custody check, tells the account, and sends nothing", async () => {
    const onKeyRefused = vi.fn();
    const onSpent = vi.fn();
    const verdict: ModelFailure = {
      code: "limit-reached",
      message: "spent",
      retryable: false,
    };
    const beforeSend = vi.fn(async () => verdict);
    const { calls, provider } = vendor(() => sse(...ANSWER), {
      beforeSend,
      onKeyRefused,
      onSpent,
    });
    expect(await collect(provider)).toEqual([
      { type: "failed", error: verdict },
    ]);
    expect(calls).toHaveLength(0);
    expect(beforeSend).toHaveBeenCalledTimes(1);
    expect(onKeyRefused).toHaveBeenCalledTimes(1);
    expect(onSpent).not.toHaveBeenCalled();
  });

  it("refuses when the custody check cannot be made", async () => {
    const { calls, provider } = vendor(() => sse(...ANSWER), {
      beforeSend: async () => {
        throw new Error("offline");
      },
    });
    expect(last(await collect(provider))).toMatchObject({
      type: "failed",
      error: { code: "connection", retryable: true },
    });
    expect(calls).toHaveLength(0);
  });

  it("sends nothing for a run already stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    const { calls, provider } = vendor(() => sse(...ANSWER));
    expect(await collect(provider, request(), controller.signal)).toEqual([
      {
        type: "failed",
        error: {
          code: "cancelled",
          message: "Request cancelled",
          retryable: false,
        },
      },
    ]);
    expect(calls).toHaveLength(0);
  });
});

// ── The vendor's refusals ────────────────────────────────────────────────────

describe("a refusal the vendor answered with a status", () => {
  const refuse =
    (
      status: number,
      body: unknown = { error: { message: "the vendor echoes the prompt" } },
      headers: HeadersInit = {},
    ) =>
    () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      });

  it.each([
    [401, "key-expired", false],
    [403, "key-expired", false],
    [402, "credit-exhausted", false],
    [400, "provider-rejected", false],
    [404, "provider-rejected", false],
    [500, "connection", true],
    [503, "connection", true],
  ] as const)("reads a %i as %s", async (status, code, retryable) => {
    const { provider } = vendor(refuse(status));
    const events = await collect(provider);
    expect(events).toHaveLength(1);
    expect(last(events)).toMatchObject({
      type: "failed",
      error: { code, retryable },
    });
    expect(JSON.stringify(events)).not.toContain("echoes");
  });

  it("reads a 408 as a timeout worth another try", async () => {
    const { provider } = vendor(refuse(408));
    expect(last(await collect(provider))).toMatchObject({
      type: "failed",
      error: { code: "timeout", retryable: true },
    });
  });

  // The vendor answers 402 both for an account with no credit and for a key
  // past its own limit; one bounded reading of the key tells them apart.
  it("reads a 402 as limit-reached when the key's own limit is spent", async () => {
    const onKeyRefused = vi.fn();
    const { calls, provider } = vendor(refuse(402), {
      onKeyRefused,
      keyInfo: () =>
        new Response(
          JSON.stringify({
            data: {
              limit: 5,
              limit_remaining: 0,
              usage: 5,
              byok_usage: 0,
              include_byok_in_limit: true,
            },
          }),
          { status: 200 },
        ),
    });

    expect(last(await collect(provider))).toMatchObject({
      type: "failed",
      error: { code: "limit-reached", retryable: false },
    });
    expect(calls.filter((call) => call.url.endsWith("/key"))).toHaveLength(1);
    expect(onKeyRefused).toHaveBeenCalledTimes(1);
  });

  it("reads a 402 as credit-exhausted when the key cannot be read", async () => {
    const { provider } = vendor(refuse(402), {
      keyInfo: () => new Response("", { status: 500 }),
    });
    expect(last(await collect(provider))).toMatchObject({
      error: { code: "credit-exhausted" },
    });
  });

  it("tells the account to look again after a refusal over the key, and charges nothing", async () => {
    for (const status of [401, 403, 402]) {
      const onKeyRefused = vi.fn();
      const onSpent = vi.fn();
      const { provider } = vendor(refuse(status), { onKeyRefused, onSpent });
      await collect(provider);
      expect(onKeyRefused).toHaveBeenCalledTimes(1);
      expect(onSpent).not.toHaveBeenCalled();
    }
    const onKeyRefused = vi.fn();
    await collect(vendor(refuse(500), { onKeyRefused }).provider);
    expect(onKeyRefused).not.toHaveBeenCalled();
  });

  it("reads the data-policy 404 as no private host", async () => {
    const { provider } = vendor(
      refuse(404, {
        error: {
          message:
            "No endpoints found matching your data policy (Paid model training)",
        },
      }),
    );
    expect(last(await collect(provider))).toMatchObject({
      type: "failed",
      error: { code: "no-private-host", retryable: false },
    });
  });

  it("reads a 429 with no rate-limit headers anywhere as a busy model", async () => {
    const { provider } = vendor(
      refuse(429, { error: { code: 429, metadata: { raw: "upstream busy" } } }),
    );
    expect(last(await collect(provider))).toMatchObject({
      type: "failed",
      error: { code: "model-busy", retryable: true },
    });
  });

  it("reads the vendor's own limits from the headers its body repeats, and its wait", async () => {
    const { provider } = vendor(
      refuse(429, {
        error: {
          code: 429,
          metadata: {
            headers: { "X-RateLimit-Limit": "20", "Retry-After": "12" },
          },
        },
      }),
    );
    expect(last(await collect(provider))).toMatchObject({
      type: "failed",
      error: { code: "rate-limited", retryable: true, retryAfterMs: 12_000 },
    });
  });

  it("reads rate-limit headers the browser can see, and a Retry-After header", async () => {
    const { provider } = vendor(
      refuse(429, {}, { "X-RateLimit-Remaining": "0", "Retry-After": "7" }),
    );
    expect(last(await collect(provider))).toMatchObject({
      type: "failed",
      error: { code: "rate-limited", retryAfterMs: 7_000 },
    });
  });

  it.each(["0", "3601", "soon", "-1"])(
    "believes no Retry-After of %j",
    async (value) => {
      const { provider } = vendor(
        refuse(429, {}, { "X-RateLimit-Limit": "1", "Retry-After": value }),
      );
      const end = last(await collect(provider));
      expect(end).toMatchObject({
        type: "failed",
        error: { code: "rate-limited" },
      });
      expect(
        (end as { error: ModelFailure }).error.retryAfterMs,
      ).toBeUndefined();
    },
  );

  it("reads a free variant's spent day as a used-up quota, by the key's own count", async () => {
    const keyInfo = vi.fn(
      () =>
        new Response(
          JSON.stringify({
            data: {
              limit: 5,
              free_model_daily_requests: { limit: 50, remaining: 0, used: 50 },
            },
          }),
          { status: 200 },
        ),
    );
    const { calls, provider } = vendor(refuse(429, { error: { code: 429 } }), {
      keyInfo,
    });
    const events = await collect(
      provider,
      request({
        model: { providerId: "openrouter", modelId: "vendor/thinker:free" },
      }),
    );
    expect(last(events)).toMatchObject({
      type: "failed",
      error: { code: "quota-exhausted", retryable: false },
    });
    const read = calls.find((call) => call.url.endsWith("/key"));
    expect(read?.init.headers).toEqual({ Authorization: `Bearer ${KEY}` });
  });

  it("takes the milder reading when the free count is left or cannot be read", async () => {
    const left = vendor(
      refuse(429, {
        error: { metadata: { headers: { "x-ratelimit-limit": "20" } } },
      }),
      {
        keyInfo: () =>
          new Response(
            JSON.stringify({
              data: { free_model_daily_requests: { remaining: 3 } },
            }),
            { status: 200 },
          ),
      },
    );
    const free = request({
      model: { providerId: "openrouter", modelId: "vendor/thinker:free" },
    });
    expect(last(await collect(left.provider, free))).toMatchObject({
      error: { code: "rate-limited" },
    });

    const unknown = vendor(refuse(429, {}), {
      keyInfo: () => new Response("x", { status: 500 }),
    });
    expect(last(await collect(unknown.provider, free))).toMatchObject({
      error: { code: "model-busy" },
    });
  });

  it("never asks about a paid model's free requests", async () => {
    const keyInfo = vi.fn(() => new Response("{}", { status: 200 }));
    const { provider } = vendor(refuse(429, {}), { keyInfo });
    await collect(provider);
    expect(keyInfo).not.toHaveBeenCalled();
  });

  it("survives a refusal whose body is not JSON at all", async () => {
    const { provider } = vendor(
      () => new Response("<html>502</html>", { status: 502 }),
    );
    expect(last(await collect(provider))).toMatchObject({
      type: "failed",
      error: { code: "connection" },
    });
  });
});

// ── Reading the stream ───────────────────────────────────────────────────────

/**
 * A body that delivers `text` and then breaks on the next read. An error
 * raised in `start` would discard the queued bytes before any read.
 */
function breaking(text: string, reason: string): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream({
    pull(controller) {
      if (sent) controller.error(new TypeError(reason));
      else controller.enqueue(encoder.encode(text));
      sent = true;
    },
  });
}

describe("reading the stream", () => {
  it("emits the answer as the app's own events, and the usage the vendor reported", async () => {
    const { provider } = vendor(() => sse(...ANSWER));
    expect(await collect(provider)).toEqual([
      {
        type: "started",
        model: { providerId: "openrouter", modelId: "vendor/some-model" },
      },
      { type: "text-delta", text: "It is " },
      { type: "text-delta", text: "sharp." },
      { type: "usage", inputTokens: 12, outputTokens: 3 },
      { type: "completed", reason: "answer" },
    ]);
  });

  it("reassembles frames split across network chunks", async () => {
    const whole = ANSWER.join("");
    const pieces: string[] = [];
    for (let at = 0; at < whole.length; at += 7)
      pieces.push(whole.slice(at, at + 7));
    const { provider } = vendor(() => sse(...pieces));
    expect(await collect(provider)).toEqual([
      {
        type: "started",
        model: { providerId: "openrouter", modelId: "vendor/some-model" },
      },
      { type: "text-delta", text: "It is " },
      { type: "text-delta", text: "sharp." },
      { type: "usage", inputTokens: 12, outputTokens: 3 },
      { type: "completed", reason: "answer" },
    ]);
  });

  it("delivers tool calls once each, assembled, with the working to hand back", async () => {
    const { provider } = vendor(() =>
      sse(
        delta({ reasoning: "Need a search." }),
        delta({
          reasoning_details: [
            { type: "reasoning.text", text: "Need", index: 0, signature: "s" },
          ],
        }),
        delta({
          tool_calls: [
            {
              index: 0,
              id: "c1",
              function: { name: "grep", arguments: '{"q"' },
            },
          ],
        }),
        delta(
          { tool_calls: [{ index: 0, function: { arguments: ':"x"}' } }] },
          { finish_reason: "tool_calls" },
        ),
        DONE,
      ),
    );
    const events = await collect(provider);
    expect(events.filter((event) => event.type === "tool-call-ready")).toEqual([
      {
        type: "tool-call-ready",
        call: { id: "c1", name: "grep", arguments: { q: "x" } },
      },
    ]);
    expect(events).toContainEqual({
      type: "block",
      block: {
        replay: [
          { type: "reasoning.text", text: "Need", index: 0, signature: "s" },
        ],
      },
    });
    expect(last(events)).toEqual({ type: "completed", reason: "tools" });
  });

  it("drops calls cut off at the output limit and ends at the limit", async () => {
    const { provider } = vendor(() =>
      sse(
        delta(
          {
            tool_calls: [
              {
                index: 0,
                id: "c1",
                function: { name: "grep", arguments: '{"q":"ha' },
              },
            ],
          },
          { finish_reason: "length" },
        ),
        DONE,
      ),
    );
    const events = await collect(provider);
    expect(events.map((event) => event.type)).toEqual(["started", "completed"]);
    expect(last(events)).toEqual({ type: "completed", reason: "limit" });
  });

  it("maps an error frame mid-answer, and reads nothing after it", async () => {
    const { provider } = vendor(() =>
      sse(
        delta({ content: "Half" }),
        frame({
          error: { code: 429, message: "busy upstream: prompt was ..." },
        }),
        delta({ content: "more" }),
      ),
    );
    const events = await collect(provider);
    expect(events.map((event) => event.type)).toEqual([
      "started",
      "text-delta",
      "failed",
    ]);
    expect(last(events)).toEqual({
      type: "failed",
      error: {
        code: "model-busy",
        message: "This model is busy right now.",
        retryable: true,
      },
    });
  });

  it("fails a body that was never SSE", async () => {
    const { provider } = vendor(
      () => new Response('{"error":"gateway"}', { status: 200 }),
    );
    expect(last(await collect(provider))).toMatchObject({
      type: "failed",
      error: { code: "invalid-response", retryable: false },
    });
  });

  it("says so when the vendor answers 200 with no body", async () => {
    const { provider } = vendor(() => new Response(null, { status: 200 }));
    expect(last(await collect(provider))).toMatchObject({
      type: "failed",
      error: { code: "invalid-response" },
    });
  });

  it("keeps a step that broke after [DONE], because it is whole and billed", async () => {
    const { provider } = vendor(
      () =>
        new Response(breaking(ANSWER.join(""), "network error"), {
          status: 200,
        }),
    );
    expect(last(await collect(provider))).toEqual({
      type: "completed",
      reason: "answer",
    });
  });

  it("reports a connection that broke mid-answer, with fixed words", async () => {
    const { provider } = vendor(
      () =>
        new Response(
          breaking(
            delta({ content: "Half" }),
            "net::ERR_HTTP2_PROTOCOL_ERROR at host",
          ),
          { status: 200 },
        ),
    );
    const events = await collect(provider);
    expect(events.map((event) => event.type)).toEqual([
      "started",
      "text-delta",
      "failed",
    ]);
    expect(last(events)).toEqual({
      type: "failed",
      error: {
        code: "connection",
        message: "The connection to the provider broke.",
        retryable: true,
      },
    });
  });

  it("calls a dead network a connection problem", async () => {
    const { provider } = vendor(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(last(await collect(provider))).toMatchObject({
      type: "failed",
      error: { code: "connection", retryable: true },
    });
  });
});

// ── Stopping and deadlines ───────────────────────────────────────────────────

/** A body that sends what `start` sends and errors only when its fetch is aborted. */
function live(
  start: (send: (text: string) => void, close: () => void) => void,
): Answer {
  return (init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          // Writes after the fetch was aborted go nowhere, as on a socket
          // that has closed.
          const quietly = (write: () => void) => {
            try {
              write();
            } catch {
              // The stream has ended.
            }
          };
          start(
            (text) => quietly(() => controller.enqueue(encoder.encode(text))),
            () => quietly(() => controller.close()),
          );
          init.signal?.addEventListener(
            "abort",
            () =>
              controller.error(
                new DOMException("The operation was aborted.", "AbortError"),
              ),
            { once: true },
          );
        },
      }),
      { status: 200 },
    );
}

describe("stopping", () => {
  const stalledRefusal: Answer = (init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          init.signal?.addEventListener("abort", () =>
            controller.error(new DOMException("aborted", "AbortError")),
          );
        },
      }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );

  it("settles a refusal whose body stalls when the writer presses Stop", async () => {
    const caller = new AbortController();
    const events = collect(
      vendor(stalledRefusal).provider,
      request(),
      caller.signal,
    );
    setTimeout(() => caller.abort(), 10);
    expect(last(await events)).toMatchObject({
      type: "failed",
      error: { code: "cancelled" },
    });
  });

  it("settles a refusal whose body stalls at the deadline, as a timeout", async () => {
    expect(last(await collect(vendor(stalledRefusal).provider))).toMatchObject({
      type: "failed",
      error: { code: "timeout" },
    });
  });

  it("tells Stop mid-answer apart from silence, and closes the stream", async () => {
    const caller = new AbortController();
    let cancelled = false;
    const provider = vendor(
      (init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(delta({ content: "Half" })));
              init.signal?.addEventListener("abort", () =>
                controller.error(new DOMException("aborted", "AbortError")),
              );
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 200 },
        ),
    ).provider;
    const events = collect(provider, request(), caller.signal);
    setTimeout(() => caller.abort(), 10);
    expect(last(await events)).toEqual({
      type: "failed",
      error: {
        code: "cancelled",
        message: "Request cancelled",
        retryable: false,
      },
    });
    expect(cancelled || caller.signal.aborted).toBe(true);
  });

  it("reports silence past the deadline as a timeout, not a cancellation", async () => {
    const events = await collect(
      vendor(live((send) => send(delta({ content: "Half" })))).provider,
    );
    expect(last(events)).toMatchObject({
      type: "failed",
      error: { code: "timeout", retryable: true },
    });
  }, 10_000);

  it("counts the vendor's keepalive comments as a stream that is alive", async () => {
    // Every 15ms for ~180ms: three times the 60ms window, never idle in it.
    const events = await collect(
      vendor(
        live((send, close) => {
          let beats = 0;
          const timer = setInterval(() => {
            beats += 1;
            send(": OPENROUTER PROCESSING\n\n");
            if (beats < 12) return;
            clearInterval(timer);
            send(ANSWER.join(""));
            close();
          }, 15);
        }),
      ).provider,
    );
    expect(events.some((event) => event.type === "failed")).toBe(false);
    expect(last(events)).toEqual({ type: "completed", reason: "answer" });
  }, 10_000);

  it("still ends a stream that only ever keeps alive, at the step deadline", async () => {
    const started = Date.now();
    const events = await collect(
      vendor(
        live((send) => {
          const timer = setInterval(
            () => send(": OPENROUTER PROCESSING\n\n"),
            15,
          );
          setTimeout(() => clearInterval(timer), 2_000);
        }),
      ).provider,
    );
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(last(events)).toMatchObject({
      type: "failed",
      error: { code: "timeout" },
    });
  }, 10_000);

  it("lets a model that is still reasoning outlive the first-output deadline", async () => {
    const events = await collect(
      vendor(
        live((send, close) => {
          let beats = 0;
          const timer = setInterval(() => {
            beats += 1;
            send(
              delta(
                beats % 2
                  ? { reasoning: `step ${beats}. ` }
                  : {
                      reasoning_details: [
                        { type: "reasoning.encrypted", data: "x" },
                      ],
                    },
              ),
            );
            if (beats < 12) return;
            clearInterval(timer);
            send(ANSWER.join(""));
            close();
          }, 15);
        }),
      ).provider,
    );
    expect(
      events.filter((event) => event.type === "reasoning-delta"),
    ).toHaveLength(12);
    expect(last(events)).toEqual({ type: "completed", reason: "answer" });
  }, 10_000);
});

// ── The account hooks ────────────────────────────────────────────────────────

describe("the spend hook", () => {
  it("is told once a stream is over, with the tokens and the cost it reported", async () => {
    const onSpent = vi.fn();
    await collect(vendor(() => sse(...ANSWER), { onSpent }).provider);
    expect(onSpent).toHaveBeenCalledTimes(1);
    expect(onSpent).toHaveBeenCalledWith({
      inputTokens: 12,
      outputTokens: 3,
      costUsd: 0.0002,
    });
  });

  it("is told after a stream that failed mid-answer, which may have billed", async () => {
    const onSpent = vi.fn();
    await collect(
      vendor(
        () => sse(delta({ content: "a" }), frame({ error: { code: 500 } })),
        { onSpent },
      ).provider,
    );
    expect(onSpent).toHaveBeenCalledWith({});
  });

  it("is told when the consumer stops reading early", async () => {
    const onSpent = vi.fn();
    const { provider } = vendor(() => sse(...ANSWER), { onSpent });
    for await (const event of provider.generate(
      request(),
      new AbortController().signal,
    ))
      if (event.type === "text-delta") break;
    expect(onSpent).toHaveBeenCalledTimes(1);
  });

  it("cannot turn an answer into a throw", async () => {
    const { provider } = vendor(() => sse(...ANSWER), {
      onSpent: () => {
        throw new Error("bookkeeping");
      },
    });
    expect(last(await collect(provider))).toEqual({
      type: "completed",
      reason: "answer",
    });
  });
});

describe("estimating before sending", () => {
  it("answers from the shared estimator rather than asking anybody", async () => {
    const { calls, provider } = vendor(() => sse(...ANSWER));
    const estimate = await provider.estimate(request());
    expect(estimate.exact).toBe(false);
    expect(estimate.tokens).toBeGreaterThan(0);
    expect(calls).toHaveLength(0);
  });
});
