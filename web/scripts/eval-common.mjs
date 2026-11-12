// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The plumbing every live measurement runs on: OpenRouter reached
// directly with the body the relay builds and the key from the environment
// alone, the meter on every request, the stub a dry run answers with, the
// invented books and the catalogue the app would list for them, and the
// provenance a report opens with. The fact check, the grouping measurement
// and the prompt-layers measurement share it, because a
// provider fixed in one runner and not the others would make their numbers
// incomparable.
//
// The key never touches a file: `OpenRouter` takes it from the caller, which
// reads `PHOSPHEARE_OPENROUTER_KEY`, and nothing here logs a header or a body.

/* global AbortSignal, setTimeout */
import { execSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { PRODUCT } from "../src/product.ts";

export const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
export const OPENROUTER = "https://openrouter.ai/api/v1";

/** A `--name value` argument, or the fallback. */
export function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
}

/** Whether a bare `--name` flag was given. */
export const flag = (name) => process.argv.includes(`--${name}`);

/**
 * The app's own modules, loaded through Vite as the SPA loads them, so a
 * runner measures the code that ships and not a copy. `close()` when done.
 */
export async function moduleServer() {
  const server = await createServer({
    root: WEB,
    logLevel: "error",
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  return { server, load: (path) => server.ssrLoadModule(path) };
}

/**
 * The OpenRouter gate every remote run passes before anything is sent: a
 * missing key or an unlisted model is a reason to do nothing. Returns the
 * public listing (no key needed) and the refusal, if any.
 */
export async function openRouterGate(providerName, modelId) {
  if (providerName !== "openrouter") return { listing: [], refusal: null };
  if (!process.env.PHOSPHEARE_OPENROUTER_KEY)
    return {
      listing: [],
      refusal:
        "PHOSPHEARE_OPENROUTER_KEY is not set in the environment; nothing was sent.",
    };
  const listing = await openRouterListing();
  return {
    listing,
    refusal: listing.some((one) => one.id === modelId)
      ? null
      : `OpenRouter lists no model ${modelId}; nothing was sent.`,
  };
}

/**
 * An invented book of one language as `EvalSource`s, sheets by shelf.
 *
 * `set` is the folder under `src/ai/eval`: `corpus`, the two books every
 * planted measurement uses, `guided`, the book whose guidebook explains
 * one of its disagreements away, or `references`, the fixture books
 * of the reference catalogue. Files are named as a project names
 * them: a `character--` file is a character sheet, an `arc--` file an arc,
 * a `notes--` file a note, and a `guidebook--<section>` or `world--<section>`
 * file the page of that section, titled by its first heading as the app
 * titles a page. A guidebook page is left out when `guidance` is false,
 * giving the same book with the page never written. Everything else is a
 * manuscript Section.
 */
export async function corpus(
  language,
  { set = "corpus", guidance = true } = {},
) {
  const dir = join(WEB, "src", "ai", "eval", set, language);
  const names = (await readdir(dir)).filter((name) => name.endsWith(".md"));
  names.sort();
  const sources = await Promise.all(
    names.map(async (name) => {
      const text = await readFile(join(dir, name), "utf8");
      const bare = name.replace(/^[a-z]+--/, "").replace(/\.md$/, "");
      const shelf = /^(guidebook|world)--/u.exec(name)?.[1];
      if (shelf)
        return {
          id: `reference:${name}`,
          title: /^#\s+(.+)$/mu.exec(text)?.[1].trim() ?? bare,
          text,
          group: shelf,
          sectionId: bare,
        };
      const group = name.startsWith("character--")
        ? "characters"
        : name.startsWith("arc--")
          ? "arcs"
          : name.startsWith("notes--")
            ? "notes"
            : null;
      return {
        id: group ? `reference:${name}` : `node:${name}`,
        title: bare,
        text,
        ...(group ? { group } : {}),
      };
    }),
  );
  return sources.filter((one) => guidance || one.group !== "guidebook");
}

/** The catalogue the app would list for these sources. */
export function catalogOf(sources) {
  let order = 0;
  return sources.map((source) =>
    source.group
      ? {
          id: source.id,
          // A notes file is a note, as the adapter publishes it.
          kind: source.group === "notes" ? "note" : "reference",
          group: source.group,
          ...(source.sectionId ? { sectionId: source.sectionId } : {}),
          title: source.title,
          path: `reference/${source.id.slice("reference:".length)}`,
          authority: "reference",
        }
      : {
          id: source.id,
          kind: "manuscript",
          title: source.title,
          path: `document/${source.id.slice("node:".length)}`,
          nodeId: source.id.slice("node:".length),
          nodeKind: "section",
          order: order++,
          authority: "manuscript",
        },
  );
}

/** A stable revision for a text: its length and a cheap digest. */
export function revisionOf(text) {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length}-${hash.toString(16)}`;
}

/**
 * The book as the app's port gives it. `reader` is the app's own module
 * `src/editor/assistant/sourceText.ts`, loaded through Vite (`moduleServer`). With
 * it every read strips what the adapter strips (the writer's notes, a
 * template's unanswered questions) and the names are the adapter's, so a
 * measurement reads the book the writer's assistant reads. Without
 * it, for a runner that measures raw text, the text is as written.
 */
export class Sources {
  constructor(sources, reader = null) {
    this.catalog = catalogOf(sources);
    this.texts = new Map(sources.map((one) => [one.id, one.text]));
    this.reader = reader;
  }
  async list() {
    return this.catalog;
  }
  async read(id) {
    const raw = this.texts.get(id);
    if (raw === undefined) throw new Error("source-not-found");
    const kind = this.catalog.find((one) => one.id === id)?.kind;
    const text = this.reader
      ? this.reader.modelText(kind, this.reader.notedText(raw))
      : raw;
    // The revision is the file's, of the raw bytes, as the adapter's is.
    return { text, revision: revisionOf(raw), origin: "project-file" };
  }
  async knownNames(ids) {
    if (!this.reader) return [];
    return ids.flatMap((id) => {
      const source = this.catalog.find((one) => one.id === id);
      const raw = this.texts.get(id);
      return source && raw !== undefined && source.kind === "reference"
        ? this.reader.namesOf(
            source,
            this.reader.notedText(raw),
            this.reader.NAMES_MOST,
          )
        : [];
    });
  }
  async search() {
    return [];
  }
  async allowedReaderSources() {
    return new Set();
  }
}

/**
 * The provider with a meter on every request: which structured step asked
 * (`request.output.name`), how long it took, what it cost, whether it
 * failed. The events pass through untouched.
 */
export class Metered {
  calls = [];
  constructor(inner) {
    this.inner = inner;
    this.id = inner.id;
  }
  listModels(...args) {
    return this.inner.listModels(...args);
  }
  describeModel(...args) {
    return this.inner.describeModel(...args);
  }
  estimate(...args) {
    return this.inner.estimate(...args);
  }
  async *generate(request, signal) {
    const call = {
      stage: request.output?.name ?? "answer",
      ms: 0,
      inputTokens: null,
      outputTokens: null,
      outcome: "completed",
      // The answer as it came, for a measurement that scores the model's
      // own words before any guard of the app's reads them (the grouping
      // measurement). Kept only in memory.
      text: "",
    };
    this.calls.push(call);
    const started = performance.now();
    try {
      for await (const event of this.inner.generate(request, signal)) {
        if (event.type === "usage") {
          if (typeof event.inputTokens === "number")
            call.inputTokens = event.inputTokens;
          if (typeof event.outputTokens === "number")
            call.outputTokens = event.outputTokens;
        }
        if (event.type === "text-delta") call.text += event.text;
        if (event.type === "failed") call.outcome = "failed";
        yield event;
      }
    } catch (error) {
      call.outcome = "threw";
      throw error;
    } finally {
      call.ms = Math.round(performance.now() - started);
    }
  }
  /** The calls so far, and a clean meter for the next run. */
  take() {
    const calls = this.calls;
    this.calls = [];
    return calls;
  }
}

/** A model that reads every text as stating nothing (`--dry`). */
export class Stub {
  id = "stub";
  descriptor = {
    id: "stub",
    providerId: "stub",
    label: "stub",
    kind: "device",
    capabilities: { tools: true, structuredOutput: true },
    contextTokens: 32_000,
  };
  async listModels() {
    return [this.descriptor];
  }
  async describeModel() {
    return this.descriptor;
  }
  async estimate() {
    return { tokens: 1, exact: false };
  }
  async *generate(request) {
    const answer =
      request.output?.name === "write_facts" ? { facts: [] } : { groups: [] };
    yield { type: "text-delta", text: JSON.stringify(answer) };
    yield { type: "usage", inputTokens: 1, outputTokens: 1 };
    yield { type: "completed", reason: "answer" };
  }
}

/** The relay's words (`RelayChatRequest::REASONING_EFFORTS`), least first. */
const RELAY_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** A model's effort scale as the relay's catalogue projects it. */
function effortsOf(reasoning) {
  const listed = Array.isArray(reasoning?.supported_efforts)
    ? reasoning.supported_efforts
    : [];
  const efforts = [...listed]
    .reverse()
    .filter((one) => RELAY_EFFORTS.includes(one));
  if (efforts.length === 0) return {};
  return {
    efforts,
    ...(efforts.includes(reasoning?.default_effort)
      ? { defaultEffort: reasoning.default_effort }
      : {}),
  };
}

/**
 * OpenRouter, reached directly with a key from the environment: the body
 * the relay builds, one non-streamed completion per request,
 * usage read off the answer. Retries a rate limit or a server error a few
 * times with a pause; anything else is one `failed` event, as the port
 * says. The key is read here and only sent as the bearer header.
 */
export class OpenRouter {
  id = "openrouter";
  constructor(key, listing) {
    this.key = key;
    this.listing = listing;
  }
  row(modelId) {
    return this.listing.find((one) => one.id === modelId) ?? null;
  }
  describe(modelId) {
    const row = this.row(modelId);
    const supported = row?.supported_parameters ?? [];
    return {
      id: modelId,
      providerId: "openrouter",
      label: row?.name ?? modelId,
      kind: "remote",
      capabilities: {
        tools: supported.includes("tools"),
        structuredOutput: supported.includes("structured_outputs"),
        reasoning: supported.includes("reasoning"),
        fixedTemperature: !supported.includes("temperature"),
        // As the relay's catalogue reads it: the model's own
        // efforts, least first, only in the words the relay forwards, and
        // its default when that is one of them.
        ...effortsOf(row?.reasoning),
      },
      ...(typeof row?.context_length === "number"
        ? { contextTokens: row.context_length }
        : {}),
    };
  }
  async listModels() {
    return this.listing.map((row) => this.describe(row.id));
  }
  async describeModel(ref) {
    return this.describe(ref.modelId);
  }
  async estimate(request) {
    return {
      tokens: Math.ceil(JSON.stringify(request.messages ?? "").length / 3),
      exact: false,
    };
  }
  async *generate(request, signal) {
    const body = {
      model: request.model.modelId,
      messages: [
        { role: "system", content: request.instructions },
        ...request.messages.map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.role === "tool" && message.toolCallId
            ? { tool_call_id: message.toolCallId }
            : {}),
          ...(message.toolCalls?.length
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: "function",
                  function: {
                    name: call.name,
                    arguments:
                      typeof call.arguments === "string"
                        ? call.arguments
                        : JSON.stringify(call.arguments ?? {}),
                  },
                })),
              }
            : {}),
        })),
      ],
      max_tokens: request.limits.outputTokens,
      provider: { data_collection: "deny" },
    };
    if (request.temperature !== undefined)
      body.temperature = request.temperature;
    if (request.effort !== undefined)
      body.reasoning = {
        effort: request.effort === "off" ? "none" : request.effort,
      };
    if (request.tools?.length)
      body.tools = request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));
    if (request.output)
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: request.output.name,
          strict: true,
          schema: request.output.schema,
        },
      };
    let response = null;
    let error = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0)
        await new Promise((resolve) =>
          setTimeout(resolve, [0, 3_000, 10_000, 30_000][attempt]),
        );
      try {
        response = await fetch(`${OPENROUTER}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.key}`,
            "Content-Type": "application/json",
            // The public name, as the app itself sends it.
            "HTTP-Referer": `https://${PRODUCT.kebab}.local/eval`,
            "X-Title": `${PRODUCT.name} evaluation`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
        });
        error = null;
        if (response.ok || (response.status !== 429 && response.status < 500))
          break;
        error = `HTTP ${response.status}`;
      } catch (thrown) {
        error = thrown instanceof Error ? thrown.message : String(thrown);
        response = null;
      }
    }
    if (!response || !response.ok) {
      const status = response?.status ?? 0;
      const detail = response ? (await response.text()).slice(0, 400) : "";
      yield {
        type: "failed",
        error: {
          code:
            status === 429
              ? "rate-limited"
              : status === 413
                ? "context-too-large"
                : status >= 500 || status === 0
                  ? "connection"
                  : "provider-rejected",
          message: `OpenRouter: ${error ?? `HTTP ${status}`} ${detail}`.trim(),
          retryable: status === 429 || status >= 500 || status === 0,
        },
      };
      return;
    }
    const json = await response.json();
    const choice = json.choices?.[0];
    const message = choice?.message ?? {};
    if (typeof message.content === "string" && message.content)
      yield { type: "text-delta", text: message.content };
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    for (const call of calls) {
      let parsed = call.function?.arguments;
      try {
        parsed = JSON.parse(parsed);
      } catch {
        // Left as the string it came as; the caller's validation says no.
      }
      yield {
        type: "tool-call-ready",
        call: { id: call.id, name: call.function?.name, arguments: parsed },
      };
    }
    if (json.usage)
      yield {
        type: "usage",
        inputTokens: json.usage.prompt_tokens,
        outputTokens: json.usage.completion_tokens,
        ...(typeof json.usage.prompt_tokens_details?.cached_tokens === "number"
          ? {
              cachedInputTokens: json.usage.prompt_tokens_details.cached_tokens,
            }
          : {}),
      };
    yield {
      type: "completed",
      reason:
        calls.length > 0
          ? "tools"
          : choice?.finish_reason === "length"
            ? "limit"
            : choice?.finish_reason === "content_filter"
              ? "refusal"
              : "answer",
    };
  }
}

/** OpenRouter's public model listing: no key, no prose. */
export async function openRouterListing() {
  const response = await fetch(`${OPENROUTER}/models`);
  if (!response.ok)
    throw new Error(`OpenRouter model listing: HTTP ${response.status}`);
  return (await response.json()).data ?? [];
}

/** Calls, failures, time and tokens per request kind. */
export function stagesOf(calls) {
  const stages = {};
  for (const call of calls) {
    const row = (stages[call.stage] ??= {
      calls: 0,
      failed: 0,
      ms: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
    row.calls += 1;
    if (call.outcome !== "completed") row.failed += 1;
    row.ms += call.ms;
    row.inputTokens += call.inputTokens ?? 0;
    row.outputTokens += call.outputTokens ?? 0;
  }
  return stages;
}

/** The tree this measured: commit, whether it was clean, the runtime. */
export function treeProvenance() {
  const git = (args) => {
    try {
      return execSync(`git ${args}`, { cwd: WEB, encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  };
  return {
    commit: git("rev-parse HEAD"),
    branch: git("rev-parse --abbrev-ref HEAD"),
    dirty: (git("status --porcelain -- src scripts") ?? "").length > 0,
    node: process.version,
  };
}

/**
 * The model as its provider lists it: Ollama's digest, size, family and
 * quantisation; OpenRouter's context, output ceiling, prices and supported
 * parameters, and never anything that needed the key.
 */
export async function modelProvenance({
  dry,
  providerName,
  modelId,
  endpoint,
  listing,
}) {
  if (dry) return { name: "stub", digest: null, details: null };
  if (providerName === "openrouter") {
    const row = listing.find((one) => one.id === modelId);
    return row
      ? {
          name: row.id,
          label: row.name ?? null,
          contextLength: row.context_length ?? null,
          maxCompletionTokens: row.top_provider?.max_completion_tokens ?? null,
          pricing: row.pricing ?? null,
          supportedParameters: row.supported_parameters ?? null,
          created: row.created ?? null,
        }
      : { name: modelId, listed: false };
  }
  try {
    const response = await fetch(`${endpoint}/api/tags`);
    const listed = ((await response.json()).models ?? []).find(
      (one) => one.name === modelId || one.model === modelId,
    );
    return listed
      ? {
          name: listed.name,
          digest: listed.digest,
          size: listed.size,
          modifiedAt: listed.modified_at,
          details: listed.details ?? null,
        }
      : { name: modelId, digest: null, details: null };
  } catch {
    return { name: modelId, digest: null, details: null };
  }
}
