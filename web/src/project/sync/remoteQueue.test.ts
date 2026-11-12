// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBIndex } from "fake-indexeddb";

/** The book the identity mock names for a local project's folder key; the
 *  manifest is keyed by it, not by the folder. */
const BOOK = (key: string) => `book-local-${key}`;

// A queued project names both the book and where its bytes are: the
// queue answers with no mirror, so it carries the id rather than looking one
// up when it drains.
const P = (key: string) => ({ id: BOOK(key), providerId: "local", key });

// The drain worker runs against fakes for the providers and pairing, because
// this file pins the worker's own logic (FIFO, retry, badge state). The queue
// goes through the real `remoteQueueStore.ts` and IndexedDB, so a fresh fake
// database per test keeps one test's queued ops out of the next.

const readFile = vi.fn();
const writeFile = vi.fn();
const removeFile = vi.fn();
const remoteRename = vi.fn();
const pairingFor = vi.fn();
// Delegate, not a factory: the cold-mirror row must answer null while the
// drain is running, which a factory function cannot.
const projectIdFor = vi.fn();

vi.mock("../../storage/localProvider", () => ({
  localProvider: {
    id: "local",
    readFile: (...args: unknown[]) => readFile(...args),
  },
}));
// The queue's source is the working copy, so its double is the
// `CacheStore` port, not a fake OPFS: the queue never touches the platform,
// and faking it here would exercise the adapter's naming and hashing on every
// drain assertion.
const cacheRead = vi.fn();
const cacheWrite = vi.fn();
const dispose = vi.fn();
vi.mock("../../storage/cache/opfsCacheStore", () => ({
  openCacheStore: () => ({
    read: (...args: unknown[]) => cacheRead(...args),
    write: (...args: unknown[]) => cacheWrite(...args),
    has: vi.fn(),
    remove: vi.fn(),
    dropProject: vi.fn(),
    dispose: () => dispose(),
  }),
}));
// The destination comes from the registry, not a named `driveProvider`
// import: the queue resolves whatever the pairing's `providerId`
// names. Mocking `getProvider` mocks the real seam, and lets this file
// describe a backend that is not Drive.
const remoteRead = vi.fn();
const remoteFingerprint = vi.fn();
const remoteExists = vi.fn();
const remoteMove = vi.fn();
const remoteProvider = {
  id: "drive",
  kind: "remote" as const,
  readFile: (...args: unknown[]) => remoteRead(...args),
  writeFile: (...args: unknown[]) => writeFile(...args),
  removeFile: (...args: unknown[]) => removeFile(...args),
  renameFile: (...args: unknown[]) => remoteRename(...args),
  moveFile: (...args: unknown[]) => remoteMove(...args),
  fingerprintFile: (...args: unknown[]) => remoteFingerprint(...args),
  exists: (...args: unknown[]) => remoteExists(...args),
};
/** A provider's `not-found`, recognized by the queue by its code. */
const notFound = () => Object.assign(new Error("gone"), { code: "not-found" });
vi.mock("../../storage", () => ({
  getProvider: (id: string) => (id === "drive" ? remoteProvider : null),
  isRemoteRef: (ref: { providerId: string }) => ref.providerId === "drive",
}));
// `remoteFor` and `syncBaselines` resolve a ref to its book from the
// record's own id, which queue records carry because the queue must answer
// with no mirror, and through the mirror only for a record without
// one. This seam stands in for the mirror.
vi.mock("../projectId", () => ({
  projectIdFor: (...args: unknown[]) => projectIdFor(...args),
}));
vi.mock("./pairing", () => ({
  pairingFor: (...args: unknown[]) => pairingFor(...args),
}));
// The eviction interlock the queue registers, kept so a row can ask it.
let evictionGuard: (() => Promise<ReadonlySet<string>>) | null = null;
vi.mock("../../storage/cache/budget", () => ({
  guardSegments: (fn: () => Promise<ReadonlySet<string>>) => {
    evictionGuard = fn;
  },
}));

/**
 * A Web Locks double, one per test: the platform's lock manager outlives a
 * test, so a row that leaves a push hanging would hold its lock into the
 * next. Two module instances in one test share it, as two tabs share the
 * browser's.
 */
function fakeLocks() {
  const chains = new Map<string, Promise<unknown>>();
  const locks = {
    /** How many locked bodies have run to their end. */
    finished: 0,
    request(name: string, callback: () => Promise<unknown>) {
      const run = (chains.get(name) ?? Promise.resolve()).then(() =>
        callback(),
      );
      const done = run.then(
        () => void locks.finished++,
        () => void locks.finished++,
      );
      chains.set(name, done);
      return run;
    },
  };
  return locks;
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("navigator", { locks: fakeLocks() });
  readFile.mockReset();
  cacheRead.mockReset();
  cacheWrite.mockReset();
  remoteRead.mockReset();
  remoteFingerprint.mockReset().mockRejectedValue(notFound());
  remoteExists.mockReset().mockResolvedValue(false);
  remoteMove.mockReset();
  dispose.mockReset();
  writeFile.mockReset();
  removeFile.mockReset();
  remoteRename.mockReset();
  pairingFor.mockReset();
  projectIdFor
    .mockReset()
    .mockImplementation(
      (ref: { providerId: string; key: string }) =>
        `book-${ref.providerId}-${ref.key}`,
    );
  const { setCurrentUserId } = await import("../../auth/currentUser");
  setCurrentUserId("test-user");
});

afterEach(async () => {
  // Each row loads its own queue, and a failed push leaves that queue's retry
  // timer armed. A slow run reaches the next rows before it fires, and the old
  // queue then pushes its own op through the shared mocks. Signing out clears
  // the timers, as it does for a real session.
  const { setCurrentUserId } = await import("../../auth/currentUser");
  setCurrentUserId(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * Poll until `check` holds, or give up. Used where the failure pinned is a
 * promise that never settles: `await settled(...)` would hang the run instead
 * of failing it, and a hung suite reports nothing.
 */
async function waitFor(check: () => boolean, ms = 1000): Promise<void> {
  const until = Date.now() + ms;
  while (!check() && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("nextBackoffMs", () => {
  it("requires a readable, writer-scoped queue before destructive actions", async () => {
    const { appendOp, pendingOpsOrThrow } = await import("./remoteQueueStore");
    const { setCurrentUserId } = await import("../../auth/currentUser");
    await appendOp(P("a"), { kind: "rm", path: "chapter.md" });
    expect(await pendingOpsOrThrow()).toHaveLength(1);
    setCurrentUserId("other-writer");
    expect(await pendingOpsOrThrow()).toEqual([]);
    setCurrentUserId(null);
    await expect(pendingOpsOrThrow()).rejects.toThrow();
    setCurrentUserId("test-user");
    const get = vi
      .spyOn(IDBIndex.prototype, "getAll")
      .mockImplementation(() => {
        throw new Error("unreadable");
      });
    try {
      await expect(pendingOpsOrThrow()).rejects.toThrow("unreadable");
    } finally {
      get.mockRestore();
    }
  });
  it("starts at the floor", async () => {
    const { nextBackoffMs } = await import("./remoteQueue");
    expect(nextBackoffMs(null)).toBe(5_000);
  });

  it("doubles each time", async () => {
    const { nextBackoffMs } = await import("./remoteQueue");
    expect(nextBackoffMs(5_000)).toBe(10_000);
    expect(nextBackoffMs(10_000)).toBe(20_000);
  });

  it("caps at five minutes", async () => {
    const { nextBackoffMs } = await import("./remoteQueue");
    expect(nextBackoffMs(4 * 60_000)).toBe(5 * 60_000);
    expect(nextBackoffMs(5 * 60_000)).toBe(5 * 60_000);
  });
});

describe("enqueue and drain", () => {
  it("pushes a put by reading local and writing to Drive, then clears pending", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    writeFile.mockResolvedValue(undefined);

    const { enqueue, isPending, subscribe } = await import("./remoteQueue");
    const seen: boolean[] = [];
    subscribe(() => seen.push(isPending(P("project-a"))));

    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    // `enqueue` kicks the drain fire-and-forget, and the queue's writes go
    // through real fake-indexeddb transactions, each its own tick, so the test
    // waits for the outcome rather than a tick count.
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));

    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ key: "folder-1" }),
      "/a.md",
      "hello",
    );
    expect(seen[0]).toBe(true); // went pending immediately on enqueue
    expect(seen[seen.length - 1]).toBe(false); // and cleared once the drain finished
  });

  it("coalesces two puts on the same path arriving in the same burst into a single push", async () => {
    // Fired together, not awaited in turn: coalescing matters only when the
    // second enqueue arrives before the first has drained, and awaiting each
    // would let the first drain before the second arrives.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "second", hash: "h" });
    writeFile.mockResolvedValue(undefined);

    const { enqueue, isPending } = await import("./remoteQueue");
    await Promise.all([
      enqueue(P("project-a"), { kind: "put", path: "/a.md" }),
      enqueue(P("project-a"), { kind: "put", path: "/a.md" }),
    ]);
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));

    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("reads the store once per op it drains", async () => {
    // Each step's claim reads the rows and re-derives the index from that one
    // read, so draining N ops is N reads of the user's rows, not 2N.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    removeFile.mockImplementationOnce(() => gate).mockResolvedValue(undefined);

    const { enqueue, isPending } = await import("./remoteQueue");
    for (const n of [1, 2, 3, 4, 5])
      await enqueue(P("project-a"), { kind: "rm", path: `/${n}.md` });
    await vi.waitFor(() => expect(removeFile).toHaveBeenCalledTimes(1));

    const getAll = vi.spyOn(IDBIndex.prototype, "getAll");
    release();
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));
    expect(removeFile).toHaveBeenCalledTimes(5);
    // Four claims that each find an op, and the one that finds none.
    expect(getAll).toHaveBeenCalledTimes(5);
    getAll.mockRestore();
  });

  it("a failed push leaves the project pending", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    writeFile.mockRejectedValue(new Error("Drive is down"));

    const { enqueue, isPending } = await import("./remoteQueue");
    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));

    expect(isPending(P("project-a"))).toBe(true);
  });

  it("names one project's outstanding ops, oldest first", async () => {
    // `mirror` projects these onto a directory listing, so a caller above the
    // port cannot tell a device base from a remote one. It reads the index
    // `isPending` reads, so a listing never disagrees with the badge beside it.
    //
    // A project with nothing outstanding answers with the shared empty array:
    // this sits in the await chain of every `listDir`, and the common answer
    // allocates nothing.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    writeFile.mockRejectedValue(new Error("Drive is down"));

    const { enqueue, pendingOpsFor } = await import("./remoteQueue");
    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await enqueue(P("project-a"), { kind: "put", path: "/b.md" });
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));

    expect(pendingOpsFor(P("project-a"))).toEqual([
      { kind: "put", path: "/a.md" },
      { kind: "put", path: "/b.md" },
    ]);
    const none = pendingOpsFor(P("project-b"));
    expect(none).toEqual([]);
    expect(pendingOpsFor(P("project-c"))).toBe(none);
  });

  it("retryNow retries immediately, without waiting for a backoff timer", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    writeFile
      .mockRejectedValueOnce(new Error("Drive is down"))
      .mockResolvedValue(undefined);

    const { enqueue, retryNow, isPending } = await import("./remoteQueue");
    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
    expect(isPending(P("project-a"))).toBe(true);

    void retryNow(P("project-a"));
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));

    expect(writeFile).toHaveBeenCalledTimes(2);
  });

  // ── Destinations that cannot receive ───────────────────────────────────────
  //
  // A pairing naming a backend that cannot receive parks the queue rather
  // than dropping it. An unregistered adapter is a fact about which
  // code is installed, not anybody's decision, and it can change on the next
  // deploy, so dropping the queue would destroy work nobody chose to discard.

  it("parks the queue when the pairing names a backend this build lacks", async () => {
    // The pairing carries a `providerId`, so it can outlive the
    // provider that wrote it: a build that dropped an adapter, or a record
    // written by a newer one. `drainAll` re-reads the store on every boot, so
    // the ops drain once the provider is back.
    pairingFor.mockResolvedValue({ providerId: "dropbox", key: "folder-1" });

    const { enqueue, isPending, settled } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");

    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await settled(P("project-a"));

    expect(await opsFor(P("project-a"))).toHaveLength(1);
    expect(isPending(P("project-a"))).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("parks rather than drops when the pairing points at a DEVICE provider", async () => {
    // The queue commits to a remote. A pairing naming the local provider would
    // copy a project onto itself, so the resolver checks `kind`, not only that
    // the id resolves.
    pairingFor.mockResolvedValue({ providerId: "local", key: "folder-1" });

    const { enqueue, isPending, settled } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");

    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await settled(P("project-a"));

    expect(await opsFor(P("project-a"))).toHaveLength(1);
    expect(isPending(P("project-a"))).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  // ── A pairing gone before the drain ────────────────────────────────────────
  //
  // The destination is resolved once at the decoration seam, and a project
  // without one is never decorated, so `resolve.test.ts` pins that it queues
  // nothing. Here an op that reached the queue and then lost its
  // pairing is dropped at drain time, and never touches the remote.
  it("drops an op whose pairing vanished before the drain reached it", async () => {
    pairingFor.mockResolvedValue(null);

    const { enqueue, isPending, settled } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");

    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await settled(P("project-a"));

    expect(isPending(P("project-a"))).toBe(false);
    expect(await opsFor(P("project-a"))).toEqual([]);
    expect(writeFile).not.toHaveBeenCalled();
  });

  // ── A database that cannot be read ─────────────────────────────────────────
  //
  // A failed read says nothing about whether the writer unpaired, so the ops
  // stay and the drain tries again after a backoff.
  it("keeps the ops and retries when the pairing cannot be read", async () => {
    pairingFor
      .mockRejectedValueOnce(new Error("IndexedDB is unavailable"))
      .mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    writeFile.mockResolvedValue(undefined);
    const timer = vi.spyOn(globalThis, "setTimeout");

    const { enqueue, isPending, retryNow, settled } =
      await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");

    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await settled(P("project-a"));

    expect(writeFile).not.toHaveBeenCalled();
    expect(isPending(P("project-a"))).toBe(true);
    expect(await opsFor(P("project-a"))).toHaveLength(1);
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 5_000);
    timer.mockRestore();

    void retryNow(P("project-a"));
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));
    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ key: "folder-1" }),
      "/a.md",
      "hello",
    );
  });

  // Without the manifest a put would skip its conflict check and could
  // overwrite an edit made on another device.
  it("holds a push whose manifest cannot be read", async () => {
    let failing = false;
    vi.resetModules();
    vi.doMock("../../storage/idb", async (importOriginal) => {
      const real = await importOriginal<typeof import("../../storage/idb")>();
      return {
        ...real,
        tx: ((store, mode, run) =>
          failing && store === real.STORE_SYNC && mode === "readonly"
            ? Promise.reject(new Error("IndexedDB is unavailable"))
            : real.tx(store, mode, run)) as typeof real.tx,
      };
    });
    try {
      const { setCurrentUserId } = await import("../../auth/currentUser");
      setCurrentUserId("test-user");
      pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
      cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
      writeFile.mockResolvedValue(undefined);

      const { enqueue, isPending, retryNow, settled } =
        await import("./remoteQueue");
      const { opsFor } = await import("./remoteQueueStore");

      failing = true;
      await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
      await settled(P("project-a"));

      expect(writeFile).not.toHaveBeenCalled();
      expect(isPending(P("project-a"))).toBe(true);
      expect(await opsFor(P("project-a"))).toHaveLength(1);

      failing = false;
      void retryNow(P("project-a"));
      await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));
      expect(writeFile).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock("../../storage/idb");
    }
  });

  // ── A cold library mirror ──────────────────────────────────────────────────
  //
  // The record carries the book's id, so the drain answers with no mirror.
  // Resolved through the mirror, a shelf that has not answered for
  // the folder yet (a boot drain racing the first pull) would read as an
  // unpair, and the drain would drop work nobody chose to drop. `projectIdFor`
  // answers null here for that state.
  it("drains a paired project's queue even while the library mirror is cold", async () => {
    projectIdFor.mockReturnValue(null);
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    writeFile.mockResolvedValue(undefined);

    // A successful push levels the manifest even on a cold shelf, or the next
    // check reports the drained edit as a conflict. `syncBaselines` keys the
    // manifest by the record's own id, without the mirror.
    const { enqueue, isPending } = await import("./remoteQueue");
    const { getManifest, putManifest } = await import("./manifestStore");
    const { emptyManifest, withBaseline } = await import("./manifest");
    const { sha256Hex } = await import("../../text/hash");
    await putManifest(
      BOOK("project-a"),
      withBaseline(
        emptyManifest({ providerId: "drive", key: "folder-1" }),
        "/a.md",
        {
          local: "stale-local-hash",
          remote: "stale-drive-hash",
          remoteFileId: "",
          localMtime: 0,
        },
      ),
    );

    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));

    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ key: "folder-1" }),
      "/a.md",
      "hello",
    );
    // The mirror was never asked: the record's own id named the book, and the
    // baseline was levelled under that id while the shelf stayed cold.
    expect(projectIdFor).not.toHaveBeenCalled();
    const manifest = await getManifest(BOOK("project-a"));
    const pushed = await sha256Hex("hello");
    expect(manifest?.files["/a.md"].local).toBe(pushed);
    expect(manifest?.files["/a.md"].remote).toBe(pushed);
  });

  it("drains a remote-primary project with no pairing at all", async () => {
    // A Drive-primary project is its own destination, so it needs no manifest
    // and no pairing record, and its writes are committed by the queue.
    // `pairingFor` is never consulted.
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    writeFile.mockResolvedValue(undefined);

    const { enqueue, settled } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");
    const ref = {
      id: "book-remote-only",
      providerId: "drive",
      key: "folder-1",
    };

    await enqueue(ref, { kind: "put", path: "/a.md" });
    await settled(ref);

    expect(pairingFor).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ key: "folder-1" }),
      "/a.md",
      "hello",
    );
    expect(await opsFor(ref)).toEqual([]);
  });

  it("keeps two backends' identical keys apart", async () => {
    // `local:book` and `drive:book` are two projects. The queue keys on the
    // whole ref, so one's ops are never drained, counted or dropped as the
    // other's; a device key is a writer-chosen folder name and a remote key a
    // backend id, so a bare key cannot tell them apart.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    writeFile.mockRejectedValue(new Error("Drive is down"));

    const { enqueue, isPending, settled } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");
    const device = { id: "book-device", providerId: "local", key: "book" };
    const remote = { id: "book-remote", providerId: "drive", key: "book" };

    await enqueue(device, { kind: "put", path: "/a.md" });
    await settled(device);

    expect(await opsFor(device)).toHaveLength(1);
    expect(await opsFor(remote)).toEqual([]);
    expect(isPending(device)).toBe(true);
    expect(isPending(remote)).toBe(false);
  });

  it("disposes the working copy it opened, on every drain pass", async () => {
    // The store subscribes to `onUserChange` so a user switch can poison it.
    // Undisposed, a long writing session would keep one live listener per op
    // it queued.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    writeFile.mockResolvedValue(undefined);

    const { enqueue, settled } = await import("./remoteQueue");
    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await settled(P("project-a"));

    expect(dispose).toHaveBeenCalled();
  });

  it("sends nothing and keeps the op when the working copy has no entry", async () => {
    // `read` resolving null is not `not-found` and must never become it: the
    // destination's predicate calls that code permanent, so a miss thrown
    // instead of returned would stop the op holding the only copy of the work.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue(null);

    const { enqueue, isPending, settled } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");
    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await settled(P("project-a"));

    // Nothing written, and no empty file over the writer's prose.
    expect(writeFile).not.toHaveBeenCalled();
    const rows = await opsFor(P("project-a"));
    expect(rows).toHaveLength(1);
    expect(rows[0].stopped).toBeUndefined();
    expect(isPending(P("project-a"))).toBe(true);
  });

  // A path the queue owes the remote is never refilled from the remote.
  // `cached()`'s read-through would otherwise fill the working
  // copy with the remote's older bytes, the queued put would send the remote
  // what it already had and clear, and the writer's uncommitted edits would
  // be gone with nothing on screen to say so.
  //
  // An in-memory storage partition (incognito, the desktop app's browser
  // pane) drops every OPFS file's bytes after an idle stretch while IndexedDB,
  // where this queue lives, keeps its rows.
  it("— a put whose entry vanished is not committed from bytes refilled off the remote", async () => {
    // A Remote-only project: its bytes live on Drive, so the queue's address
    // names Drive. The read below goes through the composition the editor
    // opens (`providerFor`), where `owes` is wired.
    const R = { id: "book-remote", providerId: "drive", key: "folder-1" };
    const DRIVE_REF = { ...R, name: "", openedAt: "" };
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    const entries = new Map<string, string>();
    cacheRead.mockImplementation(async (path: string) => {
      const text = entries.get(path);
      return text === undefined ? null : { text, hash: "h" };
    });
    cacheWrite.mockImplementation(async (path: string, text: string) => {
      entries.set(path, text);
      return { text, hash: "h" };
    });
    remoteRead.mockResolvedValue("the draft Drive already had");
    writeFile.mockResolvedValue(undefined);

    const { enqueue, isPending, settled, drainAll, readStale } =
      await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");
    const { providerFor } = await import("./resolve");
    const { openCacheStore } =
      await import("../../storage/cache/opfsCacheStore");
    const working = providerFor(DRIVE_REF, {
      store: openCacheStore({
        remote: { providerId: "drive", key: "folder-1" },
      } as unknown as Parameters<typeof openCacheStore>[0]),
      projectId: R.id,
    });
    if (!working) throw new Error("providerFor answered no provider");

    // The writer's save put its bytes in the working copy and queued them;
    // the bytes are gone by the time the drain looks, and the op is held.
    await enqueue(R, { kind: "put", path: "/a.md" });
    await settled(R);
    expect(isPending(R)).toBe(true);
    // A Remote-only miss is a loss, and the row says so.
    expect((await opsFor(R))[0].stopped?.code).toBe("lost");

    // Anything reads the file: reopening it, search, the stats pass. The
    // reader gets Drive's text, the best there is; the queue gets nothing.
    expect(await working.readFile(DRIVE_REF, "/a.md")).toBe(
      "the draft Drive already had",
    );

    // The drain runs again, through `drainAll` rather than `retryNow`: it
    // awaits its own clear before it kicks, so the settle below is the
    // retry's. A lost put is stepped past without a read: two reads (the
    // first drain's and the file's) and no third.
    await drainAll();
    await settled(R);
    expect(cacheRead).toHaveBeenCalledTimes(2);
    expect((await opsFor(R))[0].stopped?.code).toBe("lost");

    expect(writeFile).not.toHaveBeenCalledWith(
      expect.anything(),
      "/a.md",
      "the draft Drive already had",
    );
    expect(isPending(R)).toBe(true);

    // The writer's next save is a real source, and it lands. It does not
    // clear the loss: the read above was stale, so a buffer opened on
    // it held the remote's older text, and a save from it is not the lost
    // change. The notice stands until the writer dismisses it.
    await working.writeFile(DRIVE_REF, "/a.md", "the writer's next save");
    await vi.waitFor(() =>
      expect(writeFile).toHaveBeenCalledWith(
        expect.objectContaining({ key: "folder-1" }),
        "/a.md",
        "the writer's next save",
      ),
    );
    await settled(R);
    expect((await opsFor(R)).map((r) => r.stopped?.code)).toEqual(["lost"]);
    expect(readStale(R, "/a.md")).toBe(true);
  });

  // A Remote-only project saves a Section and renames it before the save has
  // drained (offline, or a retitle right after typing). `cached()`'s rename
  // keeps the old path's entry while the queue owes it, so the put on the old
  // path has a source, the save lands where it was made and the rename then
  // moves it. Without the entry the drain stops at the put, the rename never
  // runs, and the edit exists nowhere.
  it("— a save followed by a rename before it drains still lands the save", async () => {
    const R = { id: "book-remote", providerId: "drive", key: "folder-1" };
    const DRIVE_REF = { ...R, name: "", openedAt: "" };
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    const entries = new Map<string, string>();
    cacheRead.mockImplementation(async (path: string) => {
      const text = entries.get(path);
      return text === undefined ? null : { text, hash: "h" };
    });
    cacheWrite.mockImplementation(async (path: string, text: string) => {
      entries.set(path, text);
      return { text, hash: "h" };
    });
    const { openCacheStore } =
      await import("../../storage/cache/opfsCacheStore");
    const store = openCacheStore({
      remote: { providerId: "drive", key: "folder-1" },
    } as unknown as Parameters<typeof openCacheStore>[0]);
    // The shared double's `remove` is a no-op; this row needs a real one.
    store.remove = async (path: string) => void entries.delete(path);
    // Drive is unreachable while the writer works, and every write that lands
    // is recorded with what it carried.
    let online = false;
    const landed: string[] = [];
    writeFile.mockImplementation(
      async (_ref: unknown, path: string, text: string) => {
        if (!online) throw new Error("offline");
        landed.push(`${path}=${text}`);
      },
    );
    remoteRename.mockResolvedValue(undefined);

    const { isPending, settled, retryNow } = await import("./remoteQueue");
    const { providerFor } = await import("./resolve");
    const working = providerFor(DRIVE_REF, { store, projectId: R.id });
    if (!working) throw new Error("providerFor answered no provider");

    await working.writeFile(DRIVE_REF, "/document/a.md", "the new paragraph");
    await working.renameFile(DRIVE_REF, "/document/a.md", "b.md");
    await settled(R);

    online = true;
    void retryNow(R);
    // The outcome, not a count of reads: the rename reads the working copy
    // too, so "read more than once" is true before any drain.
    await vi.waitFor(() => expect(isPending(R)).toBe(false));

    expect(landed.some((l) => l.endsWith("=the new paragraph"))).toBe(true);
    expect(remoteRename).toHaveBeenCalled();
    expect(isPending(R)).toBe(false);
  });

  it("a drained put records the pushed content as the fresh baseline on both sides", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    writeFile.mockResolvedValue(undefined);

    const { enqueue, isPending } = await import("./remoteQueue");
    const { getManifest, putManifest } = await import("./manifestStore");
    const { emptyManifest, withBaseline } = await import("./manifest");
    const { sha256Hex } = await import("../../text/hash");

    // A manifest that predates the edit; left as is, every drained edit would
    // read as a conflict on the next check.
    await putManifest(
      BOOK("project-a"),
      withBaseline(
        emptyManifest({ providerId: "drive", key: "folder-1" }),
        "/a.md",
        {
          local: "stale-local-hash",
          remote: "stale-drive-hash",
          remoteFileId: "",
          localMtime: 0,
        },
      ),
    );

    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));

    const manifest = await getManifest(BOOK("project-a"));
    const pushed = await sha256Hex("hello");
    expect(manifest?.files["/a.md"].local).toBe(pushed);
    expect(manifest?.files["/a.md"].remote).toBe(pushed);
  });

  it("a drained rm drops the path from the manifest", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    removeFile.mockResolvedValue(undefined);

    const { enqueue, isPending } = await import("./remoteQueue");
    const { getManifest, putManifest } = await import("./manifestStore");
    const { emptyManifest, withBaseline } = await import("./manifest");

    await putManifest(
      BOOK("project-a"),
      withBaseline(
        emptyManifest({ providerId: "drive", key: "folder-1" }),
        "/b.md",
        {
          local: "h",
          remote: "h",
          remoteFileId: "",
          localMtime: 0,
        },
      ),
    );

    await enqueue(P("project-a"), { kind: "rm", path: "/b.md" });
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));

    const manifest = await getManifest(BOOK("project-a"));
    expect(manifest?.files["/b.md"]).toBeUndefined();
  });

  it("an rm of a file already gone from Drive is a success, not a retry loop", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    const { StorageError } = await import("../../storage/types");
    removeFile.mockRejectedValue(new StorageError("already gone", "not-found"));

    const { enqueue, isPending } = await import("./remoteQueue");
    await enqueue(P("project-a"), { kind: "rm", path: "/b.md" });
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));

    expect(removeFile).toHaveBeenCalledTimes(1);
    expect(isPending(P("project-a"))).toBe(false);
  });

  // ── Ops the destination refuses ────────────────────────────────────────────
  //
  // The queue's source can be the only copy, so a refused op is retained
  // rather than deleted, and the drain stops at it rather than stepping over
  // it: draining `/b.md` while `/a.md` never landed applies a later
  // state on top of a missing earlier one.
  it("stops at an op the destination can never accept, and does not step over it", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    const { StorageError } = await import("../../storage/types");
    writeFile
      .mockRejectedValueOnce(new StorageError("no permission", "permission"))
      .mockResolvedValue(undefined);

    const { enqueue, isPending, settled } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");
    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await enqueue(P("project-a"), { kind: "put", path: "/b.md" });
    await settled(P("project-a"));

    // One attempt, at the head, and nothing behind it.
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: "folder-1" }),
      "/a.md",
      "hello",
    );
    // Both ops survive; the head carries why it stopped.
    const rows = await opsFor(P("project-a"));
    expect(rows).toHaveLength(2);
    expect(rows[0].stopped?.code).toBe("permission");
    expect(rows[1].stopped).toBeUndefined();
    expect(isPending(P("project-a"))).toBe(true);
  });

  // A user change does not clear `locks`, which holds the promise chain an
  // in-flight body stands in, so the lock key carries the user and the next
  // user's first op never queues behind a drain that was not theirs.
  //
  // The first user's push never settles here, the shape a real one has when
  // the network is gone and the request is still open.
  it("does not chain the next user behind the last user's in-flight drain", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    writeFile
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValue(undefined);

    const { enqueue } = await import("./remoteQueue");
    const { setCurrentUserId } = await import("../../auth/currentUser");

    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await waitFor(() => writeFile.mock.calls.length === 1);

    // The switch. The outgoing user's drain is still inside its exclusive
    // section and stays there for the rest of this test.
    setCurrentUserId("other-user");
    await enqueue(P("project-a"), { kind: "put", path: "/b.md" });

    await waitFor(() => writeFile.mock.calls.length === 2);
    expect(writeFile.mock.calls[1][1]).toBe("/b.md");
  });

  // Every other source failure retries; an unusable path is the one that
  // stops at once. A lapsed grant is about a moment, and an
  // unusable path is about a name, which no moment changes.
  it("stops on the FIRST attempt when the source path can never be spelled", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    const { StorageError } = await import("../../storage/types");
    cacheRead.mockRejectedValue(
      new StorageError(
        'cachePath: refusing the path segment ".."',
        "unusable-path",
        "storage.unusablePath",
        { name: ".." },
      ),
    );

    const { enqueue, isPending, settled } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");
    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await settled(P("project-a"));

    // One read, not ten: the op does not burn the consecutive-failure budget
    // of ten throws and ten backoff periods to reach the same end state.
    expect(cacheRead).toHaveBeenCalledTimes(1);
    expect(writeFile).not.toHaveBeenCalled();

    // Stopped, and still there. Stopping is not discarding: the op
    // names the writer's only copy, and the path is something they can fix.
    const rows = await opsFor(P("project-a"));
    expect(rows).toHaveLength(1);
    expect(rows[0].stopped?.code).toBe("unusable-path");
    expect(isPending(P("project-a"))).toBe(true);
  });

  it("classifies a SOURCE failure by where it came from, not by its code", async () => {
    // `localProvider`'s `requireRoot` throws `permission` when the folder
    // grant has lapsed, the ordinary state between sessions, and
    // `isPermanent("permission")` is true. Routed through the destination's
    // predicate, a lapsed browser grant would read as Drive refusing the
    // write, and the badge would say `synced` about a stale remote.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    const { StorageError } = await import("../../storage/types");
    cacheRead.mockRejectedValue(
      new StorageError("Phospheare needs permission", "permission"),
    );

    const { enqueue, isPending, settled } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");
    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await settled(P("project-a"));

    // Not written, not stopped, not forgotten: it backs off like any other
    // transient failure, because the destination never answered.
    expect(writeFile).not.toHaveBeenCalled();
    const rows = await opsFor(P("project-a"));
    expect(rows).toHaveLength(1);
    expect(rows[0].stopped).toBeUndefined();
    expect(isPending(P("project-a"))).toBe(true);
  });

  // ── The consecutive-failure cap ────────────────────────────────────────────
  //
  // Ten consecutive failures stop the project spinning by stopping the head
  // op, never by deleting it, because that work can be the only copy.
  it("stops the head op after a cap of consecutive failures, and keeps it", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    writeFile.mockRejectedValue(new Error("Drive is down"));

    const { enqueue, retryNow, isPending, settled } =
      await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");

    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await settled(P("project-a"));
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(isPending(P("project-a"))).toBe(true);

    // One attempt already failed; `retryNow` skips the backoff and triggers
    // the next attempt, so the cap is reachable without the doubling timers.
    for (let i = 0; i < 9; i++) {
      void retryNow(P("project-a"));
      await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(i + 2));
      await settled(P("project-a"));
    }

    // Stopped, not deleted, and the project still reports that it owes work.
    const rows = await opsFor(P("project-a"));
    expect(rows).toHaveLength(1);
    expect(rows[0].stopped?.code).toBe(null);
    expect(isPending(P("project-a"))).toBe(true);
  });

  it("a stopped op is tried again by a fresh session, and can then land", async () => {
    // The queue's one automatic recovery. `drainAll` runs on every sign-in,
    // when the cause of a stop may have gone: a folder grant renewed at
    // sign-in, an adapter registered again.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    const { StorageError } = await import("../../storage/types");
    writeFile.mockRejectedValueOnce(
      new StorageError("no permission", "permission"),
    );

    const { enqueue, drainAll, settled } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");

    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await settled(P("project-a"));
    expect((await opsFor(P("project-a")))[0].stopped).toBeDefined();

    writeFile.mockResolvedValue(undefined);
    await drainAll();
    await settled(P("project-a"));

    expect(await opsFor(P("project-a"))).toEqual([]);
    expect(writeFile).toHaveBeenCalledTimes(2);
  });
});

// ── The change signal's granularity ──────────────────────────────────────────
//
// A subscriber is told whenever the queue's contents change, not only when a
// project gains or loses all its work. The notice reads a count off this
// signal: a save into an already-pending project, or one op of three
// draining, moves the count without crossing that edge, and a stale number in
// front of the writer is one they will act on. `isPending` answers the same
// boolean again on an extra notify.

// A Remote-only project's working copy is the only copy of a queued change,
// so a put whose entry has vanished is a loss: marked at once,
// stepped past so the work behind it still lands, and kept until the writer
// dismisses it or a restore repairs it.
describe("a lost change", () => {
  const R = { id: "book-remote", providerId: "drive", key: "folder-1" };

  function workingCopy(entries: Map<string, string>) {
    cacheRead.mockImplementation(async (path: string) => {
      const text = entries.get(path);
      return text === undefined ? null : { text, hash: "h" };
    });
  }

  it("is marked lost at once, and the ops behind it still drain", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    workingCopy(new Map([["/b.md", "the other Section"]]));
    writeFile.mockResolvedValue(undefined);

    const { enqueue, settled } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");
    await enqueue(R, { kind: "put", path: "/a.md" });
    await enqueue(R, { kind: "put", path: "/b.md" });
    await vi.waitFor(() =>
      expect(writeFile).toHaveBeenCalledWith(
        expect.objectContaining({ key: "folder-1" }),
        "/b.md",
        "the other Section",
      ),
    );
    await settled(R);

    const rows = await opsFor(R);
    expect(rows.map((r) => [r.op, r.stopped?.code])).toEqual([
      [{ kind: "put", path: "/a.md" }, "lost"],
    ]);
  });

  it("is not a loss for a project with a disk behind it", async () => {
    // Local + Synced: the disk still holds the bytes, and the next read
    // refills the working copy from it. Held, not lost.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    workingCopy(new Map());

    const { enqueue, settled } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");
    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await settled(P("project-a"));

    expect((await opsFor(P("project-a")))[0].stopped).toBeUndefined();
  });

  it("goes when the writer dismisses it, and nothing else does", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    workingCopy(new Map([["/c.md", "unsent"]]));
    writeFile.mockRejectedValue(new Error("Drive is down"));

    const { enqueue, settled, forgetLostChanges, isPending } =
      await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");
    await enqueue(R, { kind: "put", path: "/a.md" });
    await enqueue(R, { kind: "put", path: "/c.md" });
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalled());
    await settled(R);

    await forgetLostChanges();

    const rows = await opsFor(R);
    expect(rows.map((r) => r.op)).toEqual([{ kind: "put", path: "/c.md" }]);
    expect(isPending(R)).toBe(true);
  });

  it("is not cleared by a later save, only by the restore that repairs it", async () => {
    // A later save of the file may come from the remote's older text, so the
    // coalesce never lets it replace a lost put. `forgetLostAt` clears
    // one path's loss, after the editor re-saves a buffer known to hold the
    // change.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    const entries = new Map<string, string>();
    workingCopy(entries);
    writeFile.mockResolvedValue(undefined);

    const { enqueue, settled, isPending, forgetLostAt } =
      await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");
    await enqueue(R, { kind: "put", path: "/a.md" });
    await settled(R);
    expect((await opsFor(R))[0].stopped?.code).toBe("lost");

    entries.set("/a.md", "written again");
    await enqueue(R, { kind: "put", path: "/a.md" });
    await vi.waitFor(() =>
      expect(writeFile).toHaveBeenCalledWith(
        expect.objectContaining({ key: "folder-1" }),
        "/a.md",
        "written again",
      ),
    );
    await settled(R);
    expect((await opsFor(R)).map((r) => r.stopped?.code)).toEqual(["lost"]);

    await forgetLostAt(R, "/a.md");
    expect(isPending(R)).toBe(false);
  });

  it("is marked the moment a read falls back to the remote, before any drain", async () => {
    // The read is the earliest anything knows: otherwise a writer who
    // opens the file, types and saves would supersede the put with a save
    // made from the older text, and no drain would see the loss.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    const entries = new Map<string, string>([["/a.md", "the change"]]);
    workingCopy(entries);
    remoteRead.mockResolvedValue("the draft Drive already had");
    writeFile.mockRejectedValue(new Error("offline"));

    const { enqueue, settled, readStale } = await import("./remoteQueue");
    const { providerFor } = await import("./resolve");
    const { openCacheStore } =
      await import("../../storage/cache/opfsCacheStore");
    const { opsFor } = await import("./remoteQueueStore");
    const working = providerFor(
      { ...R, name: "", openedAt: "" },
      {
        store: openCacheStore({
          remote: { providerId: "drive", key: "folder-1" },
        } as unknown as Parameters<typeof openCacheStore>[0]),
        projectId: R.id,
      },
    );
    if (!working) throw new Error("providerFor answered no provider");

    await enqueue(R, { kind: "put", path: "/a.md" });
    await settled(R);
    // Offline: the put is live, backing off, and nothing has called it lost.
    expect((await opsFor(R))[0].stopped).toBeUndefined();

    entries.delete("/a.md");
    await working.readFile({ ...R, name: "", openedAt: "" }, "/a.md");

    expect(readStale(R, "/a.md")).toBe(true);
    await vi.waitFor(async () =>
      expect((await opsFor(R))[0].stopped?.code).toBe("lost"),
    );
  });
});

describe("the change signal", () => {
  it("fires when a second op joins a project that is already pending", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    // The remote refuses, so the drain ends with the op retained and
    // the project pending, waiting out a backoff: the offline writer's state,
    // and a deterministic one, with nothing in flight to race the assertion.
    writeFile.mockRejectedValue(new Error("no route to host"));

    const { enqueue, isPending, subscribe } = await import("./remoteQueue");
    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalled());
    expect(isPending(P("project-a"))).toBe(true);

    // Subscribed only now, so nothing below can be the first enqueue's edge.
    let fired = 0;
    subscribe(() => fired++);
    await enqueue(P("project-a"), { kind: "put", path: "/b.md" });

    // The queue went from one op to two while the project was already
    // pending, so no pending edge was crossed.
    expect(fired).toBeGreaterThan(0);
  });

  it("fires when one op of several drains away", async () => {
    // The count falls as the queue empties, not only when the last op lands.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    writeFile.mockResolvedValue(undefined);

    const { enqueue, isPending, subscribe } = await import("./remoteQueue");
    // Three distinct paths, so coalescing leaves all three standing.
    await Promise.all([
      enqueue(P("project-a"), { kind: "put", path: "/a.md" }),
      enqueue(P("project-a"), { kind: "put", path: "/b.md" }),
      enqueue(P("project-a"), { kind: "put", path: "/c.md" }),
    ]);

    let fired = 0;
    subscribe(() => fired++);
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));

    // Three ops leaving is at least three changes, though only the last
    // empties the queue.
    expect(fired).toBeGreaterThanOrEqual(3);
  });
});

describe("settled", () => {
  it("resolves at once for a project that has never drained", async () => {
    // The settle point is safe to await unconditionally, so no caller tracks
    // whether a drain has ever been kicked.
    const { settled } = await import("./remoteQueue");
    await expect(settled(P("never-touched"))).resolves.toBeUndefined();
  });
});

describe("forgetProject", () => {
  it("drops queued ops and clears pending — what unpairing needs", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    writeFile.mockRejectedValue(new Error("Drive is down"));
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });

    const { enqueue, forgetProject, isPending } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");

    // The drain fails and backs off; `forgetProject` clears the timer and
    // drops everything, so no backoff races the assertions.
    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(true));

    await forgetProject(P("project-a"));

    // Unpairing leaves nothing behind and nothing claiming to be pending.
    expect(await opsFor(P("project-a"))).toEqual([]);
    expect(isPending(P("project-a"))).toBe(false);
  });
});

/** A device project's manifest, with one baseline per entry of `remote`. */
async function seedManifest(remote: Record<string, string>): Promise<void> {
  const { putManifest } = await import("./manifestStore");
  const { emptyManifest, withBaseline } = await import("./manifest");
  let manifest = emptyManifest({ providerId: "drive", key: "folder-1" });
  for (const [path, hash] of Object.entries(remote)) {
    manifest = withBaseline(manifest, path, {
      local: `${hash}-local`,
      remote: hash,
      remoteFileId: "",
      localMtime: 0,
    });
  }
  await putManifest(BOOK("project-a"), manifest);
}

describe("coalescing", () => {
  it("never removes a put queued after the one being coalesced", async () => {
    // Two saves of one path in a burst. Each coalesce may remove the put
    // before its own, never the one after: otherwise each removes the other
    // and the save is queued nowhere. The pairing parks the queue, so no
    // drain removes anything.
    pairingFor.mockResolvedValue({ providerId: "dropbox", key: "folder-1" });

    const { enqueue, settled } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");
    await Promise.all([
      enqueue(P("project-a"), { kind: "put", path: "/a.md" }),
      enqueue(P("project-a"), { kind: "put", path: "/a.md" }),
    ]);
    await settled(P("project-a"));
    // Each coalesce runs behind the project's lock after its save resolves,
    // and a parked queue takes that lock for nothing else: two finished
    // turns are both coalesces done.
    const locks = navigator.locks as unknown as ReturnType<typeof fakeLocks>;
    await vi.waitFor(() => expect(locks.finished).toBe(2));

    expect((await opsFor(P("project-a"))).map((r) => r.op)).toEqual([
      { kind: "put", path: "/a.md" },
    ]);
  });
});

describe("a push over an edit made elsewhere", () => {
  // A device project's manifest records what the remote held at the last
  // sync. A put lands only while the remote still holds that; anything else
  // is another device's edit, and overwriting it loses it. The op stops as a
  // conflict, which the next check reports and its resolution settles.

  it("is not sent, and leaves the baseline as it was", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "mine", hash: "h" });
    writeFile.mockResolvedValue(undefined);
    remoteFingerprint.mockResolvedValue({ hash: "edited-elsewhere" });
    await seedManifest({ "/document/a.md": "synced" });

    const { enqueue, settled, isPending } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");
    const { getManifest } = await import("./manifestStore");
    await enqueue(P("project-a"), { kind: "put", path: "/document/a.md" });
    await settled(P("project-a"));

    expect(writeFile).not.toHaveBeenCalled();
    const rows = await opsFor(P("project-a"));
    expect(rows.map((r) => r.stopped?.code)).toEqual(["conflict"]);
    expect(isPending(P("project-a"))).toBe(true);
    const manifest = await getManifest(BOOK("project-a"));
    expect(manifest?.files["/document/a.md"].remote).toBe("synced");
    expect(manifest?.files["/document/a.md"].local).toBe("synced-local");
  });

  it("does not overwrite a file another device created at a path with no baseline", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "mine", hash: "h" });
    writeFile.mockResolvedValue(undefined);
    remoteFingerprint.mockResolvedValue({ hash: "theirs" });
    await seedManifest({});

    const { enqueue, settled } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");
    await enqueue(P("project-a"), { kind: "put", path: "/document/new.md" });
    await settled(P("project-a"));

    expect(writeFile).not.toHaveBeenCalled();
    expect((await opsFor(P("project-a")))[0].stopped?.code).toBe("conflict");
  });

  it("leaves a file conflict detection does not track last-write-wins", async () => {
    // The properties file is rewritten by every save on every device, so it
    // is never compared; holding its push as a conflict would stop the queue
    // behind a conflict no check ever reports.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "mine", hash: "h" });
    writeFile.mockResolvedValue(undefined);
    remoteFingerprint.mockResolvedValue({ hash: "edited-elsewhere" });
    await seedManifest({ "/document-properties.json": "synced" });

    const { enqueue, isPending } = await import("./remoteQueue");
    await enqueue(P("project-a"), {
      kind: "put",
      path: "/document-properties.json",
    });
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));

    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("lands when the remote still holds the baseline", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "mine", hash: "h" });
    writeFile.mockResolvedValue(undefined);
    remoteFingerprint.mockResolvedValue({ hash: "synced" });
    await seedManifest({ "/document/a.md": "synced" });

    const { enqueue, isPending } = await import("./remoteQueue");
    await enqueue(P("project-a"), { kind: "put", path: "/document/a.md" });
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));

    expect(remoteFingerprint).toHaveBeenCalledWith(
      expect.objectContaining({ key: "folder-1" }),
      "/document/a.md",
    );
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("is already done when the remote holds exactly these bytes", async () => {
    // The same edit reached the remote another way, such as a check's push.
    // Nothing is sent, and both sides now hold the bytes, so the baseline
    // takes them.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "mine", hash: "h" });
    const { sha256Hex } = await import("../../text/hash");
    const mine = await sha256Hex("mine");
    remoteFingerprint.mockResolvedValue({ hash: mine });
    await seedManifest({ "/document/a.md": "synced" });

    const { enqueue, isPending } = await import("./remoteQueue");
    const { getManifest } = await import("./manifestStore");
    await enqueue(P("project-a"), { kind: "put", path: "/document/a.md" });
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));

    expect(writeFile).not.toHaveBeenCalled();
    expect(
      (await getManifest(BOOK("project-a")))?.files["/document/a.md"].remote,
    ).toBe(mine);
  });
});

describe("a rename or move whose source is not on the remote", () => {
  // A redelivered rename finds its source gone because it already ran, and a
  // rename of a path that never reached the remote has nothing to move.
  // Either way the remote is where the op wanted it, so the op is done, not
  // a stop the whole project waits behind.

  it("a rename that already happened is done, and the queue moves on", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    remoteRename.mockRejectedValue(notFound());
    remoteExists.mockResolvedValue(false);
    cacheRead.mockResolvedValue({ text: "after", hash: "h" });
    writeFile.mockResolvedValue(undefined);

    const { enqueue, isPending } = await import("./remoteQueue");
    await enqueue(P("project-a"), {
      kind: "rename",
      path: "/a.md",
      newName: "b.md",
    });
    await enqueue(P("project-a"), { kind: "put", path: "/b.md" });
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));

    expect(writeFile).toHaveBeenCalledWith(expect.anything(), "/b.md", "after");
  });

  it("a move that already happened is done too", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    remoteMove.mockRejectedValue(notFound());
    remoteExists.mockResolvedValue(false);

    const { enqueue, isPending } = await import("./remoteQueue");
    await enqueue(P("project-a"), { kind: "mv", from: "/a.md", toDir: "/bin" });
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));
  });

  it("still stops when the source is there and the remote refused anyway", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    remoteRename.mockRejectedValue(notFound());
    remoteExists.mockResolvedValue(true);

    const { enqueue, settled } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");
    await enqueue(P("project-a"), {
      kind: "rename",
      path: "/a.md",
      newName: "b.md",
    });
    await settled(P("project-a"));

    expect((await opsFor(P("project-a")))[0].stopped?.code).toBe("not-found");
  });
});

describe("the drain and a sync check", () => {
  it("never interleave on one project, and neither waits on the other forever", async () => {
    // Both read and write the project's manifest. A check scanning while a
    // push is in flight reads the push as a remote change and reports the
    // writer's own edit as a conflict.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "mine", hash: "h" });
    let land!: () => void;
    writeFile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          land = resolve;
        }),
    );
    await seedManifest({});

    const { enqueue, settled } = await import("./remoteQueue");
    const { checkSync } = await import("./check");
    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalled());

    const side = (name: string, scanned: string[]) => ({
      ref: { providerId: name, key: "k", name: "", openedAt: "" },
      provider: {
        exists: async () => {
          scanned.push(name);
          return false;
        },
        listDir: async () => {
          scanned.push(name);
          throw notFound();
        },
      } as unknown as Parameters<typeof checkSync>[0]["provider"],
    });
    const scanned: string[] = [];
    const check = checkSync(
      side("local", scanned),
      side("remote", scanned),
      BOOK("project-a"),
    );

    // A check on another book runs to its end meanwhile. Once it has, the
    // held check has had every chance to scan, so its silence is the hold and
    // not a slow scheduler.
    const elsewhere: string[] = [];
    await checkSync(
      side("local", elsewhere),
      side("remote", elsewhere),
      BOOK("project-b"),
    );
    expect(elsewhere.length).toBeGreaterThan(0);
    expect(scanned).toEqual([]);

    land();
    await Promise.all([check, settled(P("project-a"))]);
    expect(scanned.length).toBeGreaterThan(0);
  });
});

describe("a wakeup that lands while a drain is leaving", () => {
  it("is not lost: the op queued then still drains", async () => {
    // The drain has found nothing to do and is on its way out when an op
    // lands and something kicks the project: a retry timer, the `online`
    // event, a writer's retry. That kick finds the drain still running and
    // returns, so unless the leaving drain notices, the op waits for the next
    // unrelated kick.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    writeFile.mockResolvedValue(undefined);

    const { enqueue, isPending, retryNow } = await import("./remoteQueue");
    const { appendOp } = await import("./remoteQueueStore");
    let passes = 0;
    let late: Promise<number> | null = null;
    dispose.mockImplementation(() => {
      // The second pass is the one that found the queue empty.
      if (++passes !== 2) return;
      late = appendOp(P("project-a"), { kind: "put", path: "/b.md" });
      void retryNow(P("project-a"));
    });

    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await vi.waitFor(() => expect(late).not.toBeNull());
    await late;

    await vi.waitFor(() =>
      expect(writeFile).toHaveBeenCalledWith(
        expect.anything(),
        "/b.md",
        "hello",
      ),
    );
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));
  });
});

describe("the eviction interlock", () => {
  it("refuses to answer when the queue cannot be read, so nothing is evicted", async () => {
    // An empty answer would say no project owes the remote anything, and
    // the budget would drop working copies that are the only copy of queued
    // work.
    await import("./remoteQueue");
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("storage blocked");
      },
    });

    if (!evictionGuard) throw new Error("the queue registered no interlock");
    await expect(evictionGuard()).rejects.toThrow();
  });
});

describe("enqueue", () => {
  it("resolves only once its op shows in the queue's index", async () => {
    // A save whose op is not yet in the index lets `cached()` read the path
    // as owed nothing and drop the entry the op reads from.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    writeFile.mockRejectedValue(new Error("Drive is down"));

    const { enqueue, pendingOpsFor, settled } = await import("./remoteQueue");
    const first = enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await enqueue(P("project-a"), { kind: "put", path: "/b.md" });

    expect(pendingOpsFor(P("project-a"))).toContainEqual({
      kind: "put",
      path: "/b.md",
    });
    await first;
    await settled(P("project-a"));
  });
});

describe("two tabs", () => {
  it("never push the same op twice", async () => {
    // Both tabs drain the one queue in IndexedDB. Without a lock between them
    // both claim the same head and both send it, which for a new file is two
    // files under one name.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    let land!: () => void;
    writeFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          land = resolve;
        }),
    );
    writeFile.mockResolvedValue(undefined);

    const first = await import("./remoteQueue");
    await first.enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));

    // The second tab: its own modules, the same database and locks.
    vi.resetModules();
    const { setCurrentUserId } = await import("../../auth/currentUser");
    setCurrentUserId("test-user");
    const second = await import("./remoteQueue");
    // The second tab's drain is started here and waited for by its
    // `settled` below, so a second push, if the lock let one through, is
    // counted before the last line.
    await second.drainAll();

    land();
    await first.settled(P("project-a"));
    await second.settled(P("project-a"));
    expect(writeFile).toHaveBeenCalledTimes(1);
  });
});

describe("a drained rename or move", () => {
  // The bytes are the same on both sides after the op, only at a new path,
  // so the baseline goes with them. Dropped, the next save at the new path
  // meets a remote file with no baseline and stops as an edit made elsewhere.

  it("carries the baseline to the new name, and the next save there lands", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    remoteRename.mockResolvedValue(undefined);
    remoteFingerprint.mockResolvedValue({ hash: "synced" });
    cacheRead.mockResolvedValue({ text: "retitled", hash: "h" });
    writeFile.mockResolvedValue(undefined);
    await seedManifest({ "/document/a.md": "synced" });

    const { enqueue, isPending } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");
    const { getManifest } = await import("./manifestStore");
    await enqueue(P("project-a"), {
      kind: "rename",
      path: "/document/a.md",
      newName: "b.md",
    });
    await enqueue(P("project-a"), { kind: "put", path: "/document/b.md" });
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));

    expect(await opsFor(P("project-a"))).toEqual([]);
    expect(writeFile).toHaveBeenCalledWith(
      expect.anything(),
      "/document/b.md",
      "retitled",
    );
    const files = (await getManifest(BOOK("project-a")))?.files ?? {};
    expect(files["/document/a.md"]).toBeUndefined();
    expect(files["/document/b.md"]).toBeDefined();
  });

  it("carries it into the bin and back out on a restore", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    remoteMove.mockResolvedValue(undefined);
    remoteFingerprint.mockResolvedValue({ hash: "synced" });
    cacheRead.mockResolvedValue({ text: "restored", hash: "h" });
    writeFile.mockResolvedValue(undefined);
    await seedManifest({ "/document/x.md": "synced" });

    const { enqueue, isPending } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");
    await enqueue(P("project-a"), {
      kind: "mv",
      from: "/document/x.md",
      toDir: "/recyclebin",
    });
    await enqueue(P("project-a"), {
      kind: "mv",
      from: "/recyclebin/x.md",
      toDir: "/document",
    });
    await enqueue(P("project-a"), { kind: "put", path: "/document/x.md" });
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));

    expect(await opsFor(P("project-a"))).toEqual([]);
    expect(writeFile).toHaveBeenCalledWith(
      expect.anything(),
      "/document/x.md",
      "restored",
    );
  });
});

describe("a remote without digests", () => {
  it("keeps landing saves: the baseline is the remote's own weak answer", async () => {
    // The remote answers with a time, not a checksum. A baseline recorded as
    // the hash of the pushed bytes never equals that time, so every save
    // after the first would stop as a conflict.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "mine", hash: "h" });
    writeFile.mockResolvedValue(undefined);
    remoteFingerprint
      .mockReset()
      // The first save's precondition: the file is new.
      .mockRejectedValueOnce(notFound())
      .mockResolvedValue({ hash: "2026-10-25T10:00:00Z", weak: true });
    await seedManifest({});

    const { enqueue, isPending } = await import("./remoteQueue");
    const { opsFor } = await import("./remoteQueueStore");
    const { getManifest } = await import("./manifestStore");
    await enqueue(P("project-a"), { kind: "put", path: "/document/a.md" });
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));
    await enqueue(P("project-a"), { kind: "put", path: "/document/a.md" });
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));

    expect(await opsFor(P("project-a"))).toEqual([]);
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(
      (await getManifest(BOOK("project-a")))?.files["/document/a.md"],
    ).toMatchObject({ remote: "2026-10-25T10:00:00Z", weak: true });
  });

  it("reads a digest equal to the synced bytes as unchanged, whatever the last answer was", async () => {
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "mine", hash: "h" });
    writeFile.mockResolvedValue(undefined);
    // The remote's answer is not the one the baseline recorded, but it is the
    // digest of the bytes both sides held at the last sync.
    remoteFingerprint.mockResolvedValue({ hash: "synced-local" });
    await seedManifest({ "/document/a.md": "synced" });

    const { enqueue, isPending } = await import("./remoteQueue");
    await enqueue(P("project-a"), { kind: "put", path: "/document/a.md" });
    await vi.waitFor(() => expect(isPending(P("project-a"))).toBe(false));

    expect(writeFile).toHaveBeenCalledTimes(1);
  });
});

describe("a stop with no code", () => {
  it("shows in the queue's rows, so the next claim holds at it", async () => {
    // The cap stops an op with whatever code its last failure had, which can
    // be none. Read as no stop, the index keeps the live row and the next
    // kick runs the op again.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "hello", hash: "h" });
    writeFile.mockRejectedValue(new Error("Drive is down"));

    const { enqueue, retryNow, pendingRecords, settled } =
      await import("./remoteQueue");
    await enqueue(P("project-a"), { kind: "put", path: "/a.md" });
    await settled(P("project-a"));
    for (let i = 0; i < 9; i++) {
      await retryNow(P("project-a"));
      await settled(P("project-a"));
    }

    expect(writeFile).toHaveBeenCalledTimes(10);
    expect(pendingRecords()).toHaveLength(1);
    expect(pendingRecords()[0].stopped).toMatchObject({ code: null });
  });
});

describe("a conflict resolution", () => {
  it("holds the drain until it is done, then drops the queue it held", async () => {
    // An op queued before the resolution ends describes the state it
    // replaces. Pushed during the copy, it would land over the kept side;
    // pushed after, it would undo the resolution.
    pairingFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    cacheRead.mockResolvedValue({ text: "before", hash: "h" });
    writeFile.mockResolvedValue(undefined);
    await seedManifest({});

    const { enqueue, resolving, settled, isPending } =
      await import("./remoteQueue");
    const { getManifest, putManifest } = await import("./manifestStore");
    const { emptyManifest, withBaseline } = await import("./manifest");
    const rebuilt = withBaseline(
      emptyManifest({ providerId: "drive", key: "folder-1" }),
      "/document/a.md",
      { local: "kept", remote: "kept", remoteFileId: "", localMtime: 0 },
    );

    let finish!: () => void;
    const copying = new Promise<void>((resolve) => (finish = resolve));
    const resolution = resolving(
      P("project-a"),
      BOOK("project-a"),
      async () => {
        await copying;
        await putManifest(BOOK("project-a"), rebuilt);
      },
    );
    await enqueue(P("project-a"), { kind: "put", path: "/document/a.md" });
    let heldSettled = false;
    void settled(P("project-a")).then(() => (heldSettled = true));

    // A second book drains freely meanwhile. Once its write has landed, the
    // held book's drain has had every chance to run, so its silence is the
    // hold and not a slow scheduler.
    await putManifest(
      BOOK("project-b"),
      emptyManifest({ providerId: "drive", key: "folder-1" }),
    );
    await enqueue(P("project-b"), { kind: "put", path: "/document/b.md" });
    await settled(P("project-b"));
    const written = () => writeFile.mock.calls.map((call) => call[1]);
    expect(written()).toEqual(["/document/b.md"]);
    expect(heldSettled).toBe(false);

    finish();
    await resolution;
    await settled(P("project-a"));

    expect(written()).toEqual(["/document/b.md"]);
    expect(isPending(P("project-a"))).toBe(false);
    expect(await getManifest(BOOK("project-a"))).toEqual(rebuilt);
  });
});
