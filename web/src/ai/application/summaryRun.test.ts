// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { ModelRequest, SourceDescriptor } from "../domain/types";
import { summariseSkill } from "../domain/skills";
import { PART_CLAUSE } from "./summarisePart";
import { ModelRunError } from "./runStep";
import {
  SOURCES,
  ProgrammableModel,
  must,
  newChat,
  setup,
} from "./assistant.fixture";

describe("runSummarise", () => {
  const PART: SourceDescriptor = {
    id: "node:one",
    kind: "manuscript",
    title: "Part One",
    path: "document/one.md",
    nodeId: "one",
    nodeKind: "part",
    order: 0,
    authority: "manuscript",
  };
  const summaryOf = (
    nodeId: string,
    freshness: SourceDescriptor["freshness"] = "current",
  ): SourceDescriptor => ({
    id: `reference:summary--${nodeId}.md`,
    kind: "summary",
    title: nodeId,
    path: `reference/summary--${nodeId}.md`,
    summarises: nodeId,
    authority: "derived",
    freshness,
  });
  const ACCOUNT = "The lamp fails, and then the theft.";

  /**
   * One Part holding both Sections: `first` summarised, `future` not. The
   * listing shows a summary once one is written, as the project adapter
   * lists it; the model writes a summary as text, and the Part's account
   * when it is asked by the Part clause.
   */
  function summarising(options: { parts?: boolean; summary?: string } = {}) {
    const harness = setup();
    const { sources, model, artifacts } = harness;
    const [first, future, world] = SOURCES;
    sources.descriptors =
      options.parts === false
        ? [first, future, world, summaryOf("first")]
        : [
            PART,
            { ...first, partId: "one", order: 1 },
            { ...future, partId: "one", order: 2 },
            world,
            summaryOf("first"),
          ];
    sources.texts.set("reference:summary--first.md", "A lamp fails.");
    sources.list = async () => {
      sources.lists += 1;
      const written = [...artifacts.summaries.entries()];
      for (const [nodeId, record] of written)
        sources.texts.set(`reference:summary--${nodeId}.md`, record.body);
      return [
        ...sources.descriptors.filter(
          (one) =>
            !(
              one.kind === "summary" &&
              artifacts.summaries.has(one.summarises ?? "")
            ),
        ),
        ...written.map(([nodeId]) => summaryOf(nodeId)),
      ];
    };
    model.generator = async function* (request) {
      const composing = request.instructions.includes(PART_CLAUSE);
      const text = composing ? ACCOUNT : (options.summary ?? "A theft.");
      if (text) yield { type: "text-delta", text };
      yield { type: "usage", inputTokens: 4, outputTokens: 3, durationMs: 2 };
      yield { type: "completed", reason: "answer" };
    };
    return harness;
  }

  const composed = (model: ProgrammableModel) =>
    model.requests.filter((one) => one.instructions.includes(PART_CLAUSE));

  it("writes the missing summary, then composes one account of the Part", async () => {
    const { assistant, artifacts, model } = summarising();
    const chat = await newChat(assistant, "editorial");
    const works: string[] = [];
    assistant.subscribe(() => {
      const progress = assistant.getSnapshot().runProgress;
      if (progress) works.push(progress.work);
    });
    expect(await assistant.summaries.run({ kind: "part" })).toBe("started");
    expect([...artifacts.summaries.keys()]).toEqual(["future"]);
    const turns = must(
      assistant.getSnapshot().chats.find((one) => one.id === chat.id),
    ).turns;
    expect(turns.map((turn) => [turn.role, turn.text])).toEqual([
      // A `part` is written as the Part it resolved to, as `/map`'s is.
      ["user", "/summarise Part One"],
      ["assistant", ACCOUNT],
    ]);
    expect(turns[0].runId).toBe(turns[1].runId);
    // The Part's id is the one thing stored.
    expect(turns[1].summarisedPart).toEqual({ nodeId: "one" });
    // One compose, from both summaries whole, in reading order, each under
    // its row header; the file's words, then the Part clause, no tools.
    expect(composed(model)).toHaveLength(1);
    const [request] = composed(model);
    expect(request.tools).toEqual([]);
    expect(request.instructions).toContain(summariseSkill.instruction);
    const shown = request.messages[0].content;
    expect(shown.indexOf("ROW node:first")).toBeGreaterThanOrEqual(0);
    expect(shown.indexOf("ROW node:first")).toBeLessThan(
      shown.indexOf("ROW node:future"),
    );
    expect(shown).toContain("A lamp fails.");
    expect(shown).toContain("A theft.");
    expect(new Set(works)).toEqual(new Set(["summarise"]));
    const after = assistant.getSnapshot();
    expect(after.running).toBe(false);
    expect(after.activity ?? null).toBeNull();
    expect(after.problem ?? null).toBeNull();
  });

  it("rewrites a summary that is out of date, and never one that is current", async () => {
    const { assistant, artifacts, sources } = summarising();
    sources.descriptors = sources.descriptors.map((one) =>
      one.id === "reference:summary--first.md"
        ? summaryOf("first", "outdated")
        : one,
    );
    await newChat(assistant, "editorial");
    await assistant.summaries.run({ kind: "part" });
    expect([...artifacts.summaries.keys()]).toEqual(["first", "future"]);
  });

  it("runs on a Part named by its title", async () => {
    const { assistant } = summarising();
    await newChat(assistant, "editorial");
    expect(await assistant.summaries.run({ kind: "node", nodeId: "one" })).toBe(
      "started",
    );
    const [asked, answer] = must(assistant.activeChat()).turns;
    expect(asked.text).toBe("/summarise Part One");
    expect(answer.summarisedPart).toEqual({ nodeId: "one" });
  });

  it("refuses another Section's title with the one remedy, before any request", async () => {
    const { assistant, model } = summarising();
    await newChat(assistant, "editorial");
    expect(
      await assistant.summaries.run({ kind: "node", nodeId: "future" }),
    ).toBe("rejected");
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "summarise-open-section",
      title: "Future",
    });
    expect(model.requests).toEqual([]);
    expect(must(assistant.activeChat()).turns).toEqual([]);
  });

  it("says a node that is gone is gone", async () => {
    const { assistant } = summarising();
    await newChat(assistant, "editorial");
    expect(
      await assistant.summaries.run({ kind: "node", nodeId: "gone" }),
    ).toBe("rejected");
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "review-node-missing",
    });
  });

  it("names the no-Part refusal by whether the project has a Part to type", async () => {
    const loose = summarising({ parts: false });
    await newChat(loose.assistant, "editorial");
    expect(await loose.assistant.summaries.run({ kind: "part" })).toBe(
      "rejected",
    );
    expect(loose.assistant.getSnapshot().problem).toEqual({
      kind: "summarise-no-part-no-parts",
    });
    // A Part elsewhere, and the open Section outside it.
    const elsewhere = summarising({ parts: false });
    elsewhere.sources.descriptors = [...elsewhere.sources.descriptors, PART];
    await newChat(elsewhere.assistant, "editorial");
    await elsewhere.assistant.summaries.run({ kind: "part" });
    expect(elsewhere.assistant.getSnapshot().problem).toEqual({
      kind: "summarise-no-part",
    });
    expect(elsewhere.model.requests).toEqual([]);
  });

  it("refuses a Part with no Section in it", async () => {
    const { assistant, sources } = summarising();
    sources.descriptors = [
      { ...PART, id: "node:bare", nodeId: "bare", title: "Bare" },
      ...sources.descriptors.filter((one) => one.nodeKind !== "part"),
    ];
    await newChat(assistant, "editorial");
    await assistant.summaries.run({ kind: "node", nodeId: "bare" });
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "summarise-nothing-to-read",
    });
  });

  it("names the Section whose summary could not be written, and tells no account", async () => {
    const { assistant, model } = summarising({ summary: "" });
    await newChat(assistant, "editorial");
    expect(await assistant.summaries.run({ kind: "part" })).toBe("started");
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "summarise-section-failed",
      title: "Future",
    });
    expect(composed(model)).toEqual([]);
    expect(must(assistant.activeChat()).turns).toEqual([]);
  });

  it("refuses summaries that together do not fit, naming the model, never clipped", async () => {
    const { assistant, model } = summarising();
    model.estimate = async (request?: ModelRequest) => ({
      tokens: request?.instructions.includes(PART_CLAUSE) ? 10_000_000 : 20,
      exact: false,
    });
    await newChat(assistant, "editorial");
    await assistant.summaries.run({ kind: "part" });
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "summarise-part-too-large",
      model: "Llama test",
    });
    expect(composed(model)).toEqual([]);
    expect(must(assistant.activeChat()).turns).toEqual([]);
  });

  it("publishes nothing when stopped while it composes", async () => {
    const { assistant, model } = summarising();
    const writing = model.generator;
    model.generator = async function* (request, signal, call) {
      if (request.instructions.includes(PART_CLAUSE)) {
        // Stop lands mid-step: the step ends as cancelled, whatever arrives.
        assistant.stop();
        yield { type: "completed", reason: "answer" };
        return;
      }
      yield* writing(request, signal, call);
    };
    await newChat(assistant, "editorial");
    await assistant.summaries.run({ kind: "part" });
    expect(assistant.getSnapshot().error).toBe("Summary stopped.");
    // The summaries written stay; the account is not told.
    expect(must(assistant.activeChat()).turns).toEqual([]);
    expect(assistant.getSnapshot().running).toBe(false);
  });

  it("never runs the nearer scopes, which are asked as a question", async () => {
    const { assistant, model } = summarising();
    await newChat(assistant, "editorial");
    expect(await assistant.summaries.run({ kind: "current" })).toBe("rejected");
    expect(await assistant.summaries.run({ kind: "section" })).toBe("rejected");
    expect(model.requests).toEqual([]);
  });

  it("refuses without a model, before any summary", async () => {
    const { assistant, model } = summarising();
    await assistant.chats.create("editorial");
    expect(await assistant.summaries.run({ kind: "part" })).toBe("rejected");
    expect(assistant.getSnapshot().errorCode).toBe("not-configured");
    expect(model.requests).toEqual([]);
  });

  it("is refused in a chat that does not offer it, whatever is asked", async () => {
    const { assistant, model } = summarising();
    await newChat(assistant, "general");
    expect(await assistant.summaries.run({ kind: "part" })).toBe("rejected");
    expect(model.requests).toEqual([]);
  });

  // A summary the writer barred is dropped from every listing
  // (`projectAdapter.list`), and its Section is marked `summaryBarred`, as
  // the adapter does; a filter alone reads as a summary never written. The
  // run composes without that Section and never writes over the barred
  // file, rather than rewriting it and refusing on every retry after paying
  // for the same summary again. It is the case `withheld` and `fromWithheld`
  // exist for.
  it("composes without a Section whose summary the writer barred, rewrites none, and says so", async () => {
    const { assistant, artifacts, sources, model } = summarising();
    const listed = sources.list;
    sources.list = async () =>
      (await listed())
        .filter((one) => one.id !== "reference:summary--first.md")
        .map((one) =>
          one.id === "node:first"
            ? { ...one, summaryBarred: true as const }
            : one,
        );
    await newChat(assistant, "editorial");
    expect(await assistant.summaries.run({ kind: "part" })).toBe("started");
    // The barred file is the writer's, and is never written over.
    expect(artifacts.summaries.has("first")).toBe(false);
    expect(assistant.getSnapshot().problem ?? null).toBeNull();
    const [, answer] = must(assistant.activeChat()).turns;
    expect(answer?.summarisedPart).toEqual({ nodeId: "one", withheld: true });
    const [request] = composed(model);
    expect(request.messages[0].content).not.toContain("ROW node:first");
    expect(request.messages[0].content).toContain("ROW node:future");
  });

  // A summary current when the run began goes out of date the moment the
  // writer types in its Section, because the adapter hashes the live buffer,
  // and `part` is asked from the open Section, which is in the Part. The
  // re-listing after the summaries never reports such a summary as one that
  // could not be written.
  it("never reports a summary that went out of date during the run as one that could not be written", async () => {
    const { assistant, artifacts, sources } = summarising();
    const listed = sources.list;
    // The writer edits "First" while `future`'s summary is being written.
    sources.list = async () =>
      (await listed()).map((one) =>
        one.id === "reference:summary--first.md" &&
        artifacts.summaries.has("future")
          ? { ...one, freshness: "outdated" as const }
          : one,
      );
    await newChat(assistant, "editorial");
    await assistant.summaries.run({ kind: "part" });
    expect(assistant.getSnapshot().problem).not.toEqual({
      kind: "summarise-section-failed",
      title: "First",
    });
  });

  it("refuses a Part whose every summary is barred, and writes none", async () => {
    const { assistant, artifacts, sources, model } = summarising();
    sources.descriptors = sources.descriptors
      .filter((one) => one.kind !== "summary")
      .map((one) =>
        one.nodeKind === "section"
          ? { ...one, summaryBarred: true as const }
          : one,
      );
    await newChat(assistant, "editorial");
    expect(await assistant.summaries.run({ kind: "part" })).toBe("rejected");
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "summarise-nothing-to-read",
    });
    expect(artifacts.summaries.size).toBe(0);
    expect(model.requests).toEqual([]);
  });

  it("never tells the Part from an old summary this run failed to replace", async () => {
    // `first`'s summary is out of date, so the run writes it again; that
    // write fails, and the stale one must not stand in for it.
    const { assistant, sources, model } = summarising({ summary: "" });
    sources.descriptors = sources.descriptors.map((one) =>
      one.id === "reference:summary--first.md"
        ? { ...one, freshness: "outdated" as const }
        : one,
    );
    await newChat(assistant, "editorial");
    await assistant.summaries.run({ kind: "part" });
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "summarise-section-failed",
      title: "First",
    });
    expect(composed(model)).toEqual([]);
  });

  // The provider counts where the estimate cannot, and answers a request
  // past the window with `context-too-large`. As
  // `generateNodeSummary` maps that to its Section's size, the Part's compose
  // maps it to the Part's too-large refusal, naming the model and offering
  // `section`, never the generic "The selected context is too large for this
  // model.".
  it("says a Part too large for the model when the provider, not the estimate, finds it too large", async () => {
    const { assistant, model } = summarising();
    const writing = model.generator;
    model.generator = async function* (request, signal, call) {
      if (request.instructions.includes(PART_CLAUSE))
        throw new ModelRunError({
          code: "context-too-large",
          message: "Too large.",
          retryable: false,
        });
      yield* writing(request, signal, call);
    };
    await newChat(assistant, "editorial");
    await assistant.summaries.run({ kind: "part" });
    expect(assistant.getSnapshot().problem).toEqual({
      kind: "summarise-part-too-large",
      model: "Llama test",
    });
    expect(must(assistant.activeChat()).turns).toEqual([]);
  });
});
