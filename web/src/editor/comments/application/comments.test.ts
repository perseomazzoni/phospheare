// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { readComments, writeComments } from "../domain/codec";
import { GHOST_COMMENTS_PER_SECTION } from "../domain/limits";
import type { CommentsFile } from "../domain/model";
import {
  CommentsRefused,
  CommentsService,
  type CommentStore,
} from "./comments";

const WRITER = { kind: "writer" } as const;

function memoryStore(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  let failReads = false;
  const store: CommentStore = {
    async read(nodeId) {
      if (failReads) throw new Error("offline");
      const text = files.get(nodeId);
      return text === undefined ? { kind: "missing" } : { kind: "text", text };
    },
    async write(nodeId, text) {
      // A slow write, so changes queued behind it are tested for real.
      await new Promise((resolve) => setTimeout(resolve, 1));
      writes.push(nodeId);
      files.set(nodeId, text);
    },
  };
  return {
    store,
    writes,
    files,
    fail(on: boolean) {
      failReads = on;
    },
    fileOf(nodeId: string): CommentsFile {
      const read = readComments(files.get(nodeId) ?? "");
      if (!read.ok) throw new Error("damaged");
      return read.file;
    },
  };
}

function service(store: CommentStore) {
  let n = 0;
  return new CommentsService({
    store,
    now: () => "2026-10-05T10:00:00Z",
    newId: () => `id${++n}`,
  });
}

const anchor = { quote: "the storm", prefix: "", suffix: "" };

describe("CommentsService", () => {
  it("loads only the nodes it is given, and a node with no file has no comments", async () => {
    const memory = memoryStore();
    const comments = service(memory.store);
    let heard = 0;
    comments.subscribe(() => (heard += 1));
    await comments.load(["EL1", "EL2"]);
    expect(comments.fileOf("EL1")).toEqual({ threads: [], dismissed: [] });
    expect(comments.snapshot().size).toBe(2);
    expect(heard).toBeGreaterThan(0);
    // Nothing is written for merely reading.
    expect(memory.writes).toEqual([]);
  });

  it("tells its listeners twice about a load, however many files it reads", async () => {
    // Each telling re-renders the editor shell and the whole structure panel,
    // so a load tells once as it starts and once as it settles, never once
    // per file.
    const memory = memoryStore({
      EL2: "not a comments file",
    });
    memory.store.read = ((read) => async (nodeId: string) => {
      // The reads land a task apart, as a real storage's do.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return read(nodeId);
    })(memory.store.read.bind(memory.store));
    const comments = service(memory.store);
    const sizes: string[] = [];
    comments.subscribe(() =>
      sizes.push(
        [...comments.snapshot().values()].map((s) => s.status).join(","),
      ),
    );
    await comments.load(["EL1", "EL2", "EL3", "EL4"]);
    expect(sizes).toEqual([
      "loading,loading,loading,loading",
      "ready,damaged,ready,ready",
    ]);
  });

  it("writes every change, and two changes landing together both survive", async () => {
    const memory = memoryStore();
    const comments = service(memory.store);
    const first = comments.open("EL1", { anchor, author: WRITER, body: "One" });
    const second = comments.open("EL1", {
      anchor: null,
      author: WRITER,
      body: "Two",
    });
    await Promise.all([first, second]);
    expect(memory.fileOf("EL1").threads.map((t) => t.entries[0].body)).toEqual([
      "One",
      "Two",
    ]);
    expect(comments.fileOf("EL1")?.threads).toHaveLength(2);
  });

  it("never writes over a damaged file, and says so", async () => {
    const memory = memoryStore({ EL1: "{ not json" });
    const comments = service(memory.store);
    await comments.load(["EL1"]);
    expect(comments.stateOf("EL1")).toEqual({ status: "damaged" });
    await expect(
      comments.open("EL1", { anchor, author: WRITER, body: "x" }),
    ).rejects.toEqual(new CommentsRefused("damaged"));
    expect(memory.files.get("EL1")).toBe("{ not json");
  });

  it("tells a storage that did not answer from a node with no comments", async () => {
    const memory = memoryStore();
    memory.fail(true);
    const comments = service(memory.store);
    await comments.load(["EL1"]);
    expect(comments.stateOf("EL1")).toEqual({ status: "unavailable" });
    await expect(
      comments.open("EL1", { anchor, author: WRITER, body: "x" }),
    ).rejects.toBeInstanceOf(CommentsRefused);
    expect(memory.writes).toEqual([]);
    // A failed change does not block the next one once the storage is back.
    memory.fail(false);
    await comments.open("EL1", { anchor, author: WRITER, body: "y" });
    expect(memory.fileOf("EL1").threads).toHaveLength(1);
  });

  it("turns a persona's proposals into ghost comments, up to the cap", async () => {
    const memory = memoryStore();
    const comments = service(memory.store);
    const proposals = Array.from(
      { length: GHOST_COMMENTS_PER_SECTION + 2 },
      (_, i) => ({
        anchor: { quote: `passage ${i}`, prefix: "", suffix: "" },
        body: `Note ${i}`,
        weight: "minor" as const,
      }),
    );
    const admission = await comments.propose("EL1", "spark", proposals);
    expect(admission.admitted).toHaveLength(GHOST_COMMENTS_PER_SECTION);
    expect(admission.refused.map((r) => r.reason)).toEqual(["cap", "cap"]);
    const file = memory.fileOf("EL1");
    expect(file.threads.every((t) => t.state === "proposed")).toBe(true);
    expect(file.threads[0].entries[0].author).toEqual({
      kind: "persona",
      id: "spark",
    });
    expect(file.threads[0].weight).toBe("minor");
  });

  it("keeps a persona's reply short and every body plain", async () => {
    const memory = memoryStore();
    const comments = service(memory.store);
    const thread = await comments.open("EL1", {
      anchor,
      author: WRITER,
      body: " hi\u200B ",
    });
    const entry = await comments.reply(
      "EL1",
      thread,
      { kind: "persona", id: "nova" },
      "x".repeat(5000),
    );
    expect(entry.body.length).toBeLessThan(5000);
    expect(memory.fileOf("EL1").threads[0].entries[0].body).toBe("hi");
  });

  it("keeps the searches a persona's reply made, and none on a person's", async () => {
    const memory = memoryStore();
    const comments = service(memory.store);
    const thread = await comments.open("EL1", {
      anchor,
      author: WRITER,
      body: "Is it true?",
    });
    const search = {
      engine: "wikipedia" as const,
      query: "storm",
      links: [{ url: "https://e.org/storm", title: "Storm" }],
    };
    await comments.reply(
      "EL1",
      thread,
      { kind: "persona", id: "nova" },
      "It is.",
      [search],
    );
    await comments.reply("EL1", thread, WRITER, "Thanks.", [search]);
    const [, persona, writer] = memory.fileOf("EL1").threads[0].entries;
    expect(persona.searched).toEqual([search]);
    expect(writer.searched).toBeUndefined();
  });

  it("folds a moved passage into the file's next write, not one of its own", async () => {
    const memory = memoryStore();
    const comments = service(memory.store);
    const thread = await comments.open("EL1", {
      anchor,
      author: WRITER,
      body: "x",
    });
    const writes = memory.writes.length;
    const moved = { quote: "the storm", prefix: "Then ", suffix: "" };
    comments.noteMoved("EL1", thread, moved);
    expect(memory.writes.length).toBe(writes);
    await comments.resolve("EL1", thread);
    const file = memory.fileOf("EL1");
    expect(file.threads[0].anchor).toEqual(moved);
    expect(file.threads[0].state).toBe("resolved");
  });

  it("remembers a dismissed ghost comment in the file", async () => {
    const memory = memoryStore();
    const comments = service(memory.store);
    await comments.propose("EL1", "spark", [
      { anchor, body: "Twice?", weight: "minor" },
    ]);
    const [ghost] = memory.fileOf("EL1").threads;
    await comments.remove("EL1", ghost.id);
    expect(memory.fileOf("EL1").dismissed).toEqual([
      {
        persona: "spark",
        quote: "the storm",
        gist: "Twice?",
        at: "2026-10-05T10:00:00Z",
      },
    ]);
    const again = await comments.propose("EL1", "spark", [
      { anchor, body: "Twice, really?", weight: "major" },
    ]);
    expect(again.admitted).toEqual([]);
  });

  it("hears nothing once disposed", async () => {
    const comments = service(
      memoryStore({ EL1: writeComments({ threads: [], dismissed: [] }) }).store,
    );
    let heard = 0;
    comments.subscribe(() => (heard += 1));
    comments.dispose();
    await comments.load(["EL1"]);
    expect(heard).toBe(0);
  });
});
