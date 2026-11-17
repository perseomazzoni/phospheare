// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { bookWordsIn } from "../domain/bookWords";
import type {
  ModelFailureCode,
  ModelRef,
  RunActivity,
  SearchAnswer,
  SearchAsk,
  ToolCall,
  WebEngine,
  WebReach,
  WebResult,
  WebSearchRecord,
} from "../domain/types";
import {
  engineFacts,
  engineLabel,
  remedyOf,
  retryAt,
  WEB_ID_MAX,
  WEB_SEARCHES_PER_RUN,
  type AttemptFact,
} from "../domain/webEngine";
import {
  plainLine,
  usableQuery,
  WEB_RESULTS_MAX,
  webPageKey,
} from "../domain/webText";
import type { WebSearch, WebSearchEngine } from "../ports";
import { appLog } from "../../log";
import { BOOK_WORDS_RUN } from "./budgets";
import { ModelRunError, throwIfCancelled } from "./runStep";
import {
  declinedResult,
  failedResult,
  fitsAtFloor,
  fitWebResults,
  searchedResult,
  shownResults,
  webSearchRefusal,
  type AttemptLine,
  type PauseAnswer,
} from "./webResults";

// The search pause: nothing leaves until the writer says so. A model
// proposes searches; the pause asks the writer, sends what they approved,
// unchanged, to the engine the ask named, and settles what each call answers.
// It runs after the step's other calls, so it can read what they showed the
// model and the room they left, and before any answer goes back to the model.
// There is one per chat run, so its state (the run's no, the latch, the
// count) ends with the run, and a queued or retried run asks again.
//
// A failed search may earn a follow-up: a re-ask of the same query on
// Wikipedia after the provider failed, or a retry on the same engine once its
// rate limit has passed. `remedyOf` decides which; the pause runs re-asks
// first, because they need no wait.
//
// The loop hands it rows already judged (`searchCandidates`), and it never
// touches the run's messages. What it tells the Assistant goes through
// `SearchPauseDependencies`, so `publish` stays the Assistant's alone.

/** A search the loop judged askable. */
export interface PauseRow {
  call: ToolCall;
  query: string;
}

/**
 * `/verify`'s terms for a step's results, which chat never sets: at
 * most `limit` results across its searches, the judge's reading, and each
 * page shown once. The same page with the same excerpt under two searches
 * would read to the judge as two sources agreeing.
 */
export interface PauseTerms {
  limit: number;
  dedupe: true;
}

export interface SearchPauseDependencies {
  webSearch: WebSearch;
  /** The model the run asks: a provider search runs on it or not at all. */
  model: ModelRef;
  /** The account the run started under; every send must still be it. */
  account: string;
  /** The run's own: Stop, delete and dispose all end the wait through it. */
  signal: AbortSignal;
  now: () => string;
  newId: () => string;
  /** The highest `web:N` the chat already holds; ids continue after it. */
  lastWebIndex: number;
  /** The writer's text this run has shown the model, when an ask is posed. */
  bookTexts: () => readonly string[];
  /**
   * The ask to show, or `null` once it is answered or the run ends, with the
   * run's whole wait on the writer so far. One call per change, so the
   * Assistant can publish the ask, the wait and the words together.
   */
  onAsk: (ask: SearchAsk | null, waitedMs: number) => void;
  onActivity: (activity: RunActivity) => void;
  /** Every record so far, to be written at once: ahead of a send, and after. */
  onRecords: (records: readonly WebSearchRecord[]) => Promise<void>;
}

/** One attempt at one row: a send, or the writer's no to it. */
type Attempt = {
  engine: WebSearchEngine;
  /** Why it was made: the proposal, a retry, or a re-ask. */
  via: AttemptFact["via"];
} & (
  | {
      outcome: "searched";
      query: string;
      results: readonly WebResult[];
      costUsd?: number;
      /** Where its record is: rewritten once the results are fitted. */
      record: number;
    }
  | {
      outcome: "failed";
      query: string;
      code: ModelFailureCode;
      reached: WebReach;
      /** When a retry may be sent (epoch ms), or `null` when none may. */
      retryAt: number | null;
    }
  | { outcome: "declined"; runNo: boolean }
);

interface RoundItem {
  row: PauseRow;
  query: string;
}

/**
 * What the ask says about itself beyond its rows: first, re-ask or retry. A
 * retry's instant is the pause's own clock (epoch ms) here, and becomes the
 * ask's ISO string only in `askOf`.
 */
type AskKind =
  | { kind: "first" }
  | { kind: "re-ask"; code: ModelFailureCode; reached: WebReach }
  | { kind: "retry"; at: number };

/**
 * The ask as the screen reads it, and the one place a retry's instant is
 * turned into the ask's ISO string. The pause keeps and compares the number,
 * so the gate never reads back what it wrote for the screen.
 */
function askOf(
  askId: string,
  engine: WebEngine,
  rows: SearchAsk["rows"],
  kind: AskKind,
): SearchAsk {
  return kind.kind === "retry"
    ? {
        askId,
        engine,
        rows,
        kind: "retry",
        at: new Date(kind.at).toISOString(),
      }
    : { askId, engine, rows, ...kind };
}

/**
 * A result's identity for `/verify`'s dedupe: its page and its excerpt. Not
 * the page alone: Wikipedia's excerpt is chosen by the query, so one article
 * found by two searches can hold the sentence that settles the claim in only
 * one of them, and a page-only dedupe would drop it.
 */
function pageAndExcerpt(result: WebResult): string {
  return `${webPageKey(result.url)}\n${plainLine(result.excerpt)}`;
}

/** A searched row as the fit reads it, and what it lost to earlier rows. */
interface SearchedRow {
  row: PauseRow;
  last: Extract<Attempt, { outcome: "searched" }>;
  /** The results the fit may show: after the dedupe, when there is one. */
  results: readonly WebResult[];
  /** The keys of results dropped as repeats of an earlier row's. */
  twins: string[];
}

/**
 * Each row with its repeats of an earlier row's results taken out, in order:
 * the first search to return a page with an excerpt keeps it. Only
 * `/verify` asks for it (`terms.dedupe`); chat passes no terms and gets its
 * rows back unchanged, because a repeat there is the model's own doing,
 * answered by the repeat refusal.
 */
function deduped(rows: SearchedRow[], dedupe: boolean): SearchedRow[] {
  if (!dedupe) return rows;
  const seen = new Set<string>();
  return rows.map((one) => {
    const results: WebResult[] = [];
    const twins: string[] = [];
    for (const result of one.results) {
      const key = pageAndExcerpt(result);
      if (seen.has(key)) twins.push(key);
      else results.push(result);
    }
    for (const result of results) seen.add(pageAndExcerpt(result));
    return { ...one, results, twins };
  });
}

function lastOf<T>(list: readonly T[] | undefined): T | undefined {
  return list?.[list.length - 1];
}

/** An attempt as the domain planner reads it: values, never engine objects. */
function factOf(attempt: Attempt): AttemptFact {
  const base = { engine: attempt.engine.engine, via: attempt.via };
  if (attempt.outcome === "failed")
    return {
      ...base,
      outcome: "failed",
      code: attempt.code,
      retryAt: attempt.retryAt,
    };
  return { ...base, outcome: attempt.outcome };
}

/**
 * The more disclosing of two `WebReach` answers: `yes`, then `unknown`, then
 * `no`.
 */
function wider(left: WebReach, right: WebReach): WebReach {
  const order: readonly WebReach[] = ["no", "unknown", "yes"];
  return order.indexOf(left) >= order.indexOf(right) ? left : right;
}

function cancelled(): ModelRunError {
  return new ModelRunError({
    code: "cancelled",
    message: "Stopped",
    retryable: false,
  });
}

export class SearchPause {
  /** Searches this run has asked about, against the per-run cap. */
  private searches = 0;
  /** The writer said no to this answer's searches; it never lifts. */
  private declined = false;
  /** A key-level failure: every later ask names Wikipedia. */
  private latched = false;
  /** This model's window cannot hold results: final for the run. */
  private tooLarge = false;
  private nextIndex: number;
  private readonly records: WebSearchRecord[] = [];
  private waited = 0;
  /** The ask in front of the writer, with the index its flags came from. */
  private pending: {
    ask: SearchAsk;
    kind: AskKind;
    bookWords: (query: string) => boolean;
    settle: (answer: SearchAnswer) => void;
  } | null = null;

  constructor(private readonly deps: SearchPauseDependencies) {
    this.nextIndex = deps.lastWebIndex + 1;
  }

  get waitedMs(): number {
    return this.waited;
  }

  /**
   * What `turn.web` holds: one row per attempt, in the order they began.
   * Every ending of the run writes it, a finished answer, a failure and a
   * Stop alike, so a Stop's declined rows need no write of their own.
   */
  get written(): readonly WebSearchRecord[] {
    return this.records;
  }

  /**
   * The writer's answer to the ask in front of them, or `false` when it is
   * not one this ask can take, and then nothing is spent and the ask stays
   * pending. Checked whole, by the ask's kind:
   * - `decline` is always taken: saying no is the safe direction;
   * - a first ask or a re-ask takes `send`, naming only its rows, each once,
   *   and every query already the one a send would send, so nothing is
   *   transformed between the card and the wire;
   * - a retry ask takes `retry`, and only once its wait has passed, compared
   *   so that an unreadable clock refuses rather than allows.
   * Single-use: a second answer, a stale one, or one after Stop finds nothing
   * pending.
   */
  answer(askId: string, answer: SearchAnswer): boolean {
    const pending = this.pending;
    if (!pending || pending.ask.askId !== askId) return false;
    if (answer.kind === "decline") return this.settle(pending, answer);
    if (pending.kind.kind === "retry") {
      if (answer.kind !== "retry") return false;
      if (!(this.clock() >= pending.kind.at)) return false;
      return this.settle(pending, answer);
    }
    if (answer.kind !== "send" || !Array.isArray(answer.rows)) return false;
    const asked = new Set(pending.ask.rows.map((row) => row.rowId));
    const named = new Set<string>();
    for (const row of answer.rows) {
      if (
        typeof row !== "object" ||
        row === null ||
        typeof row.rowId !== "string" ||
        !asked.has(row.rowId) ||
        named.has(row.rowId) ||
        typeof row.query !== "string" ||
        usableQuery(row.query) !== row.query
      )
        return false;
      named.add(row.rowId);
    }
    return this.settle(pending, answer);
  }

  private settle(
    pending: NonNullable<SearchPause["pending"]>,
    answer: SearchAnswer,
  ): true {
    this.pending = null;
    pending.settle(answer);
    return true;
  }

  /**
   * Whether an edited query repeats the writer's words, by the index of the
   * ask in front of them. `false` once that ask is settled: the index goes
   * with it.
   */
  holdsBookWords(askId: string, query: string): boolean {
    const pending = this.pending;
    return pending !== null && pending.ask.askId === askId
      ? pending.bookWords(query)
      : false;
  }

  /**
   * What each of the step's searches answers the model, settled: refused,
   * asked about, sent, re-asked, retried, fitted. `room` is the characters
   * the step's results may take (`webRoom`). Throws the run's `cancelled`
   * when the writer stops it or the account changed under it, never as a
   * tool result, so the loop's per-call catch cannot swallow either.
   */
  async searchesFor(
    rows: readonly PauseRow[],
    room: number,
    terms?: PauseTerms,
  ): Promise<Map<ToolCall, PauseAnswer>> {
    const out = new Map<ToolCall, PauseAnswer>();
    const asked: PauseRow[] = [];
    for (const row of rows) {
      if (this.tooLarge)
        out.set(row.call, webSearchRefusal("results-too-large-for-this-model"));
      else if (this.declined)
        // Not counted: once the run's no stands it never lifts, so the cap
        // behind it can never be reached again.
        out.set(row.call, declinedResult({ runNo: true }));
      else if (this.searches >= WEB_SEARCHES_PER_RUN)
        out.set(row.call, webSearchRefusal("search-limit"));
      else {
        this.searches += 1;
        asked.push(row);
      }
    }
    if (asked.length === 0) return out;
    // A chat that has issued nearly every id it may hold: nothing it could
    // show would have an id to be cited by.
    if (this.nextIndex + asked.length * WEB_RESULTS_MAX - 1 > WEB_ID_MAX) {
      for (const row of asked)
        out.set(row.call, webSearchRefusal("not-available"));
      return out;
    }
    // Fit before asking: a writer is never asked to approve a search whose
    // results this model could not be shown. The worst case counts every
    // attempt a search can make, retries and re-ask included.
    if (!fitsAtFloor(asked.length, room)) {
      this.tooLarge = true;
      for (const row of asked)
        out.set(row.call, webSearchRefusal("results-too-large-for-this-model"));
      return out;
    }

    const attempts = new Map<PauseRow, Attempt[]>(
      asked.map((row) => [row, []]),
    );
    const { webSearch } = this.deps;
    // Read once, into a const: the ask names this engine and every send goes
    // to this object, whatever `provider()` says a moment later.
    const engine = this.latched
      ? webSearch.wikipedia
      : (webSearch.provider(this.deps.model) ?? webSearch.wikipedia);
    await this.round(
      { kind: "first" },
      engine,
      asked.map((row) => ({ row, query: row.query })),
      attempts,
    );
    await this.followUps(asked, attempts);
    await this.fit(asked, attempts, room, out, terms);
    return out;
  }

  /**
   * The re-asks and retries the step's failures earn, until none is left or
   * the writer says no. Planned afresh after every round, because a round's
   * outcome decides what comes next (a retry refused with a key code is
   * re-asked; a re-ask refused for speed may be retried). Each row makes at
   * most one of each, so this ends within `MAX_ATTEMPTS` rounds of a row.
   */
  private async followUps(
    asked: readonly PauseRow[],
    attempts: Map<PauseRow, Attempt[]>,
  ): Promise<void> {
    const { wikipedia } = this.deps.webSearch;
    while (!this.declined) {
      const planned = asked.flatMap((row) => {
        const history = attempts.get(row) ?? [];
        const last = lastOf(history);
        const next = remedyOf(history.map(factOf));
        return next && last?.outcome === "failed" ? [{ row, last, next }] : [];
      });
      const reasks = planned.filter(({ next }) => next.kind === "re-ask");
      const first = reasks[0];
      if (first) {
        // The latch is the planner's to say; the pause only keeps it.
        if (reasks.some(({ next }) => next.kind === "re-ask" && next.latch))
          this.latched = true;
        // One re-ask, holding only the failed rows, each with the query the
        // writer approved. It never re-asks itself: Wikipedia has no
        // fallback.
        await this.round(
          {
            kind: "re-ask",
            code: first.last.code,
            reached: reasks.reduce<WebReach>(
              (reach, { last }) => wider(reach, last.reached),
              "no",
            ),
          },
          wikipedia,
          reasks.map(({ row, last }) => ({ row, query: last.query })),
          attempts,
        );
        continue;
      }
      const head = planned[0];
      if (!head) return;
      // One retry ask per pass, for one engine object, then plan again. Each
      // goes back to the engine its refused attempt went to, never another,
      // even one the round latched, which refuses it again; that cost is
      // accepted.
      const group = planned.filter(
        ({ last }) => last.engine === head.last.engine,
      );
      // The latest wait of its rows: one Retry sends them all.
      const at = Math.max(
        ...group.map(({ next }) => (next.kind === "retry" ? next.at : 0)),
      );
      await this.round(
        { kind: "retry", at },
        head.last.engine,
        group.map(({ row, last }) => ({ row, query: last.query })),
        attempts,
      );
    }
  }

  /**
   * One ask, answered, and its approved rows sent in order. The writer's
   * Stop anywhere in it, while the ask waits or between its sends, declines
   * every row this round had not yet recorded: asked about, never sent. Only
   * the Stop, seen as the run's signal, does so: an account change ends the
   * round too, and the rows it cut short are no answer of the writer's.
   * The round only pushes them; the run's ending writes `written`, so a
   * disposed run writes nothing at all.
   */
  private async round(
    kind: AskKind,
    engine: WebSearchEngine,
    items: readonly RoundItem[],
    attempts: Map<PauseRow, Attempt[]>,
  ): Promise<void> {
    const via: AttemptFact["via"] = kind.kind;
    const bookWords = bookWordsIn(this.deps.bookTexts(), BOOK_WORDS_RUN);
    const rows = items.map((item) => ({
      rowId: this.deps.newId(),
      query: item.query,
      bookWords: bookWords(item.query),
    }));
    const recorded = new Set<RoundItem>();
    try {
      const answer = await this.wait(
        askOf(this.deps.newId(), engine.engine, rows, kind),
        kind,
        bookWords,
      );
      const approved =
        answer.kind === "send"
          ? new Map(answer.rows.map((row) => [row.rowId, row.query]))
          : answer.kind === "retry"
            ? // A retry sends each row's own query, never one from the
              // screen: the same query, byte for byte, by construction.
              new Map(rows.map((row) => [row.rowId, row.query]))
            : new Map<string, string>();
      if (answer.kind === "decline") this.declined = true;
      for (const [at, item] of items.entries()) {
        const query = approved.get(rows[at]?.rowId ?? "");
        if (query === undefined) {
          attempts.get(item.row)?.push({
            engine,
            via,
            outcome: "declined",
            runNo: answer.kind === "decline",
          });
          this.recordDeclined(item, engine);
          recorded.add(item);
          continue;
        }
        throwIfCancelled(this.deps.signal);
        const account = this.deps.webSearch.accountId();
        if (account === null || account !== this.deps.account)
          throw cancelled();
        recorded.add(item);
        await this.send(engine, item, query, attempts, via);
      }
    } catch (error) {
      if (this.deps.signal.aborted)
        for (const item of items)
          if (!recorded.has(item)) this.recordDeclined(item, engine);
      throw error;
    }
    await this.deps.onRecords([...this.records]);
  }

  /** A row the writer was asked about and never sent: no query is kept. */
  private recordDeclined(item: RoundItem, engine: WebSearchEngine): void {
    this.records.push({
      callId: item.row.call.id,
      engine: engine.engine,
      status: "declined",
    });
  }

  /**
   * One approved query, to the ask's own engine. Written ahead as a failure
   * that may have reached the engine, so a reload mid-send says so, and
   * replaced when it settles. A search that came back stays "interrupted,
   * reached" until its results are fitted, which is true if the run never
   * gets that far.
   */
  private async send(
    engine: WebSearchEngine,
    item: RoundItem,
    query: string,
    attempts: Map<PauseRow, Attempt[]>,
    via: AttemptFact["via"],
  ): Promise<void> {
    const { row } = item;
    const record = this.records.length;
    const pending = {
      callId: row.call.id,
      engine: engine.engine,
      status: "failed" as const,
      query,
      code: "interrupted" as const,
    };
    this.records.push({ ...pending, reached: "unknown" });
    // Words before the write: the write-ahead can be slow on Remote Storage.
    this.deps.onActivity({
      kind: "searching-web",
      engine: engineLabel(engine.engine),
    });
    await this.deps.onRecords([...this.records]);
    const began = Date.now();
    const outcome = await engine.search(query, this.deps.signal);
    if (outcome.status === "searched") {
      this.records[record] = { ...pending, reached: "yes" };
      attempts.get(row)?.push({
        engine,
        via,
        outcome: "searched",
        query,
        results: outcome.results,
        ...(engineFacts(engine.engine).billed && outcome.costUsd !== undefined
          ? { costUsd: outcome.costUsd }
          : {}),
        record,
      });
    } else {
      this.records[record] = {
        ...pending,
        code: outcome.failure.code,
        reached: outcome.reached,
      };
      // Measured from the settle, read once. A clock that cannot be read
      // offers no retry rather than one at an instant nobody can check.
      const settled = this.clock();
      attempts.get(row)?.push({
        engine,
        via,
        outcome: "failed",
        query,
        code: outcome.failure.code,
        reached: outcome.reached,
        retryAt: Number.isFinite(settled)
          ? retryAt(settled, outcome.failure.retryAfterMs)
          : null,
      });
    }
    appLog.info("ai", "A web search ended.", {
      engine: engine.engine.kind,
      provider:
        engine.engine.kind === "provider"
          ? engine.engine.providerId
          : undefined,
      status: outcome.status,
      code: outcome.status === "searched" ? undefined : outcome.failure.code,
      reached: outcome.status === "searched" ? "yes" : outcome.reached,
      attempts: attempts.get(row)?.length,
      results:
        outcome.status === "searched" ? outcome.results.length : undefined,
      ms: Math.round(Date.now() - began),
    });
    await this.deps.onRecords([...this.records]);
    // Stopped mid-fetch: the attempt is written, and the run ends here.
    throwIfCancelled(this.deps.signal);
  }

  /**
   * What each asked row answers the model, with the step's results fitted
   * together and ids issued only to what is shown.
   */
  private async fit(
    asked: readonly PauseRow[],
    attempts: Map<PauseRow, Attempt[]>,
    room: number,
    out: Map<ToolCall, PauseAnswer>,
    terms: PauseTerms | undefined,
  ): Promise<void> {
    const lines = (row: PauseRow): AttemptLine[] | undefined => {
      const all = attempts.get(row) ?? [];
      if (all.length < 2) return undefined;
      return all.map((one): AttemptLine => {
        const engine = engineLabel(one.engine.engine);
        if (one.outcome === "searched")
          return { engine, status: "searched", results: one.results.length };
        if (one.outcome === "failed")
          return { engine, status: "failed", code: one.code };
        return { engine, status: "declined" };
      });
    };
    const searched = deduped(
      asked.flatMap((row) => {
        const last = lastOf(attempts.get(row));
        return last?.outcome === "searched"
          ? [{ row, last, results: last.results, twins: [] }]
          : [];
      }),
      terms?.dedupe === true,
    );
    const fitted = fitWebResults(
      searched.map(({ row, last, results }) => ({
        engine: last.engine.engine,
        query: last.query,
        results,
        attempts: lines(row),
      })),
      room,
      terms?.limit,
    );
    // What is on screen once fitted, by the dedupe's key: a twin cut by the
    // fit is no page the writer can see, so its repeats are not counted.
    const onScreen = new Set<string>();
    // Unreachable while the pre-flight's worst case is a true bound. A field
    // the bound forgets fails closed: the results are refused, and so is every
    // later search in the run.
    if (fitted === null) this.tooLarge = true;
    for (const [at, { row, last, results, twins }] of searched.entries()) {
      const shown = fitted
        ? shownResults(
            results,
            fitted.shown[at] ?? 0,
            fitted.cap,
            this.nextIndex,
          )
        : [];
      this.nextIndex += shown.length;
      // Twins are only ever earlier rows', so every one this row could
      // repeat is already in the set.
      const repeated = twins.filter((key) => onScreen.has(key)).length;
      for (const result of results.slice(0, shown.length))
        onScreen.add(pageAndExcerpt(result));
      // It searched, whatever the model is shown: the query left.
      this.records[last.record] = {
        callId: row.call.id,
        engine: last.engine.engine,
        status: "searched",
        query: last.query,
        results: shown.map(({ shown, url }) => ({
          id: shown.id,
          url,
          title: shown.title,
        })),
        ...(repeated > 0 ? { repeated } : {}),
        ...(last.costUsd === undefined ? {} : { costUsd: last.costUsd }),
      };
      out.set(
        row.call,
        fitted
          ? searchedResult({
              engine: last.engine.engine,
              query: last.query,
              results: shown.map((one) => one.shown),
              // After the dedupe: a repeat is shown, under an earlier search.
              omitted: results.length - shown.length,
              attempts: lines(row),
            })
          : webSearchRefusal("results-too-large-for-this-model"),
      );
    }
    for (const row of asked) {
      const last = lastOf(attempts.get(row));
      if (!last || last.outcome === "searched") continue;
      out.set(
        row.call,
        last.outcome === "failed"
          ? failedResult({
              engine: last.engine.engine,
              code: last.code,
              attempts: lines(row),
            })
          : declinedResult({ runNo: last.runNo, attempts: lines(row) }),
      );
    }
    await this.deps.onRecords([...this.records]);
  }

  /**
   * Post the ask and wait for the writer. Ends only two ways, their answer
   * or the run's signal, with no timer and no second dispose path. The ask,
   * its index and the wait's clock are settled in one `finally`, and
   * the Assistant hears the settle once, with the wait, so no frame shows
   * the ask gone and the clock not yet corrected.
   */
  private wait(
    ask: SearchAsk,
    kind: AskKind,
    bookWords: (query: string) => boolean,
  ): Promise<SearchAnswer> {
    const { signal } = this.deps;
    if (signal.aborted) return Promise.reject(cancelled());
    const posted = this.clock();
    this.deps.onAsk(ask, this.waited);
    return new Promise<SearchAnswer>((resolve, reject) => {
      const stop = () => reject(cancelled());
      signal.addEventListener("abort", stop, { once: true });
      this.pending = {
        ask,
        kind,
        bookWords,
        settle: (answer) => {
          signal.removeEventListener("abort", stop);
          resolve(answer);
        },
      };
    }).finally(() => {
      this.pending = null;
      // A clock that cannot be read adds nothing, rather than a NaN that
      // would reach the run's time and the live clock.
      const waited = this.clock() - posted;
      if (waited > 0) this.waited += waited;
      this.deps.onAsk(null, this.waited);
    });
  }

  /** The pause's clock, in epoch ms; `NaN` when `now()` cannot be read. */
  private clock(): number {
    return Date.parse(this.deps.now());
  }
}
