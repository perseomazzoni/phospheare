// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ModelProvider } from "../ports";
import type {
  ModelDescriptor,
  ModelEvent,
  ModelFailure,
  ModelMessage,
  ModelRef,
  ModelRequest,
  ToolCall,
} from "../domain/types";
import { normalizeOllamaEndpoint } from "../settings";
import { estimateRequestTokens } from "../domain/estimate";
import { StreamDeadlines } from "./streamDeadlines";
import { kindForDestination } from "../domain/providerKind";
import type { ModelDestination } from "../domain/providerKind";

interface OllamaModel {
  name?: unknown;
  model?: unknown;
  digest?: unknown;
  remote_model?: unknown;
  remote_host?: unknown;
}

/**
 * Deadlines per stage, in milliseconds unless named otherwise; the earliest
 * applicable one wins. A model that has not answered in this process, or not
 * within its `keepAliveMs`, may be reading its weights before the first
 * token, so it gets the longer cold window. Tests inject tiny values.
 */
export interface OllamaTimeouts {
  metadataMs: number;
  firstOutputMs: number;
  /** The first request for a model in this process; a declared cold load. */
  coldFirstOutputMs: number;
  /**
   * The slowest prompt-eval rate the first-output window allows for, in
   * tokens a second. Nothing streams while a runtime reads the prompt, and on
   * a CPU that runs near 25 tokens a second, so a prompt of a few thousand
   * tokens needs minutes before its first token. Each window grows by the
   * prompt at this floor, set below the CPU rate for slower machines. The
   * runtime's prompt cache can only make it faster.
   */
  prefillTokensPerSecond: number;
  /**
   * How long a model stays loaded after its last output, until the adapter
   * reads the real figure from Ollama (`learnKeepAlive`). Ollama unloads an
   * idle model after its `keep_alive`: 5 minutes unless the writer set
   * `OLLAMA_KEEP_ALIVE`, which this adapter never overrides because it never
   * sends one. A model silent for longer is loading again and is cold,
   * however recently this process saw it answer.
   */
  keepAliveMs: number;
  inactivityMs: number;
  stepMs: number;
}

export const DEFAULT_OLLAMA_TIMEOUTS: OllamaTimeouts = {
  metadataMs: 5_000,
  firstOutputMs: 120_000,
  coldFirstOutputMs: 300_000,
  prefillTokensPerSecond: 15,
  keepAliveMs: 300_000,
  inactivityMs: 120_000,
  stepMs: 600_000,
};

/**
 * What the adapter accepts from the runtime's stream, checked before a chunk
 * is kept, so a runtime that never ends a line cannot grow the tab's memory
 * until a deadline. The stream is untrusted input: the endpoint is
 * loopback, but the process behind it is not this one.
 *
 * One record, ended by a newline or not. The largest honest record carries a
 * call's whole arguments or a reasoning delta, both far below this.
 */
export const MAX_RECORD_BYTES = 2 * 1024 * 1024;

/**
 * The whole stream. `num_predict` bounds an honest answer; this bounds a
 * runtime that ignores it. Small records that each pass the record cap could
 * otherwise accumulate reasoning without end.
 */
export const MAX_STREAM_BYTES = 64 * 1024 * 1024;

function failure(code: ModelFailure): ModelEvent {
  return { type: "failed", error: code };
}

/**
 * The runtime's own error record, in its own words. A model that does not
 * fit in memory is `resource-exhausted`; anything else is the runtime
 * refusing.
 */
function streamError(message: string): ModelFailure {
  return {
    code: /memory/i.test(message) ? "resource-exhausted" : "provider-rejected",
    message,
    retryable: true,
  };
}

function mapMessage(message: ModelMessage): Record<string, unknown> {
  const mapped: Record<string, unknown> = {
    role: message.role,
    content: message.content,
  };
  // Native tool results key on the function name, not on an app call id; an
  // id here mismatches silently in a real Ollama tool loop.
  if (message.role === "tool" && message.toolName)
    mapped.tool_name = message.toolName;
  if (message.toolCalls)
    mapped.tool_calls = message.toolCalls.map((call) => ({
      function: { name: call.name, arguments: call.arguments },
    }));
  // The opaque blocks this adapter emitted go back where they came from.
  // Ollama returns a thinking model's reasoning in its own `thinking` field
  // beside `content`, and a tool loop that drops it asks the model to
  // continue from a turn it cannot remember taking.
  //
  // Only the one key this adapter writes is read; a block is never spread
  // over the message, where one carrying `role`, `content` or `tool_calls`
  // would overwrite what the app built. These blocks never leave this
  // process, and reading the one field keeps that safe for an adapter that
  // parses blocks off a wire.
  for (const block of message.blocks ?? []) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const thinking = (block as { thinking?: unknown }).thinking;
    if (typeof thinking === "string") mapped.thinking = thinking;
  }
  return mapped;
}

/**
 * The efforts Ollama's `think` takes, least first: `none` is `false`, and
 * the three words are what its API names. The runtime's scale, not any
 * model's; no default, so the Mode's middle is the middle of it.
 */
const OLLAMA_EFFORTS: readonly string[] = ["none", "low", "medium", "high"];

export class OllamaProvider implements ModelProvider {
  readonly id = "ollama";
  private readonly endpoint: string;
  private readonly destination: ModelDestination;
  private readonly fetcher: typeof fetch;
  private readonly timeouts: OllamaTimeouts;
  /** Probed tool support, cached by model id + digest. */
  private readonly probes = new Map<string, boolean>();
  /**
   * When each model last produced output in this process. Warm only while
   * that is within `keepAliveMs`: past it, Ollama has unloaded the model.
   */
  private readonly warmed = new Map<string, number>();
  /**
   * Each model's keep_alive as Ollama reports it (`/api/ps`), read once
   * after its first answer: the writer's own `OLLAMA_KEEP_ALIVE` is on
   * their machine, where the browser cannot read it.
   */
  private readonly keepAlive = new Map<string, number>();
  private readonly now: () => number;
  /** Digests seen in the model listing, so `describeModel` can carry them. */
  private readonly digests = new Map<string, string>();
  /** Ids whose one lazy listing lookup for a digest already ran. */
  private readonly digestLookups = new Set<string>();

  /**
   * The device provider: the writer's own Ollama on loopback and nothing
   * else. Requests carry no credentials and refuse redirects, and models
   * Ollama proxies to a cloud host are left out of the listing and refused
   * by `describeModel`.
   */
  constructor(
    endpoint: string,
    fetcher: typeof fetch = fetch,
    timeouts: Partial<OllamaTimeouts> = {},
    /** The clock warmth is measured by; tests inject one. */
    now: () => number = Date.now,
  ) {
    this.now = now;
    // Two guards answer different questions. `normalizeOllamaEndpoint` is the
    // policy: this adapter speaks only to a loopback Ollama and anything else
    // throws `loopback-only`. The kind the descriptors report is derived
    // separately, by `kindForDestination` from the same endpoint, so the axis
    // a privacy gate branches on is never an adapter's word for itself, and
    // weakening either guard cannot make the other lie.
    this.endpoint = normalizeOllamaEndpoint(endpoint);
    this.destination = { via: "direct", endpoint: this.endpoint };
    // A stored native `fetch` called as a method (`this.fetcher(...)`) binds
    // `this` to the provider, and the browser answers "Illegal invocation". A
    // closure keeps the global receiver, and an injected test fetcher keeps
    // its own behaviour.
    this.fetcher = (...args) => fetcher(...args);
    this.timeouts = { ...DEFAULT_OLLAMA_TIMEOUTS, ...timeouts };
  }

  /**
   * One fetch under its own controller, so the header deadline can abort it
   * without aborting the caller's signal.
   *
   * `held` keeps the caller's abort forwarded after the headers, for a
   * response whose body is still to be read. The controller handed to fetch
   * governs the body, so a forward dropped at the headers leaves a streamed
   * answer deaf to Stop and to every stream deadline, and it runs to its end.
   * A metadata call reads its body at once and drops it. A held
   * forward is `once` and dies with the caller's signal, which for a stream
   * is the per-generate `StreamDeadlines` controller.
   */
  private async request(
    path: string,
    init: RequestInit,
    signal: AbortSignal,
    timeoutMs = this.timeouts.metadataMs,
    held = false,
  ): Promise<Response> {
    const controller = new AbortController();
    const forward = () => controller.abort(signal.reason);
    signal.addEventListener("abort", forward, { once: true });
    let responded = false;
    const deadline = setTimeout(
      () => controller.abort("metadata-timeout"),
      timeoutMs,
    );
    try {
      const response = await this.fetcher(`${this.endpoint}${path}`, {
        ...init,
        signal: controller.signal,
        credentials: "omit",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) throw new Error(`ollama-${response.status}`);
      responded = true;
      return response;
    } finally {
      clearTimeout(deadline);
      if (!(held && responded)) signal.removeEventListener("abort", forward);
    }
  }

  /** Retries metadata discovery once, and only after a network `TypeError`. */
  private async metadata(
    path: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<Response> {
    try {
      return await this.request(path, init, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      if (!(error instanceof TypeError)) throw error;
      return this.request(path, init, signal);
    }
  }

  async listModels(signal: AbortSignal): Promise<ModelDescriptor[]> {
    const response = await this.metadata(
      "/api/tags",
      { method: "GET" },
      signal,
    );
    const body = (await response.json()) as { models?: OllamaModel[] };
    return (body.models ?? []).flatMap((model) => {
      const id =
        typeof model.name === "string"
          ? model.name
          : typeof model.model === "string"
            ? model.model
            : "";
      if (
        !id ||
        typeof model.remote_model === "string" ||
        typeof model.remote_host === "string"
      )
        return [];
      const revision =
        typeof model.digest === "string" ? model.digest : undefined;
      if (revision) this.digests.set(id, revision);
      return [
        {
          id,
          providerId: this.id,
          label: id,
          revision,
          kind: kindForDestination(this.destination),
          capabilities: { tools: false, structuredOutput: false },
        },
      ];
    });
  }

  async describeModel(
    ref: ModelRef,
    signal: AbortSignal,
  ): Promise<ModelDescriptor> {
    const id = ref.modelId;
    // `/api/show` does not repeat the digest. The listing's digest is kept so
    // generated artifacts can record the exact weights. An instance that never
    // listed models asks once, best effort: the digest is provenance, not a
    // reason to fail discovery.
    if (!this.digests.has(id) && !this.digestLookups.has(id)) {
      this.digestLookups.add(id);
      try {
        await this.listModels(signal);
      } catch {
        // The /api/show request below is the one that must succeed.
      }
    }
    const response = await this.metadata(
      "/api/show",
      { method: "POST", body: JSON.stringify({ model: id }) },
      signal,
    );
    const body = (await response.json()) as {
      capabilities?: unknown;
      model_info?: Record<string, unknown>;
      details?: { families?: unknown };
      remote_model?: unknown;
      remote_host?: unknown;
    };
    if (body.remote_model || body.remote_host)
      throw new Error("ollama-cloud-model");
    const capabilities = Array.isArray(body.capabilities)
      ? body.capabilities.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    const context = Object.entries(body.model_info ?? {}).find(
      ([key, value]) =>
        key.endsWith(".context_length") && typeof value === "number",
    )?.[1];
    return {
      id,
      providerId: this.id,
      label: id,
      revision: this.digests.get(id),
      kind: kindForDestination(this.destination),
      capabilities: {
        tools: capabilities.includes("tools"),
        structuredOutput: capabilities.includes("completion"),
        reasoning: capabilities.includes("thinking"),
        // Ollama names no levels per model, so a thinking model's scale is
        // the runtime's own, `OLLAMA_EFFORTS`.
        ...(capabilities.includes("thinking")
          ? { efforts: OLLAMA_EFFORTS }
          : {}),
      },
      contextTokens: typeof context === "number" ? context : undefined,
    };
  }

  /**
   * A tiny synthetic tool round trip, cached by model id + digest. It reads no
   * project content: one request, one trivial schema, and the answer is
   * whether the runtime emitted a tool call. Metadata indicates support;
   * this checks the protocol's behaviour.
   */
  async probeTools(ref: ModelRef, signal: AbortSignal): Promise<boolean> {
    const id = ref.modelId;
    const key = `${id}@${ref.modelRevision ?? ""}`;
    const cached = this.probes.get(key);
    if (cached !== undefined) return cached;
    const events: ModelEvent[] = [];
    for await (const event of this.generate(
      {
        model: ref,
        instructions:
          "Call the probe tool exactly once with value 1, then stop.",
        messages: [{ role: "user", content: "Run the probe." }],
        tools: [
          {
            name: "list_sources",
            description: "Synthetic probe; performs no project access.",
            inputSchema: {
              type: "object",
              properties: { value: { type: "integer" } },
              required: ["value"],
              additionalProperties: false,
            },
          },
        ],
        limits: { inputTokens: 1_000, outputTokens: 1_024 },
      },
      signal,
    ))
      events.push(event);
    // The probe runs at its own small `num_ctx`, and Ollama reloads a model
    // whose context size changes, so the next real step loads it again.
    // Answering the probe does not make the model warm for that step.
    this.warmed.delete(id);
    const ok = events.some(
      (event) =>
        event.type === "tool-call-ready" ||
        (event.type === "completed" && event.reason === "tools"),
    );
    this.probes.set(key, ok);
    return ok;
  }

  /**
   * Read how long Ollama will keep `modelId` loaded, once per model: its
   * `/api/ps` row's `expires_at`, taken right after an answer, is that
   * answer's end plus the keep_alive in force. A model missing from the list
   * was unloaded at once (`keep_alive` 0), so it is always cold; "never"
   * (a negative keep_alive) comes back as a far-off date and stays warm.
   * Best effort and never awaited: a failure keeps the default.
   */
  private learnKeepAlive(modelId: string): void {
    if (this.keepAlive.has(modelId)) return;
    const asked = this.now();
    void this.request(
      "/api/ps",
      { method: "GET" },
      new AbortController().signal,
    )
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as {
          models?: { name?: unknown; model?: unknown; expires_at?: unknown }[];
        };
        if (!Array.isArray(body.models)) return;
        const row = body.models.find(
          (one) => one.name === modelId || one.model === modelId,
        );
        if (!row) {
          this.keepAlive.set(modelId, 0);
          return;
        }
        const expires =
          typeof row.expires_at === "string" ? Date.parse(row.expires_at) : NaN;
        if (Number.isFinite(expires))
          this.keepAlive.set(modelId, Math.max(0, expires - asked));
      })
      .catch(() => undefined);
  }

  async estimate(
    request: ModelRequest,
  ): Promise<{ tokens: number; exact: boolean }> {
    // Shared with the OpenRouter adapter: counting a request body is not
    // Ollama-shaped, and two estimators drift silently, one of them admitting
    // requests the runtime truncates.
    return estimateRequestTokens(request);
  }

  async *generate(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent> {
    // A model that has not produced a token in this process may still be
    // loading, so its first request gets the cold window. Only a local runtime
    // reads weights off disk, so this adapter decides the window and hands
    // the shared machinery a number.
    const last = this.warmed.get(request.model.modelId);
    const keepAliveMs =
      this.keepAlive.get(request.model.modelId) ?? this.timeouts.keepAliveMs;
    const cold = last === undefined || this.now() - last >= keepAliveMs;
    // The base covers loading (cold) and starting to generate; the prompt's
    // own prefill is added on top, since the two happen one after the other.
    // No cap here: the step deadline still bounds the whole request, so a
    // prompt that cannot be read inside the step fails as that.
    const firstOutput =
      (cold ? this.timeouts.coldFirstOutputMs : this.timeouts.firstOutputMs) +
      Math.ceil(
        (estimateRequestTokens(request).tokens * 1000) /
          this.timeouts.prefillTokensPerSecond,
      );
    const deadlines = new StreamDeadlines(signal, {
      stepMs: this.timeouts.stepMs,
      firstOutputMs: firstOutput,
      inactivityMs: this.timeouts.inactivityMs,
    });
    let thinking = "";
    const touch = () => {
      // Once output flows, a silence is a stall and the inactivity deadline
      // applies.
      deadlines.touch();
      // Having answered within its keep_alive, the model is warm, so the next
      // request for it starts on the shorter window. Stamped on every output:
      // Ollama's idle timer starts when the request ends, and the last token
      // is the nearest point visible here.
      this.warmed.set(request.model.modelId, this.now());
    };
    let response: Response;
    try {
      const body: Record<string, unknown> = {
        model: request.model.modelId,
        stream: true,
        messages: [
          { role: "system", content: request.instructions },
          ...request.messages.map(mapMessage),
        ],
        options: {
          // `num_ctx` is the whole KV allocation, shared by prompt and
          // generation. Too small a value makes the runtime drop tokens off
          // the front of the prompt, instructions first, with no error and no
          // field in the response.
          num_ctx: request.limits.inputTokens + request.limits.outputTokens,
          num_predict: request.limits.outputTokens,
          // Only when the chat chose one: absent keeps the model's own, which
          // its Modelfile may have tuned.
          ...(request.temperature !== undefined
            ? { temperature: request.temperature }
            : {}),
        },
      };
      // Ollama's `think`: `false` for none, the level's own name otherwise.
      // A model that takes only booleans treats a name it does not know as
      // its default (thinking on), which is the nearest honest reading of
      // "low" or "high". Absent unless asked: the caller sends effort only
      // for a model that can think, because `think` to one that cannot is a
      // 400.
      if (request.effort !== undefined)
        body.think = request.effort === "none" ? false : request.effort;
      // Ollama has no switch that declares tools and forbids calling them,
      // and accepts a history whose calls name no declared tool, so a step
      // that may call none is sent none.
      if (request.tools.length > 0 && request.toolChoice !== "none")
        body.tools = request.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        }));
      if (request.output) body.format = request.output.schema;
      response = await this.request(
        "/api/chat",
        { method: "POST", body: JSON.stringify(body) },
        deadlines.signal,
        // Headers on a cold model can wait for the weights, and any model's
        // for its prompt to be read: the same window as the first output.
        firstOutput,
        // The body is the answer, read for as long as it streams.
        true,
      );
    } catch (error) {
      deadlines.dispose();
      if (signal.aborted) {
        yield failure({
          code: "cancelled",
          message: "Request cancelled",
          retryable: false,
        });
        return;
      }
      if (deadlines.timedOut) {
        yield failure({
          code: "timeout",
          message: "Ollama did not respond in time",
          retryable: true,
        });
        return;
      }
      yield failure({
        code: error instanceof TypeError ? "connection" : "provider-rejected",
        message:
          error instanceof Error ? error.message : "Ollama request failed",
        retryable: true,
      });
      return;
    }
    if (!response.body) {
      deadlines.dispose();
      yield failure({
        code: "invalid-response",
        message: "Ollama returned no stream",
        retryable: true,
      });
      return;
    }
    yield { type: "started", model: request.model };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawTools = false;
    /** Bytes of the stream so far. */
    let received = 0;
    /** Bytes of the record in progress: since the last newline. */
    let pending = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        touch();
        // Counted on the raw bytes before the chunk is kept, newline or not;
        // the per-line check below sees only lines that have ended. The
        // record in progress ends at the chunk's first newline, if any.
        if (value) {
          received += value.byteLength;
          if (received > MAX_STREAM_BYTES) throw new Error("stream-too-large");
          const firstNewline = value.indexOf(10);
          const recordEnd =
            firstNewline === -1 ? value.byteLength : firstNewline;
          if (pending + recordEnd > MAX_RECORD_BYTES)
            throw new Error("record-too-large");
          const lastNewline = value.lastIndexOf(10);
          pending =
            lastNewline === -1
              ? pending + value.byteLength
              : value.byteLength - lastNewline - 1;
        }
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          if (new TextEncoder().encode(line).byteLength > MAX_RECORD_BYTES)
            throw new Error("record-too-large");
          const item = JSON.parse(line) as {
            message?: {
              content?: unknown;
              thinking?: unknown;
              tool_calls?: Array<{
                function?: { name?: unknown; arguments?: unknown };
              }>;
            };
            done?: unknown;
            done_reason?: unknown;
            error?: unknown;
            prompt_eval_count?: unknown;
            eval_count?: unknown;
            total_duration?: unknown;
          };
          // A runtime that fails after the headers says why in a record of
          // its own, `{"error": "..."}`, and sends nothing after it.
          if (typeof item.error === "string") {
            yield failure(streamError(item.error));
            await reader.cancel().catch(() => undefined);
            return;
          }
          if (typeof item.message?.content === "string" && item.message.content)
            yield { type: "text-delta", text: item.message.content };
          // Reasoning arrives in its own field, in deltas like the content,
          // and is never a `text-delta`: in the transcript the writer could
          // not tell the model's working from the answer. It goes out twice:
          // piece by piece for the writer's fold, and whole at the end
          // as the block this runtime needs replayed on the next step of a
          // tool loop.
          if (typeof item.message?.thinking === "string") {
            thinking += item.message.thinking;
            if (item.message.thinking)
              yield { type: "reasoning-delta", text: item.message.thinking };
          }
          for (const wire of item.message?.tool_calls ?? []) {
            if (typeof wire.function?.name !== "string") continue;
            sawTools = true;
            const call: ToolCall = {
              id: crypto.randomUUID(),
              name: wire.function.name,
              arguments: wire.function.arguments ?? {},
            };
            yield { type: "tool-call-ready", call };
          }
          if (item.done === true) {
            yield {
              type: "usage",
              inputTokens:
                typeof item.prompt_eval_count === "number"
                  ? item.prompt_eval_count
                  : undefined,
              outputTokens:
                typeof item.eval_count === "number"
                  ? item.eval_count
                  : undefined,
              durationMs:
                typeof item.total_duration === "number"
                  ? item.total_duration / 1_000_000
                  : undefined,
            };
            if (thinking) yield { type: "block", block: { thinking } };
            this.learnKeepAlive(request.model.modelId);
            // `length` is the answer stopping where `num_predict` ran out,
            // read the way the OpenRouter adapter reads the vendor's `length`.
            yield {
              type: "completed",
              reason:
                item.done_reason === "length"
                  ? "limit"
                  : sawTools
                    ? "tools"
                    : "answer",
            };
            return;
          }
        }
        if (done) break;
      }
      yield failure({
        code: "interrupted",
        message: "Ollama stream ended before completion",
        retryable: true,
      });
    } catch (error) {
      yield failure({
        code: signal.aborted
          ? "cancelled"
          : deadlines.timedOut
            ? "timeout"
            : "invalid-response",
        message: deadlines.timedOut
          ? "Ollama stopped responding"
          : error instanceof Error
            ? error.message
            : "Invalid Ollama response",
        retryable: !signal.aborted,
      });
      // Refused, so the rest of the stream is not read into memory either.
      await reader.cancel().catch(() => undefined);
    } finally {
      deadlines.dispose();
      reader.releaseLock();
    }
  }
}
