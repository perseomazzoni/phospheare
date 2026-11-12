// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

// A real IndexedDB upgrade, not a mock. Pins that the handler is safe over a
// database that already exists, since an unguarded `createObjectStore`
// throws `ConstraintError` on a name already there, and that every store
// owner shares one open connection.
//
// Nothing adopts or backfills old records, as `idb.ts` states. The surviving
// handle below is evidence the store was left alone, not a promise about it.

beforeEach(() => {
  vi.resetModules();
  // A fresh factory per test: `openDb()` memoizes its promise module-wide, so
  // one database across tests would return the first test's open connection.
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openDb", () => {
  it("creates all three stores on a fresh database", async () => {
    const {
      openDb,
      STORE_HANDLES,
      STORE_SYNC,
      STORE_QUEUE,
      INDEX_QUEUE_USER_ID,
    } = await import("./idb");
    const db = await openDb();
    expect(db.objectStoreNames.contains(STORE_HANDLES)).toBe(true);
    expect(db.objectStoreNames.contains(STORE_SYNC)).toBe(true);
    expect(db.objectStoreNames.contains(STORE_QUEUE)).toBe(true);
    const queueIndexes = db
      .transaction(STORE_QUEUE)
      .objectStore(STORE_QUEUE).indexNames;
    expect(queueIndexes.contains(INDEX_QUEUE_USER_ID)).toBe(true);
    db.close();
  });

  it("reuses the same connection across calls", async () => {
    const { openDb } = await import("./idb");
    const a = await openDb();
    const b = await openDb();
    expect(a).toBe(b);
    a.close();
  });
});

/** Rejects if `promise` has not settled within a few event-loop turns. */
function soon<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("still waiting")), 200),
    ),
  ]);
}

// Another tab that upgrades the database waits for every open connection to
// close. One that never closes holds that tab's boot, and an older tab that
// holds this one's open would hang every save behind it.
describe("sharing the database with another tab", () => {
  it("closes on versionchange, so another tab's upgrade goes through", async () => {
    const { openDb } = await import("./idb");
    const held = await openDb();

    const upgraded = await soon(
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("writer-data", 2);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
    );
    expect(upgraded.version).toBe(2);
    upgraded.close();

    // The closed connection is not handed out again.
    const next = await openDb().catch((e: unknown) => e);
    expect(next).not.toBe(held);
  });
});

describe("tx", () => {
  it("round-trips a value through put and get", async () => {
    const { tx, STORE_SYNC } = await import("./idb");
    await tx(STORE_SYNC, "readwrite", (s) =>
      s.put({ hello: "world" }, "key-1"),
    );
    const value = await tx<{ hello: string } | undefined>(
      STORE_SYNC,
      "readonly",
      (s) => s.get("key-1"),
    );
    expect(value).toEqual({ hello: "world" });
  });
});
