// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { ChatTurn } from "../domain/types";
import type { ModelProvider } from "../ports";
import { Assistant } from "./assistant";
import { LOCATE_SENTENCE_MAX } from "./budgets";
import {
  SOURCES,
  mayCall,
  must,
  newChat,
  setup,
  lastTurn,
  SUMMARY,
  locating,
} from "./assistant.fixture";

// ── The /where command ───────────────────────────────────────────────────────
//
// `/where` finds the passage a writer describes and lands on it.

describe("runLocate", () => {
  function where(watching: () => boolean = () => true) {
    const events: string[] = [];
    const landed: Array<{ quote: string; allowed: boolean }> = [];
    const harness = setup({
      evidence: {
        reveal: async (anchor, options) => {
          const allowed = options?.onlyIf?.() ?? true;
          landed.push({ quote: anchor.quote, allowed });
          return allowed ? "selected" : "withheld";
        },
        open: async () => "selected",
        watch: () => {
          events.push("watch");
          return watching;
        },
      },
    });
    harness.sources.descriptors = [...SOURCES, SUMMARY];
    harness.sources.texts.set(SUMMARY.id, "A lamp fails at the gate.");
    harness.model.generator = async function* (request, signal, call) {
      events.push("request");
      yield* locating()(request, signal, call);
    };
    return { ...harness, events, landed };
  }

  it("writes the question and its answer together, and lands on the passage", async () => {
    const { assistant, events, landed } = where();
    const chat = await newChat(assistant, "general");
    await assistant.locate.run("  when the light goes out  ");
    const turns = must(
      assistant.getSnapshot().chats.find((one) => one.id === chat.id),
    ).turns;
    expect(turns.map((turn) => [turn.role, turn.text])).toEqual([
      ["user", "/where when the light goes out"],
      ["assistant", "The described moment is in node:first."],
    ]);
    expect(turns[0].runId).toBe(turns[1].runId);
    expect(turns[1].located?.matches).toEqual([
      expect.objectContaining({
        sourceId: "node:first",
        quote: "A lantern goes dark",
      }),
    ]);
    expect(landed).toEqual([{ quote: "A lantern goes dark", allowed: true }]);
    // Watched from the moment the writer asked, before any request.
    expect(events[0]).toBe("watch");
    expect(assistant.getSnapshot().runProgress).toBeUndefined();
  });

  it("leaves the answer as rows when the writer moved during the search", async () => {
    const { assistant, landed } = where(() => false);
    await newChat(assistant, "general");
    await assistant.locate.run("when the light goes out");
    expect(landed).toEqual([{ quote: "A lantern goes dark", allowed: false }]);
    expect(
      lastTurn(must(assistant.activeChat()).turns).located?.matches,
    ).toHaveLength(1);
  });

  it("refuses a reader chat before any request", async () => {
    const { assistant, model } = where();
    await newChat(assistant, "beta-reader");
    await assistant.chats.updatePreferences({
      readerScope: { kind: "whole" },
    });
    await assistant.locate.run("when the light goes out");
    expect(model.requests).toHaveLength(0);
    expect(must(assistant.activeChat()).turns).toEqual([]);
  });

  it("refuses a model without tools, naming it, before any request", async () => {
    const { assistant, model } = where();
    model.descriptor = {
      ...model.descriptor,
      capabilities: { tools: false, structuredOutput: false },
    };
    await newChat(assistant, "drafting");
    await assistant.locate.run("when the light goes out");
    expect(model.requests).toHaveLength(0);
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "where-needs-tools",
      model: "Llama test",
    });
  });

  it("refuses a description past the cap, and holds an empty one silently", async () => {
    const { assistant, model } = where();
    await newChat(assistant, "editorial");
    await assistant.locate.run("x".repeat(LOCATE_SENTENCE_MAX + 1));
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "where-too-long",
      max: LOCATE_SENTENCE_MAX,
    });
    await assistant.chats.updatePreferences({});
    await assistant.locate.run("   ");
    expect(model.requests).toHaveLength(0);
    expect(must(assistant.activeChat()).turns).toEqual([]);
  });

  it("writes nothing when the writer stops the search", async () => {
    const { assistant, model } = where();
    model.generator = async function* (_request, signal) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      assistant.stop();
      if (signal.aborted)
        yield {
          type: "failed",
          error: { code: "cancelled", message: "Stopped", retryable: false },
        };
    };
    await newChat(assistant, "general");
    await assistant.locate.run("when the light goes out");
    expect(must(assistant.activeChat()).turns).toEqual([]);
    expect(assistant.getSnapshot().errorCode).toBe("cancelled");
    expect(assistant.getSnapshot().running).toBe(false);
  });

  it("will not edit a /where into a question for the model", async () => {
    const { assistant, model } = where();
    await newChat(assistant, "general");
    await assistant.locate.run("when the light goes out");
    const asked = must(assistant.activeChat()).turns[0];
    const before = model.requests.length;
    expect(await assistant.edits.edit(asked.id, "/where the gate")).toBe(
      "rejected",
    );
    expect(model.requests).toHaveLength(before);
  });

  // The arrival rule counts the writer's moves from the moment the search is
  // asked, so `watch()` runs before `locateTarget` awaits `describeModel` and
  // `readerBoundary`, a network round trip on Ollama. Typing in that window
  // would otherwise be invisible, and the page could jump under it. The
  // `events[0] === "watch"` pin above records only requests, which those
  // awaits do not make.
  it("watches the editor before the checks that await", async () => {
    const { assistant, events, model } = where();
    const describe = model.describeModel.bind(model);
    model.describeModel = async () => {
      events.push("describe");
      return describe();
    };
    await newChat(assistant, "general");
    await assistant.locate.run("when the light goes out");
    expect(events.indexOf("watch")).toBeLessThan(events.indexOf("describe"));
  });

  // Deleting the chat a `/where` runs in aborts the run, and that abort
  // publishes no "Search stopped." with `errorCode: "cancelled"`: the dock's
  // foot would say "Stopped." under whichever chat the writer is left in,
  // about a search they never stopped.
  it("deleting the chat mid-search leaves no Stopped behind", async () => {
    const { assistant, model } = where();
    await newChat(assistant, "general");
    const asked = await newChat(assistant, "general");
    model.generator = async function* (_request, signal) {
      void assistant.deleteChat(asked.id);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (signal.aborted)
        yield {
          type: "failed",
          error: { code: "cancelled", message: "Stopped", retryable: false },
        };
    };
    await assistant.locate.run("when the light goes out");
    const snapshot = assistant.getSnapshot();
    expect(snapshot.chats.map((one) => one.id)).not.toContain(asked.id);
    expect(snapshot.running).toBe(false);
    expect(snapshot.error).toBeNull();
    expect(snapshot.errorCode ?? null).toBeNull();
  });
});

describe("completeLocate", () => {
  const STAMP = "2026-09-25T00:00:00.000Z";

  /**
   * A chat holding a `/where` answer that could not see `skipped`, as a
   * search writes it — and a model that writes summaries as text and
   * searches with tools. A summary it writes joins the catalogue, as the
   * project adapter lists it, so the search after can rank by it.
   */
  async function answered(
    skipped: string[],
    options: { after?: boolean; harness?: ReturnType<typeof setup> } = {},
  ) {
    const harness = options.harness ?? setup();
    const { assistant, artifacts, sources, model } = harness;
    sources.texts.set(SUMMARY.id, "A lamp fails at the gate.");
    const listed = sources.list.bind(sources);
    sources.list = async () => [
      ...(await listed()),
      ...(artifacts.summaries.has("first") &&
      !sources.descriptors.includes(SUMMARY)
        ? [SUMMARY]
        : []),
    ];
    model.generator = async function* (request, signal, call) {
      if (mayCall(request)) {
        yield* locating()(request, signal, call);
        return;
      }
      yield { type: "text-delta", text: "A summary." };
      yield { type: "completed", reason: "answer" };
    };
    const chat = await newChat(assistant, "general");
    const stored = must(artifacts.chats.get(chat.id));
    const turns: ChatTurn[] = [
      {
        id: "asked",
        runId: "run-old",
        role: "user",
        text: "/where when the light goes out",
        createdAt: STAMP,
        outcome: "complete",
      },
      {
        id: "answer",
        runId: "run-old",
        role: "assistant",
        text: "The described moment was not found in the Sections searched.",
        createdAt: STAMP,
        outcome: "complete",
        located: {
          matches: [],
          coverage: {
            intended: 2,
            inspected: 0,
            skipped: skipped.map((sourceId) => ({
              sourceId,
              reason: "unmapped" as const,
            })),
            complete: false,
          },
        },
      },
      ...(options.after
        ? [
            {
              id: "later",
              role: "user" as const,
              text: "And then?",
              createdAt: STAMP,
              outcome: "complete" as const,
            },
          ]
        : []),
    ];
    artifacts.chats.set(chat.id, { ...stored, turns });
    await assistant.initialize();
    return { ...harness, chat };
  }

  function turnsOf(assistant: Assistant, chatId: string): ChatTurn[] {
    return must(assistant.getSnapshot().chats.find((one) => one.id === chatId))
      .turns;
  }

  it("summarises only the live manuscript sources the answer could not see, in turn", async () => {
    const { assistant, artifacts } = await answered([
      // A forged id and a reference id are requests from a chat file, and
      // summarise nothing.
      "node:first",
      "node:gone",
      "reference:world.md",
      "node:future",
    ]);
    const seen: Array<number | undefined> = [];
    assistant.subscribe(() => {
      const progress = assistant.getSnapshot().runProgress;
      if (progress?.work === "summarise") seen.push(progress.complete);
    });
    await assistant.locate.complete("run-old");
    expect([...artifacts.summaries.keys()]).toEqual(["first", "future"]);
    expect(seen).toContain(1);
    expect(seen).toContain(2);
    expect(assistant.getSnapshot().runProgress).toBeUndefined();
    expect(assistant.getSnapshot().running).toBe(false);
  });

  // The button's run ends in the finished search, where the old answer
  // stood: one question, one answer, and the conversation's order untouched.
  it("searches again and puts the answer where the old one stood", async () => {
    const landed: string[] = [];
    const harness = setup({
      evidence: {
        reveal: async (anchor, options) => {
          if (options?.onlyIf?.() ?? true) landed.push(anchor.quote);
          return "selected";
        },
        open: async () => "selected",
        watch: () => () => true,
      },
    });
    const { assistant, chat } = await answered(["node:first"], {
      after: true,
      harness,
    });
    await assistant.locate.complete("run-old");
    const turns = turnsOf(assistant, chat.id);
    expect(turns.map((turn) => [turn.role, turn.text])).toEqual([
      ["user", "/where when the light goes out"],
      ["assistant", "The described moment is in node:first."],
      ["user", "And then?"],
    ]);
    expect(turns.some((turn) => turn.runId === "run-old")).toBe(false);
    expect(turns[0]?.runId).toBe(turns[1]?.runId);
    // `future` is not asked for and still has no summary: the new answer
    // says so itself rather than inheriting the old one's word.
    expect(turns[1]?.located?.coverage.skipped).toEqual([
      { sourceId: "node:future", reason: "unmapped" },
    ]);
    expect(landed).toEqual(["A lantern goes dark"]);
    expect(assistant.getSnapshot().error).toBeNull();
  });

  it("writes no summary the search can already see", async () => {
    const harness = setup();
    harness.sources.descriptors = [...SOURCES, SUMMARY];
    const { assistant, artifacts } = await answered(
      ["node:first", "node:future"],
      { harness },
    );
    await assistant.locate.complete("run-old");
    expect([...artifacts.summaries.keys()]).toEqual(["future"]);
  });

  it("refuses before a single summary when the model cannot search", async () => {
    const { assistant, artifacts, model, chat } = await answered([
      "node:first",
    ]);
    model.descriptor.capabilities.tools = false;
    await assistant.locate.complete("run-old");
    expect(artifacts.summaries.size).toBe(0);
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "where-needs-tools",
      model: "Llama test",
    });
    expect(turnsOf(assistant, chat.id).map((turn) => turn.id)).toEqual([
      "asked",
      "answer",
    ]);
  });

  it("skips a Section that changes while its summary is written, and goes on", async () => {
    const { assistant, artifacts, sources } = await answered([
      "node:first",
      "node:future",
    ]);
    // The first read of `first` is the capture, the second the check.
    const read = sources.read.bind(sources);
    let reads = 0;
    sources.read = async (sourceId, range) => {
      const capture = await read(sourceId, range);
      if (sourceId === "node:first" && ++reads === 2)
        return { ...capture, revision: "moved" };
      return capture;
    };
    await assistant.locate.complete("run-old");
    expect([...artifacts.summaries.keys()]).toEqual(["future"]);
    expect(assistant.getSnapshot().error).toBeNull();
  });

  it("says nothing of a stop the writer did not make: the chat was deleted", async () => {
    const { assistant, model, chat } = await answered(["node:first"]);
    await newChat(assistant, "general");
    assistant.selectChat(chat.id);
    model.generator = async function* (_request, signal) {
      void assistant.deleteChat(chat.id);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (signal.aborted)
        yield {
          type: "failed",
          error: { code: "cancelled", message: "Stopped", retryable: false },
        };
    };
    await assistant.locate.complete("run-old");
    expect(assistant.getSnapshot().error).toBeNull();
    expect(assistant.getSnapshot().running).toBe(false);
  });

  it("stops between summaries, keeping the ones written and the old answer", async () => {
    const { assistant, artifacts, model, chat } = await answered([
      "node:first",
      "node:future",
    ]);
    let calls = 0;
    model.generator = async function* () {
      calls += 1;
      if (calls === 2) assistant.stop();
      yield { type: "text-delta", text: "A summary." };
      yield { type: "completed", reason: "answer" };
    };
    await assistant.locate.complete("run-old");
    expect([...artifacts.summaries.keys()]).toEqual(["first"]);
    expect(assistant.getSnapshot().errorCode).toBe("cancelled");
    expect(turnsOf(assistant, chat.id).map((turn) => turn.id)).toEqual([
      "asked",
      "answer",
    ]);
  });

  it("does nothing for a run that is not a /where answer in this chat", async () => {
    const { assistant, artifacts, model } = await answered(["node:first"]);
    const before = model.requests.length;
    await assistant.locate.complete("run-nowhere");
    expect(model.requests.length).toBe(before);
    expect(artifacts.summaries.size).toBe(0);
    expect(assistant.getSnapshot().running).toBe(false);
  });

  // A Section deleted while the run waited, or one the model answers with
  // nothing, is that Section's failure; a failure of the model itself ends
  // the run.
  it("skips a Section deleted while the run waited for it", async () => {
    const { assistant, artifacts, sources } = await answered([
      "node:first",
      "node:future",
    ]);
    const listed = sources.list.bind(sources);
    let calls = 0;
    sources.list = async () => {
      calls += 1;
      const all = await listed();
      return calls > 1 ? all.filter((one) => one.id !== "node:first") : all;
    };
    await assistant.locate.complete("run-old");
    expect([...artifacts.summaries.keys()]).toEqual(["future"]);
    // Never the raw "summary-source-missing" string in the dock.
    expect(assistant.getSnapshot().error).toBeNull();
  });

  it("skips a Section the model answers with nothing", async () => {
    const { assistant, artifacts, model, sources } = await answered([
      "node:first",
      "node:future",
    ]);
    const first = must(sources.texts.get("node:first"));
    const search = model.generator;
    model.generator = async function* (request, signal, call) {
      if (mayCall(request)) {
        yield* search(request, signal, call);
        return;
      }
      const empty = request.messages.some((one) => one.content === first);
      yield { type: "text-delta", text: empty ? "   " : "A summary." };
      yield { type: "completed", reason: "answer" };
    };
    await assistant.locate.complete("run-old");
    expect([...artifacts.summaries.keys()]).toEqual(["future"]);
  });

  it("ends the run on a failure of the model itself, keeping the old answer", async () => {
    const { assistant, artifacts, model, chat } = await answered([
      "node:first",
      "node:future",
    ]);
    model.generator = async function* () {
      yield {
        type: "failed",
        error: { code: "connection", message: "Offline", retryable: true },
      };
    };
    await assistant.locate.complete("run-old");
    expect(artifacts.summaries.size).toBe(0);
    expect(model.requests).toHaveLength(1);
    expect(assistant.getSnapshot().errorCode).toBe("connection");
    expect(turnsOf(assistant, chat.id).map((turn) => turn.id)).toEqual([
      "asked",
      "answer",
    ]);
  });

  // A Section the model can never summarise, too large for its window, is a
  // fact about that Section, not about the run. It stops neither the Sections
  // after it nor the search; otherwise every later click would fail on the
  // same Section first and the button would never end in the finished
  // search it promises.
  it("one Section too large to summarise keeps neither the rest nor the search from running", async () => {
    const { assistant, artifacts, model, chat, sources } = await answered([
      "node:first",
      "node:future",
    ]);
    const tooLarge = must(sources.texts.get("node:first"));
    // Through the port's type: the double's own `estimate` takes no request.
    const provider: ModelProvider = model;
    provider.estimate = async (request) => ({
      tokens: request.messages.some((one) => one.content === tooLarge)
        ? 1_000_000
        : 20,
      exact: false,
    });
    await assistant.locate.complete("run-old");
    expect([...artifacts.summaries.keys()]).toEqual(["future"]);
    // The search ran again and its answer took the old pair's place.
    expect(
      turnsOf(assistant, chat.id).some((one) => one.runId === "run-old"),
    ).toBe(false);
  });

  // The new answer records the Section skipped above as `unsummarisable`,
  // not `unmapped`, so its button does not offer it again, and the next click,
  // the chat still on the same model, never sends it.
  it("records a Section the model cannot summarise, and never sends it again on the same model", async () => {
    const { assistant, model, chat, sources } = await answered([
      "node:first",
      "node:future",
    ]);
    const tooLarge = must(sources.texts.get("node:first"));
    let tried = 0;
    const provider: ModelProvider = model;
    provider.estimate = async (request) => {
      const big = request.messages.some((one) => one.content === tooLarge);
      if (big) tried += 1;
      return { tokens: big ? 1_000_000 : 20, exact: false };
    };
    await assistant.locate.complete("run-old");
    expect(tried).toBe(1);
    const answer = must(turnsOf(assistant, chat.id).find((one) => one.located));
    expect(
      answer.located?.coverage.skipped.find(
        (row) => row.sourceId === "node:first",
      )?.reason,
    ).toBe("unsummarisable");

    await assistant.locate.complete(must(answer.runId));
    expect(tried).toBe(1);
  });

  it("keeps a Section the model answered with nothing offerable", async () => {
    const { assistant, model, chat, sources } = await answered([
      "node:first",
      "node:future",
    ]);
    const first = must(sources.texts.get("node:first"));
    const search = model.generator;
    model.generator = async function* (request, signal, call) {
      if (mayCall(request)) {
        yield* search(request, signal, call);
        return;
      }
      const empty = request.messages.some((one) => one.content === first);
      yield { type: "text-delta", text: empty ? "   " : "A summary." };
      yield { type: "completed", reason: "answer" };
    };
    await assistant.locate.complete("run-old");
    const answer = must(turnsOf(assistant, chat.id).find((one) => one.located));
    // An empty answer may not repeat (`retryable`): the button offers it again.
    expect(
      answer.located?.coverage.skipped.find(
        (row) => row.sourceId === "node:first",
      )?.reason,
    ).toBe("unmapped");
  });
});
