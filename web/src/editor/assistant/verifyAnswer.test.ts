// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { quotesOf, settledVerdict } from "./verifyAnswer";
import type { ChatTurn, WebSearchRecord } from "../../ai/domain/types";
import type { CitedSource } from "../../ai/domain/webCitations";
import { siteOf } from "../../ai/domain/webText";

// The pure half of a `/verify` answer: which words hang
// under which row, and in which language they are marked.

function searchedAt(urls: readonly string[]): WebSearchRecord {
  return {
    callId: "c1",
    engine: { kind: "wikipedia" },
    status: "searched",
    query: "q",
    results: urls.map((url, index) => ({
      id: `web:${index + 1}`,
      url,
      title: `T${index + 1}`,
    })),
  };
}

function rowsFor(record: WebSearchRecord): CitedSource[] {
  return record.status === "searched"
    ? record.results.map((result, index) => ({
        ...result,
        site: siteOf(result.url) ?? "",
        n: index + 1,
      }))
    : [];
}

describe("quotesOf: the quote's language", () => {
  it("marks only the app's own Wikipedia editions, from the row's checked site", () => {
    // A closed map: an edition the app does not speak, another host that
    // merely looks like Wikipedia, and the wider web all get no `lang` —
    // never a guess a screen reader would pronounce wrongly.
    const urls = [
      "https://en.wikipedia.org/wiki/A",
      "https://it.wikipedia.org/wiki/B",
      "https://de.wikipedia.org/wiki/C",
      "https://en.wikipedia.org.evil.example/wiki/D",
      "https://www.example.org/e",
      "https://simple.wikipedia.org/wiki/F",
    ];
    const record = searchedAt(urls);
    const quotes = quotesOf(
      {
        verdict: "doubtful",
        sources: urls.map((_, index) => ({
          id: `web:${index + 1}`,
          stance: "context" as const,
          quote: `words of source ${index + 1}`,
        })),
      },
      [record],
      rowsFor(record),
    );
    expect(
      [...quotes.entries()].map(([id, quote]) => [id, quote.lang ?? null]),
    ).toEqual([
      ["web:1", "en"],
      ["web:2", "it"],
      ["web:3", null],
      ["web:4", null],
      ["web:5", null],
      ["web:6", null],
    ]);
    // Absent, not empty: no `lang=""` reaches the bdi.
    expect("lang" in (quotes.get("web:3") ?? {})).toBe(false);
  });

  it("draws nothing for a source with no quote", () => {
    const record = searchedAt(["https://en.wikipedia.org/wiki/A"]);
    expect(
      quotesOf(
        {
          verdict: "plausible",
          sources: [{ id: "web:1", stance: "supports" }],
        },
        [record],
        rowsFor(record),
      ).size,
    ).toBe(0);
  });
});

describe("settledVerdict", () => {
  const turn = (over: Partial<ChatTurn>): ChatTurn => ({
    id: "a",
    role: "assistant",
    text: "",
    createdAt: "2026-09-27T00:00:00.000Z",
    outcome: "complete",
    verifies: true,
    verified: { unjudged: "unchecked" },
    ...over,
  });

  it("is the block only on a marked answer whose run completed", () => {
    expect(settledVerdict(turn({}))).toEqual({ unjudged: "unchecked" });
    expect(settledVerdict(turn({ outcome: "interrupted" }))).toBeNull();
    expect(settledVerdict(turn({ outcome: "failed" }))).toBeNull();
    expect(settledVerdict(turn({ verified: undefined }))).toBeNull();
    expect(settledVerdict(turn({ verifies: undefined }))).toBeNull();
  });
});
