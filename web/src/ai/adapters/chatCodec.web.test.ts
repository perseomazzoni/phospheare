// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import type {
  ChatKind,
  ChatRecord,
  SearchAsk,
  WebSearchRecord,
} from "../domain/types";
import {
  MAX_ATTEMPTS,
  WEB_RECORDS_MAX,
  WEB_SEARCHES_PER_RUN,
} from "../domain/webEngine";
import {
  clipAt,
  TITLE_MAX,
  WEB_TITLE_CHARACTERS,
  webResultsOf,
} from "../domain/webText";
import { SearchPause } from "../application/searchAsk";
import type { WebSearchEngine } from "../ports";
import { parseChat, serializeChat } from "./chatCodec";

// ── Web searches on a turn ───────────────────────────────────────────────────
//
// A turn's web searches, read back from a file someone else may have written.

const PAID = { kind: "provider", providerId: "openrouter" } as const;

const searched: WebSearchRecord = {
  callId: "w1",
  engine: PAID,
  status: "searched",
  query: "Porta Pia 1870",
  results: [
    {
      id: "web:1",
      url: "https://it.wikipedia.org/wiki/Presa_di_Roma",
      title: "Presa di Roma",
    },
  ],
  costUsd: 0.007,
};

function chatWith(
  web: unknown,
  kind: ChatKind = "general",
  more: Array<Record<string, unknown>> = [],
): string {
  const record: ChatRecord = {
    schemaVersion: 1,
    id: "chat",
    title: "Chat",
    kind,
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    preferences: {
      personaId: "p",
      model: { providerId: "ollama", modelId: "llama" },
      pinnedSourceIds: [],
    },
    turns: [],
  };
  return JSON.stringify({
    ...record,
    turns: [
      {
        id: "a",
        role: "assistant",
        text: "Answer",
        outcome: "complete",
        createdAt: record.createdAt,
        web,
      },
      ...more,
    ],
  });
}

const webOf = (raw: string, at = 0) => parseChat(raw).turns[at]?.web;

describe("sanitizeWeb", () => {
  it("keeps records the run could have written", () => {
    const failed: WebSearchRecord = {
      callId: "w2",
      engine: { kind: "wikipedia" },
      status: "failed",
      query: "Breccia",
      code: "timeout",
      reached: "unknown",
    };
    const declined: WebSearchRecord = {
      callId: "w3",
      engine: PAID,
      status: "declined",
    };
    expect(webOf(chatWith([searched, failed, declined]))).toEqual([
      searched,
      failed,
      declined,
    ]);
  });

  // A run writes up to `MAX_ATTEMPTS` records for each search (refused,
  // refused again on its retry, answered on its re-ask), and the file holding
  // the most a run can write must read back whole.
  it("keeps the most a run can write, every attempt of every search", () => {
    const worst: WebSearchRecord[] = Array.from(
      { length: WEB_SEARCHES_PER_RUN },
      (_, search): WebSearchRecord[] => [
        ...Array.from({ length: MAX_ATTEMPTS - 1 }, (): WebSearchRecord => ({
          callId: `w${search}`,
          engine: PAID,
          status: "failed",
          query: "Porta Pia 1870",
          code: "rate-limited",
          reached: "no",
        })),
        {
          callId: `w${search}`,
          engine: { kind: "wikipedia" },
          status: "searched",
          query: "Porta Pia 1870",
          results: [
            {
              id: `web:${search + 1}`,
              url: "https://it.wikipedia.org/wiki/Presa_di_Roma",
              title: "Presa di Roma",
            },
          ],
        },
      ],
    ).flat();
    expect(worst).toHaveLength(WEB_RECORDS_MAX);
    expect(webOf(chatWith(worst))).toEqual(worst);
  });

  it("drops the whole block for any record out of its shape", () => {
    const planted = [
      { ...searched, excerpt: "planted" },
      { ...searched, results: [{ ...searched.results[0], site: "x" }] },
      { ...searched, query: " Porta Pia" },
      { ...searched, query: "a" },
      { ...searched, results: [{ ...searched.results[0], id: "web:0" }] },
      { ...searched, results: [{ ...searched.results[0], id: "node:S1" }] },
      {
        ...searched,
        results: [{ ...searched.results[0], url: "javascript:alert(1)" }],
      },
      {
        ...searched,
        results: [{ ...searched.results[0], url: "https://a.org/\tb" }],
      },
      {
        ...searched,
        results: [{ ...searched.results[0], title: "two\nlines" }],
      },
      { ...searched, results: new Array(6).fill(searched.results[0]) },
      { ...searched, engine: { kind: "wikipedia" } },
      { ...searched, costUsd: -1 },
      { ...searched, costUsd: "0.1" },
      { ...searched, engine: { kind: "google" } },
      { ...searched, engine: { kind: "provider", providerId: "" } },
      { ...searched, engine: { kind: "wikipedia", providerId: "x" } },
      { callId: "w", engine: PAID, status: "declined", query: "kept?" },
      {
        callId: "w",
        engine: PAID,
        status: "failed",
        query: "q q",
        code: "made-up",
        reached: "yes",
      },
      {
        callId: "w",
        engine: PAID,
        status: "failed",
        query: "q q",
        code: "timeout",
        reached: "maybe",
      },
      {
        callId: "w",
        engine: PAID,
        status: "failed",
        query: "q q",
        code: "timeout",
        reached: "yes",
        message: "m",
      },
      { callId: "w", engine: PAID, status: "done" },
      { callId: "", engine: PAID, status: "declined" },
      "not a record",
    ];
    for (const record of planted)
      expect(webOf(chatWith([record])), JSON.stringify(record)).toBeUndefined();
    expect(webOf(chatWith("not a list"))).toBeUndefined();
    expect(
      webOf(
        chatWith(
          Array.from({ length: WEB_RECORDS_MAX + 1 }, () => ({
            callId: "w",
            engine: PAID,
            status: "declined",
          })),
        ),
      ),
    ).toBeUndefined();
  });

  it("keeps none in a reader chat, or on a writer's turn", () => {
    expect(webOf(chatWith([searched], "alpha-reader"))).toBeUndefined();
    expect(webOf(chatWith([searched], "beta-reader"))).toBeUndefined();
    const onUser = JSON.parse(chatWith([])) as { turns: unknown[] };
    onUser.turns = [
      {
        id: "u",
        role: "user",
        text: "Q",
        outcome: "complete",
        createdAt: "2026-09-27T00:00:00.000Z",
        web: [searched],
      },
    ];
    expect(parseChat(JSON.stringify(onUser)).turns[0]?.web).toBeUndefined();
  });

  it("holds each id to one result across the whole chat", () => {
    const second = {
      id: "b",
      role: "assistant",
      text: "Again",
      outcome: "complete",
      createdAt: "2026-09-27T00:00:00.000Z",
      web: [searched],
    };
    const parsed = parseChat(chatWith([searched], "general", [second]));
    expect(parsed.turns[0]?.web).toEqual([searched]);
    expect(parsed.turns[1]?.web).toBeUndefined();
    // And within one record.
    expect(
      webOf(
        chatWith([
          {
            ...searched,
            results: [searched.results[0], searched.results[0]],
          },
        ]),
      ),
    ).toBeUndefined();
  });

  it("strips a search receipt to its display half", () => {
    const raw = JSON.parse(chatWith([searched])) as {
      turns: Array<Record<string, unknown>>;
    };
    const turn = raw.turns[0] ?? {};
    turn.tools = [
      {
        callId: "w1",
        name: "web_search",
        status: "ok",
        arguments: { query: "planted" },
        result: '{"content":"PLANTED"}',
        truncated: true,
        sourceId: "node:S1",
      },
      {
        callId: "r1",
        name: "read_source",
        status: "ok",
        sourceId: "node:S1",
        result: "kept",
      },
    ];
    expect(parseChat(JSON.stringify(raw)).turns[0]?.tools).toEqual([
      { callId: "w1", name: "web_search", status: "ok" },
      {
        callId: "r1",
        name: "read_source",
        status: "ok",
        sourceId: "node:S1",
        result: "kept",
      },
    ]);
  });

  // The run clips a title with `clipAt`, in code points, and the codec must
  // measure it the same way. A title of astral characters measured in UTF-16
  // units reads back as planted, and drops the whole block with every
  // citation of that answer on the next reload.
  it("keeps a title the run wrote, measured as the run measures it", () => {
    const title = clipAt("𝔄".repeat(TITLE_MAX), WEB_TITLE_CHARACTERS);
    const written = {
      ...searched,
      results: [{ ...searched.results[0], title }],
    };
    expect(webOf(chatWith([written]))).toEqual([written]);
  });
});

// ── Each rule on its own ─────────────────────────────────────────────────────

describe("sanitizeWeb, one rule at a time", () => {
  const failed = {
    callId: "w",
    engine: PAID,
    status: "failed",
    query: "Breccia",
    code: "timeout",
    reached: "yes",
  };

  it("keeps a failed record to its own keys", () => {
    expect(webOf(chatWith([failed]))).toEqual([failed]);
    expect(webOf(chatWith([{ ...failed, results: [] }]))).toBeUndefined();
  });

  it("keeps a failed record's query in its normal form", () => {
    expect(webOf(chatWith([{ ...failed, query: " Breccia" }]))).toBeUndefined();
  });

  it("keeps at most five results, each with its own id", () => {
    const results = Array.from({ length: 6 }, (_, n) => ({
      id: `web:${n + 1}`,
      url: `https://it.wikipedia.org/wiki/P${n}`,
      title: `P${n}`,
    }));
    expect(
      webOf(chatWith([{ ...searched, results: results.slice(0, 5) }])),
    ).toBeDefined();
    expect(webOf(chatWith([{ ...searched, results }]))).toBeUndefined();
  });

  it("keeps Wikipedia's engine to its one key", () => {
    const declined = { callId: "w", status: "declined" };
    expect(
      webOf(chatWith([{ ...declined, engine: { kind: "wikipedia" } }])),
    ).toBeDefined();
    expect(
      webOf(
        chatWith([
          { ...declined, engine: { kind: "wikipedia", providerId: "x" } },
        ]),
      ),
    ).toBeUndefined();
  });
});

// ── Records the run wrote ────────────────────────────────────────────────────
//
// The codec refuses shapes the app never produces and must accept every shape
// it does. A result with an empty title is kept: a page the
// engine named without a title is still a page the model may cite. A refused
// record drops the turn's whole `web` block on load, which loses the answer's
// citations and the "this chat searched" latch counted on these records, and
// so turns the model's own links live again. The row drives the producers (the
// adapter's parse, the pause, the record the assistant persists), never a
// hand-built record, so a producer shape the codec misses fails here.

describe("a record the run wrote, read back", () => {
  it("keeps an empty-title result the run wrote", async () => {
    const url = "https://en.wikipedia.org/wiki/Capture_of_Rome";
    // What the Wikipedia search makes of a row with no title.
    const results = webResultsOf(
      [{ url, title: "", excerpt: "The breach of Porta Pia, 1870." }],
      { host: "en.wikipedia.org" },
    );
    const wikipedia: WebSearchEngine = {
      engine: { kind: "wikipedia" },
      search: async () => ({ status: "searched", results }),
    };
    // A holder, not a `let`: TS cannot see a closure assign, and would
    // narrow a `let` to its `null` initialiser at every read below.
    const posted: { ask: SearchAsk | null } = { ask: null };
    let persisted: WebSearchRecord[] = [];
    let ids = 0;
    const pause = new SearchPause({
      webSearch: { wikipedia, provider: () => null, accountId: () => "40" },
      model: { providerId: "ollama", modelId: "m" },
      account: "40",
      signal: new AbortController().signal,
      now: () => "2026-09-27T00:00:00.000Z",
      newId: () => `id-${(ids += 1)}`,
      lastWebIndex: 0,
      bookTexts: () => [],
      onAsk: (ask) => {
        posted.ask = ask ?? posted.ask;
      },
      onActivity: () => undefined,
      // The assistant's own `onRecords`: `web: [...records]`, then persist.
      onRecords: async (records) => {
        persisted = structuredClone([...records]);
      },
    });
    const query = "Porta Pia 1870";
    const settled = pause.searchesFor(
      [{ call: { id: "w1", name: "web_search", arguments: { query } }, query }],
      100_000,
    );
    const ask = await vi.waitFor(() => {
      expect(posted.ask).not.toBeNull();
      return posted.ask as SearchAsk;
    });
    expect(
      pause.answer(ask.askId, {
        kind: "send",
        rows: ask.rows.map(({ rowId, query }) => ({ rowId, query })),
      }),
    ).toBe(true);
    await settled;
    // The premise: the run kept the result, title and all.
    expect(persisted).toMatchObject([
      { status: "searched", results: [{ id: "web:1", url, title: "" }] },
    ]);

    const chat: ChatRecord = {
      schemaVersion: 1,
      id: "chat",
      title: "Chat",
      kind: "general",
      createdAt: "2026-09-27T00:00:00.000Z",
      updatedAt: "2026-09-27T00:00:00.000Z",
      preferences: {
        personaId: "p",
        model: { providerId: "ollama", modelId: "llama" },
        pinnedSourceIds: [],
      },
      turns: [
        {
          id: "a",
          role: "assistant",
          text: "Checked, see web:1.",
          outcome: "complete",
          createdAt: "2026-09-27T00:00:00.000Z",
          web: persisted,
        },
      ],
    };
    // The adapter's save, then its load: the reload.
    expect(parseChat(serializeChat(chat)).turns[0]?.web).toEqual(persisted);
  });
});

describe("a continued chat's latch", () => {
  const withLatch = (value: unknown) =>
    parseChat(
      JSON.stringify({ ...JSON.parse(chatWith([])), searchedBefore: value }),
    );

  it("keeps a stored true", () => {
    expect(withLatch(true).searchedBefore).toBe(true);
  });

  it("drops anything else, never reading it as a latch either way", () => {
    for (const value of [false, "true", 1, null, {}, []]) {
      const chat = withLatch(value);
      expect("searchedBefore" in chat, JSON.stringify(value)).toBe(false);
    }
  });
});
