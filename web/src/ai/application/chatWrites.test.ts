// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { ChatRecord } from "../domain/types";
import {
  ChatWrites,
  ontoLatest,
  withTurn,
  type ChatListState,
} from "./chatWrites";

function chat(id: string, updatedAt: string): ChatRecord {
  return {
    schemaVersion: 1,
    id,
    title: id,
    kind: "general",
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt,
    preferences: {
      personaId: "p",
      pinnedSourceIds: [],
      model: { providerId: "stub", modelId: "test" },
    },
    turns: [
      {
        id: "t1",
        role: "assistant",
        text: "hello",
        createdAt: "2026-09-29T00:00:01.000Z",
        outcome: "interrupted",
      },
    ],
  };
}

/** A host whose state the writes patch, and whose saves are scripted. */
function host(
  save: (
    chat: ChatRecord,
  ) => Promise<{ conflictFile?: string; nearLimit?: boolean }>,
) {
  let state: ChatListState = {
    chats: [],
    activeChatId: null,
    saveFailedChatId: null,
  };
  const gone = new Set<string>();
  const patches: Partial<ChatListState>[] = [];
  const writes = new ChatWrites({
    save,
    publish: (patch) => {
      patches.push(patch);
      state = { ...state, ...patch };
    },
    snapshot: () => state,
    gone: (id) => gone.has(id),
  });
  return { writes, gone, patches, state: () => state };
}

describe("ChatWrites", () => {
  it("patches one turn without writing the record in place", () => {
    const before = chat("a", "2026-09-29T00:00:02.000Z");
    const after = withTurn(before, "t1", { outcome: "complete" });
    expect(after.turns[0]?.outcome).toBe("complete");
    expect(before.turns[0]?.outcome).toBe("interrupted");
    expect(after).not.toBe(before);
  });

  it("saves through one lane per chat, merges the row newest first, and keeps the writer's place", async () => {
    const saved: string[] = [];
    const h = host(async (one) => {
      saved.push(one.id);
      return {};
    });
    await h.writes.persist(chat("old", "2026-09-29T00:00:02.000Z"), true);
    expect(h.state().activeChatId).toBe("old");
    // A later chat saved without `activate` leads the list and steals nothing.
    await h.writes.persist(chat("new", "2026-09-29T00:00:09.000Z"));
    expect(h.state().chats.map((one) => one.id)).toEqual(["new", "old"]);
    expect(h.state().activeChatId).toBe("old");
    expect(saved).toEqual(["old", "new"]);
    // The conflict and the near-limit facts travel with the save's outcome.
    const h2 = host(async () => ({ conflictFile: "c.json", nearLimit: true }));
    await h2.writes.persist(chat("a", "2026-09-29T00:00:02.000Z"));
    expect(h2.state().conflictFile).toBe("c.json");
    expect(h2.state().continuationOffered).toBe(true);
  });

  it("keeps a chat whose save failed in the list and marks it, then clears the mark on the next save", async () => {
    let fail = true;
    const h = host(async () => {
      if (fail) throw new Error("save-failed");
      return {};
    });
    const record = chat("a", "2026-09-29T00:00:02.000Z");
    await h.writes.persist(record);
    expect(h.state().chats.map((one) => one.id)).toEqual(["a"]);
    expect(h.state().saveFailedChatId).toBe("a");
    fail = false;
    await h.writes.persist(record);
    expect(h.state().saveFailedChatId).toBeNull();
  });

  it("writes nothing for a chat that is gone, before or after the save", async () => {
    let resolve: (value: { conflictFile?: string }) => void = () => {};
    const h = host(() => new Promise((done) => (resolve = done)));
    const record = chat("a", "2026-09-29T00:00:02.000Z");
    const pending = h.writes.persist(record);
    // Deleted while the save is in flight: the outcome must not resurrect it.
    h.gone.add("a");
    resolve({});
    await pending;
    expect(h.state().chats).toEqual([]);
    expect(h.patches).toEqual([]);
    // A chat already gone is not saved at all.
    await h.writes.persist(record);
    expect(h.patches).toEqual([]);
  });

  it("previews a chat into the list without saving, unless it is gone", async () => {
    const saved: string[] = [];
    const h = host(async (one) => {
      saved.push(one.id);
      return {};
    });
    h.writes.preview(chat("a", "2026-09-29T00:00:02.000Z"));
    expect(h.state().chats.map((one) => one.id)).toEqual(["a"]);
    expect(saved).toEqual([]);
    h.gone.add("b");
    h.writes.preview(chat("b", "2026-09-29T00:00:03.000Z"));
    expect(h.state().chats.map((one) => one.id)).toEqual(["a"]);
  });

  it("remembers every chat whose last save failed, not only the latest", async () => {
    const failing = new Set(["a", "b"]);
    const h = host(async (one) => {
      if (failing.has(one.id)) throw new Error("save-failed");
      return {};
    });
    await h.writes.persist(chat("a", "2026-09-29T00:00:02.000Z"));
    await h.writes.persist(chat("b", "2026-09-29T00:00:03.000Z"));
    expect(h.state().saveFailedChatId).toBe("b");
    // b saves at last: a's failure still stands, and is the one shown.
    failing.delete("b");
    await h.writes.persist(chat("b", "2026-09-29T00:00:04.000Z"));
    expect(h.state().saveFailedChatId).toBe("a");
    expect(h.writes.failed("a")).toBe(true);
    expect(h.writes.failed("b")).toBe(false);
    // Forgetting a chat (a delete) leaves no failure to show.
    expect(h.writes.forget("a")).toBeNull();
    expect(h.writes.failed("a")).toBe(false);
  });

  it("writes a run's record onto the chat as it is when the save starts", async () => {
    // A rename lands while the run's copy waits in the lane: the run's write
    // keeps the rename and adds only what the run changed.
    let release: () => void = () => {};
    const gate = new Promise<void>((done) => (release = done));
    const saved: ChatRecord[] = [];
    const h = host(async (one) => {
      if (saved.length === 0) await gate;
      saved.push(one);
      return {};
    });
    const base = chat("a", "2026-09-29T00:00:02.000Z");
    h.writes.preview(base);
    const renamed = h.writes.persist({ ...base, title: "Renamed" });
    const answer = {
      id: "t2",
      role: "assistant" as const,
      text: "answer",
      createdAt: "2026-09-29T00:00:03.000Z",
      outcome: "complete" as const,
    };
    const run = h.writes.persistRun(base, {
      ...base,
      updatedAt: "2026-09-29T00:00:05.000Z",
      turns: [...base.turns, answer],
    });
    release();
    await Promise.all([renamed, run]);
    const last = saved[saved.length - 1];
    expect(last).toMatchObject({
      title: "Renamed",
      updatedAt: "2026-09-29T00:00:05.000Z",
    });
    expect(last?.turns.map((one) => one.id)).toEqual(["t1", "t2"]);
    expect(h.state().chats[0]?.title).toBe("Renamed");
  });

  it("applies a writer's change, and a run's settle, to the chat as it is when each save starts", async () => {
    // The run's answer is saved first; the rename, clicked on the streaming
    // preview, is saved after it and keeps the answer. The run's settle sees
    // a tick queued before it.
    let release: () => void = () => {};
    const gate = new Promise<void>((done) => (release = done));
    const saved: ChatRecord[] = [];
    const h = host(async (one) => {
      if (saved.length === 0) await gate;
      saved.push(one);
      return {};
    });
    const base = chat("a", "2026-09-29T00:00:02.000Z");
    h.writes.preview(base);
    const ticked = h.writes.persistChange(base, (latest) => ({
      ...latest,
      plan: { items: [] },
    }));
    const answered: ChatRecord = {
      ...base,
      turns: [{ ...base.turns[0], text: "answer", outcome: "complete" }],
    };
    let seenPlan: ChatRecord["plan"];
    const run = h.writes.persistRun(base, answered, (laid) => {
      seenPlan = laid.plan;
      return laid;
    });
    const renamed = h.writes.persistChange(base, (latest) => ({
      ...latest,
      title: "Renamed",
    }));
    release();
    await Promise.all([ticked, run, renamed]);
    expect(seenPlan).toEqual({ items: [] });
    expect(saved[saved.length - 1]).toMatchObject({
      title: "Renamed",
      plan: { items: [] },
      turns: [{ text: "answer", outcome: "complete" }],
    });
  });

  it("keeps the writer's changes and the run's apart, field by field", () => {
    const base = chat("a", "2026-09-29T00:00:02.000Z");
    const [first] = base.turns;
    const latest: ChatRecord = {
      ...base,
      title: "Renamed",
      preferences: {
        ...base.preferences,
        model: { providerId: "remote", modelId: "other" },
      },
      // The writer's verdict on an older turn, made while the run streamed.
      turns: [{ ...first, outcome: "complete" }],
    };
    const asked = {
      id: "t2",
      role: "user" as const,
      text: "q",
      createdAt: "2026-09-29T00:00:03.000Z",
      outcome: "complete" as const,
    };
    const run: ChatRecord = {
      ...base,
      updatedAt: "2026-09-29T00:00:09.000Z",
      preferences: { ...base.preferences, targetNodeId: "first" },
      turns: [...base.turns, asked],
    };
    const merged = ontoLatest(latest, base, run);
    expect(merged.title).toBe("Renamed");
    expect(merged.updatedAt).toBe("2026-09-29T00:00:09.000Z");
    expect(merged.preferences.model).toEqual({
      providerId: "remote",
      modelId: "other",
    });
    expect(merged.preferences.targetNodeId).toBe("first");
    expect(merged.turns).toEqual([{ ...first, outcome: "complete" }, asked]);
    // A chat missing from the list takes the run's record as it is.
    expect(ontoLatest(undefined, base, run)).toBe(run);
  });

  it("settles when the chat's last write has, whichever way it went", async () => {
    const h = host(async () => {
      throw new Error("save-failed");
    });
    const record = chat("a", "2026-09-29T00:00:02.000Z");
    void h.writes.persist(record);
    await expect(h.writes.settled("a")).resolves.toBeUndefined();
    await expect(h.writes.settled("never")).resolves.toBeUndefined();
  });
});
