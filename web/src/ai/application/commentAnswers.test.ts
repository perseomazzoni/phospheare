// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import type { WebSearchOutcome } from "../domain/types";
import type { CommentProposal } from "../domain/comments";
import type { Comments, WebSearchEngine } from "../ports";
import type { MarginAsk } from "./assistant";
import {
  ProgrammableModel,
  last,
  must,
  newChat,
  setup,
} from "./assistant.fixture";

describe("a persona answering in the margin", () => {
  function margin(passage: string | null = "the old gate") {
    const replies: [string, string, string, string][] = [];
    const comments: Comments = {
      cap: 8,
      threadsOf: async (nodeIds) =>
        nodeIds.map((nodeId) => ({
          nodeId,
          threads: [
            {
              id: "t1",
              state: "open" as const,
              passage,
              entries: [
                { by: { kind: "writer" as const }, body: "Is this too quiet?" },
              ],
            },
            {
              id: "t2",
              state: "open" as const,
              passage: "A lantern",
              entries: [
                {
                  by: { kind: "editor" as const, name: "M. Rossi" },
                  body: "Strong opening.",
                },
              ],
            },
          ],
        })),
      reply: async (nodeId, threadId, personaId, body) => {
        replies.push([nodeId, threadId, personaId, body]);
      },
      propose: async () => [],
    };
    return { comments, replies };
  }

  it("writes the answer into the thread, from the chapter, the thread and the rest of the margin", async () => {
    const { comments, replies } = margin();
    const { assistant, model } = setup({ comments });
    await newChat(assistant, "general");
    expect(
      await assistant.margin.answer({
        nodeId: "first",
        threadId: "t1",
        personaId: "30",
      }),
    ).toEqual({ ok: true });
    expect(replies).toEqual([["first", "t1", "30", "A careful answer."]]);
    const request = must(last(model.requests));
    // A chat's read-only tools and the margin's own, never a chat's skills.
    const offered = request.tools.map((tool) => tool.name);
    expect(offered).toContain("read_source");
    expect(offered).toContain("leave_comments");
    expect(offered).not.toContain("use_skill");
    expect(request.instructions).toContain("margin comment, not a letter");
    const shown = must(request.messages[0]).content;
    expect(shown).toContain("A lantern goes dark beside the old gate.");
    expect(shown).toContain('"text":"Is this too quiet?"');
    // The other thread, as data, with the editor named as one.
    expect(shown).toContain('"by":"editor M. Rossi"');
  });

  it("lets a reader persona read only as far as the passage, and no margin", async () => {
    const { comments } = margin("A lantern goes");
    const { assistant, model } = setup({ comments });
    await newChat(assistant, "general");
    await assistant.margin.answer({
      nodeId: "first",
      threadId: "t1",
      personaId: "40",
    });
    const request = must(last(model.requests));
    const shown = must(request.messages[0]).content;
    expect(shown).toContain("A lantern goes");
    expect(shown).not.toContain("dark beside the old gate");
    expect(shown).not.toContain("M. Rossi");
    expect(request.instructions).toContain("only as far as the passage");
  });

  it("refuses rather than guesses: no model chosen yet, a chapter out of reach, a reader's lost passage", async () => {
    const { comments, replies } = margin("words that are not there");
    const { assistant } = setup({ comments });
    const ask = (nodeId: string, personaId: string) =>
      assistant.margin.answer({ nodeId, threadId: "t1", personaId });
    // No chat has chosen a model: nothing to answer with.
    expect(await ask("first", "30")).toEqual({
      ok: false,
      reason: "no-model",
    });
    await newChat(assistant, "general");
    expect(await ask("not-in-the-book", "30")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await ask("first", "40")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await ask("first", "nobody")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    // A thread removed from the margin while the reply waited.
    expect(
      await assistant.margin.answer({
        nodeId: "first",
        threadId: "gone",
        personaId: "30",
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(replies).toEqual([]);
  });

  it("writes nothing when the answer does not come", async () => {
    const { comments, replies } = margin();
    const { assistant, model } = setup({ comments });
    await newChat(assistant, "general");
    model.generator = async function* () {
      yield { type: "text-delta", text: "Half a tho" };
      yield { type: "completed", reason: "limit" };
    };
    expect(
      await assistant.margin.answer({
        nodeId: "first",
        threadId: "t1",
        personaId: "30",
      }),
    ).toEqual({ ok: false, reason: "failed" });
    expect(replies).toEqual([]);
  });
});

// ── A margin reply that searches ─────────────────────────────────────────────
//
// A persona's margin reply asks in the thread's card rather than in the dock,
// and keeps its searches on its entry in the comments file.

describe("web search in a margin reply", () => {
  const wikipedia: WebSearchEngine & { sent: string[] } = {
    engine: { kind: "wikipedia" },
    sent: [],
    async search(query: string): Promise<WebSearchOutcome> {
      this.sent.push(query);
      return {
        status: "searched",
        results: [
          {
            url: "https://en.wikipedia.org/wiki/Lighthouse",
            title: "Lighthouse",
            excerpt: "MARGIN-EXCERPT-SENTINEL",
          },
        ],
      };
    },
  };

  function margin(
    account: string | null = "40",
    passage: string | null = "A lantern goes",
  ) {
    const replies: unknown[][] = [];
    const comments: Comments = {
      cap: 8,
      threadsOf: async (nodeIds) =>
        nodeIds.map((nodeId) => ({
          nodeId,
          threads: [
            {
              id: "t1",
              state: "open" as const,
              passage,
              entries: [
                { by: { kind: "writer" as const }, body: "Is this right?" },
              ],
            },
          ],
        })),
      reply: async (...args) => {
        replies.push(args);
      },
      propose: async () => [],
    };
    const model = new ProgrammableModel(async function* (_r, _s, call) {
      if (call === 1) {
        yield {
          type: "tool-call-ready",
          call: {
            id: "w1",
            name: "web_search",
            arguments: { query: "lighthouse lantern" },
          },
        };
        yield { type: "completed", reason: "tools" };
      } else {
        yield { type: "text-delta", text: "Lanterns did go dark." };
        yield { type: "completed", reason: "answer" };
      }
    });
    wikipedia.sent = [];
    const harness = setup({
      model,
      comments,
      webSearch: {
        wikipedia,
        provider: () => null,
        accountId: () => account,
      },
    });
    return { ...harness, model, replies };
  }

  it("asks in the thread, sends what the writer approves, and keeps the pages on the reply", async () => {
    const { assistant, model, replies } = margin();
    await newChat(assistant, "general");
    const asks: (MarginAsk | null)[] = [];
    const running = assistant.margin.answer(
      { nodeId: "first", threadId: "t1", personaId: "30" },
      undefined,
      (ask) => asks.push(ask),
    );
    await vi.waitFor(() => expect(asks[0]).toBeTruthy());
    const ask = must(asks[0]);
    expect(ask.ask.rows.map((row) => row.query)).toEqual([
      "lighthouse lantern",
    ]);
    // The writer's own words never leave in a query.
    expect(ask.holdsBookWords("A lantern goes dark beside the old gate")).toBe(
      true,
    );
    expect(wikipedia.sent).toEqual([]);
    expect(
      ask.answer({
        kind: "send",
        rows: ask.ask.rows.map(({ rowId, query }) => ({ rowId, query })),
      }),
    ).toBe(true);
    expect(await running).toEqual({ ok: true });
    expect(wikipedia.sent).toEqual(["lighthouse lantern"]);
    expect(asks[asks.length - 1]).toBeNull();
    expect(replies).toEqual([
      [
        "first",
        "t1",
        "30",
        "Lanterns did go dark.",
        [
          {
            engine: "wikipedia",
            query: "lighthouse lantern",
            links: [
              {
                url: "https://en.wikipedia.org/wiki/Lighthouse",
                title: "Lighthouse",
              },
            ],
          },
        ],
      ],
    ]);
    expect(JSON.stringify(replies)).not.toContain("MARGIN-EXCERPT-SENTINEL");
    expect(model.requests[0].tools.map((tool) => tool.name)).toContain(
      "web_search",
    );
  });

  it("offers no search to a reader persona, nor where nobody can be asked", async () => {
    const { assistant, model } = margin();
    await newChat(assistant, "general");
    await assistant.margin.answer(
      { nodeId: "first", threadId: "t1", personaId: "40" },
      undefined,
      () => undefined,
    );
    await assistant.margin.answer({
      nodeId: "first",
      threadId: "t1",
      personaId: "30",
    });
    for (const request of model.requests)
      expect(request.tools.map((tool) => tool.name)).not.toContain(
        "web_search",
      );
    expect(wikipedia.sent).toEqual([]);
  });

  it("keeps nothing of a search the writer declined", async () => {
    const { assistant, replies } = margin("40", null);
    await newChat(assistant, "general");
    const running = assistant.margin.answer(
      { nodeId: "first", threadId: "t1", personaId: "30" },
      undefined,
      // Answered as a writer does: after the ask is on screen.
      (ask) => void setTimeout(() => ask?.answer({ kind: "decline" }), 0),
    );
    expect(await running).toEqual({ ok: true });
    expect(wikipedia.sent).toEqual([]);
    expect(replies).toEqual([
      ["first", "t1", "30", "Lanterns did go dark.", []],
    ]);
  });

  it("offers no search with no account to search under", async () => {
    const { assistant, model } = margin(null);
    await newChat(assistant, "general");
    const asks: unknown[] = [];
    await assistant.margin.answer(
      { nodeId: "first", threadId: "t1", personaId: "30" },
      undefined,
      (ask) => asks.push(ask),
    );
    expect(asks).toEqual([]);
    expect(model.requests[0].tools.map((tool) => tool.name)).not.toContain(
      "web_search",
    );
  });
});

describe("a persona leaving notes in the margin", () => {
  it("offers the tool, leaves the notes, and the answer says where they went", async () => {
    const asked: [string, string, CommentProposal[]][] = [];
    const comments: Comments = {
      cap: 8,
      threadsOf: async () => [],
      reply: async () => undefined,
      propose: async (nodeId, personaId, proposals) => {
        asked.push([nodeId, personaId, [...proposals]]);
        return proposals.map(() => "placed" as const);
      },
    };
    const model = new ProgrammableModel(async function* (
      _request,
      _signal,
      call,
    ) {
      if (call === 1) {
        yield {
          type: "tool-call-ready",
          call: {
            id: "note",
            name: "leave_comments",
            arguments: {
              comments: [
                {
                  sourceId: "node:first",
                  quote: "the old gate",
                  body: "Which gate?",
                  weight: "minor",
                },
              ],
            },
          },
        };
        yield { type: "completed", reason: "tools" };
      } else {
        yield { type: "text-delta", text: "I left a note by the gate." };
        yield { type: "completed", reason: "answer" };
      }
    });
    const { assistant, artifacts } = setup({ model, comments });
    const chat = await newChat(assistant, "general");
    await assistant.send("Anything to tighten?");
    const first = must(model.requests[0]);
    expect(first.tools.some((tool) => tool.name === "leave_comments")).toBe(
      true,
    );
    expect(asked).toEqual([
      [
        "first",
        must(must(artifacts.chats.get(chat.id)).turns[1].personaId),
        [
          {
            quote: { text: "the old gate" },
            body: "Which gate?",
            weight: "minor",
          },
        ],
      ],
    ]);
    expect(must(artifacts.chats.get(chat.id)).turns[1].commented).toEqual([
      { nodeId: "first", count: 1 },
    ]);
  });
});
