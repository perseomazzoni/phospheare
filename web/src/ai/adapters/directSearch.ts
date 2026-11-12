// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type {
  ModelFailure,
  WebEngine,
  WebResult,
  WebSearchOutcome,
} from "../domain/types";
import { normaliseQuery, wikiLanguage } from "../domain/webText";
import {
  WIKI_LANGUAGE,
  acceptableQuery,
  normalizeSearchResults,
  searchCost,
} from "../domain/searchResults";
import { htmlToText } from "../domain/htmlText";
import type { WebSearchEngine } from "../ports";
import { StreamDeadlines } from "./streamDeadlines";
import {
  OPENROUTER_API,
  attributionHeaders,
  codeForStatus,
  custody,
  directInit,
  headerText,
  keyFrom,
  readCapped,
  refusal,
  refusalHead,
  refusalHints,
  refusesKey,
  safely,
} from "./directWire";
import type { Attribution } from "./directWire";
import { MODEL_ID } from "./openrouterRequest";
import { whichPaymentRefusal } from "./openrouterDirect";

// The two search engines, each calling its engine from the browser.
//
// Neither normalises the query: it is sent as given, because what the card
// showed is what the writer approved. A query not already in its normal form,
// or one the engines' own rule refuses, is refused before any request exists,
// which is the only way an outcome may say the query was not sent (`no`).
// A fetch that rejects is `unknown`; once a status has arrived, `yes`.

/** The engine's whole exchange, body included. */
export const WIKIPEDIA_DEADLINE_MS = 17_000;

/**
 * The provider's custody check and its engine together: a key reading of a
 * few seconds, then a model request that runs one search.
 */
export const PROVIDER_SEARCH_DEADLINE_MS = 30_000;

/** The most of an engine's answer ever read. */
export const SEARCH_MAX_BODY_BYTES = 524_288;

const NOT_A_QUERY: ModelFailure = {
  code: "provider-rejected",
  message: "The query is not one line of plain text.",
  retryable: false,
};

/**
 * The search could not be built, for example because the host's language
 * thunk threw. No code names "the app broke before sending", so this borrows
 * the closest; not retryable, because the same attempt breaks the same way.
 */
const NOT_BUILT: ModelFailure = {
  code: "invalid-response",
  message: "The search could not be prepared.",
  retryable: false,
};

/**
 * The model answered without running the search. `invalid-response`, whose
 * remedy is the re-ask on Wikipedia: an empty result here would tell the
 * writer the web holds nothing on a query nobody looked up.
 */
const NOT_SEARCHED: ModelFailure = {
  code: "invalid-response",
  message: "The provider answered without searching.",
  retryable: false,
};

function stoppedFailure(signal: AbortSignal, timedOut: boolean): ModelFailure {
  if (signal.aborted)
    return {
      code: "cancelled",
      message: "Search cancelled.",
      retryable: false,
    };
  if (timedOut)
    return {
      code: "timeout",
      message: "The search stopped responding.",
      retryable: true,
    };
  return {
    code: "connection",
    message: "The search engine could not be reached.",
    retryable: true,
  };
}

/** What a search may still say before any request exists. */
type Prepared =
  | { refused: ModelFailure }
  | {
      url: string;
      init: Omit<
        RequestInit,
        "credentials" | "redirect" | "referrerPolicy" | "signal"
      >;
      /** Reads the answer once a status arrived; every outcome is `yes`. */
      read(response: Response): Promise<WebSearchOutcome>;
      /** What the answer reported about its cost, once read. */
      spent?: () => SearchSpend;
    };

abstract class DirectSearchEngine implements WebSearchEngine {
  abstract readonly engine: WebEngine;

  protected readonly fetcher: typeof fetch;

  constructor(
    fetcher: typeof fetch,
    private readonly timeoutMs: number,
  ) {
    // A closure, not the stored reference: a native `fetch` called as a
    // method throws "Illegal invocation".
    this.fetcher = (...args) => fetcher(...args);
  }

  /** Everything decided before the fetch; a refusal here is `no`. */
  protected abstract prepare(
    query: string,
    signal: AbortSignal,
  ): Promise<Prepared>;

  /**
   * After the search, with whether a request left and what it reported
   * spending. Never throws.
   */
  protected settled?(
    outcome: WebSearchOutcome,
    requested: boolean,
    spend: SearchSpend,
  ): void;

  async search(query: string, signal: AbortSignal): Promise<WebSearchOutcome> {
    let requested = false;
    let spent: (() => SearchSpend) | undefined;
    let outcome: WebSearchOutcome;
    try {
      outcome = await this.exchange(query, signal, (prepared) => {
        requested = true;
        spent = prepared.spent;
      });
    } catch {
      // `exchange` answers on every path; this holds the port's contract
      // against one it missed. A throw before the fetch sent nothing and
      // says so.
      outcome = requested
        ? {
            status: "failed",
            failure: stoppedFailure(signal, false),
            reached: "unknown",
          }
        : { status: "failed", failure: NOT_BUILT, reached: "no" };
    }
    this.settled?.(outcome, requested, spent?.() ?? {});
    return outcome;
  }

  private async exchange(
    query: string,
    signal: AbortSignal,
    requesting: (prepared: { spent?: () => SearchSpend }) => void,
  ): Promise<WebSearchOutcome> {
    if (normaliseQuery(query) !== query || !acceptableQuery(query))
      return { status: "failed", failure: NOT_A_QUERY, reached: "no" };
    if (signal.aborted)
      return {
        status: "failed",
        failure: stoppedFailure(signal, false),
        reached: "no",
      };

    const deadlines = StreamDeadlines.once(
      signal,
      this.timeoutMs,
      "search-timeout",
    );
    try {
      let prepared: Prepared;
      try {
        prepared = await this.prepare(query, deadlines.signal);
      } catch {
        return { status: "failed", failure: NOT_BUILT, reached: "no" };
      }
      if ("refused" in prepared)
        return { status: "failed", failure: prepared.refused, reached: "no" };
      if (deadlines.signal.aborted)
        return {
          status: "failed",
          failure: stoppedFailure(signal, deadlines.timedOut),
          reached: "no",
        };

      let response: Response;
      try {
        requesting(prepared);
        response = await this.fetcher(
          prepared.url,
          directInit({ ...prepared.init, signal: deadlines.signal }),
        );
      } catch {
        // No answer at all, so no one can say whether it arrived.
        return {
          status: "failed",
          failure: stoppedFailure(signal, deadlines.timedOut),
          reached: "unknown",
        };
      }

      // A status arrived: the engine was reached, whatever follows.
      try {
        const outcome = await prepared.read(response);
        if (
          outcome.status === "failed" &&
          (signal.aborted || deadlines.timedOut)
        )
          return {
            status: "failed",
            failure: stoppedFailure(signal, deadlines.timedOut),
            reached: "yes",
          };
        return outcome;
      } catch {
        return {
          status: "failed",
          failure:
            signal.aborted || deadlines.timedOut
              ? stoppedFailure(signal, deadlines.timedOut)
              : refusal("connection"),
          reached: "yes",
        };
      }
    } finally {
      // Only once the body is in: Stop and the deadline must reach the read.
      deadlines.dispose();
    }
  }
}

/** A 2xx body as JSON, within the cap, or `null`. Over the cap is `null` too. */
async function cappedJson(response: Response): Promise<unknown> {
  const { text, over } = await readCapped(response, SEARCH_MAX_BODY_BYTES);
  if (over) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const failedYes = (failure: ModelFailure): WebSearchOutcome => ({
  status: "failed",
  failure,
  reached: "yes",
});

// ── Wikipedia ────────────────────────────────────────────────────────────────

const BACKOFF_DEFAULT_S = 60;
const BACKOFF_MIN_S = 1;
const BACKOFF_MAX_S = 3_600;

/**
 * Wikimedia's `Retry-After` in seconds: delta-seconds or an IMF-fixdate.
 * Absent or unreadable is the default, never "no wait"; a run of digits too
 * long to be a number is a very long wait, clamped to the longest.
 */
export function backoffSeconds(header: string | null, now: number): number {
  const value = (header ?? "").trim();
  let seconds: number | null = null;
  if (/^\d+$/.test(value)) {
    const digits = value.replace(/^0+(?=\d)/, "");
    seconds = digits.length > 10 ? BACKOFF_MAX_S : Number(digits);
  } else if (
    /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      value,
    )
  ) {
    const at = Date.parse(value);
    if (Number.isFinite(at)) seconds = Math.ceil((at - now) / 1_000);
  }
  return Math.max(
    BACKOFF_MIN_S,
    Math.min(BACKOFF_MAX_S, seconds ?? BACKOFF_DEFAULT_S),
  );
}

/** `rawurlencode`: everything but the unreserved set is escaped. */
function rawUrlEncode(text: string): string {
  return encodeURIComponent(text).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export interface WikipediaDirectOptions {
  /** Read once per search, at send time: the edition asked for and the only host rows may name. */
  language: () => string | undefined;
  /**
   * The product's name as one token (`PRODUCT.pascal`), for the
   * `Api-User-Agent` Wikimedia's policy asks for.
   */
  productPascal: string;
  /** How to reach whoever runs the app; at most 200 characters. */
  contact?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

const DEFAULT_CONTACT = "https://github.com/perseomazzoni/phospheare";

/**
 * Wikipedia, through MediaWiki's own `rest.php` search: one GET per search,
 * no key and no cost.
 *
 * The query rides in the URL's query string, built by `URLSearchParams`,
 * never concatenated. Each result's URL is built from the edition's host and
 * the page key, never read from the answer; title and excerpt arrive as HTML
 * and become text, tags first and entities second.
 *
 * A Wikimedia 429 opens this engine's breaker for as long as it asked, and
 * until then a search is refused before anything is sent: the one case in
 * which this engine may say a query stayed home besides a bad query.
 * Cross-origin, the browser cannot read `Retry-After` (Wikimedia exposes no
 * headers), so the wait is most often the default minute.
 */
export class WikipediaDirectSearchEngine extends DirectSearchEngine {
  readonly engine: WebEngine = Object.freeze({ kind: "wikipedia" });

  private readonly language: () => string | undefined;

  private readonly userAgent: string;

  private readonly now: () => number;

  private openUntil = 0;

  constructor(options: WikipediaDirectOptions) {
    super(options.fetcher ?? fetch, options.timeoutMs ?? WIKIPEDIA_DEADLINE_MS);
    this.language = options.language;
    this.now = options.now ?? Date.now;
    const product =
      options.productPascal.replace(/[^A-Za-z0-9]/g, "") || "WebSearch";
    const contact = headerText(options.contact ?? "", 200) ?? DEFAULT_CONTACT;
    this.userAgent = `${product}/1.0 (${contact}) web-search`;
  }

  protected async prepare(query: string): Promise<Prepared> {
    const waiting = this.openUntil - this.now();
    if (waiting > 0)
      return { refused: refusal("rate-limited", Math.ceil(waiting / 1_000)) };

    // The one call of `wikiLanguage`, because the port is the boundary.
    const code = wikiLanguage(this.language());
    if (!WIKI_LANGUAGE.test(code)) return { refused: NOT_BUILT };
    const host = `${code}.wikipedia.org`;
    const params = new URLSearchParams({ q: query, limit: "5" });

    return {
      url: `https://${host}/w/rest.php/v1/search/page?${params.toString()}`,
      init: {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Api-User-Agent": this.userAgent,
        },
      },
      read: async (response) => {
        // A refusal is read by its status alone; its body is let go unread.
        if (!response.ok) void response.body?.cancel().catch(() => undefined);
        if (response.status === 429) {
          const seconds = backoffSeconds(
            response.headers.get("Retry-After"),
            this.now(),
          );
          this.openUntil = this.now() + seconds * 1_000;
          return failedYes(refusal("rate-limited", seconds));
        }
        if (!response.ok)
          return failedYes(
            refusal(
              response.status >= 400 && response.status < 500
                ? "provider-rejected"
                : "connection",
            ),
          );

        const body = await cappedJson(response);
        const pages =
          typeof body === "object" && body !== null
            ? (body as { pages?: unknown }).pages
            : undefined;
        if (!Array.isArray(pages)) return failedYes(refusal("connection"));

        const rows: Array<{ url: string; title: string; excerpt: string }> = [];
        for (const page of pages) {
          if (typeof page !== "object" || page === null) continue;
          const { key, title, excerpt } = page as Record<string, unknown>;
          if (typeof key !== "string" || key === "") continue;
          rows.push({
            url: `https://${host}/wiki/${rawUrlEncode(key)}`,
            title: htmlToText(title),
            excerpt: htmlToText(excerpt),
          });
        }
        // No cost, whatever the body says: this engine bills nobody.
        return {
          status: "searched",
          results: normalizeSearchResults(rows, { host }),
        };
      },
    };
  }
}

// ── A provider's search ──────────────────────────────────────────────────────

/** Room for the one tool call and nothing more; the answer is never read. */
const SEARCH_MAX_TOKENS = 200;

/**
 * The fixed instruction the search model gets. It carries none of the
 * writer's text; the user message is the approved query, and nothing else
 * from the book travels.
 */
const SEARCH_INSTRUCTION =
  "Run exactly one web search, using the user's message verbatim as the search query. Reply with nothing else.";

/** What a provider search reported about its own cost. */
export interface SearchSpend {
  costUsd?: number;
  /** How many searches the vendor says ran, when it says. */
  searchesRun?: number;
}

export interface OpenRouterSearchOptions {
  fetcher?: typeof fetch;
  apiKey: () => string | null | Promise<string | null>;
  /** The custody check, as on the chat; a refusal it returns is `no`. */
  beforeSend?: (signal: AbortSignal) => Promise<ModelFailure | null>;
  attribution: Attribution;
  /**
   * The model the writer chose for the run that searches. The search runs
   * on it or not at all (`searchModelOf`).
   */
  model: string;
  timeoutMs?: number;
  /** The key was refused: expired, its limit spent, or no credit. */
  onKeyRefused?: () => void;
  /** A request left, and may have cost something. */
  onSpent?: (spend: SearchSpend) => void;
}

/**
 * The model id when a search may run on it, or `null`: the id's character
 * set, and neither `:` nor `@`, since either suffix can switch something on
 * for the request it rides. No other model stands in for one refused here:
 * the writer chooses every model a request names.
 */
export function searchModelOf(configured: unknown): string | null {
  return typeof configured === "string" &&
    configured.length <= 200 &&
    MODEL_ID.test(configured) &&
    !configured.includes(":") &&
    !configured.includes("@")
    ? configured
    : null;
}

function integerAtLeastZero(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/**
 * The search's results out of a chat completion: each
 * `choices[0].message.annotations[i].url_citation` whose `type` is
 * `url_citation`, as `{url, title, excerpt: content}`. `message.content`,
 * the model's own answer to the instruction, is never read. `null`
 * when there is no message at all. Whether no annotations means a search
 * that found nothing or one that never ran is `searchesRun`'s to say.
 */
export function projectSearchAnswer(
  body: unknown,
): { rows: unknown[]; costUsd?: number; searchesRun?: number } | null {
  if (typeof body !== "object" || body === null) return null;
  const choices = (body as { choices?: unknown }).choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message =
    typeof first === "object" && first !== null
      ? (first as { message?: unknown }).message
      : undefined;
  if (typeof message !== "object" || message === null || Array.isArray(message))
    return null;

  const annotations = (message as { annotations?: unknown }).annotations;
  const rows: unknown[] = [];
  for (const annotation of Array.isArray(annotations) ? annotations : []) {
    if (typeof annotation !== "object" || annotation === null) continue;
    const { type, url_citation: citation } = annotation as Record<
      string,
      unknown
    >;
    if (
      type !== "url_citation" ||
      typeof citation !== "object" ||
      citation === null
    )
      continue;
    const { url, title, content } = citation as Record<string, unknown>;
    rows.push({ url, title, excerpt: content });
  }

  const usage = (body as { usage?: unknown }).usage;
  const figures =
    typeof usage === "object" && usage !== null
      ? (usage as Record<string, unknown>)
      : {};
  const tool = figures.server_tool_use;
  const searchesRun =
    integerAtLeastZero(
      typeof tool === "object" && tool !== null
        ? (tool as Record<string, unknown>).web_search_requests
        : undefined,
    ) ?? integerAtLeastZero(figures.web_search_requests);
  const costUsd = searchCost(figures.cost);

  return {
    rows,
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(searchesRun !== undefined ? { searchesRun } : {}),
  };
}

/**
 * OpenRouter's web search, on the writer's key and the writer's model: one
 * chat completion with the vendor's `openrouter:web_search` server tool, Exa
 * as the engine, at most one search and five results.
 *
 * What is disclosed is the approved query, as the only user message, beside
 * a fixed instruction that carries nothing of the writer's. The vendor's
 * tool does not take a query from the caller: the model writes it, told to
 * use the message verbatim, so the query the engine runs may be a rewording
 * of the approved one. `max_uses: 1` holds it to a single search, and
 * `searchesRun` reports how many the vendor counted.
 *
 * `engine` is built from the one `providerId`, so what the ask names and
 * where the query goes cannot differ.
 */
export class OpenRouterDirectSearchEngine extends DirectSearchEngine {
  readonly engine: WebEngine;

  private readonly options: OpenRouterSearchOptions;

  private readonly model: string | null;

  constructor(providerId: string, options: OpenRouterSearchOptions) {
    super(
      options.fetcher ?? fetch,
      options.timeoutMs ?? PROVIDER_SEARCH_DEADLINE_MS,
    );
    this.engine = Object.freeze({ kind: "provider", providerId });
    this.options = options;
    this.model = searchModelOf(options.model);
  }

  protected async prepare(
    query: string,
    signal: AbortSignal,
  ): Promise<Prepared> {
    // Before the key is read: nothing leaves for a model no search runs on.
    if (this.model === null) return { refused: refusal("not-configured") };
    const key = await keyFrom(this.options.apiKey);
    if (key === null) return { refused: refusal("not-configured") };
    const held = await custody(this.options.beforeSend, signal);
    if (held) return { refused: held };

    const body = {
      model: this.model,
      messages: [
        { role: "system", content: SEARCH_INSTRUCTION },
        { role: "user", content: query },
      ],
      tools: [
        {
          type: "openrouter:web_search",
          parameters: { engine: "exa", max_results: 5, max_uses: 1 },
        },
      ],
      provider: { data_collection: "deny" },
      max_tokens: SEARCH_MAX_TOKENS,
      usage: { include: true },
    };

    let spend: SearchSpend = {};
    return {
      url: `${OPENROUTER_API}/chat/completions`,
      spent: () => spend,
      init: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...attributionHeaders(this.options.attribution),
        },
        body: JSON.stringify(body),
      },
      read: async (response) => {
        if (!response.ok) {
          const head = await refusalHead(response);
          const hints = refusalHints(response, head);
          let code = codeForStatus(response.status, head);
          if (response.status === 429)
            code = hints.rateLimitHeaders ? "rate-limited" : "model-busy";
          if (response.status === 402)
            code = await whichPaymentRefusal(this.fetcher, key, signal);
          return failedYes(refusal(code, hints.retryAfter));
        }
        const projected = projectSearchAnswer(await cappedJson(response));
        if (!projected) return failedYes(refusal("connection"));
        spend = {
          ...(projected.costUsd !== undefined
            ? { costUsd: projected.costUsd }
            : {}),
          ...(projected.searchesRun !== undefined
            ? { searchesRun: projected.searchesRun }
            : {}),
        };
        // No citation and no search counted: the vendor ran none, or did not
        // say it ran one. A count of one or more with no citation is a
        // search that found nothing.
        if (projected.rows.length === 0 && (projected.searchesRun ?? 0) === 0)
          return failedYes(NOT_SEARCHED);
        const results: WebResult[] = normalizeSearchResults(projected.rows);
        return projected.costUsd !== undefined
          ? { status: "searched", results, costUsd: projected.costUsd }
          : { status: "searched", results };
      },
    };
  }

  /**
   * The credit is re-read after every search that sent a request, a refusal
   * included, because a Stop mid-flight may still have been billed, and
   * never after one refused before it left. A key refusal fires both hooks;
   * collapsing them is the account's job.
   */
  protected settled(
    outcome: WebSearchOutcome,
    requested: boolean,
    spend: SearchSpend,
  ): void {
    if (outcome.status === "failed" && refusesKey(outcome.failure.code))
      safely(this.options.onKeyRefused);
    if (requested) safely(this.options.onSpent, spend);
  }
}
