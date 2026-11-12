// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

// The drain against the same seams `remoteQueue.test.ts` fakes: the working
// copy, the registry and the pairing. The manifest store is real, because the
// lock guards its read-modify-write.

const BOOK = "book-local-project-a";
const P = { id: BOOK, providerId: "local", key: "project-a" };

const writeFile = vi.fn();
const cacheRead = vi.fn();
const pairingFor = vi.fn();

vi.mock("../../storage/localProvider", () => ({
  localProvider: { id: "local", readFile: vi.fn() },
}));
vi.mock("../../storage/cache/opfsCacheStore", () => ({
  openCacheStore: () => ({
    read: (...args: unknown[]) => cacheRead(...args),
    write: vi.fn(),
    has: vi.fn(),
    remove: vi.fn(),
    dropProject: vi.fn(),
    dispose: vi.fn(),
  }),
}));
const remoteProvider = {
  id: "drive",
  kind: "remote" as const,
  writeFile: (...args: unknown[]) => writeFile(...args),
};
vi.mock("../../storage", () => ({
  getProvider: (id: string) => (id === "drive" ? remoteProvider : null),
  isRemoteRef: (ref: { providerId: string }) => ref.providerId === "drive",
}));
vi.mock("../projectId", () => ({ projectIdFor: () => BOOK }));
vi.mock("./pairing", () => ({
  pairingFor: (...args: unknown[]) => pairingFor(...args),
}));

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  writeFile.mockReset();
  cacheRead.mockReset();
  pairingFor.mockReset();
  const { setCurrentUserId } = await import("../../auth/currentUser");
  setCurrentUserId("test-user");
});

afterEach(() => vi.unstubAllGlobals());

describe("the project sync lock", () => {
  it("the drain pushes and levels its baseline only once a running check releases the lock", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "pushed", hash: "h" });
    writeFile.mockResolvedValue(undefined);
    // The platform's lock manager, with a record of every lock asked for.
    const locks = navigator.locks;
    const asked: string[] = [];
    vi.stubGlobal("navigator", {
      locks: {
        request: (name: string, run: () => Promise<unknown>) => {
          asked.push(name);
          return locks.request(name, run);
        },
      },
    });

    const { enqueue, isPending } = await import("./remoteQueue");
    const { withSyncLock } = await import("./syncLock");
    const { getManifest, putManifest } = await import("./manifestStore");
    const { emptyManifest } = await import("./manifest");
    const { sha256Hex } = await import("../../text/hash");

    await putManifest(
      BOOK,
      emptyManifest({ providerId: "drive", key: "folder-1" }),
    );

    // A check holding the lock: it writes the manifest it read at its start
    // when it finishes.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const check = withSyncLock(BOOK, async () => {
      const read = await getManifest(BOOK);
      if (!read) throw new Error("the pairing's manifest is missing");
      await gate;
      await putManifest(BOOK, read);
    });

    await enqueue(P, { kind: "put", path: "/a.md" });

    // The drain asks for the project's lock as it reaches it: once it has,
    // the push it has not made is the lock's doing, not a slow drain.
    // The platform's locks outlive the test, so a failure here still lets go.
    try {
      await vi.waitFor(() =>
        expect(
          asked.filter((name) => name.startsWith("project-sync")),
        ).toHaveLength(2),
      );
      expect(writeFile).not.toHaveBeenCalled();
      expect((await getManifest(BOOK))?.files["/a.md"]).toBeUndefined();
    } finally {
      release();
    }
    await check;
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalled());
    await vi.waitFor(() => expect(isPending(P)).toBe(false));

    // Levelled after the check's write, so the check did not drop it.
    const baseline = (await getManifest(BOOK))?.files["/a.md"];
    expect(baseline?.local).toBe(await sha256Hex("pushed"));
    expect(baseline?.remote).toBe(await sha256Hex("pushed"));
  });

  it("orders two tabs, which share the manifest", async () => {
    // Each tab has its own modules over one IndexedDB. A lock held in one
    // tab only would let the other tab's check write a stale manifest over
    // this tab's drain.
    const first = await import("./syncLock");
    vi.resetModules();
    const { setCurrentUserId } = await import("../../auth/currentUser");
    setCurrentUserId("test-user");
    const second = await import("./syncLock");

    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const held = first.withSyncLock(BOOK, async () => {
      order.push("first in");
      await gate;
      order.push("first out");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const waiting = second.withSyncLock(BOOK, async () => {
      order.push("second in");
    });

    // A second tab that ran past the lock would be in before the first is
    // out, which the order below catches.
    release();
    await Promise.all([held, waiting]);
    expect(order).toEqual(["first in", "first out", "second in"]);
  });
});
