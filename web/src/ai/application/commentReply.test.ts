// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { CommentProposal, CommentThreadView } from "../domain/comments";
import { PERSONAS } from "../domain/personas";
import type {
  ModelDescriptor,
  ModelEvent,
  ModelRef,
  ModelRequest,
  PersonaDefinition,
  SourceDescriptor,
} from "../domain/types";
import type { Comments, ModelProvider, ProjectSources } from "../ports";
import {
  MARGIN_MORE,
  MARGIN_READER,
  composeCommentReply,
  readingTo,
  readsAsReader,
} from "./commentReply";
import { ModelRunError } from "./runStep";

// Pins a persona's margin reply, run by a chat's loop and read-only tools.
// The assistant-level tests drive it through `answerComment`; these
// pin the run's own rules: which room a persona speaks from, how the thread's
// other voices are named, what it may call, how far a reader reads, and that
// only a whole answer is an answer.

class Answering implements ModelProvider {
  readonly id = "fake";
  requests: ModelRequest[] = [];
  /** One script per request, the last repeated; a flat list is every one. */
  constructor(
    private readonly events: ModelEvent[] | ModelEvent[][],
    private readonly tools = false,
  ) {}
  async listModels(): Promise<ModelDescriptor[]> {
    return [];
  }
  async describeModel(ref: ModelRef): Promise<ModelDescriptor> {
    return {
      id: ref.modelId,
      providerId: this.id,
      label: ref.modelId,
      kind: "device",
      capabilities: { tools: this.tools, structuredOutput: false },
      contextTokens: 32_000,
    };
  }
  async estimate() {
    return { tokens: 1, exact: false };
  }
  async *generate(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const scripts = Array.isArray(this.events[0])
      ? (this.events as ModelEvent[][])
      : [this.events as ModelEvent[]];
    yield* scripts[Math.min(this.requests.length, scripts.length) - 1];
  }
}

const answer = (
  text: string,
  reason: "answer" | "limit" | "refusal" = "answer",
): ModelEvent[] => [
  { type: "text-delta", text },
  { type: "completed", reason },
];

const editorial = PERSONAS.find((one) =>
  one.compatibleWith.includes("editorial"),
) as PersonaDefinition;
const other = PERSONAS.find(
  (one) => one.id !== editorial.id && !readsAsReader(one),
) as PersonaDefinition;

const THREAD: CommentThreadView = {
  id: "t1",
  state: "open",
  passage: "the old gate",
  entries: [
    { by: { kind: "writer" }, body: "Is this too quiet?" },
    { by: { kind: "persona", id: other.id }, body: "It reads as calm." },
  ],
};

const CATALOG: SourceDescriptor[] = [
  {
    id: "node:EL1",
    kind: "manuscript",
    title: "One",
    path: "",
    nodeId: "EL1",
    authority: "manuscript",
  },
  {
    id: "node:EL2",
    kind: "manuscript",
    title: "Two",
    path: "",
    nodeId: "EL2",
    authority: "manuscript",
  },
];
const BOOK = new Map([
  ["node:EL1", "By the old gate. Then the end of it."],
  ["node:EL2", "The thief was the guide."],
]);
const SOURCES: ProjectSources = {
  list: async () => CATALOG,
  read: async (sourceId, range) => {
    const text = BOOK.get(sourceId) ?? "";
    return {
      text: range ? text.slice(range.start, range.end) : text,
      revision: "r",
      origin: "project-file",
    };
  },
  allowedReaderSources: async () => new Set(["node:EL1"]),
};

async function ask(
  persona: PersonaDefinition,
  events: ModelEvent[] | ModelEvent[][],
  signal = new AbortController().signal,
  more: {
    tools?: boolean;
    allowed?: ReadonlySet<string>;
    comments?: Comments;
    text?: string;
  } = {},
) {
  const model = new Answering(events, more.tools);
  const run = composeCommentReply(
    {
      model,
      modelRef: { providerId: "scripted", modelId: "m" },
      personas: PERSONAS,
      sources: SOURCES,
      catalog: CATALOG,
      allowed: more.allowed ?? new Set(["node:EL1", "node:EL2"]),
      comments: more.comments,
    },
    {
      persona,
      chapter: {
        sourceId: "node:EL1",
        title: "One",
        text: more.text ?? "By the old gate.",
      },
      thread: THREAD,
      margin: null,
    },
    signal,
  );
  return { model, run };
}

describe("composeCommentReply", () => {
  it("names the thread's other persona by name, and offers no tools to a model that cannot call them", async () => {
    const { model, run } = await ask(editorial, answer(" Calm, yes. "));
    expect((await run).text).toBe("Calm, yes.");
    const [request] = model.requests;
    expect(request.tools).toEqual([]);
    expect(request.messages[0].content).toContain(other.name);
    expect(request.instructions).not.toContain(MARGIN_READER);
    expect(request.instructions).not.toContain(MARGIN_MORE);
  });

  it("speaks from the room a persona has when it has no editorial one", async () => {
    const general = { ...editorial, compatibleWith: ["general" as const] };
    const { run } = await ask(general, answer("Fine."));
    expect((await run).text).toBe("Fine.");
    // A persona listed for no room at all still answers, as a general one.
    const none = { ...editorial, compatibleWith: [] };
    const { run: bare } = await ask(none, answer("Fine."));
    expect((await bare).text).toBe("Fine.");
  });

  it("says why there is no answer: cut short, refused, empty or stopped", async () => {
    const code = async (events: ModelEvent[], signal?: AbortSignal) => {
      const { run } = await ask(editorial, events, signal);
      try {
        await run;
      } catch (error) {
        return (error as ModelRunError).failure.code;
      }
      return "answered";
    };
    expect(await code(answer("Half a tho", "limit"))).toBe("interrupted");
    expect(await code(answer("I can't.", "refusal"))).toBe("provider-rejected");
    expect(await code(answer("   "))).toBe("invalid-response");
    const stopped = new AbortController();
    stopped.abort();
    expect(await code(answer("Too late."), stopped.signal)).toBe("cancelled");
  });

  // A reply reads the book as a chat does and may leave notes beside other
  // passages; a chat's skills and a review's findings are not offered.
  it("reads the book with a chat's tools, and leaves notes through the margin", async () => {
    const left: [string, string, CommentProposal[]][] = [];
    const comments: Comments = {
      cap: 8,
      threadsOf: async () => [],
      reply: async () => undefined,
      propose: async (nodeId, personaId, proposals) => {
        left.push([nodeId, personaId, [...proposals]]);
        return proposals.map(() => "placed" as const);
      },
    };
    const activity: unknown[] = [];
    const model = new Answering(
      [
        [
          {
            type: "tool-call-ready",
            call: {
              id: "c1",
              name: "read_source",
              arguments: { sourceId: "node:EL2" },
            },
          },
          {
            type: "tool-call-ready",
            call: {
              id: "c2",
              name: "leave_comments",
              arguments: {
                comments: [
                  {
                    sourceId: "node:EL2",
                    quote: "the guide",
                    body: "Too early.",
                    weight: "minor",
                  },
                ],
              },
            },
          },
          { type: "completed", reason: "tools" },
        ],
        answer("The guide gives it away in Two."),
      ],
      true,
    );
    const text = await composeCommentReply(
      {
        model,
        modelRef: { providerId: "scripted", modelId: "m" },
        personas: PERSONAS,
        sources: SOURCES,
        catalog: CATALOG,
        allowed: new Set(["node:EL1", "node:EL2"]),
        comments,
      },
      {
        persona: editorial,
        chapter: { sourceId: "node:EL1", title: "One", text: "By the gate." },
        thread: THREAD,
        margin: null,
      },
      new AbortController().signal,
      (now) => activity.push(now),
    );
    expect(text.text).toBe("The guide gives it away in Two.");
    const offered = model.requests[0].tools.map((tool) => tool.name);
    expect(offered).toEqual(
      expect.arrayContaining([
        "list_sources",
        "grep",
        "read_source",
        "inspect_structure",
        "leave_comments",
      ]),
    );
    expect(offered).not.toContain("use_skill");
    // What does not fit one note goes beside its own passage.
    expect(model.requests[0].instructions).toContain(MARGIN_MORE);
    expect(offered).not.toContain("submit_findings");
    expect(offered).not.toContain("web_search");
    expect(JSON.stringify(model.requests[1].messages)).toContain(
      "The thief was the guide.",
    );
    expect(left).toEqual([
      [
        "EL2",
        editorial.id,
        [
          expect.objectContaining({
            quote: expect.objectContaining({ text: "the guide" }),
          }),
        ],
      ],
    ]);
    // The card hears each call before it runs, by the title it reads.
    expect(activity).toContainEqual({
      kind: "tool",
      tool: "read_source",
      subject: "Two",
    });
  });

  it("lets a reader read the chapter only as far as the passage, and nothing past it", async () => {
    const reader = PERSONAS.find(readsAsReader) as PersonaDefinition;
    const { model, run } = await ask(
      reader,
      [
        [
          {
            type: "tool-call-ready",
            call: {
              id: "c1",
              name: "read_source",
              arguments: { sourceId: "node:EL1" },
            },
          },
          {
            type: "tool-call-ready",
            call: {
              id: "c2",
              name: "read_source",
              arguments: { sourceId: "node:EL2" },
            },
          },
          { type: "completed", reason: "tools" },
        ],
        answer("I feel the gate."),
      ],
      undefined,
      { tools: true, allowed: new Set(["node:EL1"]), text: "By the old gate." },
    );
    expect((await run).text).toBe("I feel the gate.");
    const results = JSON.stringify(model.requests[1].messages.slice(2));
    expect(results).toContain("By the old gate.");
    expect(results).not.toContain("Then the end of it.");
    expect(results).not.toContain("The thief was the guide.");
    expect(model.requests[0].tools.map((tool) => tool.name)).not.toContain(
      "leave_comments",
    );
  });

  it("cuts the chapter at the passage on every read of it, a range included", async () => {
    const reading = readingTo(SOURCES, {
      sourceId: "node:EL1",
      title: "One",
      text: "By the old gate.",
    });
    expect((await reading.read("node:EL1")).text).toBe("By the old gate.");
    expect((await reading.read("node:EL1", { start: 3, end: 6 })).text).toBe(
      "the",
    );
    // Every other source reads as it is.
    expect((await reading.read("node:EL2")).text).toBe(
      "The thief was the guide.",
    );
    expect([
      ...(await reading.allowedReaderSources({ kind: "whole" })),
    ]).toEqual(["node:EL1"]);
    expect(await reading.list()).toBe(CATALOG);
  });

  it("shows a chapter too long for the window as far as it fits, and says so", async () => {
    const { model, run } = await ask(editorial, answer("Long."), undefined, {
      text: "word ".repeat(100_000),
    });
    await run;
    expect(model.requests[0].messages[0].content).toContain(
      "read the rest with read_source",
    );
  });

  it("names a voice the book no longer has by nothing", async () => {
    const model = new Answering(answer("Fine."));
    await composeCommentReply(
      {
        model,
        modelRef: { providerId: "scripted", modelId: "m" },
        personas: PERSONAS,
        sources: SOURCES,
        catalog: CATALOG,
        allowed: new Set(["node:EL1"]),
      },
      {
        persona: editorial,
        chapter: { sourceId: "node:EL1", title: "One", text: "By the gate." },
        thread: {
          ...THREAD,
          entries: [{ by: { kind: "persona", id: "gone" }, body: "Who am I?" }],
        },
        margin: null,
      },
      new AbortController().signal,
    );
    expect(model.requests[0].messages[0].content).toContain("Who am I?");
  });

  it("is stopped, not failed, when Stop lands mid-answer", async () => {
    const stop = new AbortController();
    const model: ModelProvider = {
      id: "fake",
      listModels: async () => [],
      describeModel: async (ref) => ({
        id: ref.modelId,
        providerId: "fake",
        label: ref.modelId,
        kind: "device",
        capabilities: { tools: false, structuredOutput: false },
        contextTokens: 32_000,
      }),
      estimate: async () => ({ tokens: 1, exact: false }),
      async *generate() {
        yield { type: "text-delta", text: "Half" };
        stop.abort();
        yield { type: "text-delta", text: " a note" };
        yield { type: "completed", reason: "answer" };
      },
    };
    await expect(
      composeCommentReply(
        {
          model,
          modelRef: { providerId: "scripted", modelId: "m" },
          personas: PERSONAS,
          sources: SOURCES,
          catalog: CATALOG,
          allowed: new Set(["node:EL1"]),
        },
        {
          persona: editorial,
          chapter: { sourceId: "node:EL1", title: "One", text: "By." },
          thread: THREAD,
          margin: null,
        },
        stop.signal,
      ),
    ).rejects.toMatchObject({ failure: { code: "cancelled" } });
  });
});
