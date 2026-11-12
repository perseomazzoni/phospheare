// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import type {
  ModelEvent,
  ModelRequest,
  SearchAsk,
  WebEngine,
  WebSearchOutcome,
} from "../domain/types";
import type { WebSearch, WebSearchEngine } from "../ports";
import { QUESTION_ARGUMENT_MAX } from "../domain/types";
import {
  ProgrammableModel,
  last,
  must,
  newChat,
  setup,
} from "./assistant.fixture";

// ── The /verify command ──────────────────────────────────────────────────────
//
// `/verify` proposes a search from the writer's own claim, and sends it only
// with the writer's approval.

describe("runVerify", () => {
  class Engine implements WebSearchEngine {
    sent: string[] = [];
    constructor(readonly engine: WebEngine) {}
    async search(query: string): Promise<WebSearchOutcome> {
      this.sent.push(query);
      return {
        status: "searched",
        results: [0, 1].map((n) => ({
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}_${n}`,
          title: `${query} ${n}`,
          excerpt: `The tower was built from 1887 to 1889 (${n}).`,
        })),
      };
    }
  }

  const says = (value: unknown): ModelEvent[] => [
    { type: "text-delta", text: JSON.stringify(value) },
    { type: "completed", reason: "answer" },
  ];

  /**
   * A model that proposes one query, then judges: `implausible`, citing the
   * first id it was offered with a quote its excerpt holds. `judge` replaces
   * the judging step.
   */
  function checker(
    judge?: (request: ModelRequest) => AsyncIterable<ModelEvent>,
  ): ProgrammableModel {
    const model = new ProgrammableModel(async function* (request, signal) {
      if (request.output?.name === "propose_queries") {
        yield* says({ queries: ["Eiffel Tower completion"] });
        return;
      }
      // A plain chat question, asked in the same chat.
      if (request.output === undefined) {
        yield { type: "text-delta", text: "A careful answer." };
        yield { type: "completed", reason: "answer" };
        return;
      }
      if (judge) {
        yield* judge(request);
        return;
      }
      const schema = request.output?.schema as {
        properties: {
          sources: { items: { properties: { id: { enum: string[] } } } };
        };
      };
      const id = schema.properties.sources.items.properties.id.enum[0];
      void signal;
      yield* says({
        verdict: "implausible",
        sources: [
          { id, stance: "contradicts", quote: "built from 1887 to 1889" },
        ],
        reasoning: `It was finished in 1889 (${id}).`,
        fix: "The tower was finished in 1889.",
      });
    });
    model.descriptor = {
      ...model.descriptor,
      capabilities: {
        tools: true,
        structuredOutput: true,
        reasoning: true,
        efforts: ["none", "low", "medium"],
      },
    };
    return model;
  }

  function verifying(
    model = checker(),
    account: () => string | null = () => "40",
  ) {
    const wikipedia = new Engine({ kind: "wikipedia" });
    const webSearch: WebSearch = {
      wikipedia,
      provider: () => null,
      accountId: account,
    };
    const harness = setup({ model, webSearch });
    const asked = async (): Promise<SearchAsk> => {
      await vi.waitFor(() =>
        expect(harness.assistant.getSnapshot().pendingSearch).toBeTruthy(),
      );
      return must(harness.assistant.getSnapshot().pendingSearch);
    };
    const sendAll = (ask: SearchAsk) =>
      harness.assistant.answerSearches(ask.askId, {
        kind: "send",
        rows: ask.rows.map(({ rowId, query }) => ({ rowId, query })),
      });
    return { ...harness, model, wikipedia, asked, sendAll };
  }

  const CLAIM = "The Eiffel Tower was finished in 1887.";

  it("checks a claim: asks, searches what was approved, judges, and stores the settled answer", async () => {
    const { assistant, artifacts, model, wikipedia, asked, sendAll } =
      verifying();
    const chat = await newChat(assistant, "general");
    const running = assistant.verify.run(CLAIM);
    const ask = await asked();
    expect(ask.rows.map((row) => row.query)).toEqual([
      "Eiffel Tower completion",
    ]);
    expect(wikipedia.sent).toEqual([]);
    sendAll(ask);
    expect(await running).toBe("started");
    const turns = must(artifacts.chats.get(chat.id)).turns;
    expect(turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
    expect(turns[0]?.text).toBe(`/verify ${CLAIM}`);
    const answer = must(turns[1]);
    expect(answer).toMatchObject({
      verifies: true,
      outcome: "complete",
      text: "It was finished in 1889 (web:1).",
      verified: {
        verdict: "implausible",
        sources: [
          {
            id: "web:1",
            stance: "contradicts",
            quote: "built from 1887 to 1889",
          },
        ],
        fix: "The tower was finished in 1889.",
      },
    });
    expect(answer.errorCode).toBeUndefined();
    expect(answer.web?.[0]).toMatchObject({
      status: "searched",
      query: "Eiffel Tower completion",
    });
    expect(model.requests.map((request) => request.output?.name)).toEqual([
      "propose_queries",
      "submit_verdict",
    ]);
    // The pause went with the run.
    expect(assistant.answerSearches(ask.askId, { kind: "decline" })).toBe(
      false,
    );
    expect(assistant.getSnapshot().running).toBe(false);
  });

  it("refuses before anything is written, asked or sent", async () => {
    const cases: Array<{
      name: string;
      arrange: (bench: ReturnType<typeof verifying>) => Promise<unknown>;
      claim?: string;
      quote?: string;
      problem?: unknown;
    }> = [
      {
        name: "a reader chat",
        arrange: async ({ assistant }) => {
          await newChat(assistant, "alpha-reader");
          await assistant.chats.updatePreferences({
            readerScope: { kind: "whole" },
          });
        },
      },
      {
        name: "nothing to check",
        arrange: ({ assistant }) => newChat(assistant, "general"),
        claim: "   ",
      },
      {
        name: "a claim over its bound",
        arrange: ({ assistant }) => newChat(assistant, "general"),
        claim: "c".repeat(QUESTION_ARGUMENT_MAX + 1),
        problem: { kind: "verify-too-long", max: QUESTION_ARGUMENT_MAX },
      },
      {
        name: "a model that cannot read tool results (O1)",
        arrange: async (bench) => {
          bench.model.descriptor = {
            ...bench.model.descriptor,
            capabilities: { tools: false, structuredOutput: true },
          };
          await newChat(bench.assistant, "general");
        },
        problem: { kind: "verify-needs-tools", model: "Llama test" },
      },
      {
        name: "no model chosen",
        arrange: ({ assistant }) => assistant.chats.create("general"),
      },
    ];
    for (const one of cases) {
      const bench = verifying();
      await one.arrange(bench);
      const saved = bench.artifacts.saved;
      const chat = must(bench.assistant.activeChat());
      expect(
        await bench.assistant.verify.run(one.claim ?? CLAIM, one.quote),
        one.name,
      ).toBe("rejected");
      expect(bench.artifacts.saved, one.name).toBe(saved);
      expect(must(bench.assistant.activeChat()).turns, one.name).toEqual(
        chat.turns,
      );
      expect(bench.model.requests, one.name).toEqual([]);
      expect(bench.wikipedia.sent, one.name).toEqual([]);
      if (one.problem)
        expect(bench.assistant.getSnapshot().problem, one.name).toEqual(
          one.problem,
        );
    }
  });

  it("refuses with no account, and while a run is live", async () => {
    const signedOut = verifying(checker(), () => null);
    await newChat(signedOut.assistant, "general");
    expect(await signedOut.assistant.verify.run(CLAIM)).toBe("rejected");
    expect(signedOut.model.requests).toEqual([]);

    const { assistant, asked, sendAll } = verifying();
    await newChat(assistant, "general");
    const running = assistant.verify.run(CLAIM);
    const ask = await asked();
    expect(await assistant.verify.run(CLAIM)).toBe("rejected");
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "run-in-progress",
    });
    sendAll(ask);
    await running;
  });

  it("writes the pair ahead, marked, before a search is asked", async () => {
    const { assistant, artifacts, asked, sendAll } = verifying();
    const chat = await newChat(assistant, "general");
    const running = assistant.verify.run(CLAIM, "The tower rose in 1887.");
    const ask = await asked();
    const written = must(artifacts.chats.get(chat.id)).turns;
    expect(written[0]).toMatchObject({
      role: "user",
      text: `/verify ${CLAIM}`,
      quote: "The tower rose in 1887.",
    });
    expect(written[1]).toMatchObject({
      role: "assistant",
      verifies: true,
      outcome: "interrupted",
    });
    expect(written[1]?.verified).toBeUndefined();
    sendAll(ask);
    await running;
  });

  it("keeps what left and no verdict when Stop ends the ask", async () => {
    const { assistant, artifacts, asked } = verifying();
    const chat = await newChat(assistant, "general");
    const running = assistant.verify.run(CLAIM);
    await asked();
    assistant.stop();
    await running;
    const answer = must(last(must(artifacts.chats.get(chat.id)).turns));
    expect(answer).toMatchObject({
      verifies: true,
      outcome: "interrupted",
      errorCode: "cancelled",
    });
    expect(answer.verified).toBeUndefined();
    expect(answer.web?.map((record) => record.status)).toEqual(["declined"]);
    expect(assistant.getSnapshot().pendingSearch).toBeNull();
  });

  it("fails as invalid-response on a judge out of shape, keeps its searches, and retries nothing", async () => {
    const { assistant, artifacts, model, asked, sendAll } = verifying(
      checker(async function* () {
        yield* says({ verdict: "true" });
      }),
    );
    const chat = await newChat(assistant, "general");
    const running = assistant.verify.run(CLAIM);
    sendAll(await asked());
    await running;
    const answer = must(last(must(artifacts.chats.get(chat.id)).turns));
    expect(answer).toMatchObject({
      verifies: true,
      outcome: "failed",
      errorCode: "invalid-response",
    });
    expect(answer.verified).toBeUndefined();
    expect(answer.web).toHaveLength(1);
    expect(model.requests).toHaveLength(2);
  });

  it("keeps none of the judge's thinking", async () => {
    const { assistant, artifacts, asked, sendAll } = verifying(
      checker(async function* (request) {
        yield { type: "reasoning-delta", text: "THINKING-SENTINEL" };
        const schema = request.output?.schema as {
          properties: {
            sources: { items: { properties: { id: { enum: string[] } } } };
          };
        };
        yield* says({
          verdict: "inconclusive",
          sources: [
            {
              id: schema.properties.sources.items.properties.id.enum[0],
              stance: "context",
              quote: "",
            },
          ],
          reasoning: "Nothing settles it.",
          fix: "",
        });
      }),
    );
    const chat = await newChat(assistant, "general");
    const running = assistant.verify.run(CLAIM);
    sendAll(await asked());
    await running;
    const saved = JSON.stringify(artifacts.chats.get(chat.id));
    expect(saved).not.toContain("THINKING-SENTINEL");
    expect(
      last(must(artifacts.chats.get(chat.id)).turns)?.trace,
    ).toBeUndefined();
  });

  it("asks a failed /verify again as a /verify, in the old pair's place", async () => {
    let judged = 0;
    const { assistant, artifacts, model, asked, sendAll } = verifying(
      checker(async function* (request) {
        judged += 1;
        if (judged === 1) {
          yield* says({ verdict: "true" });
          return;
        }
        const schema = request.output?.schema as {
          properties: {
            sources: { items: { properties: { id: { enum: string[] } } } };
          };
        };
        yield* says({
          verdict: "inconclusive",
          sources: [
            {
              id: schema.properties.sources.items.properties.id.enum[0],
              stance: "context",
              quote: "",
            },
          ],
          reasoning: "Nothing settles it.",
          fix: "",
        });
      }),
    );
    const chat = await newChat(assistant, "general");
    await assistant.send("An earlier question.");
    const first = assistant.verify.run("", "The tower rose in 1887.");
    sendAll(await asked());
    await first;
    const before = must(artifacts.chats.get(chat.id)).turns;
    const failed = must(last(before));
    expect(failed.outcome).toBe("failed");
    const requestsBefore = model.requests.length;

    const again = assistant.edits.retry(failed.id);
    sendAll(await asked());
    expect(await again).toBe("started");
    // A propose, never a chat send of the words "/verify".
    expect(model.requests[requestsBefore]?.output?.name).toBe(
      "propose_queries",
    );
    expect(
      model.requests[requestsBefore]?.messages.map((one) => one.content),
    ).toEqual([`QUOTE: ${JSON.stringify("The tower rose in 1887.")}`]);
    const after = must(artifacts.chats.get(chat.id)).turns;
    // The same place, the earlier conversation untouched, one pair.
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(after).toHaveLength(4);
    expect(after[2]).toMatchObject({
      role: "user",
      text: "/verify",
      quote: "The tower rose in 1887.",
    });
    expect(after[3]).toMatchObject({
      verifies: true,
      outcome: "complete",
      verified: { verdict: "inconclusive" },
    });
    expect(after.filter((turn) => turn.runId === failed.runId)).toEqual([]);
  });

  it("leaves the old pair as it was when the retry is refused", async () => {
    const { assistant, artifacts, model, asked, sendAll } = verifying(
      checker(async function* () {
        yield* says({ verdict: "true" });
      }),
    );
    const chat = await newChat(assistant, "general");
    const running = assistant.verify.run(CLAIM);
    sendAll(await asked());
    await running;
    const before = structuredClone(must(artifacts.chats.get(chat.id)));
    const failed = must(last(before.turns));
    model.descriptor = {
      ...model.descriptor,
      capabilities: { tools: false, structuredOutput: true },
    };
    expect(await assistant.edits.retry(failed.id)).toBe("rejected");
    expect(artifacts.chats.get(chat.id)).toEqual(before);
  });

  it("never edits a /verify that did not settle into a question", async () => {
    const { assistant, artifacts, asked } = verifying();
    const chat = await newChat(assistant, "general");
    const running = assistant.verify.run(CLAIM);
    await asked();
    assistant.stop();
    await running;
    const question = must(must(artifacts.chats.get(chat.id)).turns[0]);
    expect(await assistant.edits.edit(question.id, "Something else?")).toBe(
      "rejected",
    );
    expect(must(artifacts.chats.get(chat.id)).turns).toHaveLength(2);
  });

  // The panel gives the words back on "rejected", so a refusal that
  // publishes nothing looks to the writer like Enter did nothing at all.
  // Every `/verify` refusal names itself, with a problem or an error code.
  // The row asserts only that something is said, leaving the copy and the
  // problem's name open.
  it("says why a /verify with no account to search under was refused", async () => {
    const signedOut = verifying(checker(), () => null);
    await newChat(signedOut.assistant, "general");
    const unwired = setup({ model: checker() });
    await newChat(unwired.assistant, "general");
    for (const { assistant } of [signedOut, unwired]) {
      // Premise: nothing is being said before the refusal.
      const before = assistant.getSnapshot();
      expect(before.problem ?? before.errorCode ?? before.error).toBeFalsy();
      expect(await assistant.verify.run(CLAIM)).toBe("rejected");
      const after = assistant.getSnapshot();
      expect(after.problem ?? after.errorCode ?? after.error).toBeTruthy();
    }
  });
});
