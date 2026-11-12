// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { Assistant, DEFAULT_PERSONA } from "../../ai";
import type {
  Artifacts,
  ChatRecord,
  ChatTurn,
  ModelProvider,
  ProjectSources,
  SourceDescriptor,
} from "../../ai";
import { searchProject } from "../../project/search";
import { buildRegex } from "../engine/adapters/regex";
import { indexText } from "./turnText";

// Pins the chat search's cache end to end.
//
// The Assistant keeps each chat's documents between keystrokes, keyed on the
// record, the builder and the catalogue map. The application's rows pin the
// key with a stand-in builder; these run what the Find panel runs, the real
// `indexText`, one module-level function, and `searchProject` over what the
// Assistant hands back. They hold the cached answer to a fresh Assistant's,
// rows, order, the 20-row cap and the count included, and keep every url out
// of the documents on a call the cache served.

const AT = "2026-09-27T00:00:00.000Z";

/** Every chat here searched, so no model link is live and none is indexed. */
function answer(chat: string, n: number): ChatTurn {
  const base = n * 2 + 1;
  return {
    id: `${chat}-a${n}`,
    role: "assistant",
    text: `The walls [held](https://model.example/${chat}/${n}) (web:${base}), as node:S1 says.`,
    createdAt: AT,
    outcome: "complete",
    tools: [
      {
        callId: `r-${chat}-${n}`,
        name: "read_source",
        status: "ok",
        sourceId: "node:S1",
      },
    ],
    web: [
      {
        callId: `s-${chat}-${n}`,
        engine: { kind: "wikipedia" },
        status: "searched",
        query: "walls",
        results: [
          {
            id: `web:${base}`,
            url: `https://en.wikipedia.org/wiki/Walls_${base}`,
            title: `Walls, entry ${base}`,
          },
        ],
      },
    ],
  };
}

function chat(id: string, pairs: number): ChatRecord {
  const turns: ChatTurn[] = [];
  for (let n = 0; n < pairs; n += 1)
    turns.push(
      {
        id: `${id}-q${n}`,
        role: "user",
        text: `Question ${n} about the gate.`,
        createdAt: AT,
        outcome: "complete",
      },
      answer(id, n),
    );
  return {
    schemaVersion: 1,
    id,
    title: `Chat ${id}`,
    kind: "general",
    createdAt: AT,
    updatedAt: AT,
    preferences: {
      personaId: DEFAULT_PERSONA.id,
      model: { providerId: "test-model", modelId: "llama-test" },
      pinnedSourceIds: [],
    },
    turns,
  };
}

function descriptor(title: string): SourceDescriptor {
  return {
    id: "node:S1",
    kind: "manuscript",
    title,
    path: "document/s1.md",
    nodeId: "S1",
    nodeKind: "section",
    order: 0,
    authority: "manuscript",
    revision: "r1",
  };
}

/** The least an Assistant needs to list chats, delete one and list titles. */
function assistantOver(
  files: Map<string, ChatRecord>,
  catalogue: { title: string },
): Assistant {
  const artifacts = {
    listChats: async () => ({ chats: [...files.values()], unreadable: [] }),
    deleteChat: async (id: string) => {
      files.delete(id);
    },
  } as unknown as Artifacts;
  const sources = {
    list: async () => [descriptor(catalogue.title)],
  } as unknown as ProjectSources;
  return new Assistant({
    artifacts,
    sources,
    model: {} as ModelProvider,
    defaultNode: () => null,
  });
}

/** One keystroke of the Find panel, as `DocumentTree` runs it. */
function find(assistant: Assistant, query: string) {
  return searchProject({
    structure: { version: 1, children: [], removed: [] },
    referenceFiles: [],
    query,
    regex: buildRegex(query, { caseSensitive: false, wholeWord: false }),
    bodies: new Map(),
    chats: assistant.searchDocuments(indexText),
  });
}

describe("the Find panel over the cached chat search", () => {
  // Every step the cache must see through — an equal relisting (a hit), a
  // renamed source, a chat file read again, a deleted chat — and after each
  // the panel's result over the cached documents is the fresh Assistant's.
  // Thirty answers say "walls", so the 20-row cap is always in play.
  it("finds exactly what a fresh Assistant finds, after every change", async () => {
    const files = new Map(
      ["one", "two", "three"].map((id) => [id, chat(id, 10)] as const),
    );
    const catalogue = { title: "Opening" };
    const cached = assistantOver(files, catalogue);
    await cached.initialize();

    const same = async () => {
      // The fresh one reads the cached one's records, in its order.
      const fresh = assistantOver(
        new Map(cached.getSnapshot().chats.map((one) => [one.id, one])),
        catalogue,
      );
      await fresh.initialize();
      for (const query of ["walls", catalogue.title, "Walls, entry 3"]) {
        const got = find(cached, query);
        expect(got).toEqual(find(fresh, query));
        // A second keystroke over nothing changed is served, and the same.
        expect(find(cached, query)).toEqual(got);
      }
      return find(cached, "walls");
    };

    const first = await same();
    const rows = first.groups.find((group) => group.head === "chat")?.results;
    expect(rows).toHaveLength(20);
    expect(first.total).toBe(20);

    await cached.listSources();
    await same();

    catalogue.title = "Lantern Gate";
    await cached.listSources();
    expect(find(cached, "Lantern Gate").total).toBeGreaterThan(0);
    expect(find(cached, "Opening").total).toBe(0);
    await same();

    const two = files.get("two");
    if (!two) throw new Error("expected chat two");
    files.set("two", {
      ...two,
      turns: two.turns.map((turn) =>
        turn.id === "two-a0" ? { ...turn, text: "The towers stood." } : turn,
      ),
    });
    await cached.initialize();
    expect(find(cached, "towers").total).toBe(1);
    await same();

    await cached.deleteChat("one");
    const after = await same();
    expect(
      after.groups
        .flatMap((group) => group.results)
        .some((row) => row.kind === "chat" && row.chatId === "one"),
    ).toBe(false);
  });

  // On a call the cache served the second search is a hit, with the builder
  // never invoked, and still no document holds a url, though every answer
  // carries a model link and every source a url.
  it("holds no :// in any document on a hit", async () => {
    const files = new Map([["one", chat("one", 5)] as const]);
    const assistant = assistantOver(files, { title: "Opening" });
    await assistant.initialize();
    const builder = vi.fn(indexText);
    const cold = assistant.searchDocuments(builder);
    expect(builder).toHaveBeenCalledTimes(5);
    builder.mockClear();
    const warm = assistant.searchDocuments(builder);
    expect(builder).not.toHaveBeenCalled();
    expect(warm).toEqual(cold);
    expect(warm.filter((one) => one.text.includes("://"))).toEqual([]);
    expect(warm.some((one) => one.text.includes("en.wikipedia.org"))).toBe(
      true,
    );
  });
});
