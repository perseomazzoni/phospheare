// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { ChatRecord, ModelEvent } from "../domain/types";
import { READING_LIMITS } from "../domain/types";
import {
  ProgrammableModel,
  last,
  must,
  newChat,
  setup,
  lastTurn,
} from "./assistant.fixture";

describe("the beta reader's journal", () => {
  const says = (value: unknown): ModelEvent[] => [
    { type: "text-delta", text: JSON.stringify(value) },
    { type: "completed", reason: "answer" },
  ];
  const entry = (over: Record<string, unknown> = {}) => ({
    reaction: "The lantern scene pulled me in.",
    understanding: "Someone is signalling at the gate.",
    questions: ["Who put the lantern out?"],
    confusion: [],
    attention: 4,
    cares: ["Mara"],
    keep_reading: true,
    why: "I want to know who is at the gate.",
    settled: [],
    predictions: ["The guide knows more than he says."],
    ...over,
  });

  /** A model that journals, predicts, and answers a plain question. */
  function reader(journal = entry()): ProgrammableModel {
    return new ProgrammableModel(async function* (request) {
      if (request.output?.name === "write_journal") {
        yield* says(journal);
        return;
      }
      if (request.output?.name === "write_predictions") {
        yield* says({ predictions: ["The gate will open at midnight."] });
        return;
      }
      yield { type: "text-delta", text: "A careful answer." };
      yield { type: "completed", reason: "answer" };
    });
  }

  async function beta(model = reader()) {
    const harness = setup({ model });
    await newChat(harness.assistant, "beta-reader");
    return { ...harness, model };
  }

  it("reads the first Section, journals it, and sets the horizon there", async () => {
    const { assistant, model } = await beta();
    expect(await assistant.reader.readOn()).toBe("started");
    const chat = must(assistant.activeChat());
    // With the horizon unset, the first read sets it to the Section read,
    // never further.
    expect(chat.preferences.readerScope).toEqual({
      kind: "through",
      nodeId: "first",
    });
    expect(chat.reading?.entries).toHaveLength(1);
    expect(chat.reading?.entries[0]).toMatchObject({
      nodeId: "first",
      attention: 4,
      keepReading: true,
      cares: ["Mara"],
    });
    expect(chat.reading?.predictions).toEqual([
      {
        id: "p1",
        text: "The guide knows more than he says.",
        madeAt: "first",
        state: "open",
      },
    ]);
    // The pair: the command asked, the reader's own words answering.
    const [asked, answer] = chat.turns;
    expect(asked.text).toBe("/read-on");
    expect(answer.journal).toEqual({ kind: "read", nodeId: "first" });
    expect(answer.text).toContain("The lantern scene pulled me in.");
    // It read the Section in front of it, and nothing past it.
    const request = must(model.requests[0]);
    const message = String(request.messages[0]?.content);
    expect(message).toContain("A lantern goes dark");
    expect(message).not.toContain("FUTURE SECRET");
    expect(request.instructions).toContain(
      "reading this book for the first time",
    );
  });

  it("reads on in order, settling what it predicted", async () => {
    let call = 0;
    const model = new ProgrammableModel(async function* () {
      call += 1;
      const settled =
        call === 1
          ? []
          : [{ id: "p1", state: "overturned", note: "He was honest." }];
      yield* says(entry({ settled, predictions: call === 1 ? ["P one"] : [] }));
    });
    const { assistant } = await beta(model);
    await assistant.reader.readOn();
    await assistant.reader.readOn();
    const chat = must(assistant.activeChat());
    expect(chat.reading?.entries.map((one) => one.nodeId)).toEqual([
      "first",
      "future",
    ]);
    expect(chat.preferences.readerScope).toEqual({
      kind: "through",
      nodeId: "future",
    });
    expect(chat.reading?.predictions[0]).toMatchObject({
      id: "p1",
      state: "overturned",
      resolvedAt: "future",
      note: "He was honest.",
    });
    // The second read is shown the open prediction by its id.
    expect(String(model.requests[1]?.messages[0]?.content)).toContain(
      "p1: P one",
    );
    // And there is nothing left to read.
    expect(await assistant.reader.readOn()).toBe("rejected");
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "reading-finished",
    });
  });

  it("writes predictions down where the reader stands, reading nothing", async () => {
    const { assistant, model } = await beta();
    await assistant.reader.readOn();
    expect(await assistant.reader.predict()).toBe("started");
    const chat = must(assistant.activeChat());
    expect(chat.reading?.predictions.map((one) => one.id)).toEqual([
      "p1",
      "p2",
    ]);
    expect(chat.reading?.predictions[1]).toMatchObject({
      text: "The gate will open at midnight.",
      madeAt: "first",
    });
    expect(lastTurn(chat.turns).journal).toEqual({
      kind: "predict",
      nodeId: "first",
    });
    // The prediction step read its memory, never a Section.
    const message = String(last(model.requests)?.messages[0]?.content);
    expect(message).toContain("Someone is signalling at the gate.");
    expect(message).not.toContain("A lantern goes dark");
  });

  it("refuses before anything is sent or written", async () => {
    const { assistant, model } = await beta();
    // Nothing read, no back cover: nothing to expect from.
    expect(await assistant.reader.predict()).toBe("rejected");
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "predict-nothing-read",
    });
    // A reader that knows the whole book cannot read on blind.
    await assistant.chats.updatePreferences({ readerScope: { kind: "whole" } });
    expect(await assistant.reader.readOn()).toBe("rejected");
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "reading-whole-book",
    });
    expect(model.requests).toHaveLength(0);
    expect(must(assistant.activeChat()).turns).toHaveLength(0);
  });

  it("says the journal is full, not that the book is over, at the journal's cap", async () => {
    const { assistant, model } = await beta();
    // A long book: every entry a Section outside this catalogue, so the
    // catalogue's own Sections are all unread.
    await (
      assistant as unknown as {
        writes: { persist(chat: ChatRecord): Promise<void> };
      }
    ).writes.persist({
      ...must(assistant.activeChat()),
      reading: {
        entries: Array.from({ length: READING_LIMITS.entries }, (_, n) => ({
          nodeId: `earlier-${n}`,
          readAt: "t",
          reaction: "r",
          understanding: "u",
          questions: [],
          confusion: [],
          attention: 1,
          cares: [],
          keepReading: true,
          why: "",
        })),
        predictions: [],
      },
    });
    expect(await assistant.reader.readOn()).toBe("rejected");
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "reading-journal-full",
    });
    expect(model.requests).toHaveLength(0);
  });

  it("refuses an empty Section, one too long to read whole, and a model with no fixed shape", async () => {
    const empty = await beta();
    empty.sources.texts.set("node:first", "   ");
    expect(await empty.assistant.reader.readOn()).toBe("rejected");
    expect(empty.assistant.getSnapshot().problem).toEqual({
      kind: "reading-empty-section",
      title: "First",
    });

    const long = await beta();
    long.sources.texts.set("node:first", "word ".repeat(40_000));
    expect(await long.assistant.reader.readOn()).toBe("rejected");
    expect(long.assistant.getSnapshot().problem).toMatchObject({
      kind: "reading-too-long",
      title: "First",
    });
    expect(long.model.requests).toHaveLength(0);

    const shapeless = reader();
    shapeless.descriptor = {
      ...shapeless.descriptor,
      capabilities: { tools: false, structuredOutput: false },
    };
    const plain = await beta(shapeless);
    expect(await plain.assistant.reader.readOn()).toBe("rejected");
    expect(plain.assistant.getSnapshot().problem).toEqual({
      kind: "reading-needs-tools",
      model: "Llama test",
    });
  });

  it("predicts from the back cover alone before the first page", async () => {
    const { assistant, model, sources } = await beta();
    sources.descriptors = [
      ...sources.descriptors,
      {
        id: "reference:guidebook--blurb.md",
        kind: "reference",
        title: "Back Cover",
        path: "reference/guidebook--blurb.md",
        group: "guidebook",
        sectionId: "blurb",
        authority: "reference",
        revision: "rb",
      },
    ];
    sources.texts.set(
      "reference:guidebook--blurb.md",
      "A lighthouse keeper finds a letter that should not exist.",
    );
    expect(await assistant.reader.predict()).toBe("started");
    const chat = must(assistant.activeChat());
    // No horizon is needed, and none is set: nothing of the book is read.
    expect(chat.preferences.readerScope).toBeUndefined();
    expect(chat.reading?.predictions[0]).toEqual({
      id: "p1",
      text: "The gate will open at midnight.",
      state: "open",
    });
    expect(lastTurn(chat.turns).journal).toEqual({ kind: "predict" });
    const message = String(model.requests[0]?.messages[0]?.content);
    expect(message).toContain("BACK COVER:");
    expect(message).toContain("a letter that should not exist");
    expect(message).not.toContain("A lantern goes dark");
  });

  it("is refused in every other room", async () => {
    const model = reader();
    const { assistant } = setup({ model });
    await newChat(assistant, "editorial");
    expect(await assistant.reader.readOn()).toBe("rejected");
    expect(await assistant.reader.predict()).toBe("rejected");
    expect(model.requests).toHaveLength(0);
  });

  it("leaves the chat as it was when the answer is not a journal", async () => {
    const { assistant } = await beta(reader(entry({ reaction: "" })));
    expect(await assistant.reader.readOn()).toBe("started");
    const chat = must(assistant.activeChat());
    expect(chat.turns).toHaveLength(0);
    expect(chat.reading).toBeUndefined();
    // The horizon moves only with a read that happened.
    expect(chat.preferences.readerScope).toBeUndefined();
    expect(assistant.getSnapshot().error).toBeTruthy();
  });

  it.each(["stop", "dispose"] as const)(
    "keeps the journal and horizon unchanged after %s, even if a model answers late",
    async (end) => {
      let entered!: () => void;
      let finish!: () => void;
      let runSignal: AbortSignal | undefined;
      const live = new Promise<void>((resolve) => (entered = resolve));
      const answer = new Promise<void>((resolve) => (finish = resolve));
      const model = new ProgrammableModel(async function* (_request, signal) {
        runSignal = signal;
        entered();
        await answer;
        yield* says(entry());
      });
      const { assistant, artifacts } = await beta(model);
      const before = structuredClone(must(assistant.activeChat()));
      const writes = artifacts.saved;
      const running = assistant.reader.readOn();
      await live;

      assistant[end]();
      expect(runSignal?.aborted).toBe(true);
      finish();
      expect(await running).toBe("started");

      expect(assistant.activeChat()).toEqual(before);
      expect(artifacts.chats.get(before.id)).toEqual(before);
      expect(artifacts.saved).toBe(writes);
    },
  );

  it("answers a question from its own journal", async () => {
    const { assistant, model } = await beta();
    await assistant.reader.readOn();
    await assistant.send("Would you recommend it?");
    const message = String(last(last(model.requests)?.messages ?? [])?.content);
    expect(message).toContain("YOUR JOURNAL SO FAR");
    expect(message).toContain("First: Someone is signalling at the gate.");
    expect(message).toContain("p1: The guide knows more than he says.");
  });
});
