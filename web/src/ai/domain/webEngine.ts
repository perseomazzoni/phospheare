// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ChatKind, ModelFailureCode, WebEngine } from "./types";

// ── Web engines and their rules ──────────────────────────────────────────────
//
// What an engine is, and what a run may do with one: pure rules the pause
// reads. Everything about an engine follows from its `kind`, never
// from a flag stored beside it, because a flag is a second answer a reader
// could take instead.

/** The most searches one answer may make, retries and re-asks not counted. */
export const WEB_SEARCHES_PER_RUN = 3;

/**
 * Retries one search may make after the engine said "not so fast".
 * One, across engines: a Wikipedia re-ask refused for speed may take it if
 * the provider's attempt did not.
 */
export const RETRIES_PER_SEARCH = 1;

/**
 * The most attempts one search can make: the first, its retries and one
 * re-ask on Wikipedia. Every bound that measures a search's history derives
 * from this (the codec's record cap and the pre-flight's worst case,
 * `worstAtFloor`), so neither is sized for a shorter history than the pause
 * can write. A cap shorter than the history drops every web record of a
 * retried turn on its next read.
 */
export const MAX_ATTEMPTS = 2 + RETRIES_PER_SEARCH;

/**
 * The most records one turn may hold: every attempt of every search. The
 * codec's bound for a file it did not write. A Stop's declined record takes
 * the place of the attempt it stopped, so it adds none.
 */
export const WEB_RECORDS_MAX = MAX_ATTEMPTS * WEB_SEARCHES_PER_RUN;

/**
 * How long a retry waits when the engine said "not so fast" and not for how
 * long: a 429 whose wait the browser cannot read. Retrying at once would most
 * likely spend the search's one retry on the same refusal.
 */
export const RETRY_WAIT_DEFAULT_MS = 30_000;

/**
 * The longest wait a retry is offered for, inclusive. The waits an engine
 * can name end at the hour: the Wikipedia breaker's clamp and the vendor's
 * `Retry-After`, which the adapters read only up to an hour. A longer
 * `Retry-After` is not a wait this code models, and a hostile or absurd one
 * must not hold an ask, and with it the run, for longer, so the row fails.
 */
export const RETRY_WAIT_MAX_MS = 3_600_000;

/**
 * The chats that may offer a web search. A reader chat never does: its
 * horizon is a promise about what it has read, and the open web does not
 * respect it. The switch is exhaustive, so a new chat kind does not
 * compile until its answer is chosen.
 */
export function searchesWeb(kind: ChatKind): boolean {
  switch (kind) {
    case "general":
    case "drafting":
    case "editorial":
      return true;
    case "alpha-reader":
    case "beta-reader":
      return false;
  }
}

/**
 * What an engine means for the writer. `billed`: it spends their key, so a
 * reported cost is kept. `offersFallback`: its failure may be re-asked on
 * Wikipedia. `limited`: Wikipedia covers encyclopaedic topics only,
 * and the model is told so. Booleans, never an engine value: the pause picks
 * the one engine object it holds, so the domain can never name a substitute.
 */
export function engineFacts(engine: WebEngine): {
  billed: boolean;
  offersFallback: boolean;
  limited: boolean;
} {
  const provider = engine.kind === "provider";
  return { billed: provider, offersFallback: provider, limited: !provider };
}

/**
 * What a failed search earns: nothing; a retry of the same query on the same
 * engine once the engine's wait has passed; a re-ask on Wikipedia; or a
 * re-ask that also latches the provider off for the run.
 */
export type Remedy = "none" | "retry" | "re-ask" | "re-ask-and-latch";

/**
 * What each failure earns. Total over `ModelFailureCode`, so a new
 * code does not compile until what it earns is chosen; a default-deny list
 * would let a new code pass through silently.
 *
 * `rate-limited` is every "wait, then ask again" the SPA can see: the
 * Wikipedia breaker after a Wikimedia 429, and the vendor's own
 * 429. The remedy is the same for both, the same query to the same engine
 * once the wait has passed, so it is a retry, never a change of engine.
 *
 * The key codes latch the provider off for the rest of the run: nothing in
 * one answer fixes a key, so the next ask names Wikipedia from the start
 * rather than failing twice. `quota-exhausted` is the vendor's day-long
 * free-model count, which Wikipedia does not share. `reached` never decides
 * a remedy.
 */
export const REMEDY_ON: Readonly<Record<ModelFailureCode, Remedy>> = {
  "not-configured": "re-ask-and-latch",
  "key-expired": "re-ask-and-latch",
  "credit-exhausted": "re-ask-and-latch",
  "limit-reached": "re-ask-and-latch",
  "quota-exhausted": "re-ask-and-latch",
  // A run's searches all name the run's one model, so every later ask is
  // refused the same way.
  "no-private-host": "re-ask-and-latch",
  connection: "re-ask",
  timeout: "re-ask",
  "resource-exhausted": "re-ask",
  "rate-limited": "retry",
  "model-busy": "re-ask",
  busy: "re-ask",
  "invalid-response": "re-ask",
  "origin-or-permission": "none",
  "model-missing": "none",
  "capability-missing": "none",
  "context-too-large": "none",
  "provider-rejected": "none",
  // No adapter produces it: a tab whose writer session changes reloads
  // before it sends.
  "account-changed": "none",
  interrupted: "none",
  cancelled: "none",
  // Two endings of a chat step (`turnEnding.ts`), never of a search: a
  // search request has no output to run out of and nothing to decline, so
  // either earns nothing here, like `interrupted`.
  "output-limit": "none",
  refusal: "none",
};

/**
 * One attempt as the planner reads it: where it went, why it was made, and
 * how it ended. Plain values, never the application's engine objects, so the
 * planner stays a table of facts.
 */
export type AttemptFact = {
  engine: WebEngine;
  via: "first" | "retry" | "re-ask";
} & (
  | { outcome: "searched" }
  | {
      outcome: "failed";
      code: ModelFailureCode;
      /** When a retry may first be sent (epoch ms); null past the maximum. */
      retryAt: number | null;
    }
  | { outcome: "declined" }
);

/**
 * When a refused search may be retried: its settle instant plus the engine's
 * wait, or the default when it named none. Null past `RETRY_WAIT_MAX_MS`,
 * which is inclusive. Measured from the refused send's settle, so the
 * time a writer spends on another ask in between counts toward it.
 */
export function retryAt(
  settledAt: number,
  retryAfterMs: number | undefined,
): number | null {
  const wait = retryAfterMs ?? RETRY_WAIT_DEFAULT_MS;
  return wait <= RETRY_WAIT_MAX_MS ? settledAt + wait : null;
}

/**
 * What one search's history earns next, or null when its path has ended.
 * The one place the table is read, so the latch and the order are decided
 * once:
 * - a retry: its last attempt was refused `rate-limited`, within the wait's
 *   maximum, and the search has not retried yet, on any engine. It goes to
 *   the last attempt's own engine, never another.
 * - a re-ask: the last attempt failed on an engine that offers one, with a
 *   code that earns one, and the search has not been re-asked yet. `latch`
 *   says whether the provider is off for the rest of the run.
 *
 * Every path ends within `MAX_ATTEMPTS`: one retry and one re-ask at most.
 */
export function remedyOf(
  attempts: readonly AttemptFact[],
): { kind: "retry"; at: number } | { kind: "re-ask"; latch: boolean } | null {
  const last = attempts[attempts.length - 1];
  if (!last || last.outcome !== "failed") return null;
  const remedy = REMEDY_ON[last.code];
  if (remedy === "retry") {
    const retried = attempts.some((one) => one.via === "retry");
    return !retried && last.retryAt !== null
      ? { kind: "retry", at: last.retryAt }
      : null;
  }
  if (remedy === "none") return null;
  const reasked = attempts.some((one) => one.via === "re-ask");
  return !reasked && engineFacts(last.engine).offersFallback
    ? { kind: "re-ask", latch: remedy === "re-ask-and-latch" }
    : null;
}

/**
 * The engine as the model names it. A provider is `web`, never its id: the
 * transport is not the source, and the label stays true with any number of
 * search providers.
 */
export function engineLabel(engine: WebEngine): "wikipedia" | "web" {
  return engine.kind === "wikipedia" ? "wikipedia" : "web";
}

// ── Web result ids ───────────────────────────────────────────────────────────
//
// `web:N` is the id a model cites a search result by.

/** The largest id a chat may hold; past it a search is `not-available`. */
export const WEB_ID_MAX = 999_999;

const WEB_ID = /^web:([1-9][0-9]{0,5})$/;

export function webSourceId(n: number): string {
  return `web:${n}`;
}

/** The number in a `web:N` id, or null for anything else. */
export function webSourceNumber(id: string): number | null {
  const digits = WEB_ID.exec(id)?.[1];
  return digits === undefined ? null : Number(digits);
}

/**
 * The tools whose receipt keeps no body: no `arguments`, `result`,
 * `truncated` or `sourceId`, only `{callId, name, status}`. A web search's
 * query and results live in `turn.web`, bounded and checked; a receipt
 * carrying them again would be a second, unchecked copy that history could
 * replay as a tool message the model trusts.
 */
export function keepsNoReceiptBody(name: string): boolean {
  return name === "web_search";
}
