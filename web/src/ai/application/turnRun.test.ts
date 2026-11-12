// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import type {
  ModelRequest,
  SearchAsk,
  ToolCall,
  WebEngine,
  WebSearchOutcome,
} from "../domain/types";
import type { ModelProvider, WebSearch, WebSearchEngine } from "../ports";
import {
  askWaiting,
  type AssistantDependencies,
  type AssistantSnapshot,
} from "./assistant";
import { questionOf, skillFor } from "../domain/skills";
import { QUESTION_ARGUMENT_MAX } from "../domain/types";
import {
  mayCall,
  ProgrammableModel,
  last,
  must,
  newChat,
  setup,
} from "./assistant.fixture";

describe("/how-to-say, a question that takes words", () => {
  const asked = (argument?: string) =>
    questionOf(must(skillFor("how-to-say")), argument);

  it("sends the description last in the writer's message, never in the instructions", async () => {
    const { assistant, model } = setup();
    await newChat(assistant, "general");
    const { text, command } = asked('a tired "sigh"');
    expect(await assistant.send(text, undefined, command)).toBe("started");

    const request = must(model.requests[0]);
    const said = String(must(last(request.messages)).content);
    // Data after the fixed instruction, quoted.
    expect(said.endsWith('MEANING: "a tired \\"sigh\\""')).toBe(true);
    expect(request.instructions).not.toContain("tired");
    expect(request.instructions).not.toContain("MEANING");
  });

  it("reads exactly what a plain question reads (security 3)", async () => {
    // Same instructions, same tools: nothing is attached for voice, so no
    // transit notice is owed.
    const plain = setup();
    await newChat(plain.assistant, "general");
    await plain.assistant.send("How do I say it?");
    const command = setup();
    await newChat(command.assistant, "general");
    const { text, command: typed } = asked("a tired sigh");
    await command.assistant.send(text, undefined, typed);

    const [one, two] = [
      must(plain.model.requests[0]),
      must(command.model.requests[0]),
    ];
    expect(two.instructions).toBe(one.instructions);
    // The same tools, less `use_skill`: a command turn already runs
    // its skill, so it is offered no other. A command may reach less than a
    // question, never more.
    expect(two.tools.map((tool) => tool.name)).toEqual(
      one.tools.map((tool) => tool.name).filter((name) => name !== "use_skill"),
    );
    expect(one.tools.map((tool) => tool.name)).toContain("use_skill");
  });

  it("answers as a plain turn, with nothing a workflow stores", async () => {
    const { assistant } = setup();
    await newChat(assistant, "general");
    const { text, command } = asked("a tired sigh");
    await assistant.send(text, undefined, command);
    const answer = must(last(assistant.activeChat()?.turns ?? []));
    expect(answer.role).toBe("assistant");
    expect(answer.located).toBeUndefined();
    expect(answer.mapped).toBeUndefined();
    expect(answer.review).toBeUndefined();
  });

  it("refuses a description past the cap before anything is sent", async () => {
    const { assistant, model } = setup();
    await newChat(assistant, "general");
    const { text, command } = asked("x".repeat(QUESTION_ARGUMENT_MAX + 1));
    expect(await assistant.send(text, undefined, command)).toBe("rejected");
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "question-too-long",
      max: QUESTION_ARGUMENT_MAX,
    });
    expect(model.requests).toHaveLength(0);
    expect(assistant.activeChat()?.turns).toHaveLength(0);
    // The cap is inclusive.
    const at = asked("x".repeat(QUESTION_ARGUMENT_MAX));
    expect(await assistant.send(at.text, undefined, at.command)).toBe(
      "started",
    );
  });

  it("refuses an over-long edit without rewinding the chat", async () => {
    const { assistant } = setup();
    const chat = await newChat(assistant, "general");
    await assistant.send("First?");
    const before = assistant.activeChat()?.turns.map((turn) => turn.id);
    const { text, command } = asked("x".repeat(QUESTION_ARGUMENT_MAX + 1));

    expect(await assistant.edits.edit(must(before?.[0]), text, command)).toBe(
      "rejected",
    );
    expect(assistant.getSnapshot().problem?.kind).toBe("question-too-long");
    expect(
      assistant
        .getSnapshot()
        .chats.find((one) => one.id === chat.id)
        ?.turns.map((turn) => turn.id),
    ).toEqual(before);
  });
});

// ── Web search in a chat run ─────────────────────────────────────────────────
//
// A search leaves only with the writer's approval, one search at a time.

describe("web search in a chat run", () => {
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
          excerpt: `WEB-EXCERPT-SENTINEL ${n}`,
        })),
      };
    }
  }

  /** A model that searches on each question's first step, then answers. */
  function searcher(query = "Roman aqueducts", extra: ToolCall[] = []) {
    return new ProgrammableModel(async function* (_request, _signal, call) {
      if (call % 2 === 1) {
        for (const one of extra) yield { type: "tool-call-ready", call: one };
        yield {
          type: "tool-call-ready",
          call: { id: "w1", name: "web_search", arguments: { query } },
        };
        yield { type: "completed", reason: "tools" };
      } else {
        yield { type: "text-delta", text: "Checked, see web:1." };
        yield { type: "completed", reason: "answer" };
      }
    });
  }

  function searching(
    over: Partial<Omit<AssistantDependencies, "model">> & {
      model?: ProgrammableModel;
    } = {},
    account: string | null = "40",
  ) {
    const wikipedia = new Engine({ kind: "wikipedia" });
    const webSearch: WebSearch = {
      wikipedia,
      provider: () => null,
      accountId: () => account,
    };
    const model = over.model ?? searcher();
    const harness = setup({ model, webSearch, ...over });
    /** The ask in front of the writer, once the run has posed it. */
    const asked = async (): Promise<SearchAsk> => {
      await vi.waitFor(() =>
        expect(harness.assistant.getSnapshot().pendingSearch).toBeTruthy(),
      );
      return must(harness.assistant.getSnapshot().pendingSearch);
    };
    // `setup` hands back its own default model; this one is the one used.
    return { ...harness, model, wikipedia, asked };
  }

  const offered = (request: ModelRequest | undefined) =>
    (request?.tools ?? []).map((tool) => tool.name).includes("web_search");

  it("asks the writer, sends what they approve, and gives the model the results", async () => {
    const { assistant, artifacts, model, wikipedia, asked } = searching();
    const chat = await newChat(assistant, "general");
    const running = assistant.send("Did Romans build aqueducts?");
    const ask = await asked();
    expect(assistant.getSnapshot().activity).toEqual({
      kind: "awaiting-writer",
    });
    expect(ask.engine).toEqual({ kind: "wikipedia" });
    expect(ask.rows.map((row) => row.query)).toEqual(["Roman aqueducts"]);
    expect(wikipedia.sent).toEqual([]);
    expect(offered(model.requests[0])).toBe(true);

    expect(
      assistant.answerSearches(ask.askId, {
        kind: "send",
        rows: ask.rows.map(({ rowId, query }) => ({ rowId, query })),
      }),
    ).toBe(true);
    await running;
    expect(wikipedia.sent).toEqual(["Roman aqueducts"]);
    expect(assistant.getSnapshot().pendingSearch).toBeNull();

    const answer = JSON.parse(
      must(
        model.requests[1]?.messages.find((message) => message.role === "tool"),
      ).content,
    ) as { status: string; results: Array<{ id: string }> };
    expect(answer.status).toBe("searched");
    expect(answer.results.map((one) => one.id)).toEqual(["web:1", "web:2"]);

    const turn = last(must(artifacts.chats.get(chat.id)).turns);
    expect(turn?.tools).toEqual([
      { callId: "w1", name: "web_search", status: "ok" },
    ]);
    expect(turn?.web).toEqual([
      {
        callId: "w1",
        engine: { kind: "wikipedia" },
        status: "searched",
        query: "Roman aqueducts",
        results: [
          {
            id: "web:1",
            url: "https://en.wikipedia.org/wiki/Roman%20aqueducts_0",
            title: "Roman aqueducts 0",
          },
          {
            id: "web:2",
            url: "https://en.wikipedia.org/wiki/Roman%20aqueducts_1",
            title: "Roman aqueducts 1",
          },
        ],
      },
    ]);
    expect(JSON.stringify(artifacts.chats.get(chat.id))).not.toContain(
      "WEB-EXCERPT-SENTINEL",
    );
  });

  it("continues a chat's ids across answers, so a citation names one result", async () => {
    const { assistant, artifacts, asked } = searching();
    const chat = await newChat(assistant, "general");
    for (const question of ["First?", "Second?"]) {
      const running = assistant.send(question);
      const ask = await asked();
      assistant.answerSearches(ask.askId, {
        kind: "send",
        rows: ask.rows.map(({ rowId, query }) => ({ rowId, query })),
      });
      await running;
    }
    const ids = must(artifacts.chats.get(chat.id)).turns.flatMap((turn) =>
      (turn.web ?? []).flatMap((record) =>
        record.status === "searched" ? record.results.map((r) => r.id) : [],
      ),
    );
    expect(ids).toEqual(["web:1", "web:2", "web:3", "web:4"]);
  });

  it("reads the step's own sources before it asks about a search", async () => {
    const read: ToolCall = {
      id: "r1",
      name: "read_source",
      arguments: { sourceId: "node:first" },
    };
    const { assistant, sources, asked } = searching({
      model: searcher("lantern goes dark beside the old gate", [read]),
    });
    await newChat(assistant, "general");
    const running = assistant.send("Is this real?");
    const ask = await asked();
    expect(sources.reads).toContain("node:first");
    // The model read "A lantern goes dark beside the old gate." this step.
    expect(ask.rows[0]?.bookWords).toBe(true);
    expect(
      assistant.searchQueryHoldsBookWords(
        ask.askId,
        "A lantern goes dark beside the old gate",
      ),
    ).toBe(true);
    expect(assistant.searchQueryHoldsBookWords(ask.askId, "gate history")).toBe(
      false,
    );
    assistant.stop();
    await running;
    // The pause ends with its run, so no query is checked against it after.
    expect(
      assistant.searchQueryHoldsBookWords(
        ask.askId,
        "A lantern goes dark beside the old gate",
      ),
    ).toBe(false);
  });

  it("ends on Stop while waiting, with nothing sent", async () => {
    const { assistant, artifacts, wikipedia, asked } = searching();
    const chat = await newChat(assistant, "general");
    const running = assistant.send("Check it?");
    const ask = await asked();
    assistant.stop();
    await running;
    expect(wikipedia.sent).toEqual([]);
    expect(assistant.getSnapshot().pendingSearch).toBeNull();
    expect(assistant.answerSearches(ask.askId, { kind: "decline" })).toBe(
      false,
    );
    expect(last(must(artifacts.chats.get(chat.id)).turns)).toMatchObject({
      outcome: "interrupted",
      errorCode: "cancelled",
    });
  });

  it("leaves the writer's wait out of the answer's time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { assistant, artifacts, asked } = searching();
      const chat = await newChat(assistant, "general");
      const running = assistant.send("Check it?");
      const ask = await asked();
      vi.setSystemTime(Date.now() + 10 * 60 * 1_000);
      assistant.answerSearches(ask.askId, { kind: "decline" });
      await running;
      const turn = last(must(artifacts.chats.get(chat.id)).turns);
      expect(turn?.elapsedMs).toBeLessThan(60 * 1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers no search where it must not be, and answers a call there not-available", async () => {
    const cases: Array<{
      name: string;
      run: () => Promise<{ model: ProgrammableModel; engine: Engine }>;
    }> = [
      {
        name: "a reader chat",
        run: async () => {
          const h = searching();
          await newChat(h.assistant, "alpha-reader");
          await h.assistant.chats.updatePreferences({
            readerScope: { kind: "through", nodeId: "future" },
          });
          await h.assistant.send("Is this real?");
          return { model: h.model, engine: h.wikipedia };
        },
      },
      {
        name: "no account",
        run: async () => {
          const h = searching({}, null);
          await newChat(h.assistant, "general");
          await h.assistant.send("Is this real?");
          return { model: h.model, engine: h.wikipedia };
        },
      },
      {
        name: "a command turn",
        run: async () => {
          const h = searching();
          await newChat(h.assistant, "general");
          const asked = questionOf(
            must(skillFor("how-to-say")),
            "when you feel you cannot do something",
          );
          await h.assistant.send(asked.text, undefined, asked.command);
          return { model: h.model, engine: h.wikipedia };
        },
      },
      {
        name: "a focused review",
        run: async () => {
          const h = searching();
          await newChat(h.assistant, "editorial");
          await h.assistant.reviews.run("line", { kind: "current" });
          return { model: h.model, engine: h.wikipedia };
        },
      },
    ];
    for (const one of cases) {
      const { model, engine } = await one.run();
      expect(offered(model.requests[0]), one.name).toBe(false);
      expect(engine.sent, one.name).toEqual([]);
      const reply = model.requests[1]?.messages.find(
        (message) =>
          message.role === "tool" && message.toolName === "web_search",
      );
      expect(JSON.parse(reply?.content ?? "{}"), one.name).toMatchObject({
        error: "not-available",
      });
    }
  });

  it("offers nothing to a model that cannot call tools", async () => {
    const { assistant, model } = searching();
    model.descriptor = {
      ...model.descriptor,
      capabilities: { tools: false, structuredOutput: true },
    };
    await newChat(assistant, "general");
    await assistant.send("Is this real?");
    expect(model.requests[0]?.tools).toEqual([]);
  });

  // ── What the screen reads ──────────────────────────────────────────────────

  it("posts an ask with its words in one publish, and settles both in one", async () => {
    const { assistant, asked } = searching();
    await newChat(assistant, "general");
    const seen: AssistantSnapshot[] = [];
    assistant.subscribe(() => seen.push(assistant.getSnapshot()));
    const running = assistant.send("Check it?");
    const ask = await asked();
    assistant.answerSearches(ask.askId, { kind: "decline" });
    await running;
    // No frame shows an ask without "Waiting for you", or the words without
    // the ask they are about.
    for (const one of seen)
      expect(askWaiting(one)).toBe(one.activity?.kind === "awaiting-writer");
    const posted = seen.findIndex(askWaiting);
    expect(posted).toBeGreaterThanOrEqual(0);
    const settled = seen.findIndex(
      (one, index) => index > posted && !askWaiting(one),
    );
    expect(seen[settled]).toMatchObject({
      running: true,
      pendingSearch: null,
      activity: { kind: "preparing" },
      runWaitedMs: expect.any(Number) as number,
    });
  });

  it("publishes the writer's wait for the live clock, and none outside a run", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { assistant, asked } = searching();
      await newChat(assistant, "general");
      const waits: number[] = [];
      assistant.subscribe(() => {
        const snapshot = assistant.getSnapshot();
        if (snapshot.running) waits.push(snapshot.runWaitedMs ?? -1);
      });
      const running = assistant.send("Check it?");
      const ask = await asked();
      vi.setSystemTime(Date.now() + 10 * 60 * 1_000);
      assistant.answerSearches(ask.askId, { kind: "decline" });
      await running;
      // Nothing waited before the ask settled; the ten minutes after it.
      expect(waits[0]).toBe(0);
      expect(last(waits)).toBeGreaterThanOrEqual(10 * 60 * 1_000);
      expect(assistant.getSnapshot().runWaitedMs).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says a search is out while the approved query is at its engine", async () => {
    const { assistant, wikipedia, asked } = searching();
    const during: unknown[] = [];
    const search = wikipedia.search.bind(wikipedia);
    wikipedia.search = (query) => {
      during.push(assistant.getSnapshot().activity);
      return search(query);
    };
    await newChat(assistant, "general");
    const running = assistant.send("Check it?");
    const ask = await asked();
    assistant.answerSearches(ask.askId, {
      kind: "send",
      rows: ask.rows.map(({ rowId, query }) => ({ rowId, query })),
    });
    await running;
    // The engine by its label only: the screen names where, never which model.
    expect(during).toEqual([{ kind: "searching-web", engine: "wikipedia" }]);
  });

  it("writes the rows a Stop declined onto the stopped turn", async () => {
    const { assistant, artifacts, asked } = searching();
    const chat = await newChat(assistant, "general");
    const running = assistant.send("Check it?");
    await asked();
    assistant.stop();
    await running;
    expect(last(must(artifacts.chats.get(chat.id)).turns)).toMatchObject({
      outcome: "interrupted",
      web: [
        { callId: "w1", engine: { kind: "wikipedia" }, status: "declined" },
      ],
    });
  });

  it("writes the run's searches onto a turn that failed after them", async () => {
    const model = new ProgrammableModel(async function* (_request, _s, call) {
      if (call === 1) {
        yield {
          type: "tool-call-ready",
          call: { id: "w1", name: "web_search", arguments: { query: "Q one" } },
        };
        yield { type: "completed", reason: "tools" };
      } else {
        yield {
          type: "failed",
          error: { code: "timeout", message: "slow", retryable: true },
        };
      }
    });
    const { assistant, artifacts, asked } = searching({ model });
    const chat = await newChat(assistant, "general");
    const running = assistant.send("Check it?");
    const ask = await asked();
    assistant.answerSearches(ask.askId, {
      kind: "send",
      rows: ask.rows.map(({ rowId, query }) => ({ rowId, query })),
    });
    await running;
    const turn = last(must(artifacts.chats.get(chat.id)).turns);
    expect(turn?.outcome).toBe("failed");
    expect(turn?.web).toMatchObject([
      { callId: "w1", status: "searched", query: "Q one" },
    ]);
  });

  // The failed ending writes what the pause pushed without a write of its
  // own: here an unticked row, before a port that threw ended the round.
  it("writes the rows the writer unticked onto a turn a failing port ended", async () => {
    let reads = 0;
    const webSearch: WebSearch = {
      wikipedia: new Engine({ kind: "wikipedia" }),
      provider: () => null,
      accountId: () => {
        reads += 1;
        // The run's start reads it once; the send's check throws.
        if (reads > 1) throw new Error("account store unreadable");
        return "40";
      },
    };
    const model = searcher("row A", [
      { id: "w0", name: "web_search", arguments: { query: "row zero" } },
    ]);
    const harness = setup({ model, webSearch });
    const chat = await newChat(harness.assistant, "general");
    const running = harness.assistant.send("Check it?");
    await vi.waitFor(() =>
      expect(harness.assistant.getSnapshot().pendingSearch).toBeTruthy(),
    );
    const ask = must(harness.assistant.getSnapshot().pendingSearch);
    const kept = must(ask.rows[1]);
    harness.assistant.answerSearches(ask.askId, {
      kind: "send",
      rows: [{ rowId: kept.rowId, query: kept.query }],
    });
    await running;
    expect(
      last(must(harness.artifacts.chats.get(chat.id)).turns),
    ).toMatchObject({
      outcome: "failed",
      web: [{ callId: "w0", status: "declined" }],
    });
  });

  // A run that was offered search and asked about none leaves no `web` on
  // its turn, not an empty one.
  it("leaves no web block on a turn that searched nothing", async () => {
    const model = new ProgrammableModel(async function* () {
      yield { type: "text-delta", text: "No search needed." };
      yield { type: "completed", reason: "answer" };
    });
    const { assistant, artifacts } = searching({ model });
    const chat = await newChat(assistant, "general");
    await assistant.send("Hello?");
    expect(offered(model.requests[0])).toBe(true);
    expect(last(must(artifacts.chats.get(chat.id)).turns)?.web).toBeUndefined();
  });

  it("publishes and writes nothing once disposed while an ask waits", async () => {
    const { assistant, artifacts, asked } = searching();
    const chat = await newChat(assistant, "general");
    const running = assistant.send("Check it?");
    await asked();
    const saved = JSON.stringify(artifacts.chats.get(chat.id));
    let published = 0;
    assistant.subscribe(() => published++);
    assistant.dispose();
    await running;
    expect(published).toBe(0);
    expect(JSON.stringify(artifacts.chats.get(chat.id))).toBe(saved);
  });

  it("brings the writer to the chat whose run waits on them, and nowhere else", async () => {
    const { assistant, asked } = searching();
    const other = await newChat(assistant, "general");
    const waiting = await newChat(assistant, "general");
    // Nothing waits: the Ask button moves nothing.
    assistant.revealPendingSearch();
    expect(assistant.getSnapshot().activeChatId).toBe(waiting.id);

    const running = assistant.send("Check it?");
    const ask = await asked();
    assistant.selectChat(other.id);
    assistant.revealPendingSearch();
    expect(assistant.getSnapshot().activeChatId).toBe(waiting.id);

    assistant.answerSearches(ask.askId, { kind: "decline" });
    await running;
    assistant.selectChat(other.id);
    assistant.revealPendingSearch();
    expect(assistant.getSnapshot().activeChatId).toBe(other.id);
  });

  // A run with nothing in front of the writer, a send in flight, is no
  // reason to move them.
  it("moves nobody while a run sends, with no ask waiting", async () => {
    const { assistant, wikipedia, asked } = searching();
    let release = () => {};
    const search = wikipedia.search.bind(wikipedia);
    const out = new Promise<void>((resolve) => (release = resolve));
    let sending = false;
    wikipedia.search = async (query) => {
      sending = true;
      await out;
      return search(query);
    };
    const other = await newChat(assistant, "general");
    await newChat(assistant, "general");
    const running = assistant.send("Check it?");
    const ask = await asked();
    assistant.answerSearches(ask.askId, {
      kind: "send",
      rows: ask.rows.map(({ rowId, query }) => ({ rowId, query })),
    });
    await vi.waitFor(() => expect(sending).toBe(true));
    assistant.selectChat(other.id);
    assistant.revealPendingSearch();
    expect(assistant.getSnapshot().activeChatId).toBe(other.id);
    release();
    await running;
  });
});

// ── Search guarantees of a run ───────────────────────────────────────────────
//
// What a searching run guarantees beyond the rows above.

describe("web search in a chat run: caps, repeats and the order of answers", () => {
  class Engine implements WebSearchEngine {
    sent: string[] = [];
    constructor(readonly engine: WebEngine) {}
    async search(query: string): Promise<WebSearchOutcome> {
      this.sent.push(query);
      return {
        status: "searched",
        results: [
          {
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}`,
            title: query,
            excerpt: `about ${query}`,
          },
        ],
      };
    }
  }

  const web = (id: string, query: string): ToolCall => ({
    id,
    name: "web_search",
    arguments: { query },
  });
  const listing = (id: string): ToolCall => ({
    id,
    name: "list_sources",
    arguments: {},
  });
  const reading = (id: string, sourceId: string): ToolCall => ({
    id,
    name: "read_source",
    arguments: { sourceId },
  });

  /** A model that makes `steps[n]` on its nth tool request, then answers. */
  function scripted(steps: ToolCall[][]) {
    return new ProgrammableModel(async function* (request, _signal, call) {
      const calls = mayCall(request) ? steps[call - 1] : undefined;
      if (calls && calls.length > 0) {
        for (const one of calls) yield { type: "tool-call-ready", call: one };
        yield { type: "completed", reason: "tools" };
      } else {
        yield { type: "text-delta", text: "Done." };
        yield { type: "completed", reason: "answer" };
      }
    });
  }

  function searching(model: ProgrammableModel, account = () => "40") {
    const wikipedia = new Engine({ kind: "wikipedia" });
    const who = { account };
    const harness = setup({
      model,
      webSearch: {
        wikipedia,
        provider: () => null,
        accountId: () => who.account(),
      },
    });
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
    return { ...harness, model, wikipedia, who, asked, sendAll };
  }

  const toolReplies = (request: ModelRequest | undefined) =>
    (request?.messages ?? []).filter((message) => message.role === "tool");

  it("never asks about a search past the step's slice", async () => {
    const eight = Array.from({ length: 8 }, (_, n) => listing(`l${n}`));
    const h = searching(scripted([[...eight, web("w", "past the slice")]]));
    await newChat(h.assistant, "general");
    // A run that asked would wait on the writer here, and never finish.
    await h.assistant.send("Look around");
    expect(h.wikipedia.sent).toEqual([]);
  });

  it("ends the run when the account changes under an ask", async () => {
    const h = searching(scripted([[web("w", "account change")]]));
    const chat = await newChat(h.assistant, "general");
    const running = h.assistant.send("Check it?");
    const ask = await h.asked();
    h.who.account = () => "41";
    h.sendAll(ask);
    await running;
    expect(h.model.requests).toHaveLength(1);
    expect(h.wikipedia.sent).toEqual([]);
    expect(last(must(h.artifacts.chats.get(chat.id)).turns)).toMatchObject({
      errorCode: "cancelled",
    });
  });

  it("answers the same search in a later step as a repeat, without asking (the loop's seen set)", async () => {
    const h = searching(scripted([[web("w1", "Rome")], [web("w2", "rome ")]]));
    await newChat(h.assistant, "general");
    const running = h.assistant.send("Check it?");
    h.sendAll(await h.asked());
    await running;
    expect(h.wikipedia.sent).toEqual(["Rome"]);
    expect(
      JSON.parse(toolReplies(h.model.requests[2])[1]?.content ?? "{}"),
    ).toEqual({
      error: "repeated-tool-call",
    });
  });

  it("counts searches toward the run's tool cap", async () => {
    // Seven reads and a search a step: 8, 16, 24 — the cap after step three.
    const step = (n: number) => [
      ...Array.from({ length: 7 }, (_, k) => listing(`l${n}-${k}`)),
      web(`w${n}`, `search ${n}`),
    ];
    const h = searching(
      scripted([step(1), step(2), step(3), step(4), step(5)]),
    );
    await newChat(h.assistant, "general");
    const running = h.assistant.send("Look around");
    // No to the first ask is no to the answer's searches: none asks again.
    const ask = await h.asked();
    h.assistant.answerSearches(ask.askId, { kind: "decline" });
    await running;
    // Three steps, then the closing call with its tools withdrawn.
    expect(h.model.requests).toHaveLength(4);
    expect(last(h.model.requests)?.toolChoice).toBe("none");
  });

  it("gives each call its own answer when two share a provider's id (dev-patterns a3)", async () => {
    const h = searching(
      scripted([[web("dup", "first topic"), web("dup", "second topic")]]),
    );
    await newChat(h.assistant, "general");
    const running = h.assistant.send("Check both?");
    h.sendAll(await h.asked());
    await running;
    const replies = toolReplies(h.model.requests[1]).map(
      (message) => (JSON.parse(message.content) as { query?: string }).query,
    );
    expect(replies).toEqual(["first topic", "second topic"]);
  });

  it("answers in call order, a search before a read included", async () => {
    const h = searching(
      scripted([[web("w", "order check"), reading("r", "node:first")]]),
    );
    await newChat(h.assistant, "general");
    const running = h.assistant.send("Check it?");
    h.sendAll(await h.asked());
    await running;
    expect(
      toolReplies(h.model.requests[1]).map((message) => message.toolCallId),
    ).toEqual(["w", "r"]);
  });

  it("measures the room over the conversation and the step's reads", async () => {
    const model = scripted([[listing("l"), web("w", "no room left")]]);
    // A step's reads that leave 50 tokens: too little for any result.
    (model as ModelProvider).estimate = async (request: ModelRequest) => ({
      tokens: request.messages.some((message) => message.role === "tool")
        ? request.limits.inputTokens - 50
        : 20,
      exact: false,
    });
    const h = searching(model);
    await newChat(h.assistant, "general");
    // A run that asked would wait on the writer here, and never finish.
    await h.assistant.send("Check it?");
    expect(
      JSON.parse(
        must(
          toolReplies(h.model.requests[1]).find(
            (message) => message.toolName === "web_search",
          ),
        ).content,
      ),
    ).toMatchObject({ error: "results-too-large-for-this-model" });
  });

  describe("the book's words, from every place the run showed them", () => {
    // The selection is `node:first` ("A lantern goes dark beside the old
    // gate."); each row's query repeats text that only one source holds.
    const flagged = async (
      h: ReturnType<typeof searching>,
      question: () => Promise<unknown>,
    ) => {
      const running = question();
      const ask = await h.asked();
      h.assistant.stop();
      await running;
      return ask.rows[0]?.bookWords;
    };

    it("a Section the model read this run", async () => {
      const h = searching(
        scripted([
          [reading("r", "node:future")],
          [web("w", "future secret the guide is the thief")],
        ]),
      );
      await newChat(h.assistant, "general");
      expect(await flagged(h, () => h.assistant.send("Who?"))).toBe(true);
    });

    it("the attached Section", async () => {
      const h = searching(
        scripted([[web("w", "lantern goes dark beside the old gate")]]),
      );
      await newChat(h.assistant, "general");
      expect(await flagged(h, () => h.assistant.send("Real?"))).toBe(true);
    });

    it("the writer's quote", async () => {
      const h = searching(
        scripted([[web("w", "the ferryman counted seven silver coins")]]),
      );
      await newChat(h.assistant, "general");
      expect(
        await flagged(h, () =>
          h.assistant.send(
            "Real?",
            "At dusk the ferryman counted seven silver coins twice.",
          ),
        ),
      ).toBe(true);
    });

    it("a result replayed from an earlier answer", async () => {
      const model = new ProgrammableModel(async function* (_r, _s, call) {
        if (call === 1) {
          yield {
            type: "tool-call-ready",
            call: reading("r", "node:future"),
          };
          yield { type: "completed", reason: "tools" };
        } else if (call === 3) {
          yield {
            type: "tool-call-ready",
            call: web("w", "future secret the guide is the thief"),
          };
          yield { type: "completed", reason: "tools" };
        } else {
          yield { type: "text-delta", text: "Noted." };
          yield { type: "completed", reason: "answer" };
        }
      });
      const h = searching(model);
      await newChat(h.assistant, "general");
      await h.assistant.send("Read the future.");
      expect(await flagged(h, () => h.assistant.send("Is it real?"))).toBe(
        true,
      );
    });

    it("and not a query the run never showed", async () => {
      const h = searching(
        scripted([[web("w", "future secret the guide is the thief")]]),
      );
      await newChat(h.assistant, "general");
      expect(await flagged(h, () => h.assistant.send("Real?"))).toBe(false);
    });
  });
});
