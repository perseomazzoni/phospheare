// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PERSONA } from "../domain/personas";
import type { ChatRecord, ChatTurn } from "../domain/types";
import { webCitations } from "../domain/webCitations";
import type { Artifacts, ModelProvider, ProjectSources } from "../ports";
import { Assistant } from "./assistant";

// Pins that the chat search walks each chat at most once. `searchDocuments`
// runs on every keystroke of the Find field, over every chat. One
// `webCitations` walk per chat is linear in the turns; a walk per turn is
// quadratic and still passes every row that reads only what the walk returns,
// so the walk is counted by wrapping the real function. The file is separate
// so the mock reaches no other row.

vi.mock("../domain/webCitations", async (importOriginal) => {
  const real = await importOriginal<typeof import("../domain/webCitations")>();
  return { ...real, webCitations: vi.fn(real.webCitations) };
});

const AT = "2026-09-27T00:00:00.000Z";

function turn(id: string, role: ChatTurn["role"], text: string): ChatTurn {
  return { id, role, text, createdAt: AT, outcome: "complete" };
}

function chat(id: string, answers: number): ChatRecord {
  return {
    schemaVersion: 1,
    id,
    title: id,
    kind: "general",
    createdAt: AT,
    updatedAt: AT,
    preferences: {
      personaId: DEFAULT_PERSONA.id,
      model: { providerId: "test-model", modelId: "llama-test" },
      pinnedSourceIds: [],
    },
    turns: Array.from({ length: answers }, (_, n) => [
      turn(`${id}-q${n}`, "user", `Question ${n}`),
      turn(`${id}-a${n}`, "assistant", `Answer ${n} (web:1).`),
    ]).flat(),
  };
}

/**
 * The least an Assistant needs to load chats and list a catalogue: the rows
 * here never run a model, save a chat or read a source.
 */
function assistantOver(chats: ChatRecord[]): Assistant {
  const artifacts = {
    listChats: async () => ({ chats, unreadable: [] }),
  } as unknown as Artifacts;
  const sources = { list: async () => [] } as unknown as ProjectSources;
  return new Assistant({
    artifacts,
    sources,
    model: {} as ModelProvider,
    defaultNode: () => null,
  });
}

afterEach(() => {
  vi.mocked(webCitations).mockClear();
});

describe("the chat search's walk", () => {
  it("walks each chat at most once per call, whatever its length", async () => {
    const chats = [chat("chat-a", 3), chat("chat-b", 5)];
    const assistant = assistantOver(chats);
    await assistant.initialize();
    vi.mocked(webCitations).mockClear();
    const walks = () => vi.mocked(webCitations).mock.calls.length;

    const answerText = (one: ChatTurn) => one.text;
    const documents = assistant.searchDocuments(answerText);
    expect(
      documents.map((one) => [one.chatId, one.turnId, one.speaker, one.text]),
    ).toEqual(
      chats.flatMap((one) =>
        one.turns.map((each) => [
          one.id,
          each.id,
          each.role === "user" ? "you" : "assistant",
          each.text,
        ]),
      ),
    );
    // Each chat is walked whole, never turn by turn, so the walk count is
    // bounded by the chats, not their eight answers.
    const walked = vi.mocked(webCitations).mock.calls.map(([turns]) => turns);
    expect(walked).toEqual(
      expect.arrayContaining(chats.map((one) => one.turns)),
    );
    expect(walks()).toBeLessThanOrEqual(chats.length);

    // A repeated search, with the same builder or a new one, may reuse the
    // last walk but never walks more than once per chat.
    for (const builder of [answerText, (one: ChatTurn) => one.text]) {
      const before = walks();
      expect(assistant.searchDocuments(builder)).toEqual(documents);
      expect(walks() - before).toBeLessThanOrEqual(chats.length);
    }
  });
});

describe("the chat search in a continued chat", () => {
  it("walks a chat continued from a search as latched, before its own first search", async () => {
    // The digest of a searched chat can carry a steered link, and the chat
    // search indexes what the writer reads, so its walk must start latched as
    // the transcript's does. Without the chat's flag the walk
    // reads `searched: false` and would index the href.
    const continued = { ...chat("chat-c", 1), searchedBefore: true as const };
    const plain = chat("chat-d", 1);
    const assistant = assistantOver([continued, plain]);
    await assistant.initialize();

    const documents = assistant.searchDocuments((_turn, { web }) =>
      String(web.searched),
    );
    const answerOf = (chatId: string) =>
      documents.find(
        (one) => one.chatId === chatId && one.speaker === "assistant",
      )?.text;
    expect(answerOf("chat-c")).toBe("true");
    // The same shape without the flag walks unlatched, so the latch is the
    // flag's.
    expect(answerOf("chat-d")).toBe("false");
  });
});
