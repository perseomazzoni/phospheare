// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ModelFailureCode,
  ModelRef,
  RunActivity,
  SearchAsk,
  ToolCall,
  WebEngine,
  WebReach,
  WebSearchOutcome,
  WebSearchRecord,
} from "../domain/types";
import { MODEL_FAILURE_CODES } from "../domain/types";
import {
  REMEDY_ON,
  RETRY_WAIT_DEFAULT_MS,
  RETRY_WAIT_MAX_MS,
  WEB_RECORDS_MAX,
} from "../domain/webEngine";
import type { WebSearchEngine } from "../ports";
import { ModelRunError } from "./runStep";
import {
  SearchPause,
  type PauseRow,
  type SearchPauseDependencies,
} from "./searchAsk";
import {
  declinedResult,
  failedResult,
  searchAnswered,
  searchedResult,
  WEB_NOTES,
  WEB_SEARCH_REFUSALS,
  webSearchRefusal,
  type PauseAnswer,
} from "./webResults";

// ── The pause before a search ────────────────────────────────────────────────
//
// Nothing leaves until the writer says so.

const ROOM = 100_000;
const BOOK = "The lantern went dark beside the old gate before dawn.";

class FakeEngine implements WebSearchEngine {
  sent: string[] = [];
  /** What the next searches answer, in order; then `results`. */
  answers: Array<
    (query: string, signal: AbortSignal) => Promise<WebSearchOutcome>
  > = [];
  results = 2;

  constructor(readonly engine: WebEngine) {}

  async search(query: string, signal: AbortSignal): Promise<WebSearchOutcome> {
    this.sent.push(query);
    const next = this.answers.shift();
    if (next) return next(query, signal);
    return {
      status: "searched",
      results: Array.from({ length: this.results }, (_, n) => ({
        url: `https://example.org/${encodeURIComponent(query)}/${n}`,
        title: `${query} ${n}`,
        excerpt: `EXCERPT-SENTINEL about ${query}`,
      })),
      ...(this.engine.kind === "provider" ? { costUsd: 0.01 } : {}),
    };
  }
}

function failing(
  code: ModelFailureCode,
  reached: "no" | "yes" | "unknown" = "yes",
) {
  return async (): Promise<WebSearchOutcome> => ({
    status: "failed",
    failure: { code, message: "MESSAGE-SENTINEL", retryable: false },
    reached,
  });
}

/** The model the run asks, and so the one a provider search runs on. */
const MODEL: ModelRef = { providerId: "openrouter", modelId: "vendor/chosen" };

function setup(over: Partial<SearchPauseDependencies> = {}) {
  const wikipedia = new FakeEngine({ kind: "wikipedia" });
  const provider = new FakeEngine({
    kind: "provider",
    providerId: "openrouter",
  });
  const state = {
    provider: provider as FakeEngine | null,
    /** The model each `provider(model)` read named. */
    asked: [] as ModelRef[],
    account: "40" as string | null,
    clock: Date.parse("2026-09-27T10:00:00.000Z"),
  };
  const controller = new AbortController();
  const asks: Array<SearchAsk | null> = [];
  /** The wait each `onAsk` call carried, in order. */
  const waits: number[] = [];
  const activities: RunActivity[] = [];
  const written: WebSearchRecord[][] = [];
  let ids = 0;
  const pause = new SearchPause({
    webSearch: {
      wikipedia,
      provider: (model) => {
        state.asked.push(model);
        return state.provider;
      },
      accountId: () => state.account,
    },
    model: MODEL,
    account: "40",
    signal: controller.signal,
    now: () => new Date(state.clock).toISOString(),
    newId: () => `id-${(ids += 1)}`,
    lastWebIndex: 0,
    bookTexts: () => [BOOK],
    onAsk: (ask, waitedMs) => {
      asks.push(ask);
      waits.push(waitedMs);
    },
    onActivity: (activity) => activities.push(activity),
    onRecords: async (records) => {
      written.push(structuredClone([...records]));
    },
    ...over,
  });
  /** The `n`th ask posted (1-based), once the pause has posted it. */
  const ask = async (n = 1): Promise<SearchAsk> => {
    for (let tries = 0; tries < 200; tries += 1) {
      const open = asks.filter((one): one is SearchAsk => one !== null);
      const found = open[n - 1];
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(`no ask ${n} was posted`);
  };
  return {
    pause,
    wikipedia,
    provider,
    state,
    controller,
    asks,
    waits,
    activities,
    written,
    ask,
  };
}

function row(query: string, id = query): PauseRow {
  const call: ToolCall = { id, name: "web_search", arguments: { query } };
  return { call, query };
}

/** Send every row of an ask as shown. */
function sendAll(ask: SearchAsk) {
  return {
    kind: "send" as const,
    rows: ask.rows.map(({ rowId, query }) => ({ rowId, query })),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SearchPause: the ask", () => {
  it("asks once for the step's searches, on the provider, and sends nothing first", async () => {
    const { pause, provider, wikipedia, ask, activities } = setup();
    const rows = [
      row("Roman aqueducts"),
      row("lantern went dark beside the old gate"),
    ];
    const settled = pause.searchesFor(rows, ROOM);
    const posted = await ask();
    expect(posted.engine).toEqual({
      kind: "provider",
      providerId: "openrouter",
    });
    expect(posted.rows.map((one) => [one.query, one.bookWords])).toEqual([
      ["Roman aqueducts", false],
      ["lantern went dark beside the old gate", true],
    ]);
    expect(posted.kind).toBe("first");
    // The wait's words go out with the ask, in the Assistant's one publish:
    // the pause says nothing of its own about waiting.
    expect(activities).not.toContainEqual({ kind: "awaiting-writer" });
    expect(provider.sent).toEqual([]);
    expect(wikipedia.sent).toEqual([]);
    expect(pause.answer(posted.askId, sendAll(posted))).toBe(true);
    await settled;
    expect(provider.sent).toEqual([
      "Roman aqueducts",
      "lantern went dark beside the old gate",
    ]);
  });

  it("asks for the provider search of the run's own model", async () => {
    const { pause, state, ask } = setup();
    const settled = pause.searchesFor([row("porta pia")], ROOM);
    const posted = await ask();
    expect(state.asked).toEqual([MODEL]);
    expect(pause.answer(posted.askId, { kind: "decline" })).toBe(true);
    await settled;
  });

  it("asks on Wikipedia when no provider can search now", async () => {
    const h = setup();
    h.state.provider = null;
    const settled = h.pause.searchesFor([row("Porta Pia")], ROOM);
    const posted = await h.ask();
    expect(posted.engine).toEqual({ kind: "wikipedia" });
    h.pause.answer(posted.askId, sendAll(posted));
    await settled;
    expect(h.wikipedia.sent).toEqual(["Porta Pia"]);
  });

  it("sends the writer's edit, to the engine the ask named, whatever changes after", async () => {
    const h = setup();
    const settled = h.pause.searchesFor([row("Rome founding")], ROOM);
    const posted = await h.ask();
    // The provider's verdict moves while the writer reads the card.
    h.state.provider = null;
    const rowId = posted.rows[0]?.rowId ?? "";
    expect(
      h.pause.answer(posted.askId, {
        kind: "send",
        rows: [{ rowId, query: "founding of Rome" }],
      }),
    ).toBe(true);
    const out = await settled;
    expect(h.provider.sent).toEqual(["founding of Rome"]);
    expect(h.wikipedia.sent).toEqual([]);
    expect(out.values().next().value).toMatchObject({
      status: "searched",
      engine: "web",
      query: "founding of Rome",
    });
  });

  it("declines an unticked row and keeps no query for it", async () => {
    const h = setup();
    const rows = [row("first query"), row("second query")];
    const settled = h.pause.searchesFor(rows, ROOM);
    const posted = await h.ask();
    const first = posted.rows[0];
    h.pause.answer(posted.askId, {
      kind: "send",
      rows: first ? [{ rowId: first.rowId, query: first.query }] : [],
    });
    const out = await settled;
    expect(h.provider.sent).toEqual(["first query"]);
    expect(out.get(rows[1]?.call as ToolCall)).toEqual({
      status: "declined",
      note: WEB_NOTES.unticked,
    });
    const records = h.pause.written;
    expect(records.find((one) => one.callId === "second query")).toEqual({
      callId: "second query",
      engine: { kind: "provider", providerId: "openrouter" },
      status: "declined",
    });
  });

  it("refuses an answer it cannot take, whole, and leaves the ask pending", async () => {
    const h = setup();
    const settled = h.pause.searchesFor(
      [row("alpha query"), row("beta query")],
      ROOM,
    );
    const posted = await h.ask();
    const [a, b] = posted.rows;
    const rowId = a?.rowId ?? "";
    const refused = [
      { kind: "send", rows: [{ rowId: "forged", query: "alpha query" }] },
      {
        kind: "send",
        rows: [
          { rowId, query: "alpha query" },
          { rowId, query: "alpha query" },
        ],
      },
      { kind: "send", rows: [{ rowId, query: " alpha query" }] },
      { kind: "send", rows: [{ rowId, query: "alpha\nquery" }] },
      { kind: "send", rows: [{ rowId, query: "a" }] },
      { kind: "send", rows: [{ rowId, query: 7 }] },
      { kind: "send", rows: "all" },
      { kind: "maybe" },
    ];
    for (const answer of refused)
      expect(
        h.pause.answer(posted.askId, answer as never),
        JSON.stringify(answer),
      ).toBe(false);
    expect(h.pause.answer("stale", sendAll(posted))).toBe(false);
    expect(h.provider.sent).toEqual([]);
    expect(h.asks[h.asks.length - 1]).toBe(posted);
    expect(
      h.pause.answer(posted.askId, {
        kind: "send",
        rows: [
          { rowId, query: "alpha query" },
          { rowId: b?.rowId ?? "", query: "beta query" },
        ],
      }),
    ).toBe(true);
    // Single-use: the same answer again finds nothing pending.
    expect(h.pause.answer(posted.askId, sendAll(posted))).toBe(false);
    await settled;
    expect(h.provider.sent).toEqual(["alpha query", "beta query"]);
    expect(h.asks[h.asks.length - 1]).toBeNull();
  });

  it("says a query repeats the book only while its ask is open", async () => {
    const h = setup();
    const settled = h.pause.searchesFor([row("old gate history")], ROOM);
    const posted = await h.ask();
    expect(
      h.pause.holdsBookWords(
        posted.askId,
        "went dark beside the old gate before",
      ),
    ).toBe(true);
    expect(h.pause.holdsBookWords(posted.askId, "gate history")).toBe(false);
    expect(
      h.pause.holdsBookWords("other", "went dark beside the old gate before"),
    ).toBe(false);
    h.pause.answer(posted.askId, sendAll(posted));
    await settled;
    expect(
      h.pause.holdsBookWords(
        posted.askId,
        "went dark beside the old gate before",
      ),
    ).toBe(false);
  });
});

describe("SearchPause: the run's no and the caps", () => {
  it("takes a decline as the run's no: no later ask, and no record for it", async () => {
    const h = setup();
    const first = h.pause.searchesFor([row("one query")], ROOM);
    const posted = await h.ask();
    h.pause.answer(posted.askId, { kind: "decline" });
    const out = await first;
    expect([...out.values()]).toEqual([
      { status: "declined", note: WEB_NOTES.runNo },
    ]);
    const later = await h.pause.searchesFor([row("two query")], ROOM);
    expect([...later.values()]).toEqual([
      { status: "declined", note: WEB_NOTES.runNo },
    ]);
    expect(h.asks.filter(Boolean)).toHaveLength(1);
    expect(h.pause.written).toEqual([
      {
        callId: "one query",
        engine: { kind: "provider", providerId: "openrouter" },
        status: "declined",
      },
    ]);
    expect(h.provider.sent).toEqual([]);
  });

  it("an empty send declines the rows without saying no to the run", async () => {
    const h = setup();
    const first = h.pause.searchesFor([row("one query")], ROOM);
    const posted = await h.ask();
    h.pause.answer(posted.askId, { kind: "send", rows: [] });
    await first;
    const second = h.pause.searchesFor([row("two query")], ROOM);
    const again = await h.ask(2);
    expect(again.rows.map((one) => one.query)).toEqual(["two query"]);
    h.pause.answer(again.askId, sendAll(again));
    await second;
    expect(h.provider.sent).toEqual(["two query"]);
  });

  it("asks about three searches an answer at most, then refuses", async () => {
    const h = setup();
    const rows = ["q one", "q two", "q three", "q four", "q five"].map((q) =>
      row(q),
    );
    const settled = h.pause.searchesFor(rows, ROOM);
    const posted = await h.ask();
    expect(posted.rows).toHaveLength(3);
    h.pause.answer(posted.askId, sendAll(posted));
    const out = await settled;
    expect(out.get(rows[3]?.call as ToolCall)).toEqual({
      error: "search-limit",
      hint: WEB_SEARCH_REFUSALS["search-limit"],
    });
    expect(out.get(rows[4]?.call as ToolCall)).toMatchObject({
      error: "search-limit",
    });
    expect(h.provider.sent).toHaveLength(3);
  });

  it("asks nothing it could not show, and says so for the rest of the run", async () => {
    const h = setup();
    const out = await h.pause.searchesFor([row("tiny window")], 10);
    expect([...out.values()]).toEqual([
      {
        error: "results-too-large-for-this-model",
        hint: WEB_SEARCH_REFUSALS["results-too-large-for-this-model"],
      },
    ]);
    const later = await h.pause.searchesFor([row("again later")], ROOM);
    expect([...later.values()]).toEqual([
      expect.objectContaining({ error: "results-too-large-for-this-model" }),
    ]);
    expect(h.asks).toEqual([]);
  });

  it("refuses when the chat has no ids left to cite by", async () => {
    const h = setup({ lastWebIndex: 999_998 });
    const out = await h.pause.searchesFor([row("late query")], ROOM);
    expect([...out.values()]).toEqual([
      expect.objectContaining({ error: "not-available" }),
    ]);
    expect(h.asks).toEqual([]);
  });
});

describe("SearchPause: ending the wait", () => {
  it("never posts an ask on a run already stopped", async () => {
    const h = setup();
    h.controller.abort();
    await expect(h.pause.searchesFor([row("stopped")], ROOM)).rejects.toThrow(
      ModelRunError,
    );
    expect(h.asks).toEqual([]);
    expect(h.provider.sent).toEqual([]);
  });

  it("ends on Stop while waiting, with the ask withdrawn and nothing sent", async () => {
    const h = setup();
    const settled = h.pause.searchesFor([row("waiting query")], ROOM);
    const posted = await h.ask();
    h.controller.abort();
    await expect(settled).rejects.toMatchObject({
      failure: { code: "cancelled" },
    });
    expect(h.asks[h.asks.length - 1]).toBeNull();
    expect(h.pause.answer(posted.askId, sendAll(posted))).toBe(false);
    expect(h.pause.holdsBookWords(posted.askId, BOOK)).toBe(false);
    expect(h.provider.sent).toEqual([]);
  });

  it("stops between sends: the one in flight is written, the rest never leave", async () => {
    const h = setup();
    h.provider.answers.push(async (_query, signal) => {
      h.controller.abort();
      return {
        status: "failed",
        failure: { code: "cancelled", message: "m", retryable: false },
        reached: signal.aborted ? "unknown" : "yes",
      };
    });
    const settled = h.pause.searchesFor(
      [row("first q"), row("second q"), row("third q")],
      ROOM,
    );
    const posted = await h.ask();
    h.pause.answer(posted.askId, sendAll(posted));
    await expect(settled).rejects.toMatchObject({
      failure: { code: "cancelled" },
    });
    expect(h.provider.sent).toEqual(["first q"]);
    expect(h.written[h.written.length - 1]).toEqual([
      {
        callId: "first q",
        engine: { kind: "provider", providerId: "openrouter" },
        status: "failed",
        query: "first q",
        code: "cancelled",
        reached: "unknown",
      },
    ]);
  });

  it("has no timer: a day later the ask still waits for the writer", async () => {
    const h = setup();
    const settled = h.pause.searchesFor([row("patient query")], ROOM);
    const posted = await h.ask();
    vi.useFakeTimers();
    vi.advanceTimersByTime(24 * 60 * 60 * 1_000);
    vi.useRealTimers();
    expect(h.provider.sent).toEqual([]);
    expect(h.asks[h.asks.length - 1]).toBe(posted);
    h.pause.answer(posted.askId, sendAll(posted));
    await settled;
    expect(h.provider.sent).toEqual(["patient query"]);
  });

  it("ends the run, sending nothing, when the account changed under it", async () => {
    for (const account of ["41", null]) {
      const h = setup();
      const settled = h.pause.searchesFor([row("account query")], ROOM);
      const posted = await h.ask();
      h.state.account = account;
      h.pause.answer(posted.askId, sendAll(posted));
      await expect(settled).rejects.toMatchObject({
        failure: { code: "cancelled" },
      });
      expect(h.provider.sent).toEqual([]);
      expect(h.wikipedia.sent).toEqual([]);
    }
  });

  it("leaves the wait out of the run's time", async () => {
    const h = setup();
    const settled = h.pause.searchesFor([row("slow writer")], ROOM);
    const posted = await h.ask();
    h.state.clock += 45_000;
    h.pause.answer(posted.askId, sendAll(posted));
    await settled;
    expect(h.pause.waitedMs).toBe(45_000);
  });
});

describe("SearchPause: what is written", () => {
  it("writes each send ahead, as a failure that may have reached", async () => {
    const h = setup();
    let seen: WebSearchRecord[] | undefined;
    h.provider.answers.push(async () => {
      seen = h.written[h.written.length - 1];
      return { status: "searched", results: [] };
    });
    const settled = h.pause.searchesFor([row("ahead query")], ROOM);
    const posted = await h.ask();
    h.pause.answer(posted.askId, sendAll(posted));
    await settled;
    expect(seen).toEqual([
      {
        callId: "ahead query",
        engine: { kind: "provider", providerId: "openrouter" },
        status: "failed",
        query: "ahead query",
        code: "interrupted",
        reached: "unknown",
      },
    ]);
  });

  it("keeps what renders a citation and nothing a page wrote", async () => {
    const h = setup({ lastWebIndex: 7 });
    const settled = h.pause.searchesFor([row("citation query")], ROOM);
    const posted = await h.ask();
    h.pause.answer(posted.askId, sendAll(posted));
    const out = await settled;
    expect(h.pause.written).toEqual([
      {
        callId: "citation query",
        engine: { kind: "provider", providerId: "openrouter" },
        status: "searched",
        query: "citation query",
        results: [
          {
            id: "web:8",
            url: "https://example.org/citation%20query/0",
            title: "citation query 0",
          },
          {
            id: "web:9",
            url: "https://example.org/citation%20query/1",
            title: "citation query 1",
          },
        ],
        costUsd: 0.01,
      },
    ]);
    const stored = JSON.stringify(h.written);
    expect(stored).not.toContain("EXCERPT-SENTINEL");
    expect(stored).not.toContain("MESSAGE-SENTINEL");
    const [answer] = [...out.values()];
    expect(answer).toMatchObject({
      status: "searched",
      results: [
        {
          id: "web:8",
          site: "example.org",
          excerpt: "EXCERPT-SENTINEL about citation query",
        },
        { id: "web:9" },
      ],
      note: WEB_NOTES.searched,
    });
    expect(JSON.stringify(answer)).not.toContain("https://");
  });

  it("tells the model a failure by its code alone, and keeps no cost from Wikipedia", async () => {
    const h = setup();
    h.state.provider = null;
    h.wikipedia.answers.push(failing("timeout"));
    const settled = h.pause.searchesFor([row("wiki fails")], ROOM);
    const posted = await h.ask();
    h.pause.answer(posted.askId, sendAll(posted));
    const out = await settled;
    expect([...out.values()]).toEqual([
      {
        status: "failed",
        engine: "wikipedia",
        code: "timeout",
        note: WEB_NOTES.failed,
      },
    ]);
    // Wikipedia never falls back.
    expect(h.asks.filter(Boolean)).toHaveLength(1);
  });

  it("says a search that found nothing found nothing, and does not re-ask", async () => {
    const h = setup();
    h.provider.results = 0;
    const settled = h.pause.searchesFor([row("nothing found")], ROOM);
    const posted = await h.ask();
    h.pause.answer(posted.askId, sendAll(posted));
    const out = await settled;
    expect([...out.values()]).toEqual([
      {
        status: "searched",
        engine: "web",
        query: "nothing found",
        results: [],
        note: WEB_NOTES.zero,
      },
    ]);
    expect(h.asks.filter(Boolean)).toHaveLength(1);
  });
});

describe("SearchPause: the re-ask on Wikipedia", () => {
  it("re-asks the failed rows on Wikipedia, and latches a key failure", async () => {
    const h = setup();
    h.provider.answers.push(failing("key-expired", "no"));
    const rows = [row("fails first"), row("works first")];
    const settled = h.pause.searchesFor(rows, ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    const again = await h.ask(2);
    expect(again.askId).not.toBe(first.askId);
    expect(again.engine).toEqual({ kind: "wikipedia" });
    expect(again).toMatchObject({
      kind: "re-ask",
      code: "key-expired",
      reached: "no",
    });
    expect(again.rows.map((one) => one.query)).toEqual(["fails first"]);
    expect(again.rows[0]?.rowId).not.toBe(first.rows[0]?.rowId);
    h.pause.answer(again.askId, sendAll(again));
    const out = await settled;
    expect(h.wikipedia.sent).toEqual(["fails first"]);
    expect(out.get(rows[0]?.call as ToolCall)).toMatchObject({
      status: "searched",
      engine: "wikipedia",
      attempts: [
        { engine: "web", status: "failed", code: "key-expired" },
        { engine: "wikipedia", status: "searched", results: 2 },
      ],
      note: `${WEB_NOTES.searched}${WEB_NOTES.limited}`,
    });
    expect(h.pause.written.map((one) => [one.callId, one.status])).toEqual([
      ["fails first", "failed"],
      ["works first", "searched"],
      ["fails first", "searched"],
    ]);
    // Latched: the next ask names Wikipedia from the start.
    const later = h.pause.searchesFor([row("third search")], ROOM);
    const third = await h.ask(3);
    expect(third.engine).toEqual({ kind: "wikipedia" });
    expect(third.kind).toBe("first");
    h.pause.answer(third.askId, sendAll(third));
    await later;
    expect(h.provider.sent).toEqual(["fails first", "works first"]);
  });

  // The widest row comes first, so the last row's reach alone would say
  // less. "not sent" is never said of a query that may have left.
  it("names the widest reach among the failed rows", async () => {
    const h = setup();
    h.provider.answers.push(
      failing("timeout", "unknown"),
      failing("timeout", "no"),
    );
    const settled = h.pause.searchesFor([row("one row"), row("two row")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    const again = await h.ask(2);
    expect(again).toMatchObject({
      kind: "re-ask",
      code: "timeout",
      reached: "unknown",
    });
    h.pause.answer(again.askId, { kind: "send", rows: [] });
    await settled;
  });

  it("takes a no on the re-ask as the run's no, and never asks a third time", async () => {
    const h = setup();
    h.provider.answers.push(failing("connection"));
    const settled = h.pause.searchesFor([row("no twice")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    const again = await h.ask(2);
    h.pause.answer(again.askId, { kind: "decline" });
    const out = await settled;
    expect([...out.values()]).toEqual([
      {
        status: "declined",
        attempts: [
          { engine: "web", status: "failed", code: "connection" },
          { engine: "wikipedia", status: "declined" },
        ],
        note: WEB_NOTES.runNo,
      },
    ]);
    expect(h.asks.filter(Boolean)).toHaveLength(2);
    expect(h.wikipedia.sent).toEqual([]);
  });

  it("follows each code with exactly the remedy the table gives it", async () => {
    for (const code of MODEL_FAILURE_CODES) {
      const h = setup();
      h.provider.answers.push(failing(code));
      const settled = h.pause.searchesFor([row(`code ${code}`)], ROOM);
      const first = await h.ask();
      h.pause.answer(first.askId, sendAll(first));
      const remedy = REMEDY_ON[code];
      if (remedy === "none") {
        const out = await settled;
        expect([...out.values()], code).toEqual([
          expect.objectContaining({ status: "failed", code }),
        ]);
        expect(h.asks.filter(Boolean), code).toHaveLength(1);
      } else if (remedy === "retry") {
        const again = await h.ask(2);
        expect(again.kind, code).toBe("retry");
        expect(again.engine, code).toEqual(first.engine);
        h.pause.answer(again.askId, { kind: "decline" });
        await settled;
      } else {
        const again = await h.ask(2);
        expect(again, code).toMatchObject({ kind: "re-ask", code });
        h.pause.answer(again.askId, sendAll(again));
        await settled;
      }
    }
  });
});

// ── The pause's further guarantees ───────────────────────────────────────────
//
// Guarantees of the pause that no other row pins.

describe("SearchPause: re-asks, retries, waits and Stops", () => {
  it("re-asks with the query the writer approved, not the model's", async () => {
    const h = setup();
    h.provider.answers.push(failing("timeout"));
    const settled = h.pause.searchesFor([row("model wording")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, {
      kind: "send",
      rows: [{ rowId: first.rows[0]?.rowId ?? "", query: "writer wording" }],
    });
    const again = await h.ask(2);
    expect(again.rows.map((one) => one.query)).toEqual(["writer wording"]);
    h.pause.answer(again.askId, sendAll(again));
    await settled;
    expect(h.wikipedia.sent).toEqual(["writer wording"]);
  });

  it("keeps no cost a Wikipedia answer reports", async () => {
    const h = setup();
    h.state.provider = null;
    h.wikipedia.answers.push(async () => ({
      status: "searched",
      results: [
        { url: "https://en.wikipedia.org/wiki/A", title: "A", excerpt: "a" },
      ],
      costUsd: 0.5,
    }));
    const settled = h.pause.searchesFor([row("free search")], ROOM);
    const posted = await h.ask();
    h.pause.answer(posted.askId, sendAll(posted));
    await settled;
    expect(h.pause.written[0]).not.toHaveProperty("costUsd");
  });

  it("writes the fitted record before it hands the answers back", async () => {
    const h = setup();
    const settled = h.pause.searchesFor([row("fitted record")], ROOM);
    const posted = await h.ask();
    h.pause.answer(posted.askId, sendAll(posted));
    await settled;
    // What a Stop in the next step would leave on disk: the last write.
    expect(h.written[h.written.length - 1]?.[0]).toMatchObject({
      status: "searched",
      results: [{ id: "web:1" }, { id: "web:2" }],
    });
  });

  it("answers false to a malformed answer rather than throwing", async () => {
    const h = setup();
    const settled = h.pause.searchesFor([row("shape check")], ROOM);
    const posted = await h.ask();
    for (const answer of [
      { kind: "send" },
      { kind: "send", rows: [null] },
      { kind: "send", rows: ["row"] },
    ])
      expect(
        () => h.pause.answer(posted.askId, answer as never),
        JSON.stringify(answer),
      ).not.toThrow();
    for (const answer of [{ kind: "send" }, { kind: "send", rows: [null] }])
      expect(h.pause.answer(posted.askId, answer as never)).toBe(false);
    h.pause.answer(posted.askId, sendAll(posted));
    await settled;
  });
});

// ── The retry ────────────────────────────────────────────────────────────────
//
// A search the engine slowed is offered again, as sent, on the same engine
// object once its wait has passed.

describe("SearchPause: the retry", () => {
  const T0 = Date.parse("2026-09-27T10:00:00.000Z");

  function refused(retryAfterMs?: number, reached: WebReach = "no") {
    return async (): Promise<WebSearchOutcome> => ({
      status: "failed",
      failure: {
        code: "rate-limited",
        message: "MESSAGE-SENTINEL",
        retryable: true,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      },
      reached,
    });
  }

  it("offers the same queries again, on the same engine object, once the wait has passed", async () => {
    const h = setup();
    h.provider.answers.push(async () => {
      // The wait counts from the settle, not from when the ask was posted.
      h.state.clock = T0 + 2_000;
      return refused(10_000)();
    });
    const settled = h.pause.searchesFor([row("Porta Pia")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, {
      kind: "send",
      rows: [
        { rowId: first.rows[0]?.rowId ?? "", query: "breach of Porta Pia" },
      ],
    });
    const again = await h.ask(2);
    expect(again).toMatchObject({
      kind: "retry",
      engine: { kind: "provider", providerId: "openrouter" },
      at: new Date(T0 + 12_000).toISOString(),
    });
    // The query as it was sent: the writer's edit, not the model's words.
    expect(again.rows.map((one) => one.query)).toEqual(["breach of Porta Pia"]);
    expect(again.askId).not.toBe(first.askId);
    expect(again.rows[0]?.rowId).not.toBe(first.rows[0]?.rowId);
    // The provider's verdict moves meanwhile; the retry does not follow it.
    h.state.provider = null;
    h.state.clock = T0 + 12_000;
    expect(h.pause.answer(again.askId, { kind: "retry" })).toBe(true);
    const out = await settled;
    expect(h.provider.sent).toEqual([
      "breach of Porta Pia",
      "breach of Porta Pia",
    ]);
    expect(h.wikipedia.sent).toEqual([]);
    expect([...out.values()][0]).toMatchObject({
      status: "searched",
      attempts: [
        { engine: "web", status: "failed", code: "rate-limited" },
        { engine: "web", status: "searched", results: 2 },
      ],
    });
    expect(h.pause.written.map((one) => one.status)).toEqual([
      "failed",
      "searched",
    ]);
  });

  it("holds the wait, and takes only a retry or a no", async () => {
    const h = setup();
    h.provider.answers.push(refused(10_000));
    const settled = h.pause.searchesFor([row("hold")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    const again = await h.ask(2);
    h.state.clock = T0 + 10_000 - 1;
    expect(h.pause.answer(again.askId, { kind: "retry" })).toBe(false);
    h.state.clock = T0 + 10_000;
    // Anything but a retry is refused on a retry ask, even after the wait.
    expect(h.pause.answer(again.askId, sendAll(again))).toBe(false);
    expect(h.pause.answer(again.askId, { kind: "send", rows: [] })).toBe(false);
    // And a retry is refused on an ask that is not one.
    expect(h.pause.answer(first.askId, { kind: "retry" })).toBe(false);
    expect(h.provider.sent).toEqual(["hold"]);
    expect(h.pause.answer(again.askId, { kind: "retry" })).toBe(true);
    await settled;
    expect(h.provider.sent).toEqual(["hold", "hold"]);
  });

  it("refuses a retry when the clock cannot be read (fail-closed)", async () => {
    let readable = true;
    const h = setup({
      now: () => (readable ? new Date(T0 + 1_000).toISOString() : "not a time"),
    });
    h.provider.answers.push(refused(0));
    const settled = h.pause.searchesFor([row("clock")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    const again = await h.ask(2);
    readable = false;
    expect(h.pause.answer(again.askId, { kind: "retry" })).toBe(false);
    readable = true;
    expect(h.pause.answer(again.askId, { kind: "retry" })).toBe(true);
    await settled;
  });

  it("offers no retry when the clock could not be read at the refusal", async () => {
    let readable = true;
    const h = setup({
      now: () => (readable ? new Date(T0).toISOString() : "not a time"),
    });
    h.provider.answers.push(async () => {
      readable = false;
      return refused(1_000)();
    });
    const settled = h.pause.searchesFor([row("no clock")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    const out = await settled;
    readable = true;
    expect(h.asks.filter(Boolean)).toHaveLength(1);
    expect([...out.values()][0]).toMatchObject({ status: "failed" });
  });

  it("takes a no before the wait, as the run's no", async () => {
    const h = setup();
    h.provider.answers.push(refused(60_000));
    const settled = h.pause.searchesFor([row("no thanks")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    const again = await h.ask(2);
    expect(h.pause.answer(again.askId, { kind: "decline" })).toBe(true);
    await settled;
    const later = await h.pause.searchesFor([row("later")], ROOM);
    expect([...later.values()]).toEqual([
      expect.objectContaining({ status: "declined", note: WEB_NOTES.runNo }),
    ]);
    // A declined retry keeps no query.
    expect(h.pause.written[1]).toEqual({
      callId: "no thanks",
      engine: { kind: "provider", providerId: "openrouter" },
      status: "declined",
    });
  });

  it("waits the default when the server named no wait, and the latest of its rows' waits", async () => {
    const h = setup();
    h.provider.answers.push(refused(), refused(40_000));
    const settled = h.pause.searchesFor([row("one"), row("two")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    const again = await h.ask(2);
    expect(again.rows.map((one) => one.query)).toEqual(["one", "two"]);
    expect(again.kind === "retry" && Date.parse(again.at)).toBe(
      T0 + Math.max(RETRY_WAIT_DEFAULT_MS, 40_000),
    );
    h.pause.answer(again.askId, { kind: "decline" });
    await settled;
  });

  it("retries up to the hour, inclusive, and fails the row past it", async () => {
    const at = setup();
    at.provider.answers.push(refused(RETRY_WAIT_MAX_MS));
    const settledAt = at.pause.searchesFor([row("hour")], ROOM);
    const firstAt = await at.ask();
    at.pause.answer(firstAt.askId, sendAll(firstAt));
    expect((await at.ask(2)).kind).toBe("retry");
    at.controller.abort();
    await expect(settledAt).rejects.toBeInstanceOf(ModelRunError);

    const past = setup();
    past.provider.answers.push(refused(RETRY_WAIT_MAX_MS + 1));
    const settledPast = past.pause.searchesFor([row("hour and a bit")], ROOM);
    const firstPast = await past.ask();
    past.pause.answer(firstPast.askId, sendAll(firstPast));
    const out = await settledPast;
    expect([...out.values()]).toEqual([
      expect.objectContaining({ status: "failed", code: "rate-limited" }),
    ]);
    // No retry, and no re-ask on Wikipedia either.
    expect(past.asks.filter(Boolean)).toHaveLength(1);
    expect(past.wikipedia.sent).toEqual([]);
  });

  it("retries once: a second refusal fails the row, with no re-ask", async () => {
    const h = setup();
    h.provider.answers.push(refused(1_000), refused(1_000));
    const settled = h.pause.searchesFor([row("twice")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    const again = await h.ask(2);
    h.state.clock = T0 + 1_000;
    h.pause.answer(again.askId, { kind: "retry" });
    const out = await settled;
    expect(h.asks.filter(Boolean)).toHaveLength(2);
    expect(h.provider.sent).toEqual(["twice", "twice"]);
    expect(h.wikipedia.sent).toEqual([]);
    expect([...out.values()][0]).toMatchObject({
      status: "failed",
      code: "rate-limited",
    });
  });

  it("re-asks a retry the key refused, and latches", async () => {
    const h = setup();
    h.provider.answers.push(refused(1_000), failing("key-expired", "no"));
    const settled = h.pause.searchesFor([row("chain")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    const again = await h.ask(2);
    h.state.clock = T0 + 1_000;
    h.pause.answer(again.askId, { kind: "retry" });
    const third = await h.ask(3);
    expect(third).toMatchObject({
      kind: "re-ask",
      code: "key-expired",
      engine: { kind: "wikipedia" },
    });
    h.pause.answer(third.askId, sendAll(third));
    await settled;
    expect(h.wikipedia.sent).toEqual(["chain"]);
    // Latched: the next search asks on Wikipedia from the start.
    const later = h.pause.searchesFor([row("after the latch")], ROOM);
    expect((await h.ask(4)).engine).toEqual({ kind: "wikipedia" });
    h.controller.abort();
    await expect(later).rejects.toBeInstanceOf(ModelRunError);
  });

  it("retries a Wikipedia search the server slowed, on the Wikipedia object", async () => {
    const h = setup();
    h.state.provider = null;
    h.wikipedia.answers.push(refused(1_000));
    const settled = h.pause.searchesFor([row("slow wiki")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    const again = await h.ask(2);
    expect(again).toMatchObject({
      kind: "retry",
      engine: { kind: "wikipedia" },
    });
    h.state.clock = T0 + 1_000;
    h.pause.answer(again.askId, { kind: "retry" });
    await settled;
    expect(h.wikipedia.sent).toEqual(["slow wiki", "slow wiki"]);
  });

  it("lets a re-ask refused for speed take the row's unused retry", async () => {
    const h = setup();
    h.provider.answers.push(failing("timeout"));
    h.wikipedia.answers.push(refused(1_000));
    const settled = h.pause.searchesFor([row("re-ask then retry")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    const again = await h.ask(2);
    h.pause.answer(again.askId, sendAll(again));
    const third = await h.ask(3);
    expect(third).toMatchObject({
      kind: "retry",
      engine: { kind: "wikipedia" },
    });
    h.state.clock = T0 + 1_000;
    h.pause.answer(third.askId, { kind: "retry" });
    await settled;
    expect(h.wikipedia.sent).toEqual([
      "re-ask then retry",
      "re-ask then retry",
    ]);
  });

  it("asks the re-ask before the retry when one round needs both", async () => {
    const h = setup();
    h.provider.answers.push(failing("timeout"), refused(30_000));
    const settled = h.pause.searchesFor([row("row A"), row("row B")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    const second = await h.ask(2);
    expect(second).toMatchObject({ kind: "re-ask" });
    expect(second.rows.map((one) => one.query)).toEqual(["row A"]);
    h.pause.answer(second.askId, sendAll(second));
    const third = await h.ask(3);
    expect(third).toMatchObject({ kind: "retry" });
    expect(third.rows.map((one) => one.query)).toEqual(["row B"]);
    h.pause.answer(third.askId, { kind: "decline" });
    await settled;
  });

  it("retries a latched round's slowed row on its own engine, then re-asks it (the known cost)", async () => {
    const h = setup();
    h.provider.answers.push(
      failing("key-expired", "no"),
      refused(1_000),
      failing("key-expired", "no"),
    );
    const settled = h.pause.searchesFor([row("row A"), row("row B")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    const reask = await h.ask(2);
    h.pause.answer(reask.askId, sendAll(reask));
    const retry = await h.ask(3);
    expect(retry).toMatchObject({
      kind: "retry",
      engine: { kind: "provider", providerId: "openrouter" },
    });
    h.state.clock = T0 + 1_000;
    h.pause.answer(retry.askId, { kind: "retry" });
    const last = await h.ask(4);
    expect(last).toMatchObject({
      kind: "re-ask",
      engine: { kind: "wikipedia" },
    });
    expect(last.rows.map((one) => one.query)).toEqual(["row B"]);
    h.pause.answer(last.askId, sendAll(last));
    await settled;
    expect(h.provider.sent).toEqual(["row A", "row B", "row B"]);
    expect(h.wikipedia.sent).toEqual(["row A", "row B"]);
  });

  it("writes no more records than the codec keeps, at the pause's worst", async () => {
    const h = setup();
    // Every row: slowed, its retry refused by the key, its re-ask slowed.
    h.provider.answers.push(
      refused(1_000),
      refused(1_000),
      refused(1_000),
      failing("key-expired", "no"),
      failing("key-expired", "no"),
      failing("key-expired", "no"),
    );
    h.wikipedia.answers.push(refused(1_000), refused(1_000), refused(1_000));
    const settled = h.pause.searchesFor(
      [row("row a"), row("row b"), row("row c")],
      ROOM,
    );
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    const retry = await h.ask(2);
    h.state.clock = T0 + 1_000;
    h.pause.answer(retry.askId, { kind: "retry" });
    const reask = await h.ask(3);
    h.pause.answer(reask.askId, sendAll(reask));
    await settled;
    expect(h.asks.filter(Boolean)).toHaveLength(3);
    expect(h.pause.written).toHaveLength(WEB_RECORDS_MAX);
  });

  it("ends the run, sending nothing, when the account changed before a retry", async () => {
    const h = setup();
    h.provider.answers.push(refused(1_000));
    const settled = h.pause.searchesFor([row("who")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    const again = await h.ask(2);
    h.state.account = "41";
    h.state.clock = T0 + 1_000;
    h.pause.answer(again.askId, { kind: "retry" });
    await expect(settled).rejects.toMatchObject({
      failure: { code: "cancelled" },
    });
    expect(h.provider.sent).toEqual(["who"]);
  });

  it("hears each settle once, with the whole wait so far", async () => {
    const h = setup();
    const settled = h.pause.searchesFor([row("clocked")], ROOM);
    const posted = await h.ask();
    h.state.clock = T0 + 7_000;
    h.pause.answer(posted.askId, sendAll(posted));
    await settled;
    expect(h.asks).toEqual([posted, null]);
    expect(h.waits).toEqual([0, 7_000]);
  });
});

// ── A Stop's rows ────────────────────────────────────────────────────────────

describe("SearchPause: the words for a send", () => {
  // The line says a search is out before the write-ahead record is
  // written, so a slow write never shows "Waiting for you" over a query
  // already on its way.
  it("says it is searching before it writes the send ahead", async () => {
    const order: string[] = [];
    const h = setup({
      onActivity: (activity) => order.push(activity.kind),
      onRecords: async (records) => {
        order.push(`records:${records[records.length - 1]?.status ?? ""}`);
      },
    });
    const settled = h.pause.searchesFor([row("row A")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    await settled;
    expect(order.slice(0, 2)).toEqual(["searching-web", "records:failed"]);
  });
});

describe("SearchPause: what a Stop leaves", () => {
  it("declines every row of the ask it stopped, with no query and no write of its own", async () => {
    const h = setup();
    const settled = h.pause.searchesFor([row("one"), row("two")], ROOM);
    await h.ask();
    const writes = h.written.length;
    h.controller.abort();
    await expect(settled).rejects.toMatchObject({
      failure: { code: "cancelled" },
    });
    expect(h.pause.written).toEqual([
      { callId: "one", engine: expect.anything(), status: "declined" },
      { callId: "two", engine: expect.anything(), status: "declined" },
    ]);
    // The run's ending writes them; the cancel is never held up by a write.
    expect(h.written).toHaveLength(writes);
  });

  it("declines the rows a Stop reached before their send, and keeps the one in flight", async () => {
    const h = setup();
    h.provider.answers.push(async (_query, signal) => {
      h.controller.abort();
      return {
        status: "failed",
        failure: { code: "cancelled", message: "m", retryable: false },
        reached: signal.aborted ? "unknown" : "yes",
      };
    });
    const settled = h.pause.searchesFor(
      [row("first q"), row("second q"), row("third q")],
      ROOM,
    );
    const posted = await h.ask();
    h.pause.answer(posted.askId, sendAll(posted));
    await expect(settled).rejects.toBeInstanceOf(ModelRunError);
    expect(h.pause.written).toEqual([
      expect.objectContaining({
        callId: "first q",
        status: "failed",
        code: "cancelled",
      }),
      { callId: "second q", engine: expect.anything(), status: "declined" },
      { callId: "third q", engine: expect.anything(), status: "declined" },
    ]);
  });

  it("keeps a retried row's refusal whole when a Stop ends its retry", async () => {
    const h = setup();
    h.provider.answers.push(async () => ({
      status: "failed",
      failure: {
        code: "rate-limited",
        message: "m",
        retryable: true,
        retryAfterMs: 5_000,
      },
      reached: "no",
    }));
    const settled = h.pause.searchesFor([row("kept")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    await h.ask(2);
    h.controller.abort();
    await expect(settled).rejects.toBeInstanceOf(ModelRunError);
    expect(h.pause.written).toEqual([
      expect.objectContaining({
        callId: "kept",
        status: "failed",
        code: "rate-limited",
        reached: "no",
      }),
      {
        callId: "kept",
        engine: { kind: "provider", providerId: "openrouter" },
        status: "declined",
      },
    ]);
  });
});

// ── Re-ask order and account changes ─────────────────────────────────────────

describe("SearchPause: a re-ask before another engine's retry, and an account change", () => {
  const T0 = Date.parse("2026-09-27T10:00:00.000Z");
  const slowed =
    (retryAfterMs: number) => async (): Promise<WebSearchOutcome> => ({
      status: "failed",
      failure: {
        code: "rate-limited",
        message: "MESSAGE-SENTINEL",
        retryable: true,
        retryAfterMs,
      },
      reached: "no",
    });

  // A re-ask is asked before a retry, so an immediate question never waits
  // behind a clock. Row A is slowed on the provider; row B's key fails, so B
  // is re-asked on Wikipedia, where it is slowed too. That plans two retry
  // groups, one per engine object. A's retry, on the latched provider, is
  // refused by the key, which earns A a re-ask with no wait. B's retry still
  // has most of a minute to go, so A's re-ask comes first.
  it("asks a re-ask a retry earned before another engine's retry", async () => {
    const h = setup();
    h.provider.answers.push(
      slowed(1_000),
      failing("key-expired", "no"),
      failing("key-expired", "no"),
    );
    h.wikipedia.answers.push(slowed(60_000));
    const settled = h.pause.searchesFor([row("row A"), row("row B")], ROOM);
    const first = await h.ask();
    h.pause.answer(first.askId, sendAll(first));
    const reask = await h.ask(2);
    expect(reask).toMatchObject({ kind: "re-ask" });
    expect(reask.rows.map((one) => one.query)).toEqual(["row B"]);
    h.pause.answer(reask.askId, sendAll(reask));
    const retryA = await h.ask(3);
    expect(retryA).toMatchObject({
      kind: "retry",
      engine: { kind: "provider", providerId: "openrouter" },
    });
    expect(retryA.rows.map((one) => one.query)).toEqual(["row A"]);
    h.state.clock = T0 + 1_000;
    h.pause.answer(retryA.askId, { kind: "retry" });
    const next = await h.ask(4);
    // A's re-ask on Wikipedia, before B's retry and its clock.
    expect(next).toMatchObject({
      kind: "re-ask",
      engine: { kind: "wikipedia" },
    });
    expect(next.rows.map((one) => one.query)).toEqual(["row A"]);
    h.controller.abort();
    await expect(settled).rejects.toBeInstanceOf(ModelRunError);
  });

  // Only the writer's Stop writes declined rows; an account change writes
  // nothing. The pause ends the run on a changed account by throwing
  // `cancelled` from inside `round`, and every run ending persists `written`
  // (`webOf`), so a declined row there would put a "did not search" the
  // writer never gave into the previous account's chat.
  it("leaves no declined row when the account changed under an ask", async () => {
    const h = setup();
    const settled = h.pause.searchesFor([row("one"), row("two")], ROOM);
    const posted = await h.ask();
    h.state.account = "41";
    expect(h.pause.answer(posted.askId, sendAll(posted))).toBe(true);
    await expect(settled).rejects.toMatchObject({
      failure: { code: "cancelled" },
    });
    expect(h.provider.sent).toEqual([]);
    expect(h.pause.written).toEqual([]);
  });
});

describe("SearchPause: /verify's terms", () => {
  /** A search answering the given (page, excerpt) pairs, in order. */
  const answering =
    (pairs: Array<[string, string]>) =>
    async (): Promise<WebSearchOutcome> => ({
      status: "searched",
      results: pairs.map(([page, excerpt]) => ({
        url: `https://example.org/${page}`,
        title: page,
        excerpt,
      })),
    });
  /** A searched answer, narrowed through `searchAnswered`. */
  const searched = (answer: PauseAnswer | undefined) => {
    if (!answer || !searchAnswered(answer)) throw new Error("not searched");
    return answer;
  };
  const last = (written: WebSearchRecord[][]): WebSearchRecord[] =>
    written[written.length - 1] ?? [];
  const five = (tag: string): Array<[string, string]> =>
    [0, 1, 2, 3, 4].map((n) => [`${tag}${n}`, `about ${tag}${n}`]);

  async function settle(
    pairs: Array<Array<[string, string]>>,
    terms?: { limit: number; dedupe: true },
    room = ROOM,
  ) {
    const bench = setup();
    bench.provider.answers = pairs.map(answering);
    const rows = pairs.map((_, n) => row(`query ${n}`));
    const settled = bench.pause.searchesFor(rows, room, terms);
    const posted = await bench.ask();
    bench.pause.answer(posted.askId, sendAll(posted));
    const out = await settled;
    const answers = rows.map((one) => searched(out.get(one.call)));
    return { answers, records: last(bench.written) };
  }

  it("spreads the limit across the searches from the fullest row's tail (3/3/3)", async () => {
    const { answers } = await settle([five("a"), five("b"), five("c")], {
      limit: 9,
      dedupe: true,
    });
    expect(answers.map((one) => one.results.length)).toEqual([3, 3, 3]);
    expect(answers.map((one) => one.omitted)).toEqual([2, 2, 2]);
    // Ids are issued only to what is shown, in order across the step.
    expect(answers.flatMap((one) => one.results.map((r) => r.id))).toEqual(
      Array.from({ length: 9 }, (_, n) => `web:${n + 1}`),
    );
  });

  it("shows one page with one excerpt once, under the first search that found it", async () => {
    const { answers, records } = await settle(
      [
        [
          ["p", "same words"],
          ["q", "q words"],
        ],
        [
          ["p", "same words"],
          ["r", "r words"],
        ],
      ],
      { limit: 9, dedupe: true },
    );
    expect(answers.map((one) => one.results.map((r) => r.title))).toEqual([
      ["p", "q"],
      ["r"],
    ]);
    // A repeat counts as shown, not omitted: `omitted` is counted after the
    // dedupe.
    expect(answers[1]?.omitted).toBeUndefined();
    // The trace's count for the second search is what it found.
    const second = records[1];
    expect(second?.status === "searched" && second.repeated).toBe(1);
    expect(records[0]).not.toHaveProperty("repeated");
  });

  it("keeps a page under two searches when its excerpt differs (the deciding sentence)", async () => {
    const { answers, records } = await settle(
      [[["p", "built in 1887"]], [["p", "finished in 1889"]]],
      { limit: 9, dedupe: true },
    );
    expect(answers.map((one) => one.results.length)).toEqual([1, 1]);
    expect(records.some((one: WebSearchRecord) => "repeated" in one)).toBe(
      false,
    );
  });

  it("never says 0 results for a search whose pages are all on screen", async () => {
    const { answers, records } = await settle(
      [
        [
          ["p", "p words"],
          ["q", "q words"],
        ],
        [
          ["q", "q words"],
          ["p", "p words"],
        ],
      ],
      { limit: 9, dedupe: true },
    );
    expect(answers[1]?.results).toEqual([]);
    const second = records[1];
    expect(second?.status).toBe("searched");
    expect(second?.status === "searched" && second.repeated).toBe(2);
  });

  it("counts no repeat whose twin the fit cut", async () => {
    // The limit keeps one of the first search's two results: its second, the
    // twin of the second search's only result, is cut, so that repeat is no
    // page the writer can see.
    const { answers, records } = await settle(
      [
        [
          ["p", "p words"],
          ["q", "q words"],
        ],
        [["q", "q words"]],
      ],
      { limit: 1, dedupe: true },
    );
    expect(answers.map((one) => one.results.map((r) => r.title))).toEqual([
      ["p"],
      [],
    ]);
    expect(records.some((one: WebSearchRecord) => "repeated" in one)).toBe(
      false,
    );
  });

  it("leaves chat as it was: no limit, no dedupe, no repeated", async () => {
    const { answers, records } = await settle([
      five("a"),
      [
        ["a0", "about a0"],
        ["b", "b words"],
      ],
    ]);
    expect(answers.map((one) => one.results.length)).toEqual([5, 2]);
    expect(records.some((one: WebSearchRecord) => "repeated" in one)).toBe(
      false,
    );
  });

  it("answers the query as sent, and the array its record's ids name", async () => {
    const bench = setup();
    const proposed = row("as proposed");
    const settled = bench.pause.searchesFor([proposed], ROOM, {
      limit: 9,
      dedupe: true,
    });
    const posted = await bench.ask();
    bench.pause.answer(posted.askId, {
      kind: "send",
      rows: posted.rows.map(({ rowId }) => ({ rowId, query: "as edited" })),
    });
    const answer = searched((await settled).get(proposed.call));
    expect(answer.query).toBe("as edited");
    const record = last(bench.written)[0];
    expect(
      record?.status === "searched" && record.results.map((one) => one.id),
    ).toEqual(answer.results.map((one) => one.id));
  });
});

describe("the pause's answers narrow through one guard (5.8)", () => {
  it("is true only for a search that came back, and narrows the refusal away", () => {
    // Built by the four builders the union is named from, so the row moves
    // with them.
    const web = { kind: "provider", providerId: "openrouter" } as const;
    const answers: PauseAnswer[] = [
      searchedResult({ engine: web, query: "q", results: [] }),
      failedResult({ engine: web, code: "connection" }),
      declinedResult({ runNo: false }),
      webSearchRefusal("search-limit"),
    ];
    expect(answers.map(searchAnswered)).toEqual([true, false, false, false]);
  });
});
