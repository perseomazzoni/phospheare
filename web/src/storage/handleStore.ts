// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Directory handle persistence. A `FileSystemDirectoryHandle` is
// structured-cloneable, so IndexedDB holds it across reloads and the writer
// does not re-pick their folder on every refresh. The store holds one record
// per user: the local root handle under `LOCAL_ROOT_KEY`.
//
// Permission is not stored with the handle: `localRoot.ts` re-queries it,
// and re-grants it by a fresh pick.
//
// Keyed `[userId, key]`: a browser profile is shared, and a bare `key` would
// let one account's root answer for another's. `userId` comes from
// `getCurrentUserId()`, not a parameter, because every caller arrives from a
// `StorageProvider` method, and the port is account-agnostic.

import { STORE_HANDLES, tx } from "./idb";
import { getCurrentUserId } from "../auth/currentUser";
import { appLog, describeError } from "../log";

export interface StoredHandle {
  handle: FileSystemDirectoryHandle;
  name: string;
  openedAt: string;
}

type StoredKey = [userId: string, key: string];

function keyFor(key: string): StoredKey {
  const userId = getCurrentUserId();
  if (!userId) throw new Error("handleStore: called with no signed-in user");
  return [userId, key];
}

export async function putHandle(
  key: string,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const record: StoredHandle = {
    handle,
    name: handle.name,
    openedAt: new Date().toISOString(),
  };
  await tx(STORE_HANDLES, "readwrite", (s) => s.put(record, keyFor(key)));
}

export async function getHandle(
  key: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const record = await tx<StoredHandle | undefined>(
      STORE_HANDLES,
      "readonly",
      (s) => s.get(keyFor(key)),
    );
    return record?.handle ?? null;
  } catch (err) {
    appLog.warn("storage", "The stored local folder could not be read.", {
      ...describeError(err),
    });
    return null;
  }
}

export async function removeHandle(key: string): Promise<void> {
  try {
    await tx(STORE_HANDLES, "readwrite", (s) => s.delete(keyFor(key)));
  } catch {
    // A handle that cannot be deleted is not worth failing an open over.
  }
}

/**
 * Drops every stored record that belongs neither to `currentUserId` nor to
 * a `spared` account kept on this browser, so a previous account's row does
 * not stay in IndexedDB forever. Best-effort; never throws.
 */
export async function removeHandlesExcept(
  currentUserId: string,
  ...spared: string[]
): Promise<void> {
  const kept = [currentUserId, ...spared];
  try {
    const keys = await tx<IDBValidKey[]>(STORE_HANDLES, "readonly", (s) =>
      s.getAllKeys(),
    );
    const stale = keys.filter(
      (k): k is StoredKey => Array.isArray(k) && !kept.includes(k[0] as string),
    );
    await Promise.all(
      stale.map((k) => tx(STORE_HANDLES, "readwrite", (s) => s.delete(k))),
    );
  } catch {
    // Best-effort, like every clearing call in this module.
  }
}

/** Every stored record for the signed-in user, newest first: the root. */
export async function listHandles(): Promise<
  { key: string; record: StoredHandle }[]
> {
  const userId = getCurrentUserId();
  if (!userId) return [];
  try {
    const keys = await tx<IDBValidKey[]>(STORE_HANDLES, "readonly", (s) =>
      s.getAllKeys(),
    );
    const records = await tx<StoredHandle[]>(STORE_HANDLES, "readonly", (s) =>
      s.getAll(),
    );
    return keys
      .map((key, i) => ({ key, record: records[i] }))
      .filter(
        (e): e is { key: StoredKey; record: StoredHandle } =>
          Array.isArray(e.key) && e.key[0] === userId && !!e.record,
      )
      .map((e) => ({ key: String(e.key[1]), record: e.record }))
      .sort((a, b) => b.record.openedAt.localeCompare(a.record.openedAt));
  } catch {
    return [];
  }
}
