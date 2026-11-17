// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { INDEX_LOG_AT, STORE_LOG, openLogDb } from "../storage/idb";
import type { LogStore, StoredLine } from "./application/logger";
import type { LogEntry } from "./domain/line";
import { dropsOldest } from "./domain/retention";

// The browser's side of the log: its lines in IndexedDB, one record each,
// `{id, at, size, entry}`. The id keeps them in the order they were made.
//
// One more record, at id 0, keeps the size of all the lines, so a prune
// reads only the lines it removes and never the whole log. Each write
// changes it in the same transaction as the lines, and IndexedDB runs the
// writes of every tab one at a time, so it stays exact. It has no `at`, so
// the index of times leaves it out.

interface Row {
  id?: number;
  at: number;
  size: number;
  entry: LogEntry;
}

interface Total {
  id: typeof TOTAL_ID;
  total: number;
}

const TOTAL_ID = 0;
/**
 * Every line: autoincrement ids start at 1. Made at each call, as a browser
 * without IndexedDB has no `IDBKeyRange` to load the module with.
 */
const lines = () => IDBKeyRange.lowerBound(TOTAL_ID, true);

function done(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function run(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => void,
): Promise<void> {
  const db = await openLogDb();
  const t = db.transaction(STORE_LOG, mode);
  work(t.objectStore(STORE_LOG));
  await done(t);
}

/**
 * Hands `give` the size of all the lines. A log without the record, as one
 * written before it was kept, is counted once, and the record written.
 */
function withTotal(store: IDBObjectStore, give: (total: number) => void): void {
  const kept = store.get(TOTAL_ID);
  kept.onsuccess = () => {
    const record = kept.result as Total | undefined;
    if (record) {
      give(record.total);
      return;
    }
    const all = store.getAll(lines());
    all.onsuccess = () =>
      give((all.result as Row[]).reduce((sum, row) => sum + row.size, 0));
  };
}

/** A store in IndexedDB; with none in this browser, a store that keeps nothing. */
export function idbLogStore(): LogStore {
  if (typeof indexedDB === "undefined") {
    return {
      append: async () => {},
      read: async () => [],
      prune: async () => {},
      clear: async () => {},
    };
  }
  return {
    append: (batch: readonly StoredLine[]) =>
      run("readwrite", (store) => {
        // The total is read first, so a log counted now counts the lines
        // before these, which it then adds.
        withTotal(store, (total) => {
          let added = 0;
          for (const { entry, size } of batch) {
            store.add({ at: entry.at, size, entry } satisfies Row);
            added += size;
          }
          store.put({ id: TOTAL_ID, total: total + added } satisfies Total);
        });
      }),

    async read() {
      let rows: Row[] = [];
      await run("readonly", (store) => {
        const req = store.getAll(lines());
        req.onsuccess = () => (rows = req.result as Row[]);
      });
      return rows.map((row) => row.entry);
    },

    prune: (before: number) =>
      run("readwrite", (store) => {
        withTotal(store, (start) => {
          let total = start;
          // The lines past their time, by the index of times.
          const old = store
            .index(INDEX_LOG_AT)
            .openCursor(IDBKeyRange.upperBound(before, true));
          old.onsuccess = () => {
            const cursor = old.result;
            if (cursor) {
              total -= (cursor.value as Row).size;
              cursor.delete();
              cursor.continue();
              return;
            }
            // Then the oldest lines, while the rest are past the size limit.
            let trimming = false;
            const oldest = store.openCursor(lines());
            oldest.onsuccess = () => {
              const next = oldest.result;
              if (next && dropsOldest(total, trimming)) {
                trimming = true;
                total -= (next.value as Row).size;
                next.delete();
                next.continue();
                return;
              }
              store.put({ id: TOTAL_ID, total } satisfies Total);
            };
          };
        });
      }),

    clear: () =>
      run("readwrite", (store) => {
        store.clear();
        store.put({ id: TOTAL_ID, total: 0 } satisfies Total);
      }),
  };
}
