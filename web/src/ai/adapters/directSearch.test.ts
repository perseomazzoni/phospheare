// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import {
  OpenRouterDirectSearchEngine,
  WikipediaDirectSearchEngine,
  backoffSeconds,
  projectSearchAnswer,
} from "./directSearch";
import type { OpenRouterSearchOptions } from "./directSearch";
import type { ModelFailure, WebSearchOutcome } from "../domain/types";
import { QUERY_MAX } from "../domain/webText";
import { remedyOf } from "../domain/webEngine";

// What only these adapters can get wrong: sending something other
// than what the card showed, saying "not sent" of a query that may have
// left, handing a link back from a host that was never asked, and throwing
// out of a port whose contract is to answer.

const DEADLINE = 80;
const UA =
  "Phospheare/1.0 (https://github.com/perseomazzoni/phospheare) web-search";

type Answer = (init: RequestInit, url: string) => Response | Promise<Response>;

interface Call {
  url: string;
  init: RequestInit;
}

function wire(answer: Answer) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (init.signal?.aborted)
      throw new DOMException("The operation was aborted.", "AbortError");
    return answer(init, url);
  };
  return { calls, fetcher };
}

function sent(calls: Call[]): Call {
  const [one] = calls;
  if (!one) throw new Error("no request was sent");
  return one;
}

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const silent: Answer = (init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () =>
      reject(new DOMException("aborted", "AbortError")),
    );
  });

const stalledBody =
  (status: number): Answer =>
  (init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          init.signal?.addEventListener("abort", () =>
            controller.error(new DOMException("aborted", "AbortError")),
          );
        },
      }),
      { status, headers: { "Content-Type": "application/json" } },
    );

const PAGES = {
  pages: [
    {
      id: 1,
      key: "Alessandro_Manzoni",
      title: "Alessandro Manzoni",
      excerpt:
        'Disambiguazione – &quot;<span class="searchmatch">Manzoni</span>&quot; rimanda qui.',
      description: "ignored",
      thumbnail: { url: "//evil.example/x.jpg" },
    },
    {
      id: 2,
      key: "Rome_(city)",
      title: "Rome &amp; <b>city</b>",
      excerpt: "The <span>city</span> of Rome.",
    },
    { id: 3, key: "", title: "No key", excerpt: "dropped" },
    { id: 4, title: "No key at all", excerpt: "dropped" },
    { id: 5, key: "Empty", title: "Empty", excerpt: "<span></span>" },
  ],
};

function wikipedia(
  answer: Answer,
  language: () => string | undefined = () => "it",
  now?: () => number,
) {
  const w = wire(answer);
  return {
    ...w,
    engine: new WikipediaDirectSearchEngine({
      language,
      productPascal: "Phospheare",
      fetcher: w.fetcher,
      timeoutMs: DEADLINE,
      now,
    }),
  };
}

const ANNOTATED = {
  choices: [
    {
      message: {
        role: "assistant",
        content: "The model's own answer, never read.",
        annotations: [
          {
            type: "url_citation",
            url_citation: {
              url: "https://example.org/a",
              title: "A",
              content: "First excerpt.",
              start_index: 0,
            },
          },
          { type: "file", file: {} },
          {
            type: "url_citation",
            url_citation: {
              url: "javascript:alert(1)",
              title: "B",
              content: "x",
            },
          },
          {
            type: "url_citation",
            url_citation: {
              url: "https://example.org/b",
              title: "B",
              content: "",
            },
          },
          {
            url: "https://flat.example/",
            title: "flat",
            content: "never nested",
          },
        ],
      },
    },
  ],
  usage: { cost: 0.0042, server_tool_use: { web_search_requests: 1 } },
};

const KEY = "sk-or-v1-test";

/** The model the writer chose for the run that searches. */
const CHOSEN = "vendor/chosen";

function provider(
  answer: Answer,
  options: Partial<OpenRouterSearchOptions> = {},
) {
  const w = wire(answer);
  return {
    ...w,
    engine: new OpenRouterDirectSearchEngine("openrouter", {
      fetcher: w.fetcher,
      apiKey: () => KEY,
      attribution: { title: "Phospheare" },
      model: CHOSEN,
      timeoutMs: DEADLINE,
      ...options,
    }),
  };
}

const run = (
  engine: { search: (q: string, s: AbortSignal) => Promise<WebSearchOutcome> },
  query = "fondazione di Roma",
  signal = new AbortController().signal,
) => engine.search(query, signal);

const both = [
  ["wikipedia", (answer: Answer) => wikipedia(answer)],
  ["a provider", (answer: Answer) => provider(answer)],
] as const;

describe("what leaves is what the card showed", () => {
  it("asks Wikipedia's own search on the edition's host, the query in the URL and nowhere else", async () => {
    const { calls, engine } = wikipedia(
      () => json({ pages: [] }),
      () => "it-IT",
    );
    await run(engine, "fondazione di Roma & co");
    expect(calls).toHaveLength(1);
    const url = new URL(sent(calls).url);
    expect(url.origin + url.pathname).toBe(
      "https://it.wikipedia.org/w/rest.php/v1/search/page",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "fondazione di Roma & co",
      limit: "5",
    });
    expect(sent(calls).init).toMatchObject({
      method: "GET",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", "Api-User-Agent": UA },
    });
    expect(sent(calls).init.body).toBeUndefined();
  });

  it("names the product as one token and keeps the contact clean", async () => {
    const w = wire(() => json({ pages: [] }));
    const engine = new WikipediaDirectSearchEngine({
      language: () => "en",
      productPascal: "Phos\r\npheare",
      contact: "ops@example.org\r\nX-Evil: 1",
      fetcher: w.fetcher,
    });
    await run(engine);
    expect(
      (sent(w.calls).init.headers as Record<string, string>)["Api-User-Agent"],
    ).toBe("Phospheare/1.0 (ops@example.org X-Evil: 1) web-search");
  });

  it("falls back to English for a language that is not one", async () => {
    for (const language of [
      () => "evil.example/x",
      () => undefined,
      () => "EN-us",
    ]) {
      const { calls, engine } = wikipedia(() => json({ pages: [] }), language);
      await run(engine);
      expect(new URL(sent(calls).url).host).toMatch(/^(en)\.wikipedia\.org$/);
    }
  });

  it("asks the provider with the approved query as the only user message, beside a fixed instruction", async () => {
    const { calls, engine } = provider(() => json(ANNOTATED));
    await run(engine, "rome founding");
    expect(sent(calls).url).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    const body = JSON.parse(String(sent(calls).init.body));
    expect(body).toEqual({
      model: CHOSEN,
      messages: [
        {
          role: "system",
          content:
            "Run exactly one web search, using the user's message verbatim as the search query. Reply with nothing else.",
        },
        { role: "user", content: "rome founding" },
      ],
      tools: [
        {
          type: "openrouter:web_search",
          parameters: { engine: "exa", max_results: 5, max_uses: 1 },
        },
      ],
      provider: { data_collection: "deny" },
      max_tokens: 200,
      usage: { include: true },
    });
    expect(body).not.toHaveProperty("stream");
    expect(body).not.toHaveProperty("plugins");
    expect(sent(calls).init).toMatchObject({
      method: "POST",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Title": "Phospheare",
      },
    });
  });

  it("runs a search only on a model with no variant and no reference, and puts no other model in its place", async () => {
    for (const model of [
      "vendor/x:online",
      "vendor/x:free",
      "@preset/search",
      "bad id",
      "",
    ]) {
      const { calls, engine } = provider(() => json(ANNOTATED), { model });
      // Refused before anything leaves: no request, and so no model named.
      expect(await run(engine)).toMatchObject({
        status: "failed",
        reached: "no",
        failure: { code: "not-configured" },
      });
      expect(calls).toHaveLength(0);
    }
    const { calls, engine } = provider(() => json(ANNOTATED), {
      model: "vendor/searcher",
    });
    await run(engine);
    expect(JSON.parse(String(sent(calls).init.body)).model).toBe(
      "vendor/searcher",
    );
  });

  it.each(both)("sends the query byte for byte to %s", async (_, make) => {
    const query = "café \u{1D400} au lait";
    const { calls, engine } = make(() => json({ pages: [] }));
    await run(engine, query);
    const call = sent(calls);
    const value = call.url.includes("wikipedia")
      ? new URL(call.url).searchParams.get("q")
      : JSON.parse(String(call.init.body)).messages[1].content;
    expect(value).toBe(query);
  });

  it.each([
    "a\nb",
    " a",
    "a\u200Bb",
    "a\uFE0Fb",
    "x".repeat(QUERY_MAX + 1),
    "",
    "cafe\u0301",
  ])("refuses %j without a single fetch", async (query) => {
    for (const [, make] of both) {
      const { calls, engine } = make(() => json({ pages: [] }));
      expect(await run(engine, query)).toMatchObject({
        status: "failed",
        failure: { code: "provider-rejected", retryable: false },
        reached: "no",
      });
      expect(calls).toHaveLength(0);
    }
  });
});

describe("whether the query reached the engine", () => {
  it.each(both)(
    "is no, with no fetch, for a search already stopped (%s)",
    async (_, make) => {
      const { calls, engine } = make(() => json({ pages: [] }));
      const stopped = new AbortController();
      stopped.abort();
      expect(await run(engine, "rome", stopped.signal)).toMatchObject({
        status: "failed",
        failure: { code: "cancelled" },
        reached: "no",
      });
      expect(calls).toHaveLength(0);
    },
  );

  it.each(both)(
    "is unknown when the fetch got no answer (%s)",
    async (_, make) => {
      const { engine } = make(() => {
        throw new TypeError("Failed to fetch");
      });
      expect(await run(engine)).toMatchObject({
        status: "failed",
        failure: { code: "connection" },
        reached: "unknown",
      });
    },
  );

  it.each(both)(
    "is unknown at the deadline with no answer (%s)",
    async (_, make) => {
      const { engine } = make(silent);
      expect(await run(engine)).toMatchObject({
        status: "failed",
        failure: { code: "timeout" },
        reached: "unknown",
      });
    },
  );

  it.each(both)("is unknown on Stop with no answer (%s)", async (_, make) => {
    const { engine } = make(silent);
    const caller = new AbortController();
    const outcome = run(engine, "rome", caller.signal);
    setTimeout(() => caller.abort(), 10);
    expect(await outcome).toMatchObject({
      status: "failed",
      failure: { code: "cancelled" },
      reached: "unknown",
    });
  });

  it.each(both)(
    "is yes once a status arrived, even if its body never does (%s)",
    async (_, make) => {
      const { engine } = make(stalledBody(200));
      expect(await run(engine)).toMatchObject({
        status: "failed",
        failure: { code: "timeout" },
        reached: "yes",
      });
    },
  );

  it("is yes for a provider refusal whose body stalls past Stop", async () => {
    const { engine } = provider(stalledBody(500));
    const caller = new AbortController();
    const outcome = run(engine, "rome", caller.signal);
    setTimeout(() => caller.abort(), 10);
    expect(await outcome).toMatchObject({
      status: "failed",
      failure: { code: "cancelled" },
      reached: "yes",
    });
  });

  it("answers a Wikipedia refusal by its status, without waiting on its body", async () => {
    const { engine } = wikipedia(stalledBody(503));
    expect(await run(engine)).toMatchObject({
      status: "failed",
      failure: { code: "connection" },
      reached: "yes",
    });
  });

  it("is no when the host's language thunk throws before a request exists", async () => {
    const { calls, engine } = wikipedia(
      () => json({ pages: [] }),
      () => {
        throw new Error("project closed");
      },
    );
    expect(await run(engine)).toMatchObject({
      status: "failed",
      failure: { code: "invalid-response", retryable: false },
      reached: "no",
    });
    expect(calls).toHaveLength(0);
  });

  it("is no when there is no key, or the custody check refuses", async () => {
    const none = provider(() => json(ANNOTATED), { apiKey: () => null });
    expect(await run(none.engine)).toMatchObject({
      status: "failed",
      failure: { code: "not-configured" },
      reached: "no",
    });
    expect(none.calls).toHaveLength(0);

    const verdict: ModelFailure = {
      code: "key-expired",
      message: "renew",
      retryable: false,
    };
    const held = provider(() => json(ANNOTATED), {
      beforeSend: async () => verdict,
    });
    expect(await run(held.engine)).toEqual({
      status: "failed",
      failure: verdict,
      reached: "no",
    });
    expect(held.calls).toHaveLength(0);

    const broken = provider(() => json(ANNOTATED), {
      beforeSend: async () => {
        throw new Error("x");
      },
    });
    expect(await run(broken.engine)).toMatchObject({
      status: "failed",
      failure: { code: "connection" },
      reached: "no",
    });
    expect(broken.calls).toHaveLength(0);
  });

  it("carries no wire or exception text in a failure", async () => {
    for (const [, make] of both) {
      const { engine } = make(() => {
        throw new TypeError("net::ERR at https://secret.example/?q=the+query");
      });
      expect(JSON.stringify(await run(engine))).not.toContain("secret");
    }
    const { engine } = provider(() =>
      json({ error: { message: "echo: fondazione di Roma" } }, 400),
    );
    expect(JSON.stringify(await run(engine))).not.toContain("echo");
  });
});

describe("Wikipedia's answer", () => {
  it("builds each link from the page key, and reads the HTML as text", async () => {
    const { engine } = wikipedia(() => json(PAGES));
    expect(await run(engine)).toEqual({
      status: "searched",
      results: [
        {
          url: "https://it.wikipedia.org/wiki/Alessandro_Manzoni",
          title: "Alessandro Manzoni",
          excerpt: 'Disambiguazione – "Manzoni" rimanda qui.',
        },
        {
          url: "https://it.wikipedia.org/wiki/Rome_%28city%29",
          title: "Rome & city",
          excerpt: "The city of Rome.",
        },
      ],
    });
  });

  it("never carries a cost, whatever the body says", async () => {
    const { engine } = wikipedia(() => json({ ...PAGES, costUsd: 1 }));
    expect(await run(engine)).not.toHaveProperty("costUsd");
  });

  it.each([
    [400, "provider-rejected", false],
    [404, "provider-rejected", false],
    [500, "connection", true],
    [503, "connection", true],
  ] as const)(
    "reads a %i as %s that reached the engine",
    async (status, code, retryable) => {
      const { engine } = wikipedia(() => json({}, status));
      expect(await run(engine)).toMatchObject({
        status: "failed",
        failure: { code, retryable },
        reached: "yes",
      });
    },
  );

  it("reads a body with no page list, or one past the cap, as the engine failing", async () => {
    for (const answer of [
      () => json({ results: [] }),
      () => new Response("<html>", { status: 200 }),
      () => new Response("x".repeat(600 * 1024), { status: 200 }),
    ]) {
      const { engine } = wikipedia(answer);
      expect(await run(engine)).toMatchObject({
        status: "failed",
        failure: { code: "connection" },
        reached: "yes",
      });
    }
  });

  it("opens the breaker on a 429 and refuses, unsent, until it closes", async () => {
    let now = 1_000_000;
    let status = 429;
    const { calls, engine } = wikipedia(
      () =>
        status === 429
          ? json({}, 429, { "Retry-After": "120" })
          : json({ pages: [] }),
      () => "en",
      () => now,
    );
    expect(await run(engine)).toMatchObject({
      status: "failed",
      failure: { code: "rate-limited", retryable: true, retryAfterMs: 120_000 },
      reached: "yes",
    });
    status = 200;
    now += 30_000;
    expect(await run(engine)).toMatchObject({
      status: "failed",
      failure: { code: "rate-limited", retryAfterMs: 90_000 },
      reached: "no",
    });
    expect(calls).toHaveLength(1);
    now += 90_001;
    expect(await run(engine)).toMatchObject({ status: "searched" });
    expect(calls).toHaveLength(2);
  });

  it("waits the default minute when the wait cannot be read, as cross-origin it cannot", async () => {
    let now = 0;
    const { calls, engine } = wikipedia(
      () => json({}, 429),
      () => "en",
      () => now,
    );
    expect(await run(engine)).toMatchObject({
      failure: { retryAfterMs: 60_000 },
    });
    now = 59_000;
    expect(await run(engine)).toMatchObject({ reached: "no" });
    now = 60_001;
    await run(engine);
    expect(calls).toHaveLength(2);
  });
});

describe("Wikimedia's Retry-After", () => {
  const NOW = Date.UTC(2026, 9, 26, 12);

  it.each([
    ["30", 30],
    ["0", 1],
    ["7200", 3_600],
    ["99999999999999999999", 3_600],
    ["", 60],
    [null, 60],
    ["soon", 60],
    ["-5", 60],
    ["Mon, 26 Oct 2026 12:02:00 GMT", 120],
    ["Mon, 26 Oct 2026 11:00:00 GMT", 1],
    ["26 Oct 2026 12:02:00", 60],
  ])("reads %j as %i seconds", (header, seconds) => {
    expect(backoffSeconds(header, NOW)).toBe(seconds);
  });
});

describe("the provider's answer", () => {
  it("keeps the nested citations, the reported cost, and never the model's text", async () => {
    const { engine } = provider(() => json(ANNOTATED));
    const outcome = await run(engine);
    expect(outcome).toEqual({
      status: "searched",
      results: [
        { url: "https://example.org/a", title: "A", excerpt: "First excerpt." },
      ],
      costUsd: 0.0042,
    });
    expect(JSON.stringify(outcome)).not.toContain("never read");
  });

  it("counts a message with no annotations as a search that found nothing when a search ran", async () => {
    const { engine } = provider(() =>
      json({
        choices: [{ message: { content: "none" } }],
        usage: { server_tool_use: { web_search_requests: 1 } },
      }),
    );
    expect(await run(engine)).toEqual({ status: "searched", results: [] });
  });

  // A model that answers without calling the tool has looked nothing up; an
  // empty result would say the web holds nothing, and the Wikipedia re-ask
  // that `invalid-response` earns would never run.
  it.each([
    ["no search count", {}],
    ["a count of zero", { server_tool_use: { web_search_requests: 0 } }],
    ["a top-level count of zero", { web_search_requests: 0 }],
  ])(
    "fails a message with no annotations and %s as a search never run",
    async (_name, usage) => {
      const { engine } = provider(() =>
        json({ choices: [{ message: { content: "none" } }], usage }),
      );
      const outcome = await run(engine);
      expect(outcome).toMatchObject({
        status: "failed",
        failure: { code: "invalid-response" },
        reached: "yes",
      });
      if (outcome.status !== "failed") throw new Error("not failed");
      expect(
        remedyOf([
          {
            engine: engine.engine,
            via: "first",
            outcome: "failed",
            code: outcome.failure.code,
            retryAt: null,
          },
        ]),
      ).toEqual({ kind: "re-ask", latch: false });
    },
  );

  it("reads an answer with no message as the engine failing", async () => {
    for (const body of [{}, { choices: [] }, { choices: [{ message: "x" }] }]) {
      const { engine } = provider(() => json(body));
      expect(await run(engine)).toMatchObject({
        status: "failed",
        failure: { code: "connection" },
        reached: "yes",
      });
    }
  });

  it("reads how many searches the vendor counted, from either place it says so", () => {
    expect(projectSearchAnswer(ANNOTATED)?.searchesRun).toBe(1);
    expect(
      projectSearchAnswer({
        choices: [{ message: {} }],
        usage: { web_search_requests: 2 },
      })?.searchesRun,
    ).toBe(2);
    expect(
      projectSearchAnswer({
        choices: [{ message: {} }],
        usage: { web_search_requests: -1 },
      }),
    ).toEqual({ rows: [] });
  });

  it.each([
    [401, "key-expired"],
    [403, "key-expired"],
    [402, "credit-exhausted"],
    [500, "connection"],
    [400, "provider-rejected"],
  ] as const)("reads a %i as %s", async (status, code) => {
    const { engine } = provider(() =>
      json({ error: { message: "words" } }, status),
    );
    expect(await run(engine)).toMatchObject({
      status: "failed",
      failure: { code },
      reached: "yes",
    });
  });

  it("reads a 408 as a timeout, which the provider's search may re-ask", async () => {
    const { engine } = provider(() => json({ error: { code: 408 } }, 408));
    expect(await run(engine)).toMatchObject({
      status: "failed",
      failure: { code: "timeout", retryable: true },
      reached: "yes",
    });
  });

  // The vendor answers 402 both for an account with no credit and for a key
  // past its own limit; one reading of the key tells them apart.
  it("reads a 402 as limit-reached when the key's own limit is spent", async () => {
    const { engine, calls } = provider((_init, url) =>
      url.endsWith("/key")
        ? json({
            data: {
              limit: 5,
              limit_remaining: 0,
              usage: 5,
              byok_usage: 0,
              include_byok_in_limit: true,
            },
          })
        : json({ error: { code: 402 } }, 402),
    );
    expect(await run(engine)).toMatchObject({
      status: "failed",
      failure: { code: "limit-reached" },
      reached: "yes",
    });
    expect(calls.filter((call) => call.url.endsWith("/key"))).toHaveLength(1);
  });

  it("reads a 402 as credit-exhausted when the key still has room", async () => {
    const { engine } = provider((_init, url) =>
      url.endsWith("/key")
        ? json({
            data: {
              limit: 5,
              limit_remaining: 4,
              usage: 1,
              byok_usage: 0,
              include_byok_in_limit: true,
            },
          })
        : json({ error: { code: 402 } }, 402),
    );
    expect(await run(engine)).toMatchObject({
      failure: { code: "credit-exhausted" },
    });
  });

  it("tells the vendor's own limits from a busy model", async () => {
    const busy = provider(() => json({ error: { code: 429 } }, 429));
    expect(await run(busy.engine)).toMatchObject({
      failure: { code: "model-busy" },
    });
    const limited = provider(() =>
      json(
        {
          error: {
            metadata: {
              headers: { "X-RateLimit-Limit": "10", "Retry-After": "5" },
            },
          },
        },
        429,
      ),
    );
    expect(await run(limited.engine)).toMatchObject({
      failure: { code: "rate-limited", retryAfterMs: 5_000 },
    });
  });

  it("reads the data-policy 404 as no private host", async () => {
    const { engine } = provider(() =>
      json(
        { error: { message: "No endpoints found matching your data policy" } },
        404,
      ),
    );
    expect(await run(engine)).toMatchObject({
      failure: { code: "no-private-host" },
    });
  });

  it("names the provider it goes to, and cannot be changed", () => {
    const { engine } = provider(() => json(ANNOTATED));
    expect(engine.engine).toEqual({
      kind: "provider",
      providerId: "openrouter",
    });
    expect(Object.isFrozen(engine.engine)).toBe(true);
  });
});

describe("the account hooks", () => {
  it("re-reads the credit once after any search that left, with what it reported", async () => {
    const onSpent = vi.fn();
    const { engine } = provider(() => json(ANNOTATED), { onSpent });
    await run(engine);
    expect(onSpent).toHaveBeenCalledTimes(1);
    expect(onSpent).toHaveBeenCalledWith({ costUsd: 0.0042, searchesRun: 1 });
  });

  it("re-reads the credit after a Stop mid-flight, which may still have billed", async () => {
    const onSpent = vi.fn();
    const { engine } = provider(silent, { onSpent });
    const caller = new AbortController();
    const outcome = run(engine, "rome", caller.signal);
    setTimeout(() => caller.abort(), 10);
    await outcome;
    expect(onSpent).toHaveBeenCalledWith({});
  });

  it("re-reads nothing when no request left", async () => {
    const onSpent = vi.fn();
    const onKeyRefused = vi.fn();
    const { engine } = provider(() => json(ANNOTATED), {
      onSpent,
      onKeyRefused,
      apiKey: () => null,
    });
    await run(engine);
    await run(engine, " bad");
    expect(onSpent).not.toHaveBeenCalled();
    expect(onKeyRefused).not.toHaveBeenCalled();
  });

  it("tells the account about a key refusal, sent or not", async () => {
    const onKeyRefused = vi.fn();
    const onSpent = vi.fn();
    const upstream = provider(() => json({}, 401), { onKeyRefused, onSpent });
    await run(upstream.engine);
    expect(onKeyRefused).toHaveBeenCalledTimes(1);
    expect(onSpent).toHaveBeenCalledTimes(1);

    const held = provider(() => json(ANNOTATED), {
      onKeyRefused,
      onSpent,
      beforeSend: async () => ({
        code: "limit-reached",
        message: "spent",
        retryable: false,
      }),
    });
    await run(held.engine);
    expect(onKeyRefused).toHaveBeenCalledTimes(2);
    expect(onSpent).toHaveBeenCalledTimes(1);
  });

  it("still answers when a hook throws", async () => {
    const { engine } = provider(() => json({}, 401), {
      onKeyRefused: () => {
        throw new Error("x");
      },
      onSpent: () => {
        throw new Error("y");
      },
    });
    expect(await run(engine)).toMatchObject({
      status: "failed",
      failure: { code: "key-expired" },
    });
  });
});

describe("the browser's own fetch", () => {
  it.each(both)(
    "calls the fetcher as a plain function, never as a method (%s)",
    async (_, make) => {
      const seen: unknown[] = [];
      const { engine } = make(() => json({ pages: [] }));
      const strict = function (this: unknown) {
        seen.push(this);
        return Promise.resolve(json({ pages: [] }));
      } as unknown as typeof fetch;
      const rebound =
        engine instanceof WikipediaDirectSearchEngine
          ? new WikipediaDirectSearchEngine({
              language: () => "en",
              productPascal: "P",
              fetcher: strict,
            })
          : new OpenRouterDirectSearchEngine("openrouter", {
              apiKey: () => KEY,
              attribution: { title: "t" },
              model: CHOSEN,
              fetcher: strict,
            });
      await run(rebound);
      expect(seen).toEqual([undefined]);
    },
  );
});
