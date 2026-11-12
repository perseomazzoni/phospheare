// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type {
  CompletionReason,
  ModelEvent,
  ModelFailure,
} from "../domain/types";
import { MAX_REPLAY_BYTES, MAX_REPLAY_ITEMS } from "./openrouterRequest";

// The vendor's SSE, turned into the app's own `ModelEvent`s.
//
// A push parser rather than a loop over a stream, so it is a pure function of
// the bytes it has been handed, and every case the network makes rare (a
// payload split mid-JSON across two reads, a keepalive comment arriving alone,
// a stream that ends without its terminator) is an ordinary unit test.
//
// It re-emits and never forwards: no vendor message, field or event type
// reaches the transcript. A provider's error text has been observed to echo
// the request that caused it, which carries a writer's prose and a key.
//
// Every bound is checked in bytes before the bytes are kept, so a broken or
// hostile stream cannot fill the tab's memory.
//
// Tool calls are assembled, not interpreted: fragments are concatenated across
// deltas and parsed once, and execution stays in the application.

/** The whole stream: 32 000 tokens at a few hundred bytes a frame is ~16 MB. */
export const MAX_STREAM_BYTES = 64 * 1024 * 1024;
/** One line, and one frame's data. */
export const MAX_STREAM_LINE_BYTES = 1024 * 1024;
export const MAX_TOOL_CALLS = 64;
/** All of one step's call arguments together. */
export const MAX_TOOL_ARGUMENT_BYTES = 1024 * 1024;

/** The fields a vendor streams in pieces; every other one comes whole. */
const REASONING_APPEND_KEYS = ["text", "summary", "data"];

type Flat = string | number | null;

interface CallSlot {
  id: string;
  name: string;
  arguments: string;
}

/** What the stream reported about its own cost, for the account's reading. */
export interface StreamSpend {
  inputTokens?: number;
  outputTokens?: number;
  /** The vendor's `usage.cost`, in US dollars, only as reported. */
  costUsd?: number;
}

// Marked pure: a bundle that never decodes a stream, such as the demo site's
// (`build/demoBoundary.ts`), drops this module whole.
const encoder = /* @__PURE__ */ new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;

function failed(
  code: ModelFailure["code"],
  message: string,
  retryable: boolean,
): ModelEvent {
  return { type: "failed", error: { code, message, retryable } };
}

export class OpenRouterStreamDecoder {
  /** Bytes received but not yet resolved into a whole line. */
  private pending: Uint8Array = new Uint8Array(0);

  private readonly lineDecoder = new TextDecoder();

  /** The `data:` values of the frame being accumulated. */
  private dataLines: string[] = [];

  private frameBytes = 0;

  private receivedBytes = 0;

  private argumentBytes = 0;

  private started = false;

  /** Terminal: `[DONE]`, or a failure already reported. */
  private closed = false;

  private done = false;

  private failedRun = false;

  private toolCalls = new Map<number, CallSlot>();

  /** Merged from their deltas by `index`; flat values only. */
  private reasoningDetails = new Map<number, Record<string, Flat>>();

  private reasoningBytes = 0;

  /** Past a cap: nothing is replayed, rather than a truncated signature. */
  private reasoningOverflow = false;

  private finishReason: string | null = null;

  private inputTokens: number | null = null;

  private outputTokens: number | null = null;

  private cachedInputTokens: number | null = null;

  private costUsd: number | null = null;

  private answeringModelId: string | null = null;

  constructor(
    private readonly providerId: string,
    private readonly requestedModelId: string,
  ) {}

  /** Takes whatever came off the socket; returns the events now complete. */
  push(chunk: Uint8Array): ModelEvent[] {
    if (this.closed) return [];

    this.receivedBytes += chunk.length;
    const newline = chunk.indexOf(0x0a);
    if (
      this.receivedBytes > MAX_STREAM_BYTES ||
      this.pending.length + (newline === -1 ? chunk.length : newline) >
        MAX_STREAM_LINE_BYTES
    )
      return [this.overBudget()];

    const joined = new Uint8Array(this.pending.length + chunk.length);
    joined.set(this.pending, 0);
    joined.set(chunk, this.pending.length);

    const events: ModelEvent[] = [];
    let start = 0;
    let at = joined.indexOf(0x0a, start);
    while (at !== -1) {
      // A UTF-8 sequence never spans a newline byte, so each line decodes
      // whole on its own.
      const raw = joined.subarray(start, at);
      start = at + 1;
      events.push(...this.lineOf(raw));
      if (this.closed) {
        this.pending = new Uint8Array(0);
        return events;
      }
      at = joined.indexOf(0x0a, start);
    }
    this.pending = joined.slice(start);

    if (this.pending.length > MAX_STREAM_LINE_BYTES)
      events.push(this.overBudget());
    return events;
  }

  /** Whether `[DONE]` arrived: everything the step owes is in. */
  sawDone(): boolean {
    return this.done;
  }

  spend(): StreamSpend {
    return {
      ...(this.inputTokens !== null ? { inputTokens: this.inputTokens } : {}),
      ...(this.outputTokens !== null
        ? { outputTokens: this.outputTokens }
        : {}),
      ...(this.costUsd !== null ? { costUsd: this.costUsd } : {}),
    };
  }

  /**
   * The socket is done. Returns what the run still owes: the assembled tool
   * calls, the replay, the usage, and one terminal event.
   */
  finish(): ModelEvent[] {
    const events: ModelEvent[] = [];

    // A last frame with no trailing blank line still counts: vendors end
    // streams this way, and a parser that insists on the separator loses the
    // final delta. A last line with no newline at all counts too.
    if (!this.closed && this.pending.length > 0) {
      const raw = this.pending;
      this.pending = new Uint8Array(0);
      events.push(...this.lineOf(raw));
    }
    if (!this.closed && this.dataLines.length > 0) {
      events.push(...this.dispatch(this.dataLines.join("\n")));
      this.dataLines = [];
    }

    // A `failed` is terminal on its own; a `completed` after it would say the
    // run both did and did not finish.
    if (this.failedRun) return events;

    if (!this.started) {
      // Nothing parseable arrived, most often a body that was never SSE.
      events.push(
        failed(
          "invalid-response",
          "The provider sent nothing this app could read.",
          false,
        ),
      );
      return events;
    }

    if (this.finishReason === "error") {
      // The vendor says the run broke and gives no error object to say how.
      events.push(
        this.fail("connection", "The provider failed while answering.", true),
      );
      return events;
    }

    let calls = this.assembleToolCalls();
    const broken = calls.filter((event) => event.type === "failed");
    if (
      broken.length > 0 &&
      (this.finishReason === "length" || this.finishReason === "max_tokens")
    ) {
      // The model ran out of room while writing a call, and the vendor says
      // so: a step cut off at its limit, which the application handles, not
      // an unreadable answer. The half-written calls are dropped, never
      // handed on, because there is no safe default for what was asked.
      calls = [];
      this.toolCalls.clear();
      this.failedRun = false;
    } else if (broken.length > 0) {
      return [...events, ...broken];
    }
    events.push(...calls);

    const replay = this.reasoningReplay();
    if (replay) events.push(replay);

    if (this.inputTokens !== null || this.outputTokens !== null)
      events.push({
        type: "usage",
        ...(this.inputTokens !== null ? { inputTokens: this.inputTokens } : {}),
        ...(this.outputTokens !== null
          ? { outputTokens: this.outputTokens }
          : {}),
        ...(this.cachedInputTokens !== null
          ? { cachedInputTokens: this.cachedInputTokens }
          : {}),
      });

    events.push({ type: "completed", reason: this.completionReason() });
    return events;
  }

  /** One line of SSE as it came off the socket, without its newline. */
  private lineOf(raw: Uint8Array): ModelEvent[] {
    const bare = raw[raw.length - 1] === 0x0d ? raw.subarray(0, -1) : raw;
    return this.line(this.lineDecoder.decode(bare), bare.length);
  }

  /** One line of SSE, `size` the bytes it arrived as. */
  private line(line: string, size: number): ModelEvent[] {
    // A comment: the vendor's keepalive while a slow model warms up. It
    // emits nothing; the bytes arriving are the signal.
    if (line.startsWith(":")) return [];

    if (line === "") {
      const frame = this.dataLines.join("\n");
      this.dataLines = [];
      this.frameBytes = 0;
      return frame === "" ? [] : this.dispatch(frame);
    }

    if (line.startsWith("data:")) {
      // One optional space after the colon; any further whitespace is data.
      const prefix = line.startsWith("data: ") ? 6 : 5;
      const value = line.slice(prefix);
      this.frameBytes += size - prefix + 1;
      if (this.frameBytes > MAX_STREAM_LINE_BYTES) return [this.overBudget()];
      this.dataLines.push(value);
      return [];
    }

    // `event:`, `id:`, `retry:` and anything a vendor invents.
    return [];
  }

  private dispatch(data: string): ModelEvent[] {
    if (data === "[DONE]") {
      this.closed = true;
      this.done = true;
      return [];
    }

    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch {
      frame = null;
    }
    if (typeof frame !== "object" || frame === null)
      return [
        this.fail(
          "invalid-response",
          "The provider sent a malformed stream.",
          false,
        ),
      ];
    const body = frame as Record<string, unknown>;

    if (body.error !== undefined && body.error !== null)
      return [this.failFromUpstream(body.error)];

    const events: ModelEvent[] = [];

    if (typeof body.model === "string" && body.model !== "")
      this.answeringModelId = body.model;

    if (!this.started) {
      this.started = true;
      events.push({
        type: "started",
        model: {
          providerId: this.providerId,
          modelId: this.answeringModelId ?? this.requestedModelId,
        },
      });
    }

    const choices = body.choices;
    const choice = Array.isArray(choices) ? choices[0] : undefined;
    if (typeof choice === "object" && choice !== null) {
      const { delta: rawDelta, finish_reason: finish } = choice as Record<
        string,
        unknown
      >;
      const delta =
        typeof rawDelta === "object" && rawDelta !== null
          ? (rawDelta as Record<string, unknown>)
          : {};

      // The model's working, as its own event, so a reasoning model is not
      // silent until the first-output deadline ends it. Only the
      // plain `reasoning` string is shown; `reasoning_details` carries
      // encrypted blobs and signatures, so a detail with no text is an empty
      // piece that keeps the run alive and shows none of it. The details are
      // kept to hand back on the next step of a tool loop.
      const details = delta.reasoning_details;
      if (Array.isArray(details)) this.accumulateReasoningDetails(details);
      if (typeof delta.reasoning === "string" && delta.reasoning !== "")
        events.push({ type: "reasoning-delta", text: delta.reasoning });
      else if (Array.isArray(details) && details.length > 0)
        events.push({ type: "reasoning-delta", text: "" });

      // After the working when one frame carries both: the order the model
      // produced them in.
      if (typeof delta.content === "string" && delta.content !== "")
        events.push({ type: "text-delta", text: delta.content });

      if (
        Array.isArray(delta.tool_calls) &&
        !this.accumulateToolCalls(delta.tool_calls)
      )
        return [...events, this.overBudget()];

      if (typeof finish === "string" && finish !== "")
        this.finishReason = finish;
    }

    const usage = body.usage;
    if (typeof usage === "object" && usage !== null) {
      const figures = usage as Record<string, unknown>;
      if (Number.isInteger(figures.prompt_tokens))
        this.inputTokens = figures.prompt_tokens as number;
      if (Number.isInteger(figures.completion_tokens))
        this.outputTokens = figures.completion_tokens as number;
      const details = figures.prompt_tokens_details;
      if (typeof details === "object" && details !== null) {
        const cached = (details as Record<string, unknown>).cached_tokens;
        if (Number.isInteger(cached)) this.cachedInputTokens = cached as number;
      }
      const cost = figures.cost;
      if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0)
        this.costUsd = cost;
    }

    return events;
  }

  /**
   * Tool-call fragments, keyed by the vendor's own index, so two parallel
   * calls never merge. False when the step asks for more calls, or longer
   * arguments, than the app accepts.
   */
  private accumulateToolCalls(calls: unknown[]): boolean {
    for (const call of calls) {
      if (typeof call !== "object" || call === null || Array.isArray(call))
        continue;
      const fragment = call as Record<string, unknown>;
      const index = Number.isInteger(fragment.index)
        ? (fragment.index as number)
        : this.toolCalls.size;
      if (!this.toolCalls.has(index) && this.toolCalls.size >= MAX_TOOL_CALLS)
        return false;
      const slot = this.toolCalls.get(index) ?? {
        id: "",
        name: "",
        arguments: "",
      };

      if (typeof fragment.id === "string" && fragment.id !== "")
        slot.id = fragment.id;
      const fn =
        typeof fragment.function === "object" && fragment.function !== null
          ? (fragment.function as Record<string, unknown>)
          : {};
      if (typeof fn.name === "string" && fn.name !== "") slot.name = fn.name;
      if (typeof fn.arguments === "string") {
        this.argumentBytes += byteLength(fn.arguments);
        if (this.argumentBytes > MAX_TOOL_ARGUMENT_BYTES) return false;
        slot.arguments += fn.arguments;
      }
      this.toolCalls.set(index, slot);
    }
    return true;
  }

  /**
   * Reasoning details merged by `index`: the text arrives in pieces, the
   * signature once. Only flat values are kept, and past a cap everything is
   * dropped.
   */
  private accumulateReasoningDetails(details: unknown[]): void {
    if (this.reasoningOverflow) return;
    for (const detail of details) {
      if (
        typeof detail !== "object" ||
        detail === null ||
        Array.isArray(detail)
      )
        continue;
      const fields = detail as Record<string, unknown>;
      const index = Number.isInteger(fields.index)
        ? (fields.index as number)
        : this.reasoningDetails.size;
      const slot = this.reasoningDetails.get(index) ?? {};

      for (const [key, value] of Object.entries(fields)) {
        const flat =
          typeof value === "string" ||
          value === null ||
          (typeof value === "number" && Number.isInteger(value));
        if (!flat) continue;
        if (typeof value === "string") this.reasoningBytes += byteLength(value);
        const held = slot[key];
        if (
          typeof value === "string" &&
          REASONING_APPEND_KEYS.includes(key) &&
          typeof held === "string"
        )
          slot[key] = held + value;
        else if (value !== null || !(key in slot)) slot[key] = value as Flat;
      }
      this.reasoningDetails.set(index, slot);

      if (
        this.reasoningBytes > MAX_REPLAY_BYTES ||
        this.reasoningDetails.size > MAX_REPLAY_ITEMS
      ) {
        this.reasoningOverflow = true;
        this.reasoningDetails.clear();
        return;
      }
    }
  }

  /**
   * The step's working, ready to be handed back, or null when there is none,
   * the step asked for no tools, or it ran past a cap. Only `reasoning.*`
   * items travel, under the neutral `replay`.
   */
  private reasoningReplay(): ModelEvent | null {
    if (
      this.toolCalls.size === 0 ||
      this.reasoningOverflow ||
      this.reasoningDetails.size === 0
    )
      return null;
    const replay = [...this.reasoningDetails.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, detail]) => detail)
      .filter(
        (detail) =>
          typeof detail.type === "string" &&
          detail.type.startsWith("reasoning."),
      );
    return replay.length > 0 ? { type: "block", block: { replay } } : null;
  }

  /**
   * The fragments, parsed once. A broken argument string fails the run
   * rather than defaulting to `{}`: a tool run with no arguments because a
   * delta was lost can delete the wrong thing, or search for nothing and
   * report that the book does not mention it. An empty accumulation fails
   * too, since a no-argument tool is sent `{}`. Only a JSON object at the top
   * is a call's arguments.
   */
  private assembleToolCalls(): ModelEvent[] {
    const events: ModelEvent[] = [];
    const indices = [...this.toolCalls.keys()].sort((a, b) => a - b);
    for (const index of indices) {
      const slot = this.toolCalls.get(index) as CallSlot;
      if (slot.name === "")
        return [
          this.fail(
            "invalid-response",
            "The provider asked for a tool it did not name.",
            false,
          ),
        ];
      if (slot.arguments === "")
        return [
          this.fail(
            "invalid-response",
            "A tool call arrived without its arguments.",
            false,
          ),
        ];
      let parsed: unknown;
      try {
        parsed = JSON.parse(slot.arguments);
      } catch {
        parsed = null;
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      )
        return [
          this.fail(
            "invalid-response",
            "A tool call's arguments could not be read.",
            false,
          ),
        ];
      events.push({
        type: "tool-call-ready",
        // A synthesised id is stable within the turn and only pairs a result
        // back to its call; some providers omit it on a single call.
        call: {
          id: slot.id !== "" ? slot.id : `call_${index}`,
          name: slot.name,
          arguments: parsed,
        },
      });
    }
    return events;
  }

  /**
   * Why the run ended. An unrecognised reason falls back to what the run
   * produced, and a turn that produced tool calls did not produce an answer,
   * whatever the vendor called it: the application stops driving a run
   * reported as answered, leaving the tools it asked for unexecuted.
   */
  private completionReason(): CompletionReason {
    const calls = this.toolCalls.size > 0;
    let reason: CompletionReason;
    switch (this.finishReason) {
      case "stop":
      case "end_turn":
        reason = "answer";
        break;
      case "tool_calls":
      case "function_call":
      case "tool_use":
        reason = "tools";
        break;
      case "length":
      case "max_tokens":
        reason = "limit";
        break;
      case "content_filter":
        reason = "refusal";
        break;
      case "stop_sequence":
        reason = "stop-sequence";
        break;
      default:
        reason = calls ? "tools" : "answer";
    }
    return reason === "answer" && calls ? "tools" : reason;
  }

  /**
   * An error object inside the stream. Only its code is read, an integer, a
   * digit string or a name, and all three classify alike; the vendor's
   * message is never read.
   */
  private failFromUpstream(error: unknown): ModelEvent {
    const raw =
      typeof error === "object" && error !== null
        ? (error as { code?: unknown }).code
        : undefined;
    const code =
      typeof raw === "number" && Number.isInteger(raw)
        ? raw
        : typeof raw === "string" && /^\d+$/.test(raw)
          ? Number(raw)
          : raw === "server_error"
            ? 500
            : raw === "rate_limit_exceeded"
              ? 429
              : raw === "timeout"
                ? 408
                : 0;

    // The key's cap: retryable, which the application reads as "come back".
    if (code === 402)
      return this.fail(
        "resource-exhausted",
        "The provider will not serve any more requests on this key right now.",
        true,
      );
    // A 429 after the answer began is the model's host, never the vendor's
    // own limit, which is enforced before a stream opens.
    if (code === 429)
      return this.fail("model-busy", "This model is busy right now.", true);
    if (code === 408 || code === 504)
      return this.fail(
        "timeout",
        "The provider took too long to answer.",
        true,
      );
    if (code >= 500)
      return this.fail(
        "connection",
        "The provider failed while answering.",
        true,
      );
    return this.fail(
      "provider-rejected",
      "The provider turned the request down.",
      false,
    );
  }

  /** The stream ran past a bound. The partial line, the frame and the calls go. */
  private overBudget(): ModelEvent {
    this.pending = new Uint8Array(0);
    this.dataLines = [];
    this.toolCalls.clear();
    return this.fail(
      "invalid-response",
      "The provider sent more than this app accepts.",
      false,
    );
  }

  private fail(
    code: ModelFailure["code"],
    message: string,
    retryable: boolean,
  ): ModelEvent {
    this.failedRun = true;
    this.closed = true;
    return failed(code, message, retryable);
  }
}
