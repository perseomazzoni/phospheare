// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ModelMessage, ModelRequest } from "../domain/types";

// A generation's request, in two steps that each have one job:
//
// 1. `refuseGeneration`: the gate. A model id the vendor would read as more
//    than a name, a sampling value out of range, an empty message, a replay
//    of the wrong shape or a conversation past its size is refused before
//    anything is sent, never dropped or repaired.
// 2. `openRouterBody`: the vendor's body, built field by field from the
//    checked request, never spread from it. A field the vendor would honour
//    (`route`, `transforms`, `plugins`, a fallback `models` list, `preset`)
//    cannot reach it, because no expression here writes one; `provider` is
//    the one such field written, as a literal no input reaches.
//
// `content` is string-only, which rules out multimodal parts: a part naming
// a URL is an outbound fetch the writer never asked for, aimed by whatever
// wrote the message.

/** The reasoning efforts forwarded, in the vendor's own words, least first. */
export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

/** A ceiling on one answer: an unbounded `max_tokens` can spend a key's cap. */
export const MAX_OUTPUT_TOKENS = 32_000;

const MAX_MESSAGES = 200;
const MAX_TOTAL_BYTES = 1_500_000;
/** The serialised body, checked before it is sent. */
export const MAX_BODY_BYTES = 2_000_000;
export const MAX_REPLAY_ITEMS = 64;
export const MAX_REPLAY_BYTES = 262_144;

/**
 * The characters a model id may hold. It excludes whitespace, controls and
 * quotes, the shapes that matter once the value reaches a URL, a header or a
 * log line. `~` is a name (`~vendor/model-latest` aliases); `@` passes here
 * and `forwardsModel` refuses it.
 */
export const MODEL_ID = /^[A-Za-z0-9._/:@~-]+$/;

/** The `:variant` suffixes forwarded; any other is a switch, not a name. */
const MODEL_VARIANTS = ["free", "batch"];

/**
 * Whether the vendor reads this id as a name and nothing more. `:online`
 * turns on a web search over the whole prompt, `:nitro` and `:floor` choose
 * the route, and `@preset/…` applies a stored configuration that can carry
 * server tools and provider routing. So no `@`, and at most one `:` suffix,
 * which must be listed: default-deny, compared exactly, so a new switch
 * cannot walk past.
 */
export function forwardsModel(modelId: string): boolean {
  if (modelId.includes("@")) return false;
  const parts = modelId.split(":");
  if (parts.length === 1) return true;
  return parts.length === 2 && MODEL_VARIANTS.includes(parts[1] ?? "");
}

export function acceptsModelId(modelId: unknown): modelId is string {
  return (
    typeof modelId === "string" &&
    modelId.length <= 200 &&
    MODEL_ID.test(modelId) &&
    forwardsModel(modelId)
  );
}

// ── The gate ─────────────────────────────────────────────────────────────────

/** Why the gate refused, as the code the failure carries. */
export interface GenerationRefusal {
  code: "provider-rejected" | "context-too-large";
  /**
   * Names the field as the vendor's body numbers it, the instructions being
   * `messages.0`; never echoes a value.
   */
  field: string;
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A flat replay item: string keys, each value a string, an integer or null. */
function isFlatItem(item: unknown): boolean {
  if (!isObject(item) || Object.keys(item).length === 0) return false;
  return Object.values(item).every(
    (value) =>
      typeof value === "string" ||
      value === null ||
      (typeof value === "number" && Number.isInteger(value)),
  );
}

/** The size of a replay as `MAX_REPLAY_BYTES` counts it: its string values. */
function replayBytes(replay: unknown[]): number {
  let total = 0;
  for (const item of replay)
    if (isObject(item))
      for (const value of Object.values(item))
        if (typeof value === "string") total += bytes(value);
  return total;
}

const hasCalls = (message: ModelMessage) =>
  message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0;

/**
 * The replay a message carries, or `undefined`. A block's `replay` is read,
 * never spread: a block parsed off a wire and spread over the message could
 * rewrite its role or its calls. It rides only on an assistant turn with
 * tool calls, the only turn with a continuation to replay into.
 */
function replayOf(message: ModelMessage): unknown[] | undefined {
  if (!hasCalls(message)) return undefined;
  let replay: unknown[] | undefined;
  for (const block of message.blocks ?? []) {
    if (!isObject(block)) continue;
    if (Array.isArray(block.replay)) replay = block.replay;
  }
  return replay;
}

/**
 * Why this request may not be sent, or `null` when it may. The first failing
 * rule wins. Size is `context-too-large`, whose remedy is a shorter
 * conversation; every other rule is `provider-rejected`, because a request
 * the app built that fails its own gate is a bug, not something to retry.
 */
export function refuseGeneration(
  request: ModelRequest,
): GenerationRefusal | null {
  const rejected = (field: string): GenerationRefusal => ({
    code: "provider-rejected",
    field,
  });

  if (!acceptsModelId(request.model.modelId)) return rejected("model");

  const messages: ModelMessage[] = [
    { role: "system", content: request.instructions },
    ...request.messages,
  ];
  if (messages.length > MAX_MESSAGES)
    return { code: "context-too-large", field: "messages" };

  const maxTokens = request.limits.outputTokens;
  if (!(
    Number.isInteger(maxTokens) &&
    maxTokens >= 1 &&
    maxTokens <= MAX_OUTPUT_TOKENS
  ))
    return rejected("max_tokens");
  const temperature = request.temperature;
  if (
    temperature !== undefined &&
    !(Number.isFinite(temperature) && temperature >= 0 && temperature <= 2)
  )
    return rejected("temperature");
  if (
    request.effort !== undefined &&
    !(REASONING_EFFORTS as readonly string[]).includes(request.effort)
  )
    return rejected("reasoning_effort");

  // A ceiling on the whole conversation, the replays included, not just on
  // its parts: two hundred messages each under a field's limit still add up.
  let total = 0;
  for (const [index, message] of messages.entries()) {
    // Only an assistant turn that only asked for tools may carry no prose;
    // an empty message from any other role is a bug on its way to a paid
    // request.
    if (message.content.trim() === "" && !hasCalls(message))
      return rejected(`messages.${index}.content`);
    total += bytes(message.content);

    const replay = replayOf(message);
    if (replay === undefined) continue;
    if (
      replay.length === 0 ||
      replay.length > MAX_REPLAY_ITEMS ||
      replayBytes(replay) > MAX_REPLAY_BYTES ||
      !replay.every(isFlatItem)
    )
      return rejected(`messages.${index}.replay`);
    total += replayBytes(replay);
  }
  if (total > MAX_TOTAL_BYTES)
    return { code: "context-too-large", field: "messages" };

  return null;
}

// ── The vendor's body ────────────────────────────────────────────────────────

/**
 * One message in the vendor's dialect. The replay becomes
 * `reasoning_details`, keeping only `reasoning.*` items: a default-deny
 * allow-list, so nothing else dressed as signed working is sent, and a
 * replay with nothing left is no key at all, never `[]`.
 */
function vendorMessage(message: ModelMessage): Record<string, unknown> {
  const built: Record<string, unknown> = {
    role: message.role,
    content: message.content,
  };

  // A tool result pairs with its call by id here, not by function name as a
  // native device runtime does.
  if (message.role === "tool" && message.toolCallId)
    built.tool_call_id = message.toolCallId;

  if (message.toolCalls?.length)
    built.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: {
        name: call.name,
        // A string on the wire, as every OpenAI-compatible provider replays.
        arguments:
          typeof call.arguments === "string"
            ? call.arguments
            : JSON.stringify(call.arguments ?? {}),
      },
    }));

  const details = (replayOf(message) ?? [])
    .filter(
      (item): item is Record<string, unknown> =>
        isObject(item) &&
        typeof item.type === "string" &&
        item.type.startsWith("reasoning."),
    )
    .map((item) => {
      const entry: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(item))
        if (
          typeof value === "string" ||
          value === null ||
          Number.isInteger(value)
        )
          entry[key] = value;
      return entry;
    });
  if (details.length > 0) built.reasoning_details = details;
  return built;
}

/**
 * The vendor's streamed chat body, from a request `refuseGeneration` passed.
 * The system prompt travels as an ordinary first message, so the prompt and
 * its assembler stay in one deployable.
 *
 * `provider.data_collection: "deny"` sends the manuscript only to hosts whose
 * policy is not to keep or train on it; a model no such host serves fails
 * rather than falls back. `stream_options.include_usage` is what makes a
 * streamed answer report its tokens.
 */
export function openRouterBody(request: ModelRequest): Record<string, unknown> {
  const built: Record<string, unknown> = {
    model: request.model.modelId,
    messages: [
      { role: "system", content: request.instructions },
      ...request.messages.map(vendorMessage),
    ],
    stream: true,
    stream_options: { include_usage: true },
    provider: { data_collection: "deny" },
    max_tokens: Math.min(request.limits.outputTokens, MAX_OUTPUT_TOKENS),
  };

  if (request.tools.length > 0) {
    built.tools = request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
    if (request.toolChoice === "none") built.tool_choice = "none";
  }

  // Only when the chat chose one; absent is the model's own default.
  if (request.temperature !== undefined)
    built.temperature = request.temperature;

  if (request.output)
    built.response_format = {
      type: "json_schema",
      json_schema: {
        name: request.output.name,
        strict: true,
        schema: request.output.schema,
      },
    };

  // The vendor's nested object, built here from a word on a closed list, so
  // no other key of it (`exclude`, `max_tokens`, `enabled`) is reachable from
  // the request, even past a skipped gate.
  if ((REASONING_EFFORTS as readonly unknown[]).includes(request.effort))
    built.reasoning = { effort: request.effort };

  return built;
}
