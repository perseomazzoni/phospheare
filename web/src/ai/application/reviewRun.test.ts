// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import type { ChatTurn, ReviewScope, SourceDescriptor } from "../domain/types";
import type { ModelProvider } from "../ports";
import { Assistant } from "./assistant";
import {
  budgetFor,
  inputCharactersFor,
  limitsFor,
  INSTRUCTION_RESERVE,
  REVIEW_DIRECT_OUTPUT_TOKENS,
} from "./budgets";
import { estimateRequestTokens } from "../domain/estimate";
import { NAMED_REFERENCE_CLAUSE } from "../domain/policy";
import { REVIEW_REFERENCES_MAX } from "../domain/types";
import { isReviewReferences } from "../domain/scope";
import {
  SOURCES,
  MemorySources,
  mayCall,
  ProgrammableModel,
  last,
  must,
  newChat,
  setup,
  lastTurn,
  SUMMARY,
} from "./assistant.fixture";

describe("a review's scope", () => {
  const quiet = () =>
    new ProgrammableModel(async function* () {
      yield { type: "text-delta", text: "Nothing to report." };
      yield { type: "completed", reason: "answer" };
    });

  it("reads the named Part or Section, and holds its id", async () => {
    const model = quiet();
    const { assistant, artifacts } = setup({ model });
    const chat = await newChat(assistant, "editorial");
    await assistant.reviews.run("continuity", {
      kind: "node",
      nodeId: "future",
    });
    const saved = must(artifacts.chats.get(chat.id));
    expect(saved.preferences).toMatchObject({
      reviewScope: { kind: "node", nodeId: "future" },
      targetNodeId: "future",
    });
    // The named node is what the turn is about, not the one that is open.
    expect(last(must(model.requests[0]).messages)?.content).toContain(
      "FUTURE SECRET",
    );
  });

  it("refuses a named node that is gone, and never reads something wider", async () => {
    const model = quiet();
    const { assistant, artifacts } = setup({ model });
    const chat = await newChat(assistant, "editorial");
    await assistant.reviews.run("continuity", {
      kind: "node",
      nodeId: "deleted-since",
    });
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "review-node-missing",
    });
    expect(model.requests).toHaveLength(0);
    expect(
      must(artifacts.chats.get(chat.id)).preferences.reviewScope,
    ).toBeUndefined();
  });

  it("reads the quote at the nearest scope, and the open Section otherwise", async () => {
    const model = quiet();
    const { assistant, artifacts } = setup({ model });
    const chat = await newChat(assistant, "editorial");
    await assistant.reviews.run(
      "line",
      { kind: "current" },
      "the lantern goes dark",
    );
    const turns = must(artifacts.chats.get(chat.id)).turns;
    expect(turns[0]?.quote).toBe("the lantern goes dark");
    expect(turns[0]?.text).toContain("of the quoted passage");
    expect(must(artifacts.chats.get(chat.id)).preferences.targetNodeId).toBe(
      "first",
    );

    // `section` is the whole Section even with a quote in hand.
    await assistant.reviews.run("line", { kind: "section" }, "ignored");
    const later = must(artifacts.chats.get(chat.id)).turns;
    const asked = last(later.filter((turn) => turn.role === "user"));
    expect(asked?.quote).toBeUndefined();
    expect(asked?.text).toContain("of the source attached below");
  });

  // ── References a review reads ────────────────────────────────────────────
  const withReferences = (sources: MemorySources) => {
    sources.descriptors = [
      ...SOURCES,
      {
        id: "reference:brief",
        kind: "reference",
        title: "Editing brief",
        path: "reference/guidebook--editing-brief.md",
        authority: "reference",
        group: "guidebook",
        sectionId: "editing-brief",
      },
      {
        id: "reference:marta",
        kind: "reference",
        title: "Marta",
        path: "reference/character--marta.md",
        authority: "reference",
        group: "characters",
      },
      {
        id: "reference:timeline",
        kind: "reference",
        title: "Timeline",
        path: "reference/world--timeline.md",
        authority: "reference",
        group: "world",
        sectionId: "timeline",
      },
    ];
    sources.texts.set("reference:brief", "Keep the slow opening.");
    sources.texts.set("reference:marta", "Marta is left-handed.");
    // Far past any reference budget: it is left out whole, and named.
    sources.texts.set("reference:timeline", "1850. ".repeat(40_000));
  };

  it("attaches the references its command declares, as data, and names what did not fit", async () => {
    const model = quiet();
    const { assistant, artifacts, sources } = setup({ model });
    withReferences(sources);
    const chat = await newChat(assistant, "editorial");
    await assistant.reviews.run("continuity", { kind: "current" });

    const request = must(model.requests[0]);
    const sent = last(request.messages)?.content ?? "";
    // First in the final message, before the index — never in the
    // system instructions, whose authority a file must not borrow.
    expect(sent.indexOf("--- REFERENCE reference:brief")).toBeGreaterThan(-1);
    expect(sent.indexOf("--- REFERENCE reference:brief")).toBeLessThan(
      sent.indexOf("Project index"),
    );
    expect(sent).toContain("Marta is left-handed.");
    expect(sent).not.toContain("1850. 1850.");
    expect(request.instructions).not.toContain("Marta is left-handed.");
    expect(request.instructions).toContain(
      "never proof of what the prose does",
    );
    // How to use them: every page the chat reads is explained in
    // the app's words, the timeline included though it did not fit this
    // turn, so the instructions hold turn to turn. The records go under the
    // headings those words explain.
    expect(request.instructions).toContain(
      "HOW TO USE THE WRITER'S REFERENCES.",
    );
    for (const page of [
      "- Character sheet: ",
      "- Editing brief: ",
      "- History and timeline: ",
    ])
      expect(request.instructions).toContain(page);
    expect(sent).toContain("OTHER NOTES\n- Marta is left-handed.");

    const answer = lastTurn(must(artifacts.chats.get(chat.id)).turns);
    expect(
      answer.sources
        ?.filter((use) => use.reason === "declared")
        .map((use) => use.id),
    ).toEqual(["reference:brief", "reference:marta"]);
    expect(answer.coverage?.skipped).toContainEqual({
      sourceId: "reference:timeline",
      reason: "not-in-budget",
    });
  });

  it("attaches nothing to a reader chat, even one carrying a planted review", async () => {
    const model = quiet();
    const { assistant, artifacts, sources } = setup({ model });
    withReferences(sources);
    // A horizon that reaches the references too, so this row fails if the
    // refusal by kind goes, rather than resting on the horizon's own
    // manuscript-only listing.
    sources.allowedReaderSources = async () =>
      new Set(sources.descriptors.map((source) => source.id));
    const chat = await newChat(assistant, "alpha-reader");
    // No surface sets these on a reader chat; a chat file can.
    await assistant.chats.updatePreferences({
      readerScope: { kind: "whole" },
      reviewTask: "continuity",
      reviewScope: { kind: "current" },
    });
    await assistant.send("What do you make of her?");
    expect(last(must(model.requests[0]).messages)?.content).not.toContain(
      "--- REFERENCE",
    );
    const answer = lastTurn(must(artifacts.chats.get(chat.id)).turns);
    expect(answer.sources?.some((use) => use.reason === "declared")).not.toBe(
      true,
    );
  });

  it("attaches nothing to a question outside a review", async () => {
    const model = quiet();
    const { assistant, sources } = setup({ model });
    withReferences(sources);
    await newChat(assistant, "general");
    await assistant.send("Where is Marta from?");
    expect(last(must(model.requests[0]).messages)?.content).not.toContain(
      "--- REFERENCE",
    );
  });

  // The references' room is what the Section and the conversation history
  // leave of `totalCharacters`. A reference the history leaves no room for
  // is left out and named, as `selectDeclared` promises, and never causes a
  // `context-too-large` refusal.
  it("leaves out a reference the history has no room for, rather than refusing the turn", async () => {
    let call = 0;
    const budget = budgetFor(new ProgrammableModel().descriptor);
    const model = new ProgrammableModel(async function* () {
      call += 1;
      // The first answer is long: 30% of the input, under the history's
      // 40% share, so the second turn needs no compaction.
      yield {
        type: "text-delta",
        text:
          call === 1
            ? "a ".repeat(Math.floor(budget.totalCharacters * 0.15))
            : "Nothing to report.",
      };
      yield { type: "completed", reason: "answer" };
    });
    // The real estimator, so the size guard measures what is sent. Through
    // the port's type: the double's own `estimate` takes no request.
    const provider: ModelProvider = model;
    provider.estimate = async (request) => estimateRequestTokens(request);
    const { assistant, artifacts, sources } = setup({ model });
    withReferences(sources);
    sources.texts.set("reference:timeline", "1850.");
    // 40% of the input: the instructions and the tools' descriptions go on
    // every step and do not scale with this fixture, so each sentence added
    // to them moves the edge. The subject holds at any share: the reference
    // gives way, never the turn.
    sources.texts.set(
      "node:first",
      "s".repeat(Math.floor(budget.totalCharacters * 0.4)),
    );
    sources.texts.set(
      "reference:marta",
      "m".repeat(Math.floor(budget.totalCharacters * 0.2)),
    );
    const chat = await newChat(assistant, "editorial");
    await assistant.reviews.run("continuity", { kind: "current" });
    // Turn one fits: the Section and the sheet, and no history yet.
    expect(assistant.getSnapshot().errorCode).toBeNull();

    await assistant.send("And Marta?");
    expect(assistant.getSnapshot().errorCode).toBeNull();
    expect(model.requests).toHaveLength(2);
    const answer = lastTurn(must(artifacts.chats.get(chat.id)).turns);
    expect(answer.coverage?.skipped).toContainEqual({
      sourceId: "reference:marta",
      reason: "not-in-budget",
    });
  });

  // `/canon Marta` checks against the reference the writer named and the
  // Editing brief, and nothing else it would read. A name it cannot read
  // refuses, and is never widened into every reference.
  describe("a named reference", () => {
    const MARTA = ["reference:marta"];
    const named = "named for this review";

    it("checks a focused review against the name and the brief, and a later one without it against all", async () => {
      const model = quiet();
      const { assistant, artifacts, sources } = setup({ model });
      withReferences(sources);
      sources.texts.set("reference:timeline", "1850.");
      const chat = await newChat(assistant, "editorial");
      const reads = sources.reads.length;
      await assistant.reviews.run(
        "consistency",
        { kind: "current" },
        undefined,
        MARTA,
      );
      const request = must(model.requests[0]);
      const sent = last(request.messages)?.content ?? "";
      expect(sent).toContain(
        `--- REFERENCE reference:marta | Marta | characters | ${named} ---`,
      );
      expect(sent).toContain(
        "--- REFERENCE reference:brief | Editing brief | guidebook ---",
      );
      // The Timeline the task also reads is not read at all.
      expect(sources.reads.slice(reads)).not.toContain("reference:timeline");
      expect(request.instructions).toContain(NAMED_REFERENCE_CLAUSE);
      const stored = must(artifacts.chats.get(chat.id));
      expect(stored.preferences.reviewReferences).toEqual(MARTA);
      expect(
        lastTurn(stored.turns).sources?.map((use) => [use.id, use.reason]),
      ).toEqual(
        expect.arrayContaining([
          ["reference:marta", "named"],
          ["reference:brief", "declared"],
        ]),
      );

      // A follow-up in the same review still checks against the name.
      await assistant.send("And her hands?");
      expect(last(must(model.requests[1]).messages)?.content).toContain(named);

      // A review that names none clears it: every reference again.
      await assistant.reviews.run("consistency", { kind: "current" });
      const again = must(model.requests[2]);
      expect(last(again.messages)?.content).not.toContain(named);
      expect(last(again.messages)?.content).toContain("1850.");
      expect(again.instructions).not.toContain(NAMED_REFERENCE_CLAUSE);
      expect(
        must(artifacts.chats.get(chat.id)).preferences.reviewReferences,
      ).toBeUndefined();
    });

    it("refuses a name it cannot read now, before anything is written or sent", async () => {
      const model = quiet();
      const { assistant, artifacts, sources } = setup({ model });
      withReferences(sources);
      const chat = await newChat(assistant, "editorial");
      for (const [task, ids] of [
        // Gone since the name was typed.
        ["consistency", ["reference:gone"]],
        // A review whose command takes no name.
        ["continuity", MARTA],
      ] as const) {
        await assistant.reviews.run(task, { kind: "current" }, undefined, ids);
        expect(assistant.getSnapshot().problem).toEqual({
          kind: "review-reference-missing",
        });
      }
      expect(model.requests).toHaveLength(0);
      expect(
        must(artifacts.chats.get(chat.id)).preferences.reviewTask,
      ).toBeUndefined();
    });

    it("refuses a stored name that no longer reads, rather than checking against every reference", async () => {
      const model = quiet();
      const { assistant, sources } = setup({ model });
      withReferences(sources);
      await newChat(assistant, "editorial");
      await assistant.reviews.run(
        "consistency",
        { kind: "current" },
        undefined,
        MARTA,
      );
      // The sheet is deleted between turns.
      sources.descriptors = sources.descriptors.filter(
        (one) => one.id !== "reference:marta",
      );
      await assistant.send("And her hands?");
      expect(model.requests).toHaveLength(1);
      expect(assistant.getSnapshot().problem).toEqual({
        kind: "review-reference-missing",
      });
    });

    // A focused refusal from context assembly leaves neither the question
    // nor a failed turn behind, whose Try again would only refuse again,
    // and its raw kind never surfaces as the dock's error once the problem
    // clears. Nothing reached the model, so nothing is left.
    it("leaves no question behind a focused review its name has no room in, and says so once", async () => {
      const model = quiet();
      const { assistant, artifacts, sources } = setup({ model });
      withReferences(sources);
      const budget = budgetFor(model.descriptor);
      sources.texts.set("reference:marta", "m".repeat(budget.totalCharacters));
      const chat = await newChat(assistant, "editorial");
      const outcome = await assistant.reviews.run(
        "consistency",
        { kind: "current" },
        undefined,
        MARTA,
      );
      expect(outcome).toBe("rejected");
      expect(model.requests).toHaveLength(0);
      const snapshot = assistant.getSnapshot();
      expect(snapshot.problem).toEqual({
        kind: "review-reference-too-large-section",
        references: MARTA,
      });
      expect(snapshot.error).toBeNull();
      expect(snapshot.errorCode).toBeNull();
      const stored = must(artifacts.chats.get(chat.id));
      expect(stored.turns).toEqual([]);
      expect(stored.title).toBe(chat.title);
    });

    it("gives a follow-up back when its stored name no longer reads, keeping the review before it", async () => {
      const model = quiet();
      const { assistant, artifacts, sources } = setup({ model });
      withReferences(sources);
      const chat = await newChat(assistant, "editorial");
      await assistant.reviews.run(
        "consistency",
        { kind: "current" },
        undefined,
        MARTA,
      );
      const before = must(artifacts.chats.get(chat.id)).turns;
      sources.descriptors = sources.descriptors.filter(
        (one) => one.id !== "reference:marta",
      );
      expect(await assistant.send("And her hands?")).toBe("rejected");
      expect(must(artifacts.chats.get(chat.id)).turns).toEqual(before);
      expect(assistant.getSnapshot().error).toBeNull();
    });

    it("never publishes a wide refusal's kind as the dock's error", async () => {
      const model = quiet();
      const { assistant, sources } = setup({ model });
      withReferences(sources);
      const budget = budgetFor(model.descriptor);
      sources.texts.set("reference:marta", "m".repeat(budget.totalCharacters));
      await newChat(assistant, "editorial");
      expect(
        await assistant.reviews.run(
          "consistency",
          { kind: "structure" },
          undefined,
          MARTA,
        ),
      ).toBe("rejected");
      expect(assistant.getSnapshot().problem?.kind).toBe(
        "review-reference-too-large",
      );
      expect(assistant.getSnapshot().error).toBeNull();
    });

    // The refusal comes after the plan is written, so the plan is dropped
    // rather than kept as interrupted behind a Resume that could only
    // refuse again.
    it("keeps no plan, and offers no Resume, for a wide review its name refused", async () => {
      const model = quiet();
      const { assistant, artifacts, sources } = setup({ model });
      withReferences(sources);
      const budget = budgetFor(model.descriptor);
      sources.texts.set("reference:marta", "m".repeat(budget.totalCharacters));
      const chat = await newChat(assistant, "editorial");
      await assistant.reviews.run(
        "consistency",
        { kind: "structure" },
        undefined,
        MARTA,
      );
      expect(artifacts.reviews.size).toBe(0);
      expect(assistant.getSnapshot().pendingReview).toBeNull();
      expect(must(artifacts.chats.get(chat.id)).reviewRuns ?? []).toHaveLength(
        0,
      );
    });

    it("refuses a wide review whose name leaves no room for a Section, rather than yielding it", async () => {
      const model = quiet();
      const { assistant, sources } = setup({ model });
      withReferences(sources);
      const budget = budgetFor(model.descriptor);
      sources.texts.set("reference:marta", "m".repeat(budget.totalCharacters));
      await newChat(assistant, "editorial");
      await assistant.reviews.run(
        "consistency",
        { kind: "structure" },
        undefined,
        MARTA,
      );
      expect(model.requests).toHaveLength(0);
      expect(assistant.getSnapshot().problem).toEqual({
        kind: "review-reference-too-large",
        // The set, so the refusal can say which reference it was.
        references: MARTA,
      });
    });

    // The guard measures the shortest Section with prose in it. An empty
    // Section is 0 characters long, and measuring it would pass a set that
    // leaves the only prose in scope `too-large`.
    it("refuses a wide review whose name leaves no room for any Section with prose, even beside an empty one", async () => {
      const model = quiet();
      const { assistant, sources } = setup({ model });
      withReferences(sources);
      // What one reading step may carry in (`readingRoom`).
      const room =
        inputCharactersFor(
          limitsFor(model.descriptor, REVIEW_DIRECT_OUTPUT_TOKENS),
        ) - INSTRUCTION_RESERVE;
      sources.texts.set("node:first", "");
      sources.texts.set("node:future", "f".repeat(5_000));
      // Fits the room alone, and leaves under 5,000 characters beside it.
      sources.texts.set("reference:marta", "m".repeat(room - 3_000));
      await newChat(assistant, "editorial");
      await assistant.reviews.run(
        "consistency",
        { kind: "structure" },
        undefined,
        MARTA,
      );
      expect(model.requests).toHaveLength(0);
      expect(assistant.getSnapshot().problem).toEqual({
        kind: "review-reference-too-large",
        // The set, so the refusal can say which reference it was.
        references: MARTA,
      });
    });

    // `runReview` checks both that each id is one the task may read and that
    // the set is one the chat file may carry (`isReviewReferences`). A
    // repeated id, or a name standing for more than `REVIEW_REFERENCES_MAX`
    // documents, would otherwise be stored, and the codec would drop the
    // name and the scope on the next load.
    it("stores only a named set its own codec reads back", async () => {
      for (const ids of [
        [...MARTA, ...MARTA],
        Array.from(
          { length: REVIEW_REFERENCES_MAX + 1 },
          (_, i) => `reference:marta-${i}`,
        ),
      ]) {
        const model = quiet();
        const { assistant, artifacts, sources } = setup({ model });
        withReferences(sources);
        // One character written across many files of one title: the
        // name stands for every one of them (`referenceNames`).
        for (const id of ids.filter((one) => !MARTA.includes(one))) {
          sources.descriptors = [
            ...sources.descriptors,
            {
              id,
              kind: "reference",
              title: "Marta",
              path: `reference/character--${id.slice(10)}.md`,
              authority: "reference",
              group: "characters",
            },
          ];
          sources.texts.set(id, "Marta is left-handed.");
        }
        const chat = await newChat(assistant, "editorial");
        await assistant.reviews.run(
          "consistency",
          { kind: "current" },
          undefined,
          ids,
        );
        const stored = must(artifacts.chats.get(chat.id)).preferences
          .reviewReferences;
        expect(
          stored === undefined || isReviewReferences(stored),
          JSON.stringify(stored),
        ).toBe(true);
      }
    });

    // The brief is best-effort, and yields first. On the wide path its room
    // is what a step has left beside the named set and the shortest
    // Section, so a brief that does not fit there gives way and the set
    // runs, rather than the whole review being refused.
    it("lets the Editing brief yield, rather than refuse a named wide review it would not fit beside", async () => {
      const model = quiet();
      const { assistant, sources } = setup({ model });
      withReferences(sources);
      // What one reading step may carry in (`readingRoom`).
      const room =
        inputCharactersFor(
          limitsFor(model.descriptor, REVIEW_DIRECT_OUTPUT_TOKENS),
        ) - INSTRUCTION_RESERVE;
      sources.texts.set("node:first", "a".repeat(5_000));
      sources.texts.set("node:future", "f".repeat(5_000));
      // The set leaves ~10,700 characters beside it: room for a Section
      // and the clause that says how to read the references (a
      // few thousand characters), and not for those and a 4,000-character
      // brief.
      sources.texts.set("reference:marta", "m".repeat(room - 11_000));
      sources.texts.set("reference:brief", "b".repeat(4_000));
      await newChat(assistant, "editorial");
      await assistant.reviews.run(
        "consistency",
        { kind: "structure" },
        undefined,
        MARTA,
      );
      expect(assistant.getSnapshot().problem).toBeNull();
      expect(model.requests.length).toBeGreaterThan(0);
      const content = last(must(model.requests[0]).messages)?.content;
      expect(content).toContain("named for this review");
      // The brief yields, so the case under test happens.
      expect(content).not.toContain("b".repeat(100));
      expect(must(model.requests[0]).instructions).toContain(
        "HOW TO USE THE WRITER'S REFERENCES.",
      );
    });

    // A named-reference refusal finds nothing written and nothing started:
    // `onStarted` fires only once the question is on disk and the run is
    // live, so `rewindAndAsk` puts back the turns it cut. A retry keeps the
    // question and its failed answer, an edit never resolves "started" over
    // a chat cut short, and a refused send leaves an edit's Undo standing.
    it("keeps the question a retry was refused over its named reference for", async () => {
      const model = new ProgrammableModel(async function* (
        _request,
        _signal,
        call,
      ) {
        if (call === 2) {
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
        yield { type: "text-delta", text: "Nothing to report." };
        yield { type: "completed", reason: "answer" };
      });
      const { assistant, artifacts, sources } = setup({ model });
      withReferences(sources);
      const chat = await newChat(assistant, "editorial");
      await assistant.reviews.run(
        "consistency",
        { kind: "current" },
        undefined,
        MARTA,
      );
      await assistant.send("And her hands?");
      const before = must(artifacts.chats.get(chat.id)).turns;
      const failed = lastTurn(before);
      expect(failed.outcome).toBe("failed");
      sources.descriptors = sources.descriptors.filter(
        (one) => one.id !== "reference:marta",
      );
      expect(await assistant.edits.retry(failed.id)).toBe("rejected");
      expect(must(artifacts.chats.get(chat.id)).turns).toEqual(before);
    });

    it("refuses an edit its named reference refuses, leaving the chat as it was", async () => {
      const model = quiet();
      const { assistant, artifacts, sources } = setup({ model });
      withReferences(sources);
      const chat = await newChat(assistant, "editorial");
      await assistant.reviews.run(
        "consistency",
        { kind: "current" },
        undefined,
        MARTA,
      );
      await assistant.send("And her hands?");
      const before = must(artifacts.chats.get(chat.id)).turns;
      const asked = must(before.find((one) => one.text === "And her hands?"));
      sources.descriptors = sources.descriptors.filter(
        (one) => one.id !== "reference:marta",
      );
      const outcome = await assistant.edits.edit(asked.id, "And her eyes?");
      await vi.waitFor(() =>
        expect(assistant.getSnapshot().running).toBe(false),
      );
      expect(must(artifacts.chats.get(chat.id)).turns).toEqual(before);
      // Rejected, so the bubble keeps the edit open with the new words.
      expect(outcome).toBe("rejected");
    });

    it("leaves an edit's Undo standing when the next send is refused over its named reference", async () => {
      const model = quiet();
      const { assistant, artifacts, sources } = setup({ model });
      withReferences(sources);
      const chat = await newChat(assistant, "editorial");
      await assistant.reviews.run(
        "consistency",
        { kind: "current" },
        undefined,
        MARTA,
      );
      await assistant.send("And her hands?");
      const asked = must(
        must(artifacts.chats.get(chat.id)).turns.find(
          (one) => one.text === "And her hands?",
        ),
      );
      expect(await assistant.edits.edit(asked.id, "And her eyes?")).toBe(
        "started",
      );
      await vi.waitFor(() =>
        expect(assistant.getSnapshot().running).toBe(false),
      );
      sources.descriptors = sources.descriptors.filter(
        (one) => one.id !== "reference:marta",
      );
      expect(await assistant.send("And her feet?")).toBe("rejected");
      expect(await assistant.edits.undo()).toBe(true);
    });

    // A queued question is out of the composer the moment it is queued.
    // When it drains and its named reference refuses it, the rollback must
    // not erase it, because nothing else holds the writer's words.
    it("never erases a queued question its named reference refuses when it drains", async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const model = new ProgrammableModel(async function* (
        _request,
        _signal,
        call,
      ) {
        if (call === 2) await gate;
        yield { type: "text-delta", text: "Nothing to report." };
        yield { type: "completed", reason: "answer" };
      });
      const { assistant, artifacts, sources } = setup({ model });
      withReferences(sources);
      const chat = await newChat(assistant, "editorial");
      await assistant.reviews.run(
        "consistency",
        { kind: "current" },
        undefined,
        MARTA,
      );
      const first = assistant.send("And her hands?");
      await vi.waitFor(() => expect(model.requests).toHaveLength(2));
      expect(await assistant.send("And her eyes?")).toBe("queued");
      // The sheet goes while the first answer is still coming.
      sources.descriptors = sources.descriptors.filter(
        (one) => one.id !== "reference:marta",
      );
      release();
      await first;
      await vi.waitFor(() =>
        expect(assistant.getSnapshot().problem?.kind).toBe(
          "review-reference-missing",
        ),
      );
      await vi.waitFor(() =>
        expect(assistant.getSnapshot().running).toBe(false),
      );
      // Held somewhere the writer can reach: in the transcript, or given
      // back through the snapshot. This row accepts either.
      const held =
        JSON.stringify(artifacts.chats.get(chat.id)) +
        JSON.stringify(assistant.getSnapshot());
      expect(held).toContain("And her eyes?");
    });

    // `runReview` writes the chat's review preferences (task, scope, the
    // named set) before the focused `send`, so a refusal restores them as
    // well as the turns. Otherwise a refused `/canon Marta` would leave the
    // chat a `/canon Marta` review it never ran, and every later question
    // in it would be refused the same way.
    it("leaves the chat's review as it was when a review is refused over its name", async () => {
      const model = quiet();
      const { assistant, artifacts, sources } = setup({ model });
      withReferences(sources);
      const chat = await newChat(assistant, "editorial");
      await assistant.reviews.run("continuity", { kind: "current" });
      const before = must(artifacts.chats.get(chat.id)).preferences;
      sources.texts.set(
        "reference:marta",
        "m".repeat(budgetFor(model.descriptor).totalCharacters),
      );
      expect(
        await assistant.reviews.run(
          "consistency",
          { kind: "current" },
          undefined,
          MARTA,
        ),
      ).toBe("rejected");
      expect(must(artifacts.chats.get(chat.id)).preferences).toEqual(before);
      // The next question is the continuity follow-up it was.
      expect(await assistant.send("And the ferry?")).toBe("started");
    });

    // Two guards a planted chat file meets; each row fails without its guard.
    it("reads a stored name only for a task whose command takes one", async () => {
      const model = quiet();
      const { assistant, sources } = setup({ model });
      withReferences(sources);
      sources.texts.set("reference:timeline", "1850.");
      await newChat(assistant, "editorial");
      // No command writes this; a chat file can.
      await assistant.chats.updatePreferences({
        reviewTask: "continuity",
        reviewScope: { kind: "current" },
        reviewReferences: MARTA,
      });
      await assistant.send("Anything off?");
      const sent = last(must(model.requests[0]).messages)?.content ?? "";
      expect(sent).not.toContain(named);
      // Read as the task reads: every declared reference.
      expect(sent).toContain("1850.");
    });

    it("refuses to resume a plan that names a reference for a task that takes none", async () => {
      const model = quiet();
      const { assistant, artifacts, sources } = setup({ model });
      withReferences(sources);
      await newChat(assistant, "editorial");
      await assistant.reviews.run("continuity", { kind: "structure" });
      const plan = must([...artifacts.reviews.values()][0]);
      // The memory store is not the codec: this reaches the engine.
      artifacts.reviews.set(plan.runId, {
        ...plan,
        state: "interrupted",
        ...(plan.method === "sections" ? { references: MARTA } : {}),
      });
      const asked = model.requests.length;
      await assistant.reviews.resume(plan.runId);
      expect(model.requests).toHaveLength(asked);
      expect(assistant.getSnapshot().problem).toEqual({
        kind: "review-reference-missing",
      });
    });

    it("drops a plan its named reference refuses on resume, rather than offering it again", async () => {
      const model = quiet();
      const { assistant, artifacts, sources } = setup({ model });
      withReferences(sources);
      const chat = await newChat(assistant, "editorial");
      await assistant.reviews.run(
        "consistency",
        { kind: "structure" },
        undefined,
        MARTA,
      );
      const plan = must([...artifacts.reviews.values()][0]);
      artifacts.reviews.set(plan.runId, { ...plan, state: "interrupted" });
      sources.descriptors = sources.descriptors.filter(
        (one) => one.id !== "reference:marta",
      );

      await assistant.reviews.resume(plan.runId);
      expect(assistant.getSnapshot().problem).toEqual({
        kind: "review-reference-missing",
      });
      expect(artifacts.reviews.has(plan.runId)).toBe(false);
      expect(assistant.getSnapshot().pendingReview).toBeNull();
      expect(
        must(artifacts.chats.get(chat.id)).reviewRuns?.map((run) => run.runId),
      ).not.toContain(plan.runId);
    });

    it("carries the name through a wide plan and its answer", async () => {
      const model = quiet();
      const { assistant, artifacts, sources } = setup({ model });
      withReferences(sources);
      // Short enough to be attached if the name were ignored.
      sources.texts.set("reference:timeline", "1850.");
      const chat = await newChat(assistant, "editorial");
      await assistant.reviews.run(
        "consistency",
        { kind: "structure" },
        undefined,
        MARTA,
      );
      const review = must([...artifacts.reviews.values()][0]);
      expect(review).toMatchObject({
        method: "sections",
        references: MARTA,
      });
      const step = must(model.requests[0]);
      expect(step.instructions).toContain(NAMED_REFERENCE_CLAUSE);
      expect(last(step.messages)?.content).toContain(named);
      expect(last(step.messages)?.content).not.toContain("1850.");
      const stored = must(artifacts.chats.get(chat.id));
      const answer = lastTurn(stored.turns);
      expect(answer.review?.references).toEqual(MARTA);
      // A wide review writes no focused name on the chat. The chat file
      // keeps both names, which `chatCodec.test.ts` pins.
      expect(stored.preferences.reviewReferences).toBeUndefined();
    });
  });

  describe("the part scope", () => {
    // "One" holds First and Future; Coda sits at the top of the Structure.
    const withParts = (sources: MemorySources) => {
      sources.descriptors = [
        {
          id: "node:one",
          kind: "manuscript",
          title: "One",
          path: "document/one.md",
          nodeId: "one",
          nodeKind: "part",
          order: 0,
          authority: "manuscript",
        },
        ...SOURCES.map((one) =>
          one.kind === "manuscript" ? { ...one, partId: "one" } : one,
        ),
        {
          id: "node:coda",
          kind: "manuscript",
          title: "Coda",
          path: "document/coda.md",
          nodeId: "coda",
          nodeKind: "section",
          order: 5,
          authority: "manuscript",
        },
      ];
      sources.texts.set("node:one", "# One");
      sources.texts.set("node:coda", "CODA: the harbour, years later.");
    };

    it("reads every Section of the open Section's Part together, and plans the Part by name", async () => {
      const model = quiet();
      const { assistant, artifacts, sources } = setup({ model });
      withParts(sources);
      const chat = await newChat(assistant, "editorial");
      // A focused review first: the wide one must clear it.
      await assistant.chats.updatePreferences({
        reviewScope: { kind: "current" },
      });
      await assistant.reviews.run("continuity", { kind: "part" });

      const plan = must([...artifacts.reviews.values()][0]);
      // Planned as the Part it resolved to, so a resume reads that Part
      // whichever Section is open by then.
      expect(plan.scope).toEqual({ kind: "node", nodeId: "one" });
      expect(plan.sources.map((one) => one.sourceId)).toEqual([
        "node:first",
        "node:future",
      ]);
      expect(sources.reads).not.toContain("node:coda");
      expect(sources.reads).not.toContain("node:one");
      const saved = must(artifacts.chats.get(chat.id));
      // The turn records the Part the plan read, not the word typed,
      // because review-again reads it and must not review whichever Part is
      // open at the click. The chat's next question is an ordinary one.
      expect(last(saved.turns)?.review?.scope).toEqual({
        kind: "node",
        nodeId: "one",
      });
      expect(saved.preferences.reviewScope).toBeUndefined();
    });

    it("refuses a Section in no Part, offering the next word up the command has", async () => {
      const model = quiet();
      const { assistant, artifacts, sources } = setup({
        model,
        defaultNode: () => ({ id: "coda", title: "Coda", kind: "section" }),
      });
      withParts(sources);
      await newChat(assistant, "editorial");
      await assistant.reviews.run("continuity", { kind: "part" });
      expect(assistant.getSnapshot().problem).toEqual({
        kind: "review-no-part",
      });
      // `/line-editing` offers no `structure` to go up to.
      await assistant.reviews.run("line", { kind: "part" });
      expect(assistant.getSnapshot().problem).toEqual({
        kind: "review-no-part-no-structure",
      });
      expect(model.requests).toHaveLength(0);
      expect(artifacts.reviews.size).toBe(0);
    });

    it("reads a Part named by its title as the whole Part, not its heading", async () => {
      const model = quiet();
      const { assistant, artifacts, sources } = setup({
        model,
        defaultNode: () => ({ id: "coda", title: "Coda", kind: "section" }),
      });
      withParts(sources);
      await newChat(assistant, "editorial");
      await assistant.reviews.run("continuity", {
        kind: "node",
        nodeId: "one",
      });
      const plan = must([...artifacts.reviews.values()][0]);
      expect(plan.sources.map((one) => one.sourceId)).toEqual([
        "node:first",
        "node:future",
      ]);
    });

    it("sweeps a Part's Sections for line editing, and nothing outside it", async () => {
      const model = quiet();
      const { assistant, artifacts, sources } = setup({ model });
      withParts(sources);
      await newChat(assistant, "editorial");
      await assistant.reviews.run("line", { kind: "part" });
      const plan = must([...artifacts.reviews.values()][0]);
      expect(plan.method).toBe("segments");
      expect(plan.sources.map((one) => one.sourceId)).toEqual([
        "node:first",
        "node:future",
      ]);
      expect(sources.reads).not.toContain("node:coda");
    });

    it("resumes a Part's plan within the Part, whatever the plan file names", async () => {
      let fail = true;
      const model = new ProgrammableModel(async function* () {
        if (fail) {
          yield {
            type: "failed",
            error: { code: "timeout", message: "Timed out", retryable: true },
          };
          return;
        }
        yield { type: "completed", reason: "answer" };
      });
      const { assistant, artifacts, sources } = setup({ model });
      withParts(sources);
      await newChat(assistant, "editorial");
      await assistant.reviews.run("continuity", { kind: "part" });
      const pending = must(assistant.getSnapshot().pendingReview);
      // Someone adds Coda to the plan in the shared folder.
      const plan = must(artifacts.reviews.get(pending.runId));
      artifacts.reviews.set(pending.runId, {
        ...plan,
        sources: [...plan.sources, { sourceId: "node:coda", state: "pending" }],
      });
      sources.reads = [];
      fail = false;
      await assistant.reviews.resume(pending.runId);
      expect(sources.reads).not.toContain("node:coda");
      const done = must(artifacts.reviews.get(pending.runId));
      expect(
        done.sources.find((one) => one.sourceId === "node:coda")?.state,
      ).toBe("failed");
    });

    it("starts no wide review from a reader chat (security condition 6)", async () => {
      const model = quiet();
      const { assistant, artifacts, sources } = setup({ model });
      withParts(sources);
      await newChat(assistant, "alpha-reader");
      sources.reads = [];
      await assistant.reviews.run("continuity", { kind: "part" });
      await assistant.reviews.run("continuity", {
        kind: "node",
        nodeId: "one",
      });
      await assistant.reviews.run("continuity", { kind: "structure" });
      expect(model.requests).toHaveLength(0);
      expect(artifacts.reviews.size).toBe(0);
      expect(sources.reads).toEqual([]);
    });

    it("never takes a planted wide scope in the chat for a focused review", async () => {
      const model = quiet();
      const { assistant } = setup({ model });
      await newChat(assistant, "editorial");
      await assistant.chats.updatePreferences({
        reviewTask: "continuity",
        reviewScope: { kind: "part" },
      });
      await assistant.send("What happens to the lantern?");
      expect(model.requests[0]?.tools.map((tool) => tool.name)).not.toContain(
        "submit_findings",
      );
    });

    it("refuses a Part with no Section in it rather than reporting a completed review", async () => {
      // A Part the writer has just made, with nothing in it yet.
      const model = quiet();
      const { assistant, artifacts, sources } = setup({
        model,
        defaultNode: () => ({ id: "two", title: "Two", kind: "part" }),
      });
      withParts(sources);
      sources.descriptors = [
        ...sources.descriptors,
        {
          id: "node:two",
          kind: "manuscript",
          title: "Two",
          path: "document/two.md",
          nodeId: "two",
          nodeKind: "part",
          order: 6,
          authority: "manuscript",
        },
      ];
      sources.texts.set("node:two", "# Two");
      const chat = await newChat(assistant, "editorial");
      await assistant.reviews.run("continuity", { kind: "part" });
      // Nothing was read, so nothing may say "the completed review" found
      // no issues: the run refuses, the way a Section in no Part does.
      const saved = must(artifacts.chats.get(chat.id));
      expect(saved.turns.some((turn) => turn.review !== undefined)).toBe(false);
      expect(artifacts.reviews.size).toBe(0);
      expect(assistant.getSnapshot().problem).not.toBeNull();
    });

    it("refuses to resume a Part's plan once the plan's Part is gone", async () => {
      let fail = true;
      const model = new ProgrammableModel(async function* () {
        if (fail) {
          yield {
            type: "failed",
            error: { code: "timeout", message: "Timed out", retryable: true },
          };
          return;
        }
        yield { type: "completed", reason: "answer" };
      });
      const { assistant, artifacts, sources } = setup({ model });
      withParts(sources);
      const chat = await newChat(assistant, "editorial");
      await assistant.reviews.run("continuity", { kind: "part" });
      const pending = must(assistant.getSnapshot().pendingReview);
      // The writer dissolves the Part: its Sections move to the top.
      sources.descriptors = sources.descriptors
        .filter((one) => one.id !== "node:one")
        .map((one) => ({ ...one, partId: undefined }));
      fail = false;
      await assistant.reviews.resume(pending.runId);
      // The same refusal a fresh run of a vanished node gets, because a
      // Part named by `node` is re-checked at run time; never a "completed
      // review" over no Section at all.
      expect(assistant.getSnapshot().problem).toEqual({
        kind: "review-node-missing",
      });
      const saved = must(artifacts.chats.get(chat.id));
      expect(saved.turns.some((turn) => turn.review !== undefined)).toBe(false);
    });
  });
});

describe("completeReview", () => {
  const STAMP = "2026-09-25T00:00:00.000Z";
  const PART_ONE: SourceDescriptor = {
    id: "node:one",
    kind: "manuscript",
    title: "One",
    path: "document/one.md",
    nodeId: "one",
    nodeKind: "part",
    order: 0,
    authority: "manuscript",
  };
  const CODA: SourceDescriptor = {
    id: "node:coda",
    kind: "manuscript",
    title: "Coda",
    path: "document/coda.md",
    nodeId: "coda",
    nodeKind: "section",
    order: 5,
    authority: "manuscript",
  };

  /**
   * An editorial chat holding a wide review's answer that could not see the
   * `unmapped` Sections, the finding on the lantern already dismissed by the
   * writer — and a model that writes summaries as text and, asked to
   * review, finds the lantern again. A summary it writes joins the
   * catalogue, as the project adapter lists it.
   */
  async function answered(
    unmapped: string[],
    options: {
      scope?: ReviewScope;
      after?: boolean;
      harness?: ReturnType<typeof setup>;
      /** Rows `unsummarisable`, and the answer on the chat's model. */
      blocked?: boolean;
    } = {},
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
    model.generator = async function* (request) {
      if (!mayCall(request)) {
        yield { type: "text-delta", text: "A summary." };
        yield { type: "completed", reason: "answer" };
        return;
      }
      yield {
        type: "tool-call-ready",
        call: {
          id: "findings",
          name: "submit_findings",
          arguments: {
            findings: [
              {
                title: "The lantern again",
                explanation: "Worded differently this time.",
                severity: "minor",
                evidence: [
                  { sourceId: "node:first", quote: "lantern goes dark" },
                ],
              },
            ],
          },
        },
      };
      yield { type: "completed", reason: "tools" };
    };
    const chat = await newChat(assistant, "editorial");
    const stored = must(artifacts.chats.get(chat.id));
    const turns: ChatTurn[] = [
      {
        id: "answer",
        runId: "run-old",
        role: "assistant",
        text: "Completed the continuity review with 1 finding.",
        createdAt: STAMP,
        outcome: "complete",
        findings: [
          {
            id: "old",
            severity: "minor",
            title: "Lantern",
            explanation: "",
            evidence: [{ sourceId: "node:first", quote: "lantern goes dark" }],
            status: "dismissed",
          },
        ],
        coverage: {
          intended: 2,
          inspected: 2 - unmapped.length,
          skipped: unmapped.map((sourceId) => ({
            sourceId,
            reason: options.blocked
              ? ("unsummarisable" as const)
              : ("unmapped" as const),
          })),
          complete: unmapped.length === 0,
        },
        ...(options.blocked && stored.preferences.model
          ? { model: stored.preferences.model }
          : {}),
        review: {
          runId: "run-old",
          task: "continuity",
          scope: options.scope ?? { kind: "structure" },
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

  it("summarises only the live Sections in reach the answer could not see, then reviews again in its place", async () => {
    const { assistant, artifacts, chat } = await answered(
      // A forged id and a reference id are requests from a chat file, and
      // summarise nothing.
      ["node:first", "node:gone", "reference:world.md"],
      { after: true },
    );
    const seen: Array<string | undefined> = [];
    assistant.subscribe(() => {
      seen.push(assistant.getSnapshot().runProgress?.work);
    });
    await assistant.reviews.complete("run-old");

    expect([...artifacts.summaries.keys()]).toEqual(["first"]);
    expect(seen).toContain("summarise");
    const turns = turnsOf(assistant, chat.id);
    expect(turns.map((turn) => turn.id)).toEqual([expect.any(String), "later"]);
    expect(turns.some((turn) => turn.runId === "run-old")).toBe(false);
    const answer = must(turns[0]);
    expect(answer.review).toEqual({
      runId: answer.runId,
      task: "continuity",
      scope: { kind: "structure" },
    });
    // The writer dismissed the lantern; the new review found it again on the
    // same evidence, so it arrives dismissed.
    expect(answer.findings?.map((one) => [one.title, one.status])).toEqual([
      ["The lantern again", "dismissed"],
    ]);
    expect(assistant.getSnapshot().error).toBeNull();
    expect(assistant.getSnapshot().running).toBe(false);
  });

  // As with `/where`, a review answer that records a Section
  // the chat's model could not summarise never sends it again on that model.
  // This fixture's review fits one window and never
  // routes by summaries, so `markUnsummarisable` pins the relabelling.
  it("never sends a Section the model could not summarise again on the same model", async () => {
    const { assistant, model, sources } = await answered(["node:first"], {
      blocked: true,
    });
    const first = must(sources.texts.get("node:first"));
    let tried = 0;
    const provider: ModelProvider = model;
    provider.estimate = async (request) => {
      if (
        !mayCall(request) &&
        request.messages.some((one) => one.content === first)
      )
        tried += 1;
      return { tokens: 20, exact: false };
    };
    await assistant.reviews.complete("run-old");
    expect(tried).toBe(0);
  });

  it("reviews again with no summary to write when the answer only came before them", async () => {
    const harness = setup();
    harness.sources.descriptors = [...SOURCES, SUMMARY];
    const { assistant, artifacts, model, chat } = await answered(
      ["node:first"],
      { harness },
    );
    await assistant.reviews.complete("run-old");
    expect(artifacts.summaries.size).toBe(0);
    expect(model.requests.every((one) => mayCall(one))).toBe(true);
    expect(turnsOf(assistant, chat.id)[0]?.runId).not.toBe("run-old");
  });

  it("reviews the Part the plan read, not the one open at the click", async () => {
    const harness = setup({
      defaultNode: () => ({ id: "coda", title: "Coda", kind: "section" }),
    });
    harness.sources.descriptors = [
      PART_ONE,
      ...SOURCES.map((one) =>
        one.kind === "manuscript" ? { ...one, partId: "one" } : one,
      ),
      CODA,
    ];
    harness.sources.texts.set("node:one", "# One");
    harness.sources.texts.set("node:coda", "CODA: the harbour, years later.");
    // Rows a chat file could plant: the Part's own heading file (in the
    // chat's boundary, not in the reach) and a Section outside the Part.
    const { assistant, artifacts, sources } = await answered(
      ["node:first", "node:one", "node:coda"],
      { scope: { kind: "node", nodeId: "one" }, harness },
    );
    await assistant.reviews.complete("run-old");
    expect([...artifacts.summaries.keys()]).toEqual(["first"]);
    const plan = must([...artifacts.reviews.values()][0]);
    expect(plan.scope).toEqual({ kind: "node", nodeId: "one" });
    expect(plan.sources.map((one) => one.sourceId)).toEqual([
      "node:first",
      "node:future",
    ]);
    expect(sources.reads).not.toContain("node:coda");
  });

  it("refuses before a single summary when the plan's Part is gone", async () => {
    const { assistant, artifacts, model } = await answered(["node:first"], {
      scope: { kind: "node", nodeId: "one" },
    });
    await assistant.reviews.complete("run-old");
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "review-node-missing",
    });
    expect(model.requests).toHaveLength(0);
    expect(artifacts.summaries.size).toBe(0);
    expect(artifacts.reviews.size).toBe(0);
  });

  it("does nothing for a focused answer, or a run that is not a review in this chat", async () => {
    const { assistant, artifacts, model } = await answered(["node:first"], {
      scope: { kind: "current" },
    });
    await assistant.reviews.complete("run-old");
    await assistant.reviews.complete("run-nowhere");
    expect(model.requests).toHaveLength(0);
    expect(artifacts.summaries.size).toBe(0);
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
    await assistant.reviews.complete("run-old");
    expect([...artifacts.summaries.keys()]).toEqual(["first"]);
    expect(assistant.getSnapshot().errorCode).toBe("cancelled");
    expect(turnsOf(assistant, chat.id).map((turn) => turn.id)).toEqual([
      "answer",
    ]);
    expect(artifacts.reviews.size).toBe(0);
  });

  it("reviews again in the answer's own chat when the writer switches chats during the summaries", async () => {
    const { assistant, artifacts, model, chat } = await answered([
      "node:first",
    ]);
    // A second chat, and the answer's chat active again: the click is made
    // there, and the writer moves on while the summaries run (minutes each
    // on a local model).
    const other = await newChat(assistant, "editorial");
    assistant.selectChat(chat.id);
    const review = model.generator;
    model.generator = async function* (request, signal, count) {
      if (!mayCall(request)) assistant.selectChat(other.id);
      yield* review(request, signal, count);
    };
    await assistant.reviews.complete("run-old");

    // The re-review belongs to the chat whose answer it replaces, never to
    // whichever chat is active when the summaries end. Read from the active
    // chat, the plan and the answer would land in `other` with its persona
    // and model, and a reader chat there would get the editorial review's
    // refusal copy.
    expect([...artifacts.reviews.values()].map((one) => one.chatId)).toEqual([
      chat.id,
    ]);
    expect(must(artifacts.chats.get(other.id)).turns).toEqual([]);
    const turns = turnsOf(assistant, chat.id);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.runId).not.toBe("run-old");
    expect(turns[0]?.review?.task).toBe("continuity");
  });

  it("a review-again stopped mid-review and then resumed still replaces the answer it was started from", async () => {
    const { assistant, model, chat } = await answered(["node:first"]);
    const review = model.generator;
    let stopped = false;
    model.generator = async function* (request, signal, count) {
      // Stop once, in the review itself — after the summaries are written.
      if (mayCall(request) && !stopped) {
        stopped = true;
        assistant.stop();
        yield {
          type: "failed",
          error: { code: "cancelled", message: "Stopped", retryable: false },
        };
        return;
      }
      yield* review(request, signal, count);
    };
    await assistant.reviews.complete("run-old");
    const pending = must(assistant.getSnapshot().pendingReview);
    // The Resume on offer is the review-again's own plan.
    expect(pending.runId).not.toBe("run-old");
    await assistant.reviews.resume(pending.runId);

    // Resuming finishes the click that was stopped: the answer it was started
    // from is replaced where it stood, and its verdicts come with it. One
    // review never has two answers with the old one still offering its button,
    // and the lantern the writer dismissed arrives dismissed.
    const turns = turnsOf(assistant, chat.id);
    expect(turns.map((turn) => turn.runId)).toEqual([pending.runId]);
    expect(turns[0]?.findings?.map((one) => one.status)).toEqual(["dismissed"]);
  });

  it("starts nothing for a task and scope its command does not offer, whatever the chat file says", async () => {
    const { assistant, artifacts, model, chat } = await answered([
      "node:first",
    ]);
    // A shared folder's chat file can pair a real task with a real scope that
    // the task's command never offers: `/line-editing` has no `structure`
    // (`60-line-editing.md`), and it never maps, so a summary is no use to it.
    const stored = must(artifacts.chats.get(chat.id));
    artifacts.chats.set(chat.id, {
      ...stored,
      turns: stored.turns.map((turn) =>
        turn.review
          ? { ...turn, review: { ...turn.review, task: "line" as const } }
          : turn,
      ),
    });
    await assistant.initialize();
    await assistant.reviews.complete("run-old");
    // Nothing goes to the model: `first` is not summarised, and no
    // whole-Structure line sweep is planned or run.
    expect(artifacts.summaries.size).toBe(0);
    expect(artifacts.reviews.size).toBe(0);
    expect(model.requests).toHaveLength(0);
  });

  it("refuses a Part dissolved while its summaries were written", async () => {
    const harness = setup();
    harness.sources.descriptors = [
      PART_ONE,
      ...SOURCES.map((one) =>
        one.kind === "manuscript" ? { ...one, partId: "one" } : one,
      ),
    ];
    harness.sources.texts.set("node:one", "# One");
    const { assistant, artifacts, model, sources } = await answered(
      ["node:first"],
      { scope: { kind: "node", nodeId: "one" }, harness },
    );
    const summarise = model.generator;
    model.generator = async function* (request, signal, count) {
      // The writer dissolves the Part while the summary is written.
      if (!mayCall(request))
        sources.descriptors = SOURCES.map((one) => ({ ...one }));
      yield* summarise(request, signal, count);
    };
    await assistant.reviews.complete("run-old");
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "review-node-missing",
    });
    expect(artifacts.reviews.size).toBe(0);
    expect(assistant.getSnapshot().running).toBe(false);
  });

  it("replaces only a review answer, whatever a plan file names", async () => {
    // A resumable plan whose `replaces` a shared folder pointed at a
    // question: the resumed answer is added, and the question stays.
    let fail = true;
    const model = new ProgrammableModel(async function* () {
      if (fail) {
        yield {
          type: "failed",
          error: { code: "timeout", message: "Timed out", retryable: true },
        };
        return;
      }
      yield { type: "completed", reason: "answer" };
    });
    const { assistant, artifacts } = setup({ model });
    const chat = await newChat(assistant, "editorial");
    await assistant.reviews.run("continuity", { kind: "structure" });
    const pending = must(assistant.getSnapshot().pendingReview);
    const stored = must(artifacts.chats.get(chat.id));
    const question: ChatTurn = {
      id: "asked",
      runId: "run-question",
      role: "user",
      text: "What happens to the lantern?",
      createdAt: STAMP,
      outcome: "complete",
    };
    artifacts.chats.set(chat.id, { ...stored, turns: [question] });
    const plan = must(artifacts.reviews.get(pending.runId));
    artifacts.reviews.set(pending.runId, { ...plan, replaces: "run-question" });
    await assistant.initialize();
    fail = false;
    await assistant.reviews.resume(pending.runId);
    const turns = must(
      assistant.getSnapshot().chats.find((one) => one.id === chat.id),
    ).turns;
    // The question stays; the review's own command line and answer follow.
    expect(turns.map((turn) => turn.id)).toEqual([
      "asked",
      expect.any(String),
      expect.any(String),
    ]);
    expect(turns[1]).toMatchObject({
      role: "user",
      runId: pending.runId,
      command: { skill: "continuity" },
    });
    expect(turns[2]?.runId).toBe(pending.runId);
  });

  it("starts nothing from a reader chat, whatever its file says", async () => {
    const { assistant, artifacts, model, chat } = await answered([
      "node:first",
    ]);
    const stored = must(artifacts.chats.get(chat.id));
    artifacts.chats.set(chat.id, { ...stored, kind: "alpha-reader" });
    await assistant.initialize();
    await assistant.reviews.complete("run-old");
    expect(model.requests).toHaveLength(0);
    expect(artifacts.summaries.size).toBe(0);
  });
});
