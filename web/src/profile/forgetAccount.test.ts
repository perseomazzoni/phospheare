// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import "fake-indexeddb/auto";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { CardContent } from "./profileStore";

const P = (key: string) => ({ id: `book-${key}`, providerId: "local", key });

const forgetDriveToken = vi.fn();
vi.mock("../storage/driveToken", () => ({
  forgetDriveToken: () => forgetDriveToken(),
  driveAccessToken: vi.fn(),
}));

// Node has no localStorage, and half of what `purgeLocalData` clears uses it.
beforeAll(() => {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
});

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.clear();
  forgetDriveToken.mockClear();
});

afterEach(() => vi.unstubAllGlobals());

// The profile keys rows by the project uuid, and drops any other id.
const BOOK = "3f2b8c1a-5d4e-4f6a-9b7c-0123456789ab";

const card: CardContent = {
  id: BOOK,
  title: "Once Dark",
  type: "novel",
  words: 48210,
  parts: 3,
  sections: 27,
  goal: null,
  perNode: [],
  structure: { version: 1, children: [] },
  updatedAt: "2026-07-28T10:00:00.000Z",
  cachedAt: "2026-07-28T10:00:00.000Z",
};

/** Seeds buckets (c) and (d) for the given user, current at call time. */
async function seed(userId: string) {
  const { setCurrentUserId } = await import("../auth/currentUser");
  setCurrentUserId(userId);

  const { addToLibrary, setPref } = await import("./profileSync");
  const { putHandle } = await import("../storage/handleStore");
  const { putManifest } = await import("../project/sync/manifestStore");
  const { emptyManifest } = await import("../project/sync/manifest");
  const { appendOp } = await import("../project/sync/remoteQueueStore");

  addToLibrary(
    userId,
    { id: BOOK, provider: "local", key: "a", name: "a" },
    card,
  );
  // A value inside the profile's domain, which drops any other.
  setPref("density", "list");
  await putHandle("a", { name: "a" } as unknown as FileSystemDirectoryHandle);
  await putManifest(
    "a",
    emptyManifest({ providerId: "drive", key: "folder-a" }),
  );
  await appendOp(P("a"), { kind: "put", path: "/x.md" });
}

describe("purgeLocalData", () => {
  it("clears the one cache (prefs, membership, cards), the Drive token, and every device store", async () => {
    await seed("u1");

    const { purgeLocalData } = await import("./forgetAccount");
    await purgeLocalData("u1");

    const { getPref, libraryRows } = await import("./profileSync");
    const { getHandle } = await import("../storage/handleStore");
    const { getManifest } = await import("../project/sync/manifestStore");
    const { opsFor } = await import("../project/sync/remoteQueueStore");

    expect(libraryRows("u1")).toEqual([]);
    expect(getPref("density", "grid")).toBe("grid");
    expect(await getHandle("a")).toBeNull();
    expect(await getManifest("a")).toBeNull();
    expect(await opsFor(P("a"))).toEqual([]);
    expect(forgetDriveToken).toHaveBeenCalled();
  });

  it("leaves every other account on this browser untouched", async () => {
    await seed("u1");
    await seed("u2");

    // `purgeLocalData` requires `getCurrentUserId()` to equal the user being
    // purged. `seed("u2")` left it at u2, so it moves back before purging u1,
    // or this would clear u2's (d) instead.
    const { setCurrentUserId } = await import("../auth/currentUser");
    setCurrentUserId("u1");

    const { purgeLocalData } = await import("./forgetAccount");
    await purgeLocalData("u1");

    setCurrentUserId("u2");
    const { getPref, libraryRows } = await import("./profileSync");
    const { getHandle } = await import("../storage/handleStore");

    expect(libraryRows("u2").map((r) => r.key)).toEqual(["a"]);
    expect(libraryRows("u2")[0].card?.title).toBe("Once Dark");
    expect(getPref("density", "grid")).toBe("list");
    expect((await getHandle("a"))?.name).toBe("a");
  });

  it("is content with an account that had nothing to purge", async () => {
    const { setCurrentUserId } = await import("../auth/currentUser");
    setCurrentUserId("nobody");
    const { purgeLocalData } = await import("./forgetAccount");
    await expect(purgeLocalData("nobody")).resolves.toBeUndefined();
  });
});

// The sweep on every confirmed identity resolution: everything except the
// confirmed id's data is gone, and that data and the token are untouched.
describe("purgeOtherUsersLocalData", () => {
  it("wipes every other id's (c) and (d) data, leaves the current id and the token untouched", async () => {
    await seed("u1");
    await seed("u2");
    await seed("u3");

    // Every store here clears for whoever is current at call time. u3 is
    // current going in, as in `SessionGate`, which calls this the instant
    // the sign-in confirms an id.
    const { setCurrentUserId } = await import("../auth/currentUser");
    setCurrentUserId("u3");

    const { purgeOtherUsersLocalData } = await import("./forgetAccount");
    await purgeOtherUsersLocalData("u3");

    const { getPref, libraryRows } = await import("./profileSync");
    const { getHandle } = await import("../storage/handleStore");
    const { getManifest } = await import("../project/sync/manifestStore");
    const { opsFor } = await import("../project/sync/remoteQueueStore");

    // u3, the current id, is untouched.
    expect(libraryRows("u3").map((r) => r.key)).toEqual(["a"]);
    expect(getPref("density", "grid")).toBe("list");
    expect((await getHandle("a"))?.name).toBe("a");
    expect((await getManifest("a"))?.remote).toEqual({
      providerId: "drive",
      key: "folder-a",
    });
    expect(await opsFor(P("a"))).toHaveLength(1);

    // u1 and u2 are gone, (c) and (d) both.
    expect(libraryRows("u1")).toEqual([]);
    expect(libraryRows("u2")).toEqual([]);
    setCurrentUserId("u1");
    expect(getPref("density", "grid")).toBe("grid");
    expect(await getHandle("a")).toBeNull();
    expect(await getManifest("a")).toBeNull();
    expect(await opsFor(P("a"))).toEqual([]);
    setCurrentUserId("u2");
    expect(getPref("density", "grid")).toBe("grid");
    expect(await getHandle("a")).toBeNull();
    expect(await getManifest("a")).toBeNull();
    expect(await opsFor(P("a"))).toEqual([]);

    // The token belongs to the confirmed session and is never touched.
    expect(forgetDriveToken).not.toHaveBeenCalled();
  });

  it("spares the shelf kept by the account without Google", async () => {
    await seed("u1");
    await seed("u2");
    const { setCurrentUserId } = await import("../auth/currentUser");
    setCurrentUserId("u2");

    const { purgeOtherUsersLocalData } = await import("./forgetAccount");
    await purgeOtherUsersLocalData("u2", "u1");

    const { libraryRows } = await import("./profileSync");
    const { getHandle } = await import("../storage/handleStore");
    const { getManifest } = await import("../project/sync/manifestStore");
    expect(libraryRows("u1").map((r) => r.key)).toEqual(["a"]);
    setCurrentUserId("u1");
    expect((await getHandle("a"))?.name).toBe("a");
    expect(await getManifest("a")).not.toBeNull();
  });

  it("is content when every account on this browser is already the current one", async () => {
    await seed("solo");
    const { setCurrentUserId } = await import("../auth/currentUser");
    setCurrentUserId("solo");

    const { purgeOtherUsersLocalData } = await import("./forgetAccount");
    await expect(purgeOtherUsersLocalData("solo")).resolves.toBeUndefined();

    const { libraryRows } = await import("./profileSync");
    expect(libraryRows("solo").map((r) => r.key)).toEqual(["a"]);
  });

  it("sweeps every AI connection key but the account's own, a stray .anonymous included", async () => {
    // There is no signed-out bucket: a `.anonymous` key is never
    // read, and the next sign-in sweeps it with every other account's key.
    for (const id of ["anonymous", "u1", "u3"])
      localStorage.setItem(
        `ai.connection.${id}`,
        JSON.stringify({ endpoint: "http://localhost:11434" }),
      );
    const { purgeOtherUsersLocalData } = await import("./forgetAccount");
    await purgeOtherUsersLocalData("u3");
    const kept = Array.from({ length: localStorage.length }, (_, i) =>
      localStorage.key(i),
    ).filter((key) => key?.startsWith("ai.connection."));
    expect(kept).toEqual(["ai.connection.u3"]);
  });
});

// Account-keyed entries beside the profile are swept too, so a shared
// browser does not hand the next account another's profile, key or proof.
describe("the account-keyed entries outside the cache", () => {
  const entries = (id: string) => [
    `profile.${id}`,
    `openrouter.remember.${id}`,
    `identity.proof.${id}`,
  ];
  const stored = () =>
    Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      .filter((key): key is string => key !== null)
      .sort();

  it("sweeps every other account's, sparing the current and the kept", async () => {
    for (const id of ["u1", "u2", "u3"])
      for (const key of entries(id)) localStorage.setItem(key, "1");
    const { purgeOtherUsersLocalData } = await import("./forgetAccount");

    await purgeOtherUsersLocalData("u3", "u2");

    expect(stored()).toEqual([...entries("u2"), ...entries("u3")].sort());
  });

  it("removes the remember choice and the proof of the account a purge clears", async () => {
    const { setCurrentUserId } = await import("../auth/currentUser");
    setCurrentUserId("u1");
    for (const id of ["u1", "u2"])
      for (const key of entries(id).slice(2)) localStorage.setItem(key, "1");
    const { purgeLocalData } = await import("./forgetAccount");

    await purgeLocalData("u1");

    expect(stored()).toEqual(entries("u2").slice(2).sort());
  });
});

describe("settlesWithin", () => {
  it("says whether the work resolved in time, and never rejects", async () => {
    const { settlesWithin } = await import("./forgetAccount");
    await expect(settlesWithin(Promise.resolve(), 50)).resolves.toBe(true);
    await expect(
      settlesWithin(Promise.reject(new Error("no")), 50),
    ).resolves.toBe(false);
  });

  it("gives up at the bound, and leaves no timer behind", async () => {
    vi.useFakeTimers();
    try {
      const { settlesWithin } = await import("./forgetAccount");
      const hung = settlesWithin(new Promise(() => {}), 10_000);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(hung).resolves.toBe(false);
      await settlesWithin(Promise.resolve(), 10_000);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// The upload a clearing sign-out makes while Drive is connected. The sync
// reports a failure in its state rather than by rejecting, so the answer
// reads that state, and only a sync newer than the call counts.
describe("uploadProfile", () => {
  async function uploadWith(
    sync: () => Promise<unknown>,
    state: () => { kind: string; at?: string },
  ) {
    vi.doMock("./profileStore", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      mergeWithDrive: sync,
      profileSyncState: state,
    }));
    return (await import("./forgetAccount")).uploadProfile;
  }

  afterEach(() => {
    vi.doUnmock("./profileStore");
  });

  it("is true when a sync after the call reached Remote Storage", async () => {
    let at = "";
    const upload = await uploadWith(
      async () => {
        at = new Date().toISOString();
      },
      () => ({ kind: "synced", at }),
    );
    await expect(upload("u1")).resolves.toBe(true);
  });

  it("is false when the sync paused", async () => {
    const upload = await uploadWith(
      async () => {},
      () => ({ kind: "paused" }),
    );
    await expect(upload("u1")).resolves.toBe(false);
  });

  it("is false when the last good sync is older than the call", async () => {
    const upload = await uploadWith(
      async () => {},
      () => ({ kind: "synced", at: "2026-01-01T00:00:00.000Z" }),
    );
    await expect(upload("u1")).resolves.toBe(false);
  });

  it("is false when the sync takes longer than ten seconds", async () => {
    vi.useFakeTimers();
    try {
      const upload = await uploadWith(
        () => new Promise(() => {}),
        () => ({ kind: "synced", at: new Date().toISOString() }),
      );
      const answer = upload("u1");
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(answer).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
