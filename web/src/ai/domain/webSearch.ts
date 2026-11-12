// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Web search: engines, results, whether a query was sent, outcomes and the
// writer's answers.

import type { ModelFailure, ModelFailureCode } from "./models";

// ── Web search ───────────────────────────────────────────────────────────────

/**
 * Where an approved query goes, shaped by engine rather than by vendor:
 * keyless Wikipedia, or a connected provider's search, which
 * spends the writer's key. Everything else about an engine
 * (whether it is billed, which way a fallback may go, whether a cost is
 * reported) is derived from `kind`, never stored beside it.
 */
export type WebEngine =
  { kind: "wikipedia" } | { kind: "provider"; providerId: string };

/**
 * One result as an engine returned it, after the SPA's own check
 * (`webResultsOf`). No `site`: the host is derived from `url` wherever it is
 * shown. No id: the run issues `web:N` when it hands results to a model.
 */
export interface WebResult {
  url: string;
  title: string;
  excerpt: string;
}

/**
 * Whether a query reached the engine. `no` only when the code that refused
 * decided before any outbound call: the engine's own refusal before its
 * fetch. `unknown` when no answer came back at all. Everything else is
 * `yes`: over-disclosing is the safe direction, and "not sent" is the one
 * claim that must never be a guess.
 */
export type WebReach = "no" | "yes" | "unknown";

/**
 * What one search came to. A search never throws; every failure is this.
 *
 * It names no engine, and must never gain one: a record's engine is written
 * from the engine object the writer approved, and an outcome that said where
 * it went would be a second answer someone could read instead, which is
 * substitution.
 */
export type WebSearchOutcome =
  | {
      status: "searched";
      results: WebResult[];
      /** The provider's reported cost, only as reported. */
      costUsd?: number;
    }
  | {
      status: "failed";
      /**
       * `failure.message` stops at the adapter: a tool result and a stored
       * record carry the code alone. The message is the adapter's English,
       * never model input and never a file's content.
       */
      failure: ModelFailure;
      reached: WebReach;
    };

/**
 * A proposed search, waiting on the writer. Data only, so it can
 * ride in the published snapshot: the engine object, the book-words index and
 * the wait itself stay on the run.
 *
 * Rows are named by an id the app issued, never by the model's call id: a
 * vendor's call ids arrive as it wrote them, two calls can share one, and an
 * answer must not be able to name a row it was not shown.
 *
 * Three kinds, as a union rather than optional fields side by side, so no
 * ask can be two of them at once:
 * - `first`: the model's proposal, each row editable;
 * - `re-ask`: the same queries on Wikipedia after the provider failed, with
 *   why, and whether the query may have reached it;
 * - `retry`: the same queries to the same engine once the engine's wait has
 *   passed. `at` is the ISO instant it may first be answered; its rows are
 *   the queries as sent, and cannot be edited or unticked.
 */
export type SearchAsk = {
  askId: string;
  /** Where every approved row goes, bound when the ask was posed. */
  engine: WebEngine;
  rows: Array<{
    rowId: string;
    /** Already `normaliseQuery`'s value: what would be sent, byte for byte. */
    query: string;
    /** It repeats a run of the writer's own words. */
    bookWords: boolean;
  }>;
} & (
  | { kind: "first" }
  | { kind: "re-ask"; code: ModelFailureCode; reached: WebReach }
  | { kind: "retry"; at: string }
);

/**
 * The writer's answer to a `SearchAsk`. `send` carries the ticked rows only,
 * each with the query as the writer left it; a row it does not name is
 * declined. `decline` is the run's no: no later search in this answer is
 * asked about. An empty `send` declines every row and is not that no.
 * `retry` answers a retry ask, and only one: it names no row and no query,
 * because the pause sends each row's own stored query, byte for byte by
 * construction, with nothing from the screen to check.
 */
export type SearchAnswer =
  | { kind: "send"; rows: Array<{ rowId: string; query: string }> }
  | { kind: "retry" }
  | { kind: "decline" };

/**
 * One attempt at one search, kept on the answer's turn. Of what a
 * search returned, only what renders a citation is kept: no excerpt, no
 * site, no message, and no query on a declined row, which never left.
 */
export type WebSearchRecord =
  | {
      callId: string;
      engine: WebEngine;
      status: "searched";
      query: string;
      /** The results the model was shown, with the ids it was shown them by. */
      results: Array<{ id: string; url: string; title: string }>;
      /**
       * How many more this search returned that `/verify` showed under an
       * earlier search of the same check (the same page, the same excerpt),
       * counted only while that twin is itself on screen. So the trace can
       * say what this search found, never "0 results" for a search whose
       * pages are in front of the writer. Absent when none. The trace's web
       * row (`AiTrace`) is its one reader: never a source count, never the
       * model's.
       */
      repeated?: number;
      /** A provider's reported cost, only as reported. */
      costUsd?: number;
    }
  | {
      callId: string;
      engine: WebEngine;
      status: "failed";
      query: string;
      code: ModelFailureCode;
      reached: WebReach;
    }
  | { callId: string; engine: WebEngine; status: "declined" };
