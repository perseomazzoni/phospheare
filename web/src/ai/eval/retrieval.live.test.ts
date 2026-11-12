// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { OllamaProvider } from "../adapters/ollama";
import { Assistant } from "../application/assistant";
import type {
  ChatRecord,
  ReviewCheckpoint,
  SourceDescriptor,
} from "../domain/types";
import type { Artifacts, ChatListing, ProjectSources } from "../ports";

// The behavioural eval, never part of ordinary CI. Protocol conformance says
// the adapter speaks the wire format; it cannot say whether the assembled
// assistant makes a model behave. Every other gate can be green while the
// assistant is unable to find a chapter it was not handed.
//
// This runs the real `Assistant`, with its real policy, briefing, index and
// tools, against a real model. It checks that when the writer names a
// document that is not attached, the assistant goes and gets it.
//
// It is a qualification, not a regression gate, because a model is not
// deterministic and a flaky assertion about one would poison the suite. Run
// it when the prompt changes:
//
//   $env:PHOSPHEARE_OLLAMA_LIVE = "1"
//   $env:PHOSPHEARE_OLLAMA_MODEL = "qwen3:8b"                (optional)
//   npx vitest run src/ai/eval/retrieval.live.test.ts
//
// The fixture is synthetic, invented chapters only, so the run exposes no
// writer's manuscript; the adapter's live file holds the same rule.

const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};
const live = env.PHOSPHEARE_OLLAMA_LIVE === "1";
const endpoint = env.PHOSPHEARE_OLLAMA_URL ?? "http://localhost:11434";
const modelId = env.PHOSPHEARE_OLLAMA_MODEL ?? "qwen3:8b";
const MODEL = { providerId: "ollama", modelId };

const CATALOG: SourceDescriptor[] = [
  {
    id: "node:ch1",
    kind: "manuscript",
    title: "The Crossing",
    path: "document/section--the-crossing.00.md",
    nodeId: "ch1",
    nodeKind: "section",
    order: 0,
    authority: "manuscript",
  },
  {
    id: "node:ch2",
    kind: "manuscript",
    title: "The Customs House",
    path: "document/section--the-customs-house.00.md",
    nodeId: "ch2",
    nodeKind: "section",
    order: 1,
    authority: "manuscript",
  },
];

const TEXTS = new Map([
  [
    "node:ch1",
    "They crossed at dawn, when the tide was lowest and the watch was thin.\nAbel carried the ledger under his coat and did not speak until the far bank.",
  ],
  [
    "node:ch2",
    'The rain had not stopped for three days. Mira stood at the window of the\ncustoms house and watched the harbour dissolve into grey.\n\n"It is the same number it was an hour ago," she said.',
  ],
]);

class EvalSources implements ProjectSources {
  async list() {
    return CATALOG;
  }
  async read(sourceId: string) {
    const text = TEXTS.get(sourceId);
    if (text === undefined) throw new Error("source-not-found");
    return {
      text,
      revision: `${sourceId}-r1`,
      origin: "project-file" as const,
    };
  }
  async search(query: string, allowed: ReadonlySet<string>, limit: number) {
    const needle = query.toLocaleLowerCase();
    return CATALOG.filter(
      (source) =>
        allowed.has(source.id) &&
        ((TEXTS.get(source.id) ?? "").toLocaleLowerCase().includes(needle) ||
          source.title.toLocaleLowerCase().includes(needle)),
    )
      .slice(0, limit)
      .map((source) => ({
        source,
        excerpt: TEXTS.get(source.id) ?? "",
        score: 1,
      }));
  }
  async allowedReaderSources() {
    return new Set(CATALOG.map((one) => one.id));
  }
}

/** Memory-only: the eval writes nothing to anyone's disk. */
class EvalArtifacts implements Artifacts {
  chats = new Map<string, ChatRecord>();
  async listChats(): Promise<ChatListing> {
    return { chats: [...this.chats.values()], unreadable: [] };
  }
  async loadChat(id: string) {
    const chat = this.chats.get(id);
    if (!chat) throw new Error("missing-chat");
    return chat;
  }
  async saveChat(chat: ChatRecord) {
    this.chats.set(chat.id, structuredClone(chat));
    return {};
  }
  async deleteChatFile() {}
  async deleteChat(id: string) {
    this.chats.delete(id);
  }
  async saveReview() {}
  async loadReview(): Promise<ReviewCheckpoint> {
    throw new Error("missing-review");
  }
  async deleteReview() {}
  async readSummary() {
    return null;
  }
  async writeSummary() {}
  async readLedger() {
    return null;
  }
  async writeLedger() {}
  async readJudgements() {
    return null;
  }
  async writeJudgements() {}
  async readEntities() {
    return null;
  }
  async writeEntities() {}
}

describe.skipIf(!live)("assistant retrieval behaviour (live)", () => {
  // The timeout is the run's own: a cold model load plus a tool loop takes
  // minutes, so a qualification gets the time a real one needs instead of
  // the suite's default.
  it("fetches a chapter it was not handed, addressed by its ordinal", async () => {
    const artifacts = new EvalArtifacts();
    const assistant = new Assistant({
      sources: new EvalSources(),
      artifacts,
      model: new OllamaProvider(endpoint),
      // The writer is looking at chapter two. Chapter one is reachable and
      // not attached, which is the scenario under test.
      defaultNode: () => ({
        id: "ch2",
        title: "The Customs House",
        kind: "section",
      }),
      projectFacts: () => ({
        title: "The Grey Port",
        type: "Novel",
        language: "English",
      }),
    });

    const chat = await assistant.chats.create("general");
    // Which model answers is the chat's own, so the eval sets it on the chat
    // rather than handing the `Assistant` an ambient default. A
    // first chat has nothing to inherit from, so the call is required.
    await assistant.chats.updatePreferences({ model: MODEL });
    // By ordinal, not by title: "the first chapter" matches no node's name,
    // and resolving it relies on the index's numbering rather than on the
    // instruction.
    expect(
      await assistant.send("What do you think of the first chapter?"),
    ).toBe("started");

    const saved = artifacts.chats.get(chat?.id ?? "");
    const answer = saved?.turns.find((turn) => turn.role === "assistant");

    // The assertion is on the receipts, not on the prose. What the model
    // said about the chapter is a matter of taste and would be a flaky
    // assertion; whether it read the chapter is a fact.
    const read = (answer?.tools ?? []).filter(
      (receipt) => receipt.name === "read_source",
    );
    expect(read.length).toBeGreaterThan(0);
    expect((answer?.sources ?? []).map((use) => use.id)).toContain("node:ch1");
    expect(answer?.text ?? "").not.toMatch(/cannot|unavailable|do not have/i);
  }, 600_000);
});
