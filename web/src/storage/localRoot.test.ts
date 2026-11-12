// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setLocalRootPickerForTest,
  __resetLocalRootCacheForTest,
  ensureLocalRoot,
  forgetLocalRoot,
  getLocalRoot,
  rootPermission,
  LOCAL_ROOT_KEY,
} from "./localRoot";
import type { StoredHandle } from "./handleStore";

// The File System Access API is Chromium-only and needs a native picker no
// test can drive, so this suite drives the picker seam
// (`__setLocalRootPickerForTest`, dev-gated) with a fake picker returning
// fake handles, as `mockDriveFetch` does for Drive.
//
// The handle store is mocked at the module boundary, as in
// `localProvider.test.ts`; its persistence (structured cloning of a handle
// into IndexedDB) is pinned in `handleStore.test.ts`. This suite pins the
// pick → store → ref contract, where the picked folder is the root, used
// verbatim, and the permission question.

const stored = new Map<string, StoredHandle>();

vi.mock("./handleStore", () => ({
  putHandle: async (key: string, handle: FileSystemDirectoryHandle) => {
    stored.set(key, {
      handle,
      name: (handle as { name: string }).name,
      openedAt: new Date().toISOString(),
    });
  },
  getHandle: async (key: string) => stored.get(key)?.handle ?? null,
  removeHandle: async (key: string) => void stored.delete(key),
  listHandles: async () =>
    [...stored.entries()].map(([key, record]) => ({ key, record })),
}));

interface FakeDir {
  name: string;
  children: Map<string, FakeDir>;
  queryPermission: () => Promise<PermissionState>;
  requestPermission: () => Promise<PermissionState>;
  /** Set to true when the writer was asked for permission. */
  requested: boolean;
  getDirectoryHandle: (
    name: string,
    opts?: { create?: boolean },
  ) => Promise<FakeDir>;
}

function makeDir(name: string, children: FakeDir[] = []): FakeDir {
  const dir: FakeDir = {
    name,
    children: new Map(),
    queryPermission: async () => "granted" as PermissionState,
    requestPermission: async () => {
      dir.requested = true;
      return "granted" as PermissionState;
    },
    requested: false,
    async getDirectoryHandle(
      this: FakeDir,
      name: string,
      opts: { create?: boolean } = {},
    ): Promise<FakeDir> {
      const existing = this.children.get(name);
      if (existing) return existing;
      if (!opts.create) throw new DOMException("Not found", "NotFoundError");
      const child = makeDir(name);
      this.children.set(name, child);
      return child;
    },
  };
  for (const child of children) dir.children.set(child.name, child);
  return dir;
}

/** A folder with ordinary contents, as a writer picks one. */
function pickedFolder(name = "documents"): FakeDir {
  return makeDir(name, [makeDir("recipes")]);
}

/** The picker seam takes a `FileSystemDirectoryHandle`; tests pass a fake. */
function pickerReturning(
  dir: FakeDir | null,
): () => Promise<FileSystemDirectoryHandle | null> {
  return async () => dir as unknown as FileSystemDirectoryHandle | null;
}

// The handle store keys by the signed-in user.
const { setCurrentUserId } = await import("../auth/currentUser");

beforeEach(() => {
  stored.clear();
  __resetLocalRootCacheForTest();
  setCurrentUserId("u1");
  // Chromium, as far as `localRoot` can tell; the picker itself is
  // seam-driven.
  vi.stubGlobal("window", { showDirectoryPicker: () => {} });
});

afterEach(() => {
  __setLocalRootPickerForTest(null);
  vi.unstubAllGlobals();
});

describe("ensureLocalRoot — the picked folder is the root", () => {
  it("stores the picked folder verbatim — nothing is nested or scaffolded", async () => {
    const picked = pickedFolder();
    __setLocalRootPickerForTest(pickerReturning(picked));

    const ref = await ensureLocalRoot();

    expect(ref?.key).toBe(LOCAL_ROOT_KEY);
    // The ref names what the writer picked: there is no app-owned folder on
    // local disk.
    expect(ref?.name).toBe("documents");
    expect(stored.get(LOCAL_ROOT_KEY)?.handle).toBe(picked);
    // Existing children are left as they were: nothing scaffolded inside,
    // nothing renamed.
    expect(picked.children.has("recipes")).toBe(true);
    expect(picked.children.size).toBe(1);
  });

  it("picking a different folder replaces the stored root", async () => {
    __setLocalRootPickerForTest(pickerReturning(pickedFolder("documents")));
    await ensureLocalRoot();

    const other = pickedFolder("other-place");
    __setLocalRootPickerForTest(pickerReturning(other));
    await ensureLocalRoot();

    expect(stored.get(LOCAL_ROOT_KEY)?.handle).toBe(other);
  });

  it("returns null when the writer closes the picker", async () => {
    __setLocalRootPickerForTest(pickerReturning(null));
    expect(await ensureLocalRoot()).toBeNull();
  });
});

describe("rootPermission", () => {
  it("is granted when the browser already says so", async () => {
    __setLocalRootPickerForTest(pickerReturning(pickedFolder()));
    await ensureLocalRoot();

    expect(await rootPermission()).toBe("granted");
  });

  it("is needs-gesture when permission has lapsed to prompt", async () => {
    __setLocalRootPickerForTest(pickerReturning(pickedFolder()));
    await ensureLocalRoot();

    const root = stored.get(LOCAL_ROOT_KEY)?.handle as unknown as FakeDir;
    root.queryPermission = async () => "prompt" as PermissionState;
    expect(await rootPermission()).toBe("needs-gesture");
  });

  it("is gone when no root exists yet", async () => {
    expect(await rootPermission()).toBe("gone");
  });

  it("never asks the writer for permission", async () => {
    __setLocalRootPickerForTest(pickerReturning(pickedFolder()));
    await ensureLocalRoot();
    const root = stored.get(LOCAL_ROOT_KEY)?.handle as unknown as FakeDir;

    await rootPermission();
    expect(root.requested).toBe(false);
  });
});

// `getLocalRoot()` caches the resolved handle between the two events that can
// change it, a re-pick (`ensureLocalRoot`) and a forget (`forgetLocalRoot`),
// so a run of file operations in between shares one IndexedDB read.
describe("getLocalRoot caching", () => {
  it("resolves the stored handle once for repeated calls", async () => {
    __setLocalRootPickerForTest(pickerReturning(pickedFolder()));
    await ensureLocalRoot();
    const getSpy = vi.fn(stored.get.bind(stored));
    stored.get = getSpy;

    await getLocalRoot();
    await getLocalRoot();

    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("re-reads after a fresh pick replaces the root", async () => {
    __setLocalRootPickerForTest(pickerReturning(pickedFolder()));
    await ensureLocalRoot();
    const first = await getLocalRoot();

    const secondPick = pickedFolder();
    __setLocalRootPickerForTest(pickerReturning(secondPick));
    await ensureLocalRoot();
    const second = await getLocalRoot();

    expect(second).not.toBe(first);
    expect(second).toBe(secondPick);
  });

  it("re-reads after forgetLocalRoot clears the root", async () => {
    __setLocalRootPickerForTest(pickerReturning(pickedFolder()));
    await ensureLocalRoot();
    expect(await getLocalRoot()).not.toBeNull();

    await forgetLocalRoot();

    expect(await getLocalRoot()).toBeNull();
  });

  it("re-reads after an account change — the memo never outlives its user", async () => {
    __setLocalRootPickerForTest(pickerReturning(pickedFolder()));
    await ensureLocalRoot();
    const getSpy = vi.fn(stored.get.bind(stored));
    stored.get = getSpy;

    await getLocalRoot();
    expect(getSpy).toHaveBeenCalledTimes(1);

    // `AuthContext` sets the user on every sign-in and sign-out, the signal
    // the purge sweep (`purgeOtherUsersLocalData`) also follows. A handle that
    // survives the switch would answer the next account with the departed
    // account's root, or resurrect a purged one. The `beforeEach` signed "u1"
    // in, so the switch must be to another account for the listener to fire.
    setCurrentUserId("u2");
    await getLocalRoot();
    await getLocalRoot();

    expect(getSpy).toHaveBeenCalledTimes(2);
    setCurrentUserId(null);
  });
});

// The re-grant path is the picker (`ensureLocalRoot`), never a
// `requestPermission` on the stored handle. The "rootPermission never
// asks" rows hold that boundary: everything here is query-only.
