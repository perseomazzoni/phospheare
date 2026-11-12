// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

// Every test gets a fresh module (a fresh in-memory cache) and a fresh
// database: `pairing.ts` warms its cache on user change, so reusing either
// across tests would leak state from whichever test ran first.

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const { setCurrentUserId } = await import("../../auth/currentUser");
  setCurrentUserId("test-user");
});

afterEach(() => vi.unstubAllGlobals());

describe("pair / unpair / pairingFor", () => {
  it("a freshly paired project is found by pairingFor", async () => {
    const { pair, pairingFor } = await import("./pairing");
    await pair("local-1", { providerId: "drive", key: "folder-1" });
    expect(await pairingFor("local-1")).toEqual({
      providerId: "drive",
      key: "folder-1",
    });
  });

  it("an unpaired project has no pairing", async () => {
    const { pairingFor } = await import("./pairing");
    expect(await pairingFor("never-paired")).toBeNull();
  });

  it("unpair removes it", async () => {
    const { pair, pairingFor, unpair } = await import("./pairing");
    await pair("local-1", { providerId: "drive", key: "folder-1" });
    await unpair("local-1");
    expect(await pairingFor("local-1")).toBeNull();
  });

  it("unpair drops the working copy filled for that remote", async () => {
    // An unpaired project is Local and never reads it again.
    const { fakeOpfs } = await import("../../storage/cache/fakeOpfs.fixture");
    const opfs = fakeOpfs();
    opfs.install();
    try {
      const { openCacheStore } =
        await import("../../storage/cache/opfsCacheStore");
      const { pair, unpair } = await import("./pairing");
      const remote = { providerId: "drive", key: "folder-1" };
      await pair("local-1", remote);
      const before = openCacheStore({ id: "local-1", remote });
      await before.write("/document/a.md", "prose");
      before.dispose();

      await unpair("local-1");

      const after = openCacheStore({ id: "local-1", remote });
      expect(await after.read("/document/a.md")).toBeNull();
      after.dispose();
    } finally {
      opfs.uninstall();
    }
  });

  it("re-pairing the same project to a different folder updates it in place", async () => {
    const { pair, pairingFor } = await import("./pairing");
    await pair("local-1", { providerId: "drive", key: "folder-1" });
    await pair("local-1", { providerId: "drive", key: "folder-2" });
    expect(await pairingFor("local-1")).toEqual({
      providerId: "drive",
      key: "folder-2",
    });
  });
});

describe("allPairings", () => {
  it("maps each project id to the remote it is paired with", async () => {
    const { pair, allPairings } = await import("./pairing");
    await pair("local-1", { providerId: "drive", key: "folder-1" });
    await pair("local-2", { providerId: "drive", key: "folder-2" });

    const all = await allPairings();

    expect(all.get("local-1")).toEqual({
      providerId: "drive",
      key: "folder-1",
    });
    expect(all.get("local-2")).toEqual({
      providerId: "drive",
      key: "folder-2",
    });
    expect(all.size).toBe(2);
  });

  it("is empty when nothing is paired", async () => {
    const { allPairings } = await import("./pairing");
    expect((await allPairings()).size).toBe(0);
  });
});

describe("pairingForSync", () => {
  it("reads a pairing made through pair() once the cache has caught up", async () => {
    const { pair, pairingForSync } = await import("./pairing");
    await pair("local-1", { providerId: "drive", key: "folder-1" });
    // `pair()` awaits the cache load, so once it resolves the synchronous
    // read is safe, the one case `pairingForSync` promises.
    expect(pairingForSync("local-1")).toEqual({
      providerId: "drive",
      key: "folder-1",
    });
  });

  it("is null for a project nobody has paired", async () => {
    const { pair, pairingForSync } = await import("./pairing");
    await pair("local-1", { providerId: "drive", key: "folder-1" });
    expect(pairingForSync("local-2")).toBeNull();
  });
});

describe("switching users", () => {
  it("drops the in-memory cache — a pairing made as one user is invisible to the next", async () => {
    const { setCurrentUserId } = await import("../../auth/currentUser");
    const { pair, pairingFor, pairingForSync } = await import("./pairing");

    await pair("shared-key", { providerId: "drive", key: "folder-a" });
    expect(pairingForSync("shared-key")).toEqual({
      providerId: "drive",
      key: "folder-a",
    });

    setCurrentUserId("user-b");
    // The reload `onUserChange` starts is async; `pairingFor` awaits it.
    expect(await pairingFor("shared-key")).toBeNull();
    expect(pairingForSync("shared-key")).toBeNull();

    setCurrentUserId("test-user");
    expect(await pairingFor("shared-key")).toEqual({
      providerId: "drive",
      key: "folder-a",
    });
  });
});

// ── A database that cannot be read ───────────────────────────────────────────
//
// A failed read must never answer "not paired": the queue drops a device
// project's changes on that answer. These tests fail the IndexedDB reads
// themselves, the layer under `manifestStore.ts`, while `failing` is set.

let failing = false;

/** Reloads the modules with sync-store reads failing while `failing` holds. */
async function withFailingReads(): Promise<void> {
  vi.resetModules();
  vi.doMock("../../storage/idb", async (importOriginal) => {
    const real = await importOriginal<typeof import("../../storage/idb")>();
    const refused = () => Promise.reject(new Error("IndexedDB is unavailable"));
    return {
      ...real,
      tx: ((store, mode, run) =>
        failing && store === real.STORE_SYNC && mode === "readonly"
          ? refused()
          : real.tx(store, mode, run)) as typeof real.tx,
      txPair: ((store, run) =>
        failing && store === real.STORE_SYNC
          ? refused()
          : real.txPair(store, run)) as typeof real.txPair,
    };
  });
  const { setCurrentUserId } = await import("../../auth/currentUser");
  setCurrentUserId("test-user");
}

describe("when the pairings cannot be read", () => {
  afterEach(() => {
    failing = false;
    vi.doUnmock("../../storage/idb");
  });

  it("rejects instead of answering unpaired, and answers once the read recovers", async () => {
    const before = await import("./pairing");
    await before.pair("local-1", { providerId: "drive", key: "folder-1" });

    await withFailingReads();
    failing = true;
    const { pairingFor } = await import("./pairing");
    await expect(pairingFor("local-1")).rejects.toThrow(
      "IndexedDB is unavailable",
    );

    // The failed load was not kept as an empty map.
    failing = false;
    expect(await pairingFor("local-1")).toEqual({
      providerId: "drive",
      key: "folder-1",
    });
  });

  it("pairing again writes nothing over a manifest it cannot read", async () => {
    const { putManifest } = await import("./manifestStore");
    const { emptyManifest, withBaseline } = await import("./manifest");
    const target = { providerId: "drive", key: "folder-1" };
    const kept = withBaseline(emptyManifest(target), "/a.md", {
      local: "local-hash",
      remote: "remote-hash",
      remoteFileId: "",
      localMtime: 0,
    });
    await putManifest("local-1", kept);

    await withFailingReads();
    const { pair } = await import("./pairing");
    const { getManifest } = await import("./manifestStore");
    // The cache loads first, then only the single-record read fails.
    await (await import("./pairing")).pairingFor("local-1");
    failing = true;
    await expect(
      pair("local-1", { providerId: "drive", key: "folder-2" }),
    ).rejects.toThrow("IndexedDB is unavailable");

    failing = false;
    expect(await getManifest("local-1")).toEqual(kept);
  });
});
