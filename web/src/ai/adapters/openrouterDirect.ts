// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ModelProvider } from "../ports";
import type {
  ModelDescriptor,
  ModelEvent,
  ModelFailure,
  ModelRef,
  ModelRequest,
} from "../domain/types";
import { estimateRequestTokens } from "../domain/estimate";
import { keyVerdict } from "../domain/openrouterKey";
import { kindForDestination } from "../domain/providerKind";
import type { ModelDestination } from "../domain/providerKind";
import { StreamDeadlines } from "./streamDeadlines";
import {
  OPENROUTER_API,
  OPENROUTER_HOST,
  attributionHeaders,
  codeForStatus,
  custody,
  directInit,
  keyFrom,
  refusal,
  refusalHead,
  refusalHints,
  refusesKey,
  safely,
} from "./directWire";
import type { Attribution } from "./directWire";
import {
  MAX_BODY_BYTES,
  openRouterBody,
  refuseGeneration,
} from "./openrouterRequest";
import { OpenRouterStreamDecoder } from "./openrouterStream";
import type { StreamSpend } from "./openrouterStream";
import { projectCatalogue } from "./openrouterCatalogue";
import { inspectKey } from "./openrouterAuth";
import { ModelRunError } from "../application/runStep";
import { appLog, describeError } from "../../log";

export interface DirectTimeouts {
  metadataMs: number;
  /** Generous: a remote model behind a queue can be quiet a long time. */
  firstOutputMs: number;
  inactivityMs: number;
  /** The ceiling on one generation, whatever else happens. */
  stepMs: number;
}

export const DEFAULT_DIRECT_TIMEOUTS: DirectTimeouts = {
  metadataMs: 15_000,
  firstOutputMs: 180_000,
  inactivityMs: 120_000,
  stepMs: 300_000,
};

/**
 * How long a failed or empty catalogue read keeps the model list from asking
 * again. Describing the model a turn runs on never waits on it.
 */
const CATALOGUE_BACKOFF_MS = 30_000;

/**
 * The key read on a 429 or a 402 stands between the writer and an answer, so
 * it is short.
 */
const KEY_READ_MS = 5_000;

export interface OpenRouterDirectOptions {
  fetcher?: typeof fetch;
  /**
   * The writer's key, read per request. `null`, an empty string or a throw
   * is no key: the request is refused before anything is sent.
   */
  apiKey: () => string | null | Promise<string | null>;
  /**
   * The custody check, run after the key is read and before anything is
   * sent: the key's verdict, expired or limit-reached, decided by the host.
   * A failure it returns is the request's, provably unsent; a throw refuses
   * as `connection`.
   */
  beforeSend?: (signal: AbortSignal) => Promise<ModelFailure | null>;
  attribution: Attribution;
  timeouts?: Partial<DirectTimeouts>;
  /**
   * Told when a refusal concerns the key (`key-expired`, `limit-reached`,
   * `credit-exhausted`), so the account reads it again.
   */
  onKeyRefused?: () => void;
  /**
   * Told when a stream the vendor accepted is over, however it ended, with
   * what it reported about its cost: the key may have been charged.
   */
  onSpent?: (spend: StreamSpend) => void;
  /** Read only by the breaker's clock in tests. */
  now?: () => number;
}

function failure(error: ModelFailure): ModelEvent {
  return { type: "failed", error };
}

/**
 * OpenRouter, called from the browser with the writer's own key.
 *
 * The destination is `direct` to the vendor's API, so `kindForDestination`
 * answers `remote` from the endpoint itself: the prose leaves the machine
 * for `openrouter.ai`, which routes it on to a model host that promises not
 * to keep it (`data_collection: "deny"`).
 *
 * Everything decided before a byte leaves is provably unsent: an aborted
 * signal, a body the gate refuses, no key, and the host's custody check.
 * After the request is out, a refusal is read by its status alone and a
 * stream is decoded by `OpenRouterStreamDecoder`, so no vendor text reaches
 * the transcript.
 *
 * There is no `probeTools`: a probe would be a synthetic round trip billed
 * to the writer's key each time a settings pane opens, buying nothing the
 * catalogue does not state.
 */
export class OpenRouterDirectProvider implements ModelProvider {
  readonly id: string;

  readonly destination: ModelDestination = {
    via: "direct",
    endpoint: OPENROUTER_API,
  };

  /** Where the prose ends up, for copy; never the privacy axis. */
  readonly upstreamHost = OPENROUTER_HOST;

  private readonly fetcher: typeof fetch;

  private readonly options: OpenRouterDirectOptions;

  private readonly timeouts: DirectTimeouts;

  private readonly now: () => number;

  private catalogue: Map<string, ModelDescriptor> | null = null;

  private catalogueRetryAt = 0;

  constructor(providerId: string, options: OpenRouterDirectOptions) {
    this.id = providerId;
    this.options = options;
    const fetcher = options.fetcher ?? fetch;
    // A closure, not the stored reference: a native `fetch` called as a
    // method throws "Illegal invocation".
    this.fetcher = (...args) => fetcher(...args);
    this.timeouts = { ...DEFAULT_DIRECT_TIMEOUTS, ...options.timeouts };
    this.now = options.now ?? Date.now;
  }

  /**
   * The catalogue's models. A failed or empty read answers none rather than
   * throwing, and the list is not asked for again until the backoff passes,
   * so an outage does not cost a request per render. The caller's own abort
   * still rejects.
   */
  async listModels(signal: AbortSignal): Promise<ModelDescriptor[]> {
    if (!this.catalogue && this.now() < this.catalogueRetryAt) return [];
    try {
      return [...(await this.load(signal)).values()];
    } catch (error) {
      if (signal.aborted) throw error;
      return [];
    }
  }

  /**
   * What a model can do, from the catalogue and never from a probe. Throws
   * for a model the catalogue does not list rather than inventing one: a
   * guessed `tools: true` offers a tool loop to a model that cannot run one.
   *
   * A catalogue that cannot be read is asked again here whatever the list's
   * backoff, because a turn is waiting on it, and fails the turn as
   * `connection`: the model is not known to be missing, only unreachable.
   */
  async describeModel(
    ref: ModelRef,
    signal: AbortSignal,
  ): Promise<ModelDescriptor> {
    let models: Map<string, ModelDescriptor>;
    try {
      models = await this.load(signal);
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ModelRunError(refusal("connection"));
    }
    const found = models.get(ref.modelId);
    if (!found) throw new Error(`openrouter-unknown-model:${ref.modelId}`);
    return found;
  }

  async estimate(
    request: ModelRequest,
  ): Promise<{ tokens: number; exact: boolean }> {
    return estimateRequestTokens(request);
  }

  /**
   * The catalogue, kept for the instance's life once it lists a model.
   *
   * A failed or empty read throws and is not kept, so one blip does not hide
   * every model for the session; it starts the list's backoff.
   *
   * The key rides along when there is one. The catalogue itself is public,
   * so a key the vendor refuses is dropped and the read made again without
   * it: a revoked key must still reach the custody check, which offers the
   * renewal, rather than fail the turn here.
   */
  private async load(
    signal: AbortSignal,
  ): Promise<Map<string, ModelDescriptor>> {
    if (this.catalogue) return this.catalogue;

    const deadlines = StreamDeadlines.once(
      signal,
      this.timeouts.metadataMs,
      "metadata-timeout",
    );
    const started = this.now();
    let status: number | undefined;
    try {
      const key = await keyFrom(this.options.apiKey);
      const read = (bearer: string | null) =>
        this.fetcher(
          `${OPENROUTER_API}/models`,
          directInit({
            method: "GET",
            signal: deadlines.signal,
            ...(bearer
              ? { headers: { Authorization: `Bearer ${bearer}` } }
              : {}),
          }),
        );
      let response = await read(key);
      if (key && (response.status === 401 || response.status === 403)) {
        void response.body?.cancel().catch(() => undefined);
        response = await read(null);
      }
      status = response.status;
      if (!response.ok) throw new Error(`catalogue-${response.status}`);
      const models = projectCatalogue(
        await response.json(),
        this.id,
        kindForDestination(this.destination),
      );
      if (models.length === 0) throw new Error("catalogue-empty");
      this.catalogue = new Map(models.map((model) => [model.id, model]));
      return this.catalogue;
    } catch (error) {
      if (!signal.aborted) {
        this.catalogueRetryAt = this.now() + CATALOGUE_BACKOFF_MS;
        appLog.warn("ai", "The OpenRouter model catalogue could not be read.", {
          provider: this.id,
          ...(status === undefined ? {} : { status }),
          ms: this.now() - started,
          ...describeError(error),
        });
      }
      throw error;
    } finally {
      deadlines.dispose();
    }
  }

  async *generate(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent> {
    if (signal.aborted) {
      yield failure(cancelled());
      return;
    }

    const refused = refuseGeneration(request);
    if (refused) {
      // A request the app built that fails its own gate is a bug, so the field
      // is named; no value is echoed.
      yield failure(
        refused.code === "context-too-large"
          ? refusal(refused.code)
          : {
              code: "provider-rejected",
              message: `The request could not be sent: ${refused.field}.`,
              retryable: false,
            },
      );
      return;
    }
    // Encoded once: the bytes measured are the bytes sent.
    const body = new TextEncoder().encode(
      JSON.stringify(openRouterBody(request)),
    );
    if (body.length > MAX_BODY_BYTES) {
      yield failure(refusal("context-too-large"));
      return;
    }

    const key = await keyFrom(this.options.apiKey);
    if (key === null) {
      yield failure(refusal("not-configured"));
      return;
    }
    const held = await custody(this.options.beforeSend, signal);
    if (signal.aborted) {
      yield failure(cancelled());
      return;
    }
    if (held) {
      if (refusesKey(held.code)) safely(this.options.onKeyRefused);
      yield failure(held);
      return;
    }

    const deadlines = new StreamDeadlines(signal, {
      stepMs: this.timeouts.stepMs,
      firstOutputMs: this.timeouts.firstOutputMs,
      inactivityMs: this.timeouts.inactivityMs,
    });

    let response: Response;
    try {
      response = await this.fetcher(
        `${OPENROUTER_API}/chat/completions`,
        directInit({
          method: "POST",
          signal: deadlines.signal,
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...attributionHeaders(this.options.attribution),
          },
          body,
        }),
      );
    } catch {
      deadlines.dispose();
      yield failure(stopped(signal, deadlines.timedOut));
      return;
    }

    if (!response.ok) {
      // Read inside the deadlines, so a refusal whose body stalls still ends
      // on Stop or at the step deadline.
      const answer = await this.refusal(
        response,
        key,
        request.model.modelId,
        deadlines.signal,
      );
      deadlines.dispose();
      if (signal.aborted || deadlines.timedOut) {
        yield failure(stopped(signal, deadlines.timedOut));
        return;
      }
      if (refusesKey(answer.code)) safely(this.options.onKeyRefused);
      yield failure(answer);
      return;
    }

    const decoder = new OpenRouterStreamDecoder(this.id, request.model.modelId);

    if (!response.body) {
      deadlines.dispose();
      yield failure({
        code: "invalid-response",
        message: "The provider returned no stream.",
        retryable: true,
      });
      safely(this.options.onSpent, decoder.spend());
      return;
    }

    const reader = response.body.getReader();
    let finished = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        // Any chunk, the vendor's `:` keepalive included, is a sign of life
        // and resets the idle window; the step deadline stays the ceiling on a
        // stream that only ever keeps alive.
        if (value.length > 0) deadlines.touch();
        for (const event of decoder.push(value)) {
          yield event;
          // A failed run reads no further: the decoder drops what follows,
          // and a stream past its bounds would run on, billed, unseen.
          if (event.type === "failed") return;
        }
      }
      finished = true;
      yield* decoder.finish();
    } catch {
      if (finished) return;
      // A transport error after `[DONE]` lands on a step that is whole and
      // billed. Failing it would have the application run, and pay for, the
      // step again.
      if (decoder.sawDone()) {
        yield* decoder.finish();
        return;
      }
      yield failure(
        stopped(
          signal,
          deadlines.timedOut,
          "The connection to the provider broke.",
        ),
      );
    } finally {
      deadlines.dispose();
      // Cancelling the body closes the connection, half of what makes Stop
      // stop: a reader that has gone must not keep the vendor generating at
      // the writer's cost.
      void reader.cancel().catch(() => undefined);
      safely(this.options.onSpent, decoder.spend());
    }
  }

  /**
   * The vendor's refusal, by status, with the few facts its head can add:
   * the data-policy 404, which kind of 429 this is, and which
   * kind of 402.
   */
  private async refusal(
    response: Response,
    key: string,
    modelId: string,
    signal: AbortSignal,
  ): Promise<ModelFailure> {
    const head = await refusalHead(response);
    const hints = refusalHints(response, head);
    let code = codeForStatus(response.status, head);
    if (response.status === 429)
      code = await this.whichRateLimit(
        hints.rateLimitHeaders,
        key,
        modelId,
        signal,
      );
    if (response.status === 402)
      code = await whichPaymentRefusal(this.fetcher, key, signal, this.now);
    return refusal(code, hints.retryAfter);
  }

  /**
   * Which "slow down" a 429 is, told apart without reading a word of it.
   *
   * The vendor's own limits come with `X-RateLimit-*` headers, repeated in
   * its error body because the browser cannot read the headers
   * cross-origin; a model host at capacity sends none. A free variant whose
   * day's requests are spent, by the vendor's own count, is
   * `quota-exhausted` whatever else is visible, because waiting a moment
   * does nothing for it. Otherwise no such headers is `model-busy`, and
   * anything else `rate-limited`, the milder reading.
   */
  private async whichRateLimit(
    rateLimitHeaders: boolean,
    key: string,
    modelId: string,
    signal: AbortSignal,
  ): Promise<ModelFailure["code"]> {
    if (modelId.endsWith(":free")) {
      const read = await inspectKey(this.fetcher, key, signal, KEY_READ_MS);
      const left = read.ok
        ? (read.info.freeModelDailyRequests?.remaining ?? null)
        : null;
      if (left !== null && left <= 0) return "quota-exhausted";
    }
    return rateLimitHeaders ? "rate-limited" : "model-busy";
  }
}

/**
 * Which "payment required" a 402 is. The vendor answers it both for an
 * account with no credit and for a key past its own spend limit, and only a
 * reading of the key tells the two apart: `limit-reached` when the key's
 * verdict says its limit is spent, `credit-exhausted` otherwise, a failed
 * reading included. One bounded read.
 */
export async function whichPaymentRefusal(
  fetcher: typeof fetch,
  key: string,
  signal: AbortSignal,
  now: () => number = Date.now,
): Promise<"limit-reached" | "credit-exhausted"> {
  const read = await inspectKey(fetcher, key, signal, KEY_READ_MS);
  return read.ok && keyVerdict(read.info, now()).state === "limit-reached"
    ? "limit-reached"
    : "credit-exhausted";
}

function cancelled(): ModelFailure {
  return { code: "cancelled", message: "Request cancelled", retryable: false };
}

/**
 * Which of "the writer stopped it", "it stopped answering" and "the network
 * failed" happened. Fixed messages, never the exception's: a `TypeError`
 * names the network and an error from a body read can quote it.
 */
function stopped(
  signal: AbortSignal,
  timedOut: boolean,
  broken = "The provider could not be reached.",
): ModelFailure {
  if (signal.aborted) return cancelled();
  if (timedOut)
    return {
      code: "timeout",
      message: "The provider stopped responding.",
      retryable: true,
    };
  return { code: "connection", message: broken, retryable: true };
}
