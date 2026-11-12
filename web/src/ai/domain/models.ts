// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Models and their providers: capabilities, references, requests, events,
// tools and the failures a run can end with.

/**
 * Where a provider runs, and the one axis the app above the port branches on.
 *
 * `device` is inference on the writer's own machine; `remote` is inference
 * reached over the network, and therefore the side that has a key, a bill, a
 * rate limit, and a privacy question about the prose it is sent.
 *
 * This is the storage port's rule. Asking a provider's id while
 * meaning "is this remote" is correct only while one remote is registered,
 * and becomes a refactor the day a second one appears.
 *
 * Anything narrower than this axis is an optional port member whose absence
 * is the answer, such as `probeTools`. Screens that offer a named choice
 * still name providers directly, and user-facing copy still says Ollama,
 * never "your device provider".
 */
export type ProviderKind = "device" | "remote";

/**
 * What a model can do, beyond answering.
 *
 * `tools` and `structuredOutput` are the two a local runtime varies in, read
 * off Ollama's `/api/show`; a hosted provider always has both and varies in
 * the other fields. Every other field is optional and falsy by absence, so an
 * adapter that cannot answer a question does not have to lie about it.
 */
export interface ModelCapabilities {
  tools: boolean;
  structuredOutput: boolean;
  /** It emits reasoning the adapter round-trips in `ModelMessage.blocks`. */
  reasoning?: boolean;
  /**
   * The model takes no temperature, as with OpenAI's reasoning models, whose
   * vendor refuses a request that sends one. Negative so that it stays falsy
   * by absence: a device model reports nothing here and does take one.
   */
  fixedTemperature?: boolean;
  /**
   * The model's own reasoning efforts, least first, in its own words: what
   * its provider says it takes, and nothing the app assumes.
   * `none` comes first only when the model can be asked not to reason; Claude
   * Sonnet 5.5 and Gemini 3.8 Flash cannot, and start at `low`; GPT-5.5 Pro
   * starts at `medium`. Absent or empty: the model names no scale, and no
   * effort is ever sent to it, which leaves it at its own default.
   */
  efforts?: readonly ReasoningEffort[];
  /**
   * The effort the model uses when none is sent, as its provider says: the
   * middle of the Mode's track. Absent: the middle of `efforts`.
   */
  defaultEffort?: ReasoningEffort;
}

/**
 * Which model answers, and whose it is.
 *
 * A bare model id cannot say which provider owns it, and reading the id's
 * spelling to find out (`qwen3:8b` looks local, `openai/gpt-5` looks remote)
 * is forbidden: an identifier is an address, not a statement about what
 * something is. It would work until the first local model with a slash in
 * its name, and the question it would get wrong is "did this book's prose
 * leave the machine".
 *
 * The same triple names the model a request asks for and the model a turn
 * records as having answered (`ChatTurn.model`), written down once.
 */
export interface ModelRef {
  providerId: string;
  modelId: string;
  modelRevision?: string;
}

/**
 * Whether two refs address the same model.
 *
 * The revision is not compared: it is a fact about which build
 * answered, recorded so a receipt can say so, and a model that was re-pulled
 * between two questions is still the model the writer chose. Comparing it
 * would make a menu row stop being ticked because a tag moved underneath it.
 */
export function sameModel(a: ModelRef, b: ModelRef): boolean {
  return a.providerId === b.providerId && a.modelId === b.modelId;
}

export interface ModelDescriptor {
  /** The model's own id, unique within its provider, never across providers. */
  id: string;
  /** Which provider offers it; `id` alone is ambiguous across providers. */
  providerId: string;
  label: string;
  revision?: string;
  /** Where it runs, the one axis the app branches on (`ProviderKind`). */
  kind: ProviderKind;
  capabilities: ModelCapabilities;
  contextTokens?: number;
  /**
   * A ceiling the provider imposes on one response, when it states one.
   *
   * Anthropic's Messages API requires `max_tokens` on every request and
   * rejects one above the model's own cap, and those caps differ sharply
   * between models; OpenAI's equivalent is optional but capped per model just
   * the same. `OUTPUT_MAX` is an Ollama-shaped guess, so without this a hosted
   * adapter would carry a hardcoded table of other people's limits.
   */
  maxOutputTokens?: number;
  /**
   * What a million tokens costs, when the provider states a price.
   *
   * Absent for a device model, and that absence is the answer rather than a
   * zero: a model running on the writer's own machine has no price, which is
   * a different fact from one a provider offers at no charge, and flattening
   * the two would put a "Free" badge on something nobody is billing for.
   *
   * Absent also for a remote model whose provider states no price, or states
   * half of one. That case renders as nothing, never as free.
   */
  pricing?: ModelPricing;
}

/**
 * The cost of a model, in the unit a person can read.
 *
 * Per million tokens, converted once at the adapter. Providers quote per
 * token (a typical model is 0.0000001), and a surface that rendered that
 * number would be asking a writer to count leading zeros.
 */
export interface ModelPricing {
  promptUsdPerMillion: number;
  completionUsdPerMillion: number;
}

/**
 * Whether a model can be used without being charged for it.
 *
 * Derived from the price and never from the id. OpenRouter's `:free` suffix
 * is sound in one direction only: every suffixed model is free, but some
 * free models are not suffixed. The suffix is also a string the vendor owns
 * and can change; the price is what is charged.
 *
 * A model with no stated price is not free but unknown, and this returns
 * false for it. Both axes must be zero: a model that is free to prompt and
 * charged to answer is charged.
 */
export function isFreeModel(model: ModelDescriptor): boolean {
  return (
    model.pricing !== undefined &&
    model.pricing.promptUsdPerMillion === 0 &&
    model.pricing.completionUsdPerMillion === 0
  );
}

/**
 * Where this device's Ollama is listening. Not a secret, and a fact about a
 * machine and nothing else: it lives on this device, keyed to the account,
 * and never travels in a project file.
 *
 * It holds no model: the only copy of a selection is `ChatPreferences.model`.
 * It holds no resource size either: every run limit is derived from
 * the window the chosen model reports, in `application/budgets.ts`, rather
 * than asking the writer to guess a number the model already states.
 */
export interface AiConnectionSettings {
  endpoint: string;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** App-issued call id, echoed where a provider needs it. */
  toolCallId?: string;
  /** The function a tool message answers; native providers key on the name. */
  toolName?: string;
  toolCalls?: ToolCall[];
  /**
   * Provider-shaped content the application must carry but must never read.
   *
   * Reasoning models return blocks that must come back unchanged on the next
   * request of the same tool loop: Claude's extended thinking is signed and
   * rejects a modified or missing block, and Ollama's `thinking` field is the
   * same idea without the signature. Dropping one silently discards the
   * model's reasoning, and on a provider that verifies it is a hard error.
   *
   * The type is `unknown[]` because the app cannot inspect these without
   * learning one provider's schema, and then the port would stop being
   * provider-neutral. Only the adapter that produced them may read them;
   * everything else moves them from one request to the next untouched.
   */
  blocks?: unknown[];
}

/**
 * The tool catalog, as a value: the same shape as `CHAT_KINDS` and
 * for the same reason: a union alone is erased at runtime, and `chatCodec`
 * has to recognise a tool name in a file it did not write.
 */
export const TOOL_NAMES = [
  "list_sources",
  "grep",
  "read_source",
  "inspect_structure",
  "submit_findings",
  "web_search",
  "use_skill",
  "leave_comments",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * The tools a workflow offers the model on its own steps and never in a chat:
 * `/where`'s ranking and judging, and a wide review's map.
 * Kept out of `TOOL_NAMES`: that list is what a chat turn's receipts may
 * name, and a chat never runs these, so a receipt naming one is a file
 * someone else wrote.
 */
export type WorkflowToolName =
  | "choose_sections"
  | "submit_match"
  | "nominate_issues"
  | "submit_placement"
  | "submit_quote"
  | "submit_fit"
  | "submit_beats"
  | "propose_queries"
  | "submit_verdict"
  | "write_journal"
  | "write_predictions"
  | "write_facts"
  | "group_names"
  | "submit_judgement"
  | "submit_rule_check";

export interface ToolDefinition {
  name: ToolName | WorkflowToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

/**
 * A reasoning effort, in the model's own words: one of its
 * `capabilities.efforts` ("none", "low", "high", "max"…), never a level the
 * app made up. Each adapter says it in its provider's field:
 * Ollama's `think`, OpenRouter's `reasoning_effort`.
 */
export type ReasoningEffort = string;

export interface ModelRequest {
  model: ModelRef;
  instructions: string;
  messages: ModelMessage[];
  tools: ToolDefinition[];
  /**
   * `none` declares `tools` without letting this step call one. A step
   * whose history holds calls still declares their tools, because a vendor
   * refuses a call that names an undeclared tool. An adapter whose runtime
   * has no such switch sends no tools instead.
   */
  toolChoice?: "none";
  /**
   * The answer's shape, for a model that can hold its output to a schema
   * (`capabilities.structuredOutput`). Typed rather than a bare schema because
   * the two adapters say it differently: Ollama takes the schema alone as
   * `format`, OpenRouter takes it wrapped as OpenAI's `json_schema {name,
   * strict, schema}`. One untyped object could satisfy only one of them.
   *
   * `strict` is always on for OpenRouter, so a schema here must be
   * strict-compatible: every property required, `additionalProperties: false`,
   * no min/max keywords. The caps a schema cannot say live in the caller's
   * validation of what came back.
   */
  output?: { name: string; schema: Record<string, unknown> };
  limits: { inputTokens: number; outputTokens: number };
  /**
   * Sampling temperature, 0 to 2. Absent means the model's own default, which
   * is a different fact from any number: providers tune theirs per model, and
   * sending 0.7 to one tuned for 0.3 is a choice nobody made.
   */
  temperature?: number;
  /**
   * How hard a reasoning model thinks before it answers. Absent means the
   * model's own default, and it must be absent for a model without the
   * `reasoning` capability: Ollama answers 400 to `think` on a model that
   * cannot, so the caller that knows the descriptor is the one that decides.
   */
  effort?: ReasoningEffort;
  /**
   * How many messages from the start of `messages` are stable enough to cache.
   *
   * Prompt caching is prefix-based wherever it exists, and the request is
   * assembled in order of how often each part changes: policy, then the
   * project briefing, then the workflow, then the persona, and only then the
   * index, the attached prose and the question. That ordering makes caching
   * possible; this field tells a provider that needs it where the stable part
   * ends. Ollama and OpenAI reuse a prefix on their own and ignore it;
   * Anthropic needs an explicit breakpoint.
   *
   * Advisory in both directions: an adapter may ignore it, and a wrong value
   * costs cache hits, never correctness.
   */
  cacheBreakpoint?: number;
}

/**
 * Why a step stopped.
 *
 * `answer`, `tools` and `limit` are what a local runtime reports. Hosted
 * providers distinguish more, and the two that matter to a writer are
 * `refusal` (the model declined) and `stop-sequence`. A refusal reported as
 * `interrupted` would describe a broken connection, not a model that said
 * no, and send the writer looking for a network fault that is not there.
 */
export type CompletionReason =
  "answer" | "tools" | "limit" | "stop-sequence" | "refusal";

/**
 * One inference step of a run, in the order the model produced it: its
 * working, then any prose it wrote before calling tools, then the calls.
 *
 * Steps rather than a flat list of mixed entries, because the protocol fixes
 * that order inside a step: a flat list could hold orders that cannot happen
 * (two thoughts in a row, a call before the thought that led to it), and a
 * renderer would have to decide what they mean. A call is referenced by id,
 * never copied: its display half lives on `ChatTurn.tools`, once.
 */
export interface TraceStep {
  /** The model's working for this step; empty when it showed none. */
  reasoning: string;
  /**
   * Prose the model wrote beside its tool calls ("let me check chapter 1").
   * It streams into the answer while the step runs and moves here when the
   * step ends in calls, so the next step's first word does not overwrite it
   * and the writer never sees a sentence appear and vanish.
   */
  text?: string;
  toolCallIds: string[];
}

/** A turn's steps, and whether the start of their text was cut by the cap. */
export interface TurnTrace {
  steps: TraceStep[];
  trimmed?: boolean;
}

export type ModelEvent =
  | { type: "started"; model: ModelRef }
  | { type: "text-delta"; text: string }
  /**
   * A piece of the model's working, before or between its answer.
   *
   * Its own event, never `text-delta` (the writer asked for an answer, and
   * the two would run together) and never a `block` (that is replay
   * material an adapter hands back, and this is for the writer's eyes).
   * It also proves the model is still working, so an adapter's idle
   * deadline resets on it. `text` may be empty: a model whose working
   * arrives only encrypted is alive, and says nothing more.
   */
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call-ready"; call: ToolCall }
  /**
   * Provider-shaped content the adapter needs handed back unchanged on the
   * next request of this tool loop, typically a reasoning block.
   *
   * The adapter both makes and reads it; the application only moves it from
   * the step that produced it onto the message it replays, and never reads
   * it, as with `ModelMessage.blocks`.
   */
  | { type: "block"; block: unknown }
  | {
      type: "usage";
      inputTokens?: number;
      outputTokens?: number;
      /** Part of `inputTokens`: what the provider served from its cache. */
      cachedInputTokens?: number;
      durationMs?: number;
    }
  | { type: "completed"; reason: CompletionReason }
  | { type: "failed"; error: ModelFailure };

/**
 * What a run is doing at this instant, for the waiting indicator.
 *
 * Not progress and not a log: there is no total to count towards and nothing
 * here is kept. It answers "is it stuck, or is it working?".
 *
 * The tool is named by its own name rather than by a phrase, because the
 * phrase is a user-facing string and belongs in the locale files with the
 * others. `subject` is the human-readable thing it is working on (a source's
 * title, never its id, or a search's terms), or absent for a tool that acts
 * on the project as a whole.
 *
 * Every kind is named for what is happening at that instant, and none of
 * the others is shown as "Thinking": a request standing in line, a wait on
 * the writer, a search, a verify step or a three-minute Section read called
 * that would say nothing of what, or blame the model for a wait that is not
 * its own. `thinking` starts on the first reasoning event and never before.
 *
 * `waiting` is the stretch between a request leaving and its first byte,
 * named for what the app knows rather than what it guesses: it covers
 * transit, a free model's queue, prefill and an Ollama cold load. `model`
 * is the catalogue's display label, resolved once per run.
 */
export type RunActivity =
  | { kind: "preparing" }
  | { kind: "waiting"; model: string }
  | { kind: "thinking" }
  | { kind: "writing" }
  | { kind: "tool"; tool: string; subject?: string }
  /**
   * The run is paused on the writer: a web search is proposed and nothing
   * leaves until they answer it.
   */
  | { kind: "awaiting-writer" }
  /**
   * An approved web search on its way. The engine's kind, not the
   * tool's name: "Searching the web" while it searches Wikipedia would tell
   * the writer their query went further than it did. Never the query.
   */
  | { kind: "searching-web"; engine: "wikipedia" | "web" }
  /**
   * `/verify`'s own two steps: the model choosing what to search, and
   * weighing what came back.
   */
  | { kind: "verifying"; step: "proposing" | "judging" }
  /**
   * A beta reader's journal run: reading one Section, or writing down what
   * it expects next.
   */
  | { kind: "reading"; title: string }
  | { kind: "predicting" };

export const MODEL_FAILURE_CODES = [
  "not-configured",
  "connection",
  "origin-or-permission",
  "model-missing",
  "capability-missing",
  "context-too-large",
  "resource-exhausted",
  "invalid-response",
  "provider-rejected",
  /**
   * The chosen model has no host that promises not to keep or train on the
   * text, which every remote request asks for (`data_collection: "deny"`);
   * the vendor answers 404 naming that policy (`codeForStatus`). Apart from
   * `provider-rejected` because the remedy is certain: another model, never a
   * retry of this one.
   */
  "no-private-host",
  /**
   * The two credential failures a remote provider can have, two rather than
   * one because they are the same shape with different remedies.
   *
   * The app's own popup can mint a fresh key, so `key-expired` gets a button
   * that works. Raising a spend limit happens at the vendor, on a page the
   * app does not control, so `credit-exhausted` can only point. Collapsed
   * into one code, the copy would have to promise whichever of those the
   * button cannot do.
   */
  "key-expired",
  "credit-exhausted",
  /**
   * The key has spent the limit the writer set for it, by the app's reading of
   * the vendor's report on the key. Not
   * `credit-exhausted`: that is the vendor saying the account has no credit,
   * fixed at the vendor, while this one's remedy is the app's: a new key, which
   * starts with a limit of its own. A shared code would tell a writer at their
   * own limit to go and add credit.
   */
  "limit-reached",
  /**
   * Three kinds of "slow down", and three rather than one for the same reason
   * as the two above: the remedies differ.
   * `rate-limited` is the account asking too fast (wait a moment),
   * `model-busy` is the model's host at capacity whoever asks (try again
   * shortly, or another model), and `quota-exhausted` is the day's free
   * requests used up (a paid model still answers; waiting a moment does
   * nothing). The adapter tells them apart; the panel only names them.
   */
  "rate-limited",
  "model-busy",
  "quota-exhausted",
  /**
   * Another generation of this writer's is already running. No adapter
   * produces it: nothing limits concurrent generations. Not
   * `resource-exhausted`, which a mid-stream 402 for the key's cap uses.
   */
  "busy",
  /**
   * The session belongs to another writer than the one this tab holds.
   * No adapter produces it: a tab whose writer session changes
   * reloads before it sends.
   */
  "account-changed",
  "timeout",
  "interrupted",
  "cancelled",
  /**
   * Two endings of the model's own, kept apart from the transport failures
   * above because each is worded by what the writer saw (`turnEnding.ts`).
   * `output-limit`: the answer stopped mid-sentence where the output
   * allowance ran out; an interrupted turn, its text kept, with Try again.
   * `refusal`: the model declined the request; a failed turn, the words it
   * declined in kept as its text. Neither is stored as `complete`, or a
   * cut-off sentence would read as a finished answer.
   */
  "output-limit",
  "refusal",
] as const;

export type ModelFailureCode = (typeof MODEL_FAILURE_CODES)[number];

export interface ModelFailure {
  code: ModelFailureCode;
  message: string;
  retryable: boolean;
  /**
   * How long the provider said to wait, when it said.
   *
   * A chat run carries it as a fact and acts on nothing: retrying a chat
   * automatically means deciding what to do with a half-streamed answer, and
   * that is its own decision rather than a detail of transport. A web search
   * reads it: a `rate-limited` search is offered back to the writer
   * as a retry once this has passed (`retryAt`). Nothing sleeps on it and
   * nothing sends by itself; the retry is the writer's press.
   */
  retryAfterMs?: number;
}
