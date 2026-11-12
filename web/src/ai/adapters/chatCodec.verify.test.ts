// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  CHAT_KINDS,
  VERIFY_FIX_MAX,
  type ChatKind,
  type ChatRecord,
  type ChatTurn,
} from "../domain/types";
import { offersWorkflow } from "../domain/skills";
import { searchesWeb } from "../domain/webEngine";
import { WEB_QUOTE_MAX } from "../domain/webText";
import {
  settleClaimVerdict,
  type JudgedAnswer,
} from "../application/verifyClaim";
import type { ShownResult } from "../application/webResults";
import { parseChat } from "./chatCodec";

// Pins how a /verify answer is read back from a file someone else may have
// written.

/** A judged answer as a run writes one: the base every row edits. */
const BASE = {
  verdict: "implausible",
  sources: [
    { id: "web:1", stance: "contradicts", quote: "built from 1887 to 1889" },
    { id: "web:2", stance: "context" },
  ],
  fix: "The tower was finished in 1889.",
};

function chatWith(
  answer: Record<string, unknown>,
  kind: ChatKind = "general",
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
      model: { providerId: "ollama", modelId: "qwen3:8b" },
      pinnedSourceIds: [],
      ...(kind === "alpha-reader" || kind === "beta-reader"
        ? { readerScope: { kind: "through", nodeId: "n" } }
        : {}),
    },
    turns: [],
  };
  return JSON.stringify({
    ...record,
    turns: [
      {
        id: "q",
        runId: "r",
        role: "user",
        text: "/verify The tower was finished in 1887.",
        outcome: "complete",
        createdAt: record.createdAt,
      },
      {
        id: "a",
        runId: "r",
        role: "assistant",
        text: "It was finished in 1889 (web:1).",
        outcome: "complete",
        createdAt: record.createdAt,
        ...answer,
      },
    ],
  });
}

const answerOf = (raw: string): ChatTurn | undefined =>
  parseChat(raw).turns.find((turn) => turn.role === "assistant");

describe("sanitizeVerified", () => {
  it("keeps what a run writes, beside its marker (the base first)", () => {
    const turn = answerOf(chatWith({ verifies: true, verified: BASE }));
    expect(turn?.verifies).toBe(true);
    expect(turn?.verified).toEqual(BASE);
    for (const unjudged of ["unchecked", "nothing-found"])
      expect(
        answerOf(chatWith({ verifies: true, verified: { unjudged } }))
          ?.verified,
      ).toEqual({ unjudged });
  });

  it("drops an outcome with no marker, and a marker that is not true", () => {
    // A `verified` block is read only beside its marker.
    expect(answerOf(chatWith({ verified: BASE }))?.verified).toBeUndefined();
    for (const marker of ["yes", 1, false, null, {}]) {
      const turn = answerOf(chatWith({ verifies: marker, verified: BASE }));
      expect(turn?.verifies).toBeUndefined();
      expect(turn?.verified).toBeUndefined();
      // Never the turn: its text still reads.
      expect(turn?.text).toBe("It was finished in 1889 (web:1).");
    }
  });

  it("keeps the marker only on an answer, where the chat offers /verify and searches the web", () => {
    for (const kind of CHAT_KINDS) {
      const kept = offersWorkflow(kind, "verify") && searchesWeb(kind);
      const turn = answerOf(chatWith({ verifies: true, verified: BASE }, kind));
      expect(turn?.verifies === true).toBe(kept);
      expect(turn?.verified !== undefined).toBe(kept);
    }
    expect(offersWorkflow("alpha-reader", "verify")).toBe(false);
    const asked = parseChat(
      chatWith({}).replace('"role":"user",', '"role":"user","verifies":true,'),
    ).turns[0];
    expect(asked?.verifies).toBeUndefined();
  });

  it("drops the whole block for anything a run could not have written", () => {
    const hostile: unknown[] = [
      // Mixed shapes and unknown keys.
      { ...BASE, unjudged: "unchecked" },
      { unjudged: "unchecked", sources: [] },
      { unjudged: "maybe" },
      { ...BASE, note: "x" },
      // Enums.
      { ...BASE, verdict: "true" },
      { ...BASE, verdict: "unchecked" },
      { ...BASE, sources: [{ id: "web:1", stance: "agrees" }] },
      // Ids: shaped, unique, at most five.
      { ...BASE, sources: [{ id: "1", stance: "context" }] },
      { ...BASE, sources: [{ id: "node:S1", stance: "context" }] },
      {
        ...BASE,
        sources: [
          { id: "web:1", stance: "context" },
          { id: "web:1", stance: "supports" },
        ],
      },
      {
        ...BASE,
        sources: [1, 2, 3, 4, 5, 6].map((n) => ({
          id: `web:${n}`,
          stance: "context",
        })),
      },
      // Quotes, at the amended floor and the ceiling, one plain line.
      {
        ...BASE,
        sources: [{ id: "web:1", stance: "context", quote: "two words" }],
      },
      {
        ...BASE,
        sources: [
          {
            id: "web:1",
            stance: "context",
            quote: "a b " + "c".repeat(WEB_QUOTE_MAX),
          },
        ],
      },
      {
        ...BASE,
        sources: [{ id: "web:1", stance: "context", quote: "one\ntwo three" }],
      },
      { ...BASE, sources: [{ id: "web:1", stance: "context", quote: 3 }] },
      // Fix: bounded, and only where the claim is doubtful or implausible.
      { ...BASE, fix: "f".repeat(VERIFY_FIX_MAX + 1) },
      { ...BASE, fix: "" },
      { ...BASE, verdict: "plausible" },
      { ...BASE, verdict: "inconclusive" },
      "implausible",
      [BASE],
    ];
    for (const verified of hostile)
      expect(
        answerOf(chatWith({ verifies: true, verified }))?.verified,
      ).toBeUndefined();
  });

  it("loads a sourced verdict with no sources as inconclusive, with no fix (7.7)", () => {
    expect(
      answerOf(chatWith({ verifies: true, verified: { ...BASE, sources: [] } }))
        ?.verified,
    ).toEqual({ verdict: "inconclusive", sources: [] });
  });

  it("keeps a planted quote as data", () => {
    const quote = '<img src=x onerror="alert(1)"> javascript:alert(1) here';
    const verified = {
      ...BASE,
      sources: [{ id: "web:1", stance: "contradicts", quote }],
    };
    expect(answerOf(chatWith({ verifies: true, verified }))?.verified).toEqual(
      verified,
    );
  });

  it("reads back what the settle writes, whatever the judge said (6.22)", () => {
    // The producer feeds the round trip: every edge the settle handles.
    const shown = new Map<string, ShownResult>(
      [1, 2, 3].map((n) => [
        `web:${n}`,
        {
          id: `web:${n}`,
          site: "example.org",
          title: `r${n}`,
          excerpt: `Result ${n} says the tower was built from 1887 to 1889.`,
        },
      ]),
    );
    const answers: JudgedAnswer[] = [];
    for (const verdict of [
      "plausible",
      "doubtful",
      "implausible",
      "inconclusive",
    ] as const)
      for (const quote of ["", "from 1887 to 1889", "1887", "not there at all"])
        for (const fix of [
          "",
          "A fix (web:2).",
          "f".repeat(VERIFY_FIX_MAX + 5),
        ])
          answers.push({
            verdict,
            sources: [
              { id: "web:1", stance: "supports", quote },
              { id: "2", stance: "context", quote },
              { id: "web:9", stance: "context", quote },
            ],
            reasoning: "Why.",
            fix,
          });
    for (const answer of answers) {
      const { verified } = settleClaimVerdict(answer, shown, {
        claim: "The tower was finished in 1887.",
      });
      expect(
        answerOf(chatWith({ verifies: true, verified }))?.verified,
      ).toEqual(verified);
    }
  });
});

describe("the repeated count", () => {
  const record = (over: Record<string, unknown>) => ({
    callId: "c1",
    engine: { kind: "wikipedia" },
    status: "searched",
    query: "Eiffel Tower",
    results: [
      {
        id: "web:1",
        url: "https://en.wikipedia.org/wiki/Eiffel_Tower",
        title: "Eiffel Tower",
      },
    ],
    ...over,
  });
  const repeatedOf = (answer: Record<string, unknown>) => {
    const web = answerOf(chatWith(answer))?.web;
    const first = web?.[0];
    return first?.status === "searched" ? first.repeated : "no-record";
  };

  it("keeps a count a run could write, on a /verify answer's searched record", () => {
    expect(repeatedOf({ verifies: true, web: [record({ repeated: 4 })] })).toBe(
      4,
    );
  });

  it("drops the count and keeps the record otherwise", () => {
    for (const repeated of [0, -1, 1.5, "2", 5])
      expect(
        repeatedOf({ verifies: true, web: [record({ repeated })] }),
      ).toBeUndefined();
    // Not a /verify answer: chat never writes one.
    expect(repeatedOf({ web: [record({ repeated: 1 })] })).toBeUndefined();
  });

  // A bad field drops the field, never the record. On a declined or failed
  // record the count must go alone: dropping the whole `web` block would also
  // drop the searched record beside it, and with it the trace's word that a
  // query left.
  it("drops a count on a record that is not searched, never the records", () => {
    const declined = {
      callId: "c2",
      engine: { kind: "wikipedia" },
      status: "declined",
    };
    const failed = {
      callId: "c3",
      engine: { kind: "wikipedia" },
      status: "failed",
      query: "Tour Eiffel",
      code: "connection",
      reached: "unknown",
    };
    // Premise: both records as a run writes them are kept.
    expect(
      answerOf(
        chatWith({ verifies: true, web: [record({}), declined, failed] }),
      )?.web,
    ).toHaveLength(3);
    const web = answerOf(
      chatWith({
        verifies: true,
        web: [
          record({}),
          { ...declined, repeated: 1 },
          { ...failed, repeated: 1 },
        ],
      }),
    )?.web;
    expect(web?.map((one) => one.status)).toEqual([
      "searched",
      "declined",
      "failed",
    ]);
    expect(web?.some((one) => "repeated" in one)).toBe(false);
  });
});
