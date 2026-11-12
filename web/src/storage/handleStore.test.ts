// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

// A plain object stands in for a `FileSystemDirectoryHandle`: these rows pin
// key scoping and round-tripping, not the File System Access API, which jsdom
// cannot run (`localProvider.test.ts` makes the same call).
function fakeHandle(name: string): FileSystemDirectoryHandle {
  return { name } as unknown as FileSystemDirectoryHandle;
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const { setCurrentUserId } = await import("../auth/currentUser");
  setCurrentUserId("test-user");
});

afterEach(() => vi.unstubAllGlobals());

describe("putHandle / getHandle / removeHandle", () => {
  it("round-trips a handle by key", async () => {
    const { putHandle, getHandle } = await import("./handleStore");
    await putHandle("project-a", fakeHandle("Once Dark"));
    expect((await getHandle("project-a"))?.name).toBe("Once Dark");
  });

  it("returns null for a key that was never stored", async () => {
    const { getHandle } = await import("./handleStore");
    expect(await getHandle("never-stored")).toBeNull();
  });

  it("removeHandle drops exactly the named key", async () => {
    const { putHandle, getHandle, removeHandle } =
      await import("./handleStore");
    await putHandle("project-a", fakeHandle("A"));
    await putHandle("project-b", fakeHandle("B"));

    await removeHandle("project-a");

    expect(await getHandle("project-a")).toBeNull();
    expect((await getHandle("project-b"))?.name).toBe("B");
  });

  it("does not throw removing a key that was never there", async () => {
    const { removeHandle } = await import("./handleStore");
    await expect(removeHandle("never-stored")).resolves.toBeUndefined();
  });
});

describe("listHandles", () => {
  it("lists every stored handle, newest first", async () => {
    const { putHandle, listHandles } = await import("./handleStore");
    await putHandle("older", fakeHandle("Older"));
    await putHandle("newer", fakeHandle("Newer"));

    const all = await listHandles();

    expect(all.map((e) => e.key)).toEqual(["newer", "older"]);
  });

  it("is empty when nothing is stored", async () => {
    const { listHandles } = await import("./handleStore");
    expect(await listHandles()).toEqual([]);
  });
});

describe("switching users", () => {
  it("keeps handles apart, even under the same key", async () => {
    const { setCurrentUserId } = await import("../auth/currentUser");
    const { putHandle, getHandle, listHandles } = await import("./handleStore");

    await putHandle("shared-key", fakeHandle("User A copy"));

    setCurrentUserId("user-b");
    expect(await getHandle("shared-key")).toBeNull();
    expect(await listHandles()).toEqual([]);
    await putHandle("shared-key", fakeHandle("User B copy"));

    setCurrentUserId("test-user");
    expect((await getHandle("shared-key"))?.name).toBe("User A copy");
    expect(await listHandles()).toHaveLength(1);
  });
});
