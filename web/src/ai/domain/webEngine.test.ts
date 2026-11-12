// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  CHAT_KINDS,
  MODEL_FAILURE_CODES,
  type ModelFailureCode,
} from "./types";
import {
  engineFacts,
  engineLabel,
  keepsNoReceiptBody,
  MAX_ATTEMPTS,
  REMEDY_ON,
  remedyOf,
  RETRIES_PER_SEARCH,
  RETRY_WAIT_DEFAULT_MS,
  RETRY_WAIT_MAX_MS,
  retryAt,
  searchesWeb,
  WEB_ID_MAX,
  WEB_RECORDS_MAX,
  WEB_SEARCHES_PER_RUN,
  webSourceId,
  webSourceNumber,
  type AttemptFact,
} from "./webEngine";
import { runElapsedMs } from "./runClock";

describe("web engines", () => {
  it("offers search in general, drafting and editorial chats, never a reader's", () => {
    expect(CHAT_KINDS.filter(searchesWeb)).toEqual([
      "general",
      "drafting",
      "editorial",
    ]);
  });

  it("derives every engine fact from its kind", () => {
    expect(engineFacts({ kind: "wikipedia" })).toEqual({
      billed: false,
      offersFallback: false,
      limited: true,
    });
    expect(engineFacts({ kind: "provider", providerId: "openrouter" })).toEqual(
      { billed: true, offersFallback: true, limited: false },
    );
  });

  // An allow-list, total over the codes, so this table is the one place a
  // new code is decided. `rate-limited` earns a retry on the same engine,
  // and only it.
  it("gives each failure one remedy: a retry, a re-ask, or none", () => {
    const table = Object.fromEntries(
      MODEL_FAILURE_CODES.map((code) => [code, REMEDY_ON[code]]),
    );
    expect(table).toEqual({
      "not-configured": "re-ask-and-latch",
      connection: "re-ask",
      "origin-or-permission": "none",
      "model-missing": "none",
      "capability-missing": "none",
      "context-too-large": "none",
      "resource-exhausted": "re-ask",
      "invalid-response": "re-ask",
      "provider-rejected": "none",
      "no-private-host": "re-ask-and-latch",
      "key-expired": "re-ask-and-latch",
      "credit-exhausted": "re-ask-and-latch",
      "limit-reached": "re-ask-and-latch",
      "rate-limited": "retry",
      "model-busy": "re-ask",
      "quota-exhausted": "re-ask-and-latch",
      busy: "re-ask",
      "account-changed": "none",
      timeout: "re-ask",
      interrupted: "none",
      cancelled: "none",
      // Chat-step endings (`turnEnding.ts`): never a search's.
      "output-limit": "none",
      refusal: "none",
    });
  });

  it("bounds a turn's records at every attempt a search may make", () => {
    expect(WEB_SEARCHES_PER_RUN).toBe(3);
    expect(RETRIES_PER_SEARCH).toBe(1);
    // The first attempt, one retry and one re-ask.
    expect(MAX_ATTEMPTS).toBe(2 + RETRIES_PER_SEARCH);
    expect(WEB_RECORDS_MAX).toBe(MAX_ATTEMPTS * WEB_SEARCHES_PER_RUN);
  });

  it("names an engine to the model by its kind, never its id", () => {
    expect(engineLabel({ kind: "provider", providerId: "openrouter" })).toBe(
      "web",
    );
    expect(engineLabel({ kind: "wikipedia" })).toBe("wikipedia");
  });

  it("reads back only the ids it writes", () => {
    expect(webSourceId(7)).toBe("web:7");
    expect(webSourceNumber("web:7")).toBe(7);
    expect(webSourceNumber(webSourceId(WEB_ID_MAX))).toBe(WEB_ID_MAX);
    for (const id of [
      "web:0",
      "web:07",
      "web:1000000",
      "web:1 ",
      " web:1",
      "web:-1",
      "WEB:1",
      "node:1",
    ])
      expect(webSourceNumber(id), id).toBeNull();
  });

  it("keeps a search's receipt bare and every other tool's whole", () => {
    expect(keepsNoReceiptBody("web_search")).toBe(true);
    expect(keepsNoReceiptBody("read_source")).toBe(false);
  });

  it("leaves the writer's wait out of a run's time, never below zero", () => {
    const start = "2026-09-27T10:00:00.000Z";
    expect(runElapsedMs(start, 0, "2026-09-27T10:00:30.000Z")).toBe(30_000);
    expect(runElapsedMs(start, 20_000, "2026-09-27T10:00:30.000Z")).toBe(
      10_000,
    );
    expect(runElapsedMs(start, 90_000, "2026-09-27T10:00:30.000Z")).toBe(0);
  });
});

// The retry and the re-ask, planned.

describe("retryAt", () => {
  const settled = Date.parse("2026-09-27T10:00:00.000Z");

  it("waits what the server said, from the settle", () => {
    expect(retryAt(settled, 5_000)).toBe(settled + 5_000);
  });

  it("waits the default when the server said nothing", () => {
    expect(retryAt(settled, undefined)).toBe(settled + RETRY_WAIT_DEFAULT_MS);
    expect(RETRY_WAIT_DEFAULT_MS).toBeLessThanOrEqual(RETRY_WAIT_MAX_MS);
  });

  it("waits up to the hour, inclusive, and offers nothing past it", () => {
    expect(RETRY_WAIT_MAX_MS).toBe(3_600_000);
    expect(retryAt(settled, RETRY_WAIT_MAX_MS)).toBe(
      settled + RETRY_WAIT_MAX_MS,
    );
    expect(retryAt(settled, RETRY_WAIT_MAX_MS + 1)).toBeNull();
  });
});

describe("remedyOf: what a row's last attempt earns", () => {
  const PAID = { kind: "provider", providerId: "openrouter" } as const;
  const WIKI = { kind: "wikipedia" } as const;
  const failed = (
    engine: AttemptFact["engine"],
    code: ModelFailureCode,
    via: AttemptFact["via"] = "first",
    at: number | null = 1,
  ): AttemptFact => ({ engine, via, outcome: "failed", code, retryAt: at });

  it("earns nothing without a failure", () => {
    expect(remedyOf([])).toBeNull();
    expect(
      remedyOf([{ engine: PAID, via: "first", outcome: "searched" }]),
    ).toBeNull();
    expect(
      remedyOf([{ engine: PAID, via: "first", outcome: "declined" }]),
    ).toBeNull();
    expect(remedyOf([failed(PAID, "provider-rejected")])).toBeNull();
  });

  it("retries a rate-limited attempt on any engine, at its own instant", () => {
    expect(remedyOf([failed(PAID, "rate-limited", "first", 42)])).toEqual({
      kind: "retry",
      at: 42,
    });
    expect(remedyOf([failed(WIKI, "rate-limited", "first", 42)])).toEqual({
      kind: "retry",
      at: 42,
    });
  });

  it("does not retry past the wait's maximum", () => {
    expect(remedyOf([failed(PAID, "rate-limited", "first", null)])).toBeNull();
  });

  it("retries once per search, whichever engine the retry was on", () => {
    expect(
      remedyOf([
        failed(PAID, "rate-limited"),
        failed(PAID, "rate-limited", "retry"),
      ]),
    ).toBeNull();
    // A re-ask refused for speed may take the row's retry while it is unused…
    expect(
      remedyOf([
        failed(PAID, "key-expired"),
        failed(WIKI, "rate-limited", "re-ask", 7),
      ]),
    ).toEqual({ kind: "retry", at: 7 });
    // …and not once it is spent.
    expect(
      remedyOf([
        failed(PAID, "rate-limited"),
        failed(PAID, "key-expired", "retry"),
        failed(WIKI, "rate-limited", "re-ask"),
      ]),
    ).toBeNull();
  });

  it("re-asks a provider's failure on Wikipedia once, and latches on a key code", () => {
    expect(remedyOf([failed(PAID, "timeout")])).toEqual({
      kind: "re-ask",
      latch: false,
    });
    expect(remedyOf([failed(PAID, "key-expired")])).toEqual({
      kind: "re-ask",
      latch: true,
    });
    // A retry that fails with a key code is re-asked: the chained case.
    expect(
      remedyOf([
        failed(PAID, "rate-limited"),
        failed(PAID, "key-expired", "retry"),
      ]),
    ).toEqual({ kind: "re-ask", latch: true });
  });

  it("never re-asks Wikipedia, and never twice", () => {
    expect(remedyOf([failed(WIKI, "timeout")])).toBeNull();
    expect(
      remedyOf([failed(PAID, "timeout"), failed(WIKI, "timeout", "re-ask")]),
    ).toBeNull();
  });

  it("never plans a row past its attempts, from either engine", () => {
    // Every path a row can take, each attempt failing with any code, ends
    // within `MAX_ATTEMPTS`, the bound the codec and the pre-flight read.
    const walk = (history: AttemptFact[]): number => {
      const next = remedyOf(history);
      if (!next) return history.length;
      const engine =
        next.kind === "re-ask"
          ? WIKI
          : (history[history.length - 1]?.engine ?? PAID);
      return Math.max(
        ...MODEL_FAILURE_CODES.map((code) =>
          walk([...history, failed(engine, code, next.kind)]),
        ),
      );
    };
    for (const first of [PAID, WIKI])
      expect(
        Math.max(
          ...MODEL_FAILURE_CODES.map((code) => walk([failed(first, code)])),
        ),
        first.kind,
      ).toBeLessThanOrEqual(MAX_ATTEMPTS);
    expect(
      Math.max(
        ...MODEL_FAILURE_CODES.map((code) => walk([failed(PAID, code)])),
      ),
    ).toBe(MAX_ATTEMPTS);
  });
});
