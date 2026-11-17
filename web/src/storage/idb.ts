// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { StorageError } from "./types";

// ── The sole IndexedDB opener ────────────────────────────────────────────────
//
// IndexedDB runs one upgrade transaction per database, and every store must be
// declared there, so every store of the writer's data lives in one database
// opened only from this file. Two call sites racing their own
// `indexedDB.open` with different versions would let a stray `VersionError`
// reach a writer mid-session.

// Per-user scoping (handles and sync keyed `[userId, key]`) lives in the store
// modules, because out-of-line keys accept arrays. Queue records instead keep
// `userId` as a field, since their auto-incrementing `id` keyPath gives FIFO
// order, so the database declares a `userId` index for per-user drains. The
// user comes from `auth/currentUser.ts`.

// Neutral: developer tools list it, so it names no product or project,
// and IndexedDB is per origin, so no other brand of this code can share it.
const DB_NAME = "writer-data";
// The queue store is `queue`, and a queued op names the whole project ref,
// not a bare `localKey` that only a device project has.
const DB_VERSION = 1;

export const STORE_HANDLES = "handles";
export const STORE_SYNC = "sync";
export const STORE_QUEUE = "queue";
export const INDEX_QUEUE_USER_ID = "userId";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // ── The upgrade handler ──────────────────────────────────────────────────
    //
    // Schema creation, not data migration. A record written under an older
    // shape is left as it is, and no code backfills it. After the handler
    // runs, the three stores and the queue index exist.
    //
    // Every branch is guarded because `openDb` runs against whatever version
    // this browser already holds: `createObjectStore` on an existing name
    // throws `ConstraintError` and takes the whole database down. The guards
    // make the handler safe to re-enter; they rescue no data.
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_HANDLES)) {
        db.createObjectStore(STORE_HANDLES);
      }
      if (!db.objectStoreNames.contains(STORE_SYNC)) {
        db.createObjectStore(STORE_SYNC);
      }
      // An upgrade always runs inside a transaction, so `null` means
      // IndexedDB misbehaved. Falling through would commit the queue store
      // without its index, and every per-user drain after this boot would
      // read nothing, so the open fails instead.
      const tx = req.transaction;
      if (tx === null) throw new Error("idb upgrade: no upgrade transaction");
      const queue = db.objectStoreNames.contains(STORE_QUEUE)
        ? tx.objectStore(STORE_QUEUE)
        : db.createObjectStore(STORE_QUEUE, {
            keyPath: "id",
            autoIncrement: true,
          });
      if (!queue.indexNames.contains(INDEX_QUEUE_USER_ID)) {
        queue.createIndex(INDEX_QUEUE_USER_ID, "userId");
      }
    };
    // An upgrade in another tab waits until every open connection closes. A
    // connection that ignores `versionchange` holds that tab's boot for as
    // long as this one stays open, so it closes, and the next call here opens
    // again. An older tab holding its connection blocks this open the same
    // way; the open fails instead of hanging every save behind it, and the
    // next call asks again. A connection that arrives after the failure is
    // closed at once.
    let settled = false;
    req.onsuccess = () => {
      const db = req.result;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      db.onversionchange = () => {
        db.close();
        if (dbPromise === opening) dbPromise = null;
      };
      resolve(db);
    };
    req.onblocked = () => {
      if (settled) return;
      settled = true;
      if (dbPromise === opening) dbPromise = null;
      reject(
        new StorageError(
          "idb: another tab holds an older version of the database open",
          "unavailable",
        ),
      );
    };
    req.onerror = () => {
      settled = true;
      reject(req.error);
    };
  });
  dbPromise = opening;
  return opening;
}

// ── The log's database ───────────────────────────────────────────────────────
//
// The app's log (`log/`) has a database of its own, opened here too. Its
// writes are frequent and best effort, and a full or failing log must never
// hold up the writer's data, nor an upgrade of it; it is emptied on its own.

const LOG_DB_NAME = "writer-log";
const LOG_DB_VERSION = 1;

export const STORE_LOG = "lines";
/** Lines by their time, for the prune of old ones. */
export const INDEX_LOG_AT = "at";

let logDbPromise: Promise<IDBDatabase> | null = null;

export function openLogDb(): Promise<IDBDatabase> {
  if (logDbPromise) return logDbPromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(LOG_DB_NAME, LOG_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_LOG)) {
        db.createObjectStore(STORE_LOG, {
          keyPath: "id",
          autoIncrement: true,
        }).createIndex(INDEX_LOG_AT, "at");
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        if (logDbPromise === opening) logDbPromise = null;
      };
      resolve(db);
    };
    req.onblocked = () => {
      if (logDbPromise === opening) logDbPromise = null;
      reject(new StorageError("idb: the log is held open", "unavailable"));
    };
    req.onerror = () => {
      if (logDbPromise === opening) logDbPromise = null;
      reject(req.error);
    };
  });
  logDbPromise = opening;
  return opening;
}

/**
 * One request in one transaction against one store. Every store owner goes
 * through this instead of opening its own transaction, so the failure shape
 * is the same everywhere.
 */
export function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/**
 * Two readonly requests sharing one transaction, so both see the same
 * snapshot. Separate `getAllKeys()` and `getAll()` transactions let a write
 * land between them and pair each key with the wrong record.
 */
export function txPair<T1, T2>(
  store: string,
  run: (store: IDBObjectStore) => [IDBRequest<T1>, IDBRequest<T2>],
): Promise<[T1, T2]> {
  return openDb().then(
    (db) =>
      new Promise<[T1, T2]>((resolve, reject) => {
        const t = db.transaction(store, "readonly");
        const s = t.objectStore(store);
        const [r1, r2] = run(s);
        const results: [unknown, unknown] = [undefined, undefined];
        let pending = 2;
        const settle = () => {
          if (--pending === 0) resolve(results as [T1, T2]);
        };
        r1.onsuccess = () => {
          results[0] = r1.result;
          settle();
        };
        r1.onerror = () => reject(r1.error);
        r2.onsuccess = () => {
          results[1] = r2.result;
          settle();
        };
        r2.onerror = () => reject(r2.error);
      }),
  );
}
