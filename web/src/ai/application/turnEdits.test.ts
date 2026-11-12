// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { questionOf, skillFor } from "../domain/skills";
import { QUESTION_ARGUMENT_MAX } from "../domain/types";
import {
  ProgrammableModel,
  last,
  must,
  newChat,
  setup,
  lastTurn,
} from "./assistant.fixture";

describe("asking again after a failure", () => {
  /** A model that fails the first time and answers the second. */
  function failThenAnswer() {
    return new ProgrammableModel(async function* (_request, _signal, call) {
      if (call === 1) {
        yield {
          type: "failed",
          error: {
            code: "connection",
            message: "The provider is offline.",
            retryable: true,
          },
        };
        return;
      }
      yield { type: "text-delta", text: "The second time." };
      yield { type: "completed", reason: "answer" };
    });
  }

  it("replaces the failed exchange instead of asking a second time", async () => {
    // A failed turn keeps whatever prose arrived before it broke, and
    // history replays an assistant turn's text, so appending a retry would
    // hand the model its own truncated attempt as context. The pair shares a
    // `runId` so it can be removed as one thing.
    const model = failThenAnswer();
    const { assistant, artifacts } = setup({ model });
    const chat = await newChat(assistant, "general");
    await assistant.send("Is it sharp?");

    const failed = lastTurn(artifacts.chats.get(chat.id)?.turns ?? []);
    expect(failed).toMatchObject({ outcome: "failed" });

    expect(await assistant.edits.retry(failed.id)).toBe("started");

    const turns = artifacts.chats.get(chat.id)?.turns ?? [];
    // One question and one answer, not two of each.
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: "user", text: "Is it sharp?" });
    expect(turns[1]).toMatchObject({
      role: "assistant",
      text: "The second time.",
      outcome: "complete",
    });
  });

  it("sends the question again and not the failure with it", async () => {
    const model = failThenAnswer();
    const { assistant, artifacts } = setup({ model });
    const chat = await newChat(assistant, "general");
    await assistant.send("Is it sharp?");
    const failed = lastTurn(artifacts.chats.get(chat.id)?.turns ?? []);

    await assistant.edits.retry(failed.id);

    // The second request's history carries the question once and carries
    // nothing the failed attempt produced.
    const contents = (model.requests[1]?.messages ?? []).map(
      (message) => message.content,
    );
    expect(
      contents.filter((one) => String(one).includes("Is it sharp?")),
    ).toHaveLength(1);
    expect(contents.some((one) => String(one).includes("offline"))).toBe(false);
  });

  it("carries the quotation the question was asked about", async () => {
    // A retry that drops the passage is a different question, as a refused
    // send that drops it is.
    const model = failThenAnswer();
    const { assistant } = setup({ model });
    await newChat(assistant, "general");
    await assistant.send("Is it sharp?", "the blade lay flat");
    const failed = lastTurn(assistant.getSnapshot().chats[0]?.turns ?? []);

    await assistant.edits.retry(failed.id);

    const resent = (model.requests[1]?.messages ?? []).map((message) =>
      String(message.content),
    );
    expect(resent.some((one) => one.includes("the blade lay flat"))).toBe(true);
  });

  it("carries the command the question was typed as", async () => {
    // The bubble shows the command, and a retry that lost it would show
    // the rubric it sent instead.
    const model = failThenAnswer();
    const { assistant, artifacts } = setup({ model });
    const chat = await newChat(assistant, "general");
    await assistant.send("The rubric.", undefined, { skill: "asks" });
    const failed = lastTurn(artifacts.chats.get(chat.id)?.turns ?? []);

    await assistant.edits.retry(failed.id);

    expect(artifacts.chats.get(chat.id)?.turns[0]).toMatchObject({
      text: "The rubric.",
      command: { skill: "asks" },
    });
  });

  /**
   * A model that streams one word, then waits for Stop. `live` resolves once
   * the run is under way, so a test can press Stop or Undo mid-answer.
   */
  function untilStopped() {
    let markLive: () => void = () => undefined;
    const live = new Promise<void>((resolve) => (markLive = resolve));
    const model = new ProgrammableModel(async function* (_request, signal) {
      yield { type: "text-delta", text: "Half" };
      markLive();
      while (!signal.aborted)
        await new Promise((resolve) => setTimeout(resolve, 2));
      yield {
        type: "failed",
        error: { code: "cancelled", message: "cancelled", retryable: false },
      };
    });
    return { model, live };
  }

  it("says which way an answer ended, on the turn", async () => {
    // The placeholder written as the run begins carries `interrupted`, what
    // a reload mid-answer leaves behind, and every real ending replaces it:
    // Stop with `cancelled`, an answer with none.
    const { model, live } = untilStopped();
    const { assistant, artifacts } = setup({ model });
    const chat = await newChat(assistant, "general");
    const running = assistant.send("Is it sharp?");
    await live;
    const placeholder = lastTurn(artifacts.chats.get(chat.id)?.turns ?? []);
    expect(placeholder.errorCode).toBe("interrupted");
    assistant.stop();
    await running;
    const stopped = lastTurn(artifacts.chats.get(chat.id)?.turns ?? []);
    expect(stopped).toMatchObject({
      outcome: "interrupted",
      errorCode: "cancelled",
      text: "Half",
    });

    model.generator = async function* () {
      yield { type: "text-delta", text: "Whole." };
      yield { type: "completed", reason: "answer" };
    };
    await assistant.send("Again?");
    const answered = lastTurn(artifacts.chats.get(chat.id)?.turns ?? []);
    expect(answered.outcome).toBe("complete");
    expect(answered.errorCode).toBeUndefined();
  });

  it("offers a stopped answer again, replacing it", async () => {
    // Stop leaves an answer that can be asked again, as in other chat apps.
    const { model, live } = untilStopped();
    const { assistant, artifacts } = setup({ model });
    const chat = await newChat(assistant, "general");
    const running = assistant.send("Is it sharp?");
    await live;
    assistant.stop();
    await running;
    const stopped = lastTurn(artifacts.chats.get(chat.id)?.turns ?? []);
    expect(stopped.outcome).toBe("interrupted");

    model.generator = async function* () {
      yield { type: "text-delta", text: "Whole now." };
      yield { type: "completed", reason: "answer" };
    };
    expect(await assistant.edits.retry(stopped.id)).toBe("started");

    const turns = artifacts.chats.get(chat.id)?.turns ?? [];
    expect(turns.map((one) => one.text)).toEqual([
      "Is it sharp?",
      "Whole now.",
    ]);
  });

  it("never retries the stopped-looking turn that is still streaming", async () => {
    // An assistant turn is written `interrupted` the moment its run begins,
    // so during a run the last turn looks stopped. Retrying it would tear a
    // live answer out from under its own run.
    const { model, live } = untilStopped();
    const { assistant, artifacts } = setup({ model });
    const chat = await newChat(assistant, "general");
    const running = assistant.send("Is it sharp?");
    await live;
    const streaming = lastTurn(artifacts.chats.get(chat.id)?.turns ?? []);

    expect(await assistant.edits.retry(streaming.id)).toBe("rejected");
    assistant.stop();
    await running;
  });

  describe("editing a question", () => {
    async function twoExchanges() {
      const model = new ProgrammableModel(async function* (request) {
        const asked = String(last(request.messages)?.content ?? "");
        yield { type: "text-delta", text: `Answer to ${asked}` };
        yield { type: "completed", reason: "answer" };
      });
      const harness = setup({ model });
      const chat = await newChat(harness.assistant, "general");
      await harness.assistant.send("First?", "a quoted line");
      await harness.assistant.send("Second?");
      const turns = () => harness.artifacts.chats.get(chat.id)?.turns ?? [];
      return { ...harness, model, chat, turns };
    }

    it("rewinds to the edited question and asks it again", async () => {
      // Everything after the edited question goes, and the new question is
      // asked in its place, with none of the dropped exchange in the
      // model's history.
      const { assistant, model, turns } = await twoExchanges();
      const first = must(turns()[0]);

      expect(await assistant.edits.edit(first.id, "First, again?")).toBe(
        "started",
      );
      await vi.waitFor(() => expect(turns()).toHaveLength(2));
      await vi.waitFor(() => expect(turns()[1]?.outcome).toBe("complete"));

      expect(turns()[0]?.text).toBe("First, again?");
      // The passage it was asked about rides with the edit.
      expect(turns()[0]?.quote).toBe("a quoted line");
      const sent = (last(model.requests)?.messages ?? [])
        .map((one) => String(one.content))
        .join("\n");
      expect(sent).not.toContain("Second?");
    });

    it("asks an edit without its quote when told to, and Undo brings it back", async () => {
      const { assistant, model, turns } = await twoExchanges();
      const first = must(turns()[0]);
      expect(
        await assistant.edits.edit(first.id, "Whole Section?", undefined, {
          withoutQuote: true,
        }),
      ).toBe("started");
      await vi.waitFor(() => expect(last(turns())?.outcome).toBe("complete"));
      expect(turns()[0]?.quote).toBeUndefined();
      const sent = (last(model.requests)?.messages ?? [])
        .map((one) => String(one.content))
        .join("\n");
      expect(sent).not.toContain("a quoted line");
    });

    it("keeps the command an edit is asked as, and none a plain edit is", async () => {
      const { assistant, turns } = await twoExchanges();

      await assistant.edits.edit(must(turns()[0]).id, "The rubric.", {
        skill: "asks",
        argument: "a sigh",
      });
      await vi.waitFor(() => expect(last(turns())?.outcome).toBe("complete"));
      expect(turns()[0]).toMatchObject({
        text: "The rubric.",
        command: { skill: "asks", argument: "a sigh" },
      });

      await assistant.edits.edit(must(turns()[0]).id, "Plain again?");
      await vi.waitFor(() => expect(last(turns())?.outcome).toBe("complete"));
      expect(turns()[0]?.command).toBeUndefined();
    });

    it("takes the edit back, exactly", async () => {
      const { assistant, turns } = await twoExchanges();
      const original = turns().map((one) => one.id);

      await assistant.edits.edit(must(turns()[0]).id, "Changed?");
      await vi.waitFor(() => expect(last(turns())?.outcome).toBe("complete"));

      expect(await assistant.edits.undo()).toBe(true);
      expect(turns().map((one) => one.id)).toEqual(original);
      // Once: there is nothing left to take back.
      expect(await assistant.edits.undo()).toBe(false);
    });

    it("stops the new answer and restores, when undone mid-answer", async () => {
      // The Undo is offered the moment the edit starts, and a local model
      // can take minutes — so it has to work while the answer is coming,
      // and must wait for the stopped run's last write before restoring.
      const { assistant, model, turns } = await twoExchanges();
      const original = turns().map((one) => one.id);
      const { model: slow, live } = untilStopped();
      model.generator = slow.generator;

      expect(await assistant.edits.edit(must(turns()[2]).id, "Changed?")).toBe(
        "started",
      );
      await live;

      expect(await assistant.edits.undo()).toBe(true);
      expect(turns().map((one) => one.id)).toEqual(original);
      expect(assistant.getSnapshot().running).toBe(false);
    });

    it("withdraws the Undo once the writer asks something new", async () => {
      // Taking the edit back then would drop the new question with it.
      const { assistant, turns } = await twoExchanges();
      await assistant.edits.edit(must(turns()[0]).id, "Changed?");
      await vi.waitFor(() => expect(last(turns())?.outcome).toBe("complete"));
      await assistant.send("And another?");

      expect(await assistant.edits.undo()).toBe(false);
    });

    it("keeps the Undo when a send is refused and nothing new was asked", async () => {
      // `send` withdraws the Undo before `ask` decides; a refused
      // /how-to-say asks nothing, so there is no new question
      // for the Undo to drop.
      const { assistant, turns } = await twoExchanges();
      await assistant.edits.edit(must(turns()[0]).id, "Changed?");
      await vi.waitFor(() => expect(last(turns())?.outcome).toBe("complete"));
      const long = questionOf(
        must(skillFor("how-to-say")),
        "x".repeat(QUESTION_ARGUMENT_MAX + 1),
      );
      expect(await assistant.send(long.text, undefined, long.command)).toBe(
        "rejected",
      );

      expect(await assistant.edits.undo()).toBe(true);
    });

    it("refuses an edit while a run is going, and an empty one", async () => {
      const { assistant, turns, model } = await twoExchanges();
      const { model: slow, live } = untilStopped();
      model.generator = slow.generator;
      const running = assistant.send("Third?");
      await live;

      expect(await assistant.edits.edit(must(turns()[0]).id, "Changed?")).toBe(
        "rejected",
      );
      assistant.stop();
      await running;
      expect(await assistant.edits.edit(must(turns()[0]).id, "   ")).toBe(
        "rejected",
      );
    });

    it("refuses to edit anything but the writer's own question", async () => {
      const { assistant, turns } = await twoExchanges();
      expect(await assistant.edits.edit(must(turns()[1]).id, "Nope")).toBe(
        "rejected",
      );
    });
  });

  it("retries only the LAST exchange, never one further up the chat", async () => {
    // Only the latest response can be retried, as in ChatGPT, Claude.ai and
    // Gemini. An older failure asked again at the bottom would carry every
    // later turn in its history, which makes it a different question, and
    // would rearrange the transcript.
    const model = failThenAnswer();
    const { assistant, artifacts } = setup({ model });
    const chat = await newChat(assistant, "general");
    await assistant.send("First?");
    const failed = lastTurn(artifacts.chats.get(chat.id)?.turns ?? []);
    await assistant.send("Second?");
    const before = artifacts.chats.get(chat.id)?.turns.map((one) => one.id);

    expect(await assistant.edits.retry(failed.id)).toBe("rejected");
    expect(artifacts.chats.get(chat.id)?.turns.map((one) => one.id)).toEqual(
      before,
    );
  });

  it("refuses a turn that did not fail", async () => {
    const { assistant, artifacts } = setup();
    const chat = await newChat(assistant, "general");
    await assistant.send("Hello");
    const answered = lastTurn(artifacts.chats.get(chat.id)?.turns ?? []);

    expect(await assistant.edits.retry(answered.id)).toBe("rejected");
    expect(artifacts.chats.get(chat.id)?.turns).toHaveLength(2);
  });

  it("puts the question back when the retry cannot start", async () => {
    // `send` rejects before persisting anything — here because the chat has
    // no model — so the removal has to be undone completely. Without this a
    // writer who pressed Try again would watch their question disappear.
    const model = new ProgrammableModel(async function* () {
      yield {
        type: "failed",
        error: {
          code: "connection",
          message: "The provider is offline.",
          retryable: true,
        },
      };
    });
    const { assistant, artifacts } = setup({ model });
    const chat = await newChat(assistant, "general");
    await assistant.send("Is it sharp?");
    const failed = lastTurn(artifacts.chats.get(chat.id)?.turns ?? []);

    await assistant.chats.updatePreferences({ model: undefined });
    expect(await assistant.edits.retry(failed.id)).toBe("rejected");

    const turns = artifacts.chats.get(chat.id)?.turns ?? [];
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: "user", text: "Is it sharp?" });
  });
});
