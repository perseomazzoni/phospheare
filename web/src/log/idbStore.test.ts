// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { LogEntry } from "./domain/line";
import { MAX_SIZE } from "./domain/retention";

// A real IndexedDB, not a mock, fresh for each test: `openLogDb()` keeps its
// connection module-wide.

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const line = (at: number, message: string, size = 100) => ({
  entry: {
    at,
    level: "info",
    area: "app",
    message,
    account: null,
    fields: {},
  } satisfies LogEntry,
  size,
});

describe("the log in IndexedDB", () => {
  it("keeps lines in the order they came, and clears them", async () => {
    const { idbLogStore } = await import("./idbStore");
    const store = idbLogStore();
    await store.append([line(2, "first"), line(1, "second")]);
    await store.append([line(3, "third")]);
    expect((await store.read()).map((e) => e.message)).toEqual([
      "first",
      "second",
      "third",
    ]);
    await store.clear();
    expect(await store.read()).toEqual([]);
  });

  it("drops the lines older than the limit", async () => {
    const { idbLogStore } = await import("./idbStore");
    const store = idbLogStore();
    await store.append([line(10, "old"), line(20, "edge"), line(30, "new")]);
    await store.prune(20);
    expect((await store.read()).map((e) => e.message)).toEqual(["edge", "new"]);
  });

  it("drops the oldest lines past the size limit", async () => {
    const { idbLogStore } = await import("./idbStore");
    const store = idbLogStore();
    const quarter = MAX_SIZE / 4;
    await store.append([1, 2, 3, 4, 5].map((n) => line(n, `l${n}`, quarter)));
    await store.prune(0);
    // Five quarters are over; trimming to eight tenths keeps three.
    expect((await store.read()).map((e) => e.message)).toEqual([
      "l3",
      "l4",
      "l5",
    ]);
  });

  it("keeps one size for the lines of every tab", async () => {
    const { idbLogStore } = await import("./idbStore");
    // Two tabs: each store writes its own lines to the one log.
    const one = idbLogStore();
    const two = idbLogStore();
    const quarter = MAX_SIZE / 4;
    await one.append([line(1, "l1", quarter), line(2, "l2", quarter)]);
    await two.append([line(3, "l3", quarter), line(4, "l4", quarter)]);
    await one.append([line(5, "l5", quarter)]);
    await two.prune(0);
    expect((await one.read()).map((e) => e.message)).toEqual([
      "l3",
      "l4",
      "l5",
    ]);
  });

  it("counts a log written without its size once", async () => {
    const { idbLogStore } = await import("./idbStore");
    const { openLogDb, STORE_LOG } = await import("../storage/idb");
    const quarter = MAX_SIZE / 4;
    const db = await openLogDb();
    await new Promise<void>((resolve) => {
      const t = db.transaction(STORE_LOG, "readwrite");
      for (const n of [1, 2, 3]) {
        const { entry, size } = line(n, `l${n}`, quarter);
        t.objectStore(STORE_LOG).add({ at: n, size, entry });
      }
      t.oncomplete = () => resolve();
    });
    const store = idbLogStore();
    await store.append([4, 5].map((n) => line(n, `l${n}`, quarter)));
    await store.prune(0);
    expect((await store.read()).map((e) => e.message)).toEqual([
      "l3",
      "l4",
      "l5",
    ]);
  });

  it("keeps nothing in a browser without IndexedDB", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const { idbLogStore } = await import("./idbStore");
    const store = idbLogStore();
    await store.append([line(1, "lost")]);
    await store.prune(0);
    await store.clear();
    expect(await store.read()).toEqual([]);
  });
});
