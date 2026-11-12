// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CacheStore } from "../../storage/cache/cacheStore";

const enqueue = vi.fn();
const pendingOpsFor = vi.fn((): readonly unknown[] => []);
/** The address the composed provider asks the queue about. */
let seenRef: unknown = null;

vi.mock("./remoteQueue", () => ({
  enqueue: (ref: unknown, op: unknown) => enqueue(ref, op),
  pendingOpsFor: (ref: unknown) => {
    seenRef = ref;
    return pendingOpsFor();
  },
}));

/** Enough of the port to prove which side a write reached. */
function fakeStore(): CacheStore {
  return {
    read: vi.fn(async () => null),
    write: vi.fn(async (_p: string, text: string) => ({ text, hash: "h" })),
    has: vi.fn(async () => false),
    remove: vi.fn(async () => {}),
    dropProject: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}

beforeEach(() => {
  vi.resetModules();
  enqueue.mockReset();
  pendingOpsFor.mockReset();
  pendingOpsFor.mockReturnValue([]);
  seenRef = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  // One test swaps `mirror` for a spy to read the argument it is handed; the
  // rest compose the real decorator, so the swap is undone after each test.
  vi.doUnmock("../../storage/mirrored");
});

const localRef = {
  providerId: "local",
  key: "abc",
  name: "Project",
  openedAt: "",
};
const remoteRef = {
  providerId: "drive",
  key: "folder-1",
  name: "Project",
  openedAt: "",
};

// Which projects get a working copy and a queue, and which get their provider
// bare, follows one resolved fact: whether the project has a destination.
// A Drive-primary project has one, so its writes are committed by the
// queue.

/** The book these refs name; the queue and the working copy key on it. */
const BOOK = "book-1";

describe("providerFor", () => {
  it("wraps a project that has a destination, whatever kind it is", async () => {
    const { providerFor } = await import("./resolve");
    const { localProvider } = await import("../../storage/localProvider");
    const { driveProvider } = await import("../../storage/driveProvider");

    const local = providerFor(localRef, {
      store: fakeStore(),
      projectId: BOOK,
    });
    expect(local).not.toBe(localProvider);
    expect(local?.id).toBe(localProvider.id);

    // A remote-primary project is decorated, because its bytes go to the
    // working copy and the queue rather than straight to the network.
    const remote = providerFor(remoteRef, {
      store: fakeStore(),
      projectId: BOOK,
    });
    expect(remote).not.toBe(driveProvider);
    expect(remote?.id).toBe(driveProvider.id);
  });

  it("hands back the bare provider when there is no destination", async () => {
    // A Local project's "saved" stays a fact about a file the writer can open
    // in another editor: no working copy, no queue, no decorator between the
    // editor and the disk.
    const { providerFor } = await import("./resolve");
    const { localProvider } = await import("../../storage/localProvider");
    expect(providerFor(localRef, { store: null, projectId: BOOK })).toBe(
      localProvider,
    );
  });

  it("writes through the working copy before it enqueues", async () => {
    // `cached` is inside `mirror`, so an op is appended only after both
    // durable writes resolved; an op whose source was never written would
    // drain a stale file or none.
    const { providerFor } = await import("./resolve");
    const store = fakeStore();
    const provider = providerFor(remoteRef, { store, projectId: BOOK });

    await provider?.writeFile(remoteRef, "/document/a.md", "prose");

    expect(store.write).toHaveBeenCalledWith("/document/a.md", "prose");
    // The op names the book and where its bytes are: the queue can hold work
    // that exists nowhere else, so it carries both rather than resolving one
    // from the other when it drains.
    expect(enqueue).toHaveBeenCalledWith(
      { id: BOOK, providerId: "drive", key: "folder-1" },
      { kind: "put", path: "/document/a.md" },
    );
  });

  it("holds the working copy's lock across every tab from a save's write until its op is queued", async () => {
    // A fill from the remote takes the same lock, so it never lands between
    // the entry a save wrote and the op that says the entry is unsent.
    const { providerFor } = await import("./resolve");
    const store = fakeStore();
    let queued!: () => void;
    enqueue.mockImplementation(
      () => new Promise<void>((resolve) => (queued = resolve)),
    );
    const provider = providerFor(remoteRef, { store, projectId: BOOK });

    const saving = provider?.writeFile(remoteRef, "/document/a.md", "prose");
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalled());
    const held = (await navigator.locks.query()).held ?? [];
    expect(
      held.some(
        (lock) =>
          lock.name?.startsWith("working-copy") &&
          lock.name.endsWith("drive:folder-1"),
      ),
    ).toBe(true);

    queued();
    await saving;
    const after = (await navigator.locks.query()).held ?? [];
    expect(after.some((lock) => lock.name?.startsWith("working-copy"))).toBe(
      false,
    );
  });

  it("does not enqueue when the working copy refuses the write", async () => {
    // A queue row whose source does not exist can only fail or push nothing,
    // which is why the decorators nest this way round.
    const { providerFor } = await import("./resolve");
    const store = fakeStore();
    store.write = vi.fn(async () => {
      throw new Error("no room");
    });
    const provider = providerFor(remoteRef, { store, projectId: BOOK });

    await expect(
      provider?.writeFile(remoteRef, "/document/a.md", "prose"),
    ).rejects.toThrow();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("asks the queue about the same book it enqueues to", async () => {
    // One address, used both directions: `mirror` is told what to commit and
    // asks what is still outstanding. A supplier closing over a different key
    // would list another project's pending work onto this folder, and since
    // that is still a plausible listing, nothing downstream would catch it.
    const seen: { pending?: () => readonly unknown[] } = {};
    vi.doMock("../../storage/mirrored", () => ({
      mirror: (
        base: unknown,
        _enqueue: unknown,
        pending: () => readonly unknown[],
      ) => {
        seen.pending = pending;
        return base;
      },
    }));
    const { providerFor } = await import("./resolve");
    providerFor(remoteRef, { store: fakeStore(), projectId: BOOK });

    const ops = [{ kind: "rm", path: "/document/a.md" }];
    pendingOpsFor.mockReturnValue(ops);
    expect(seen.pending).toBeTypeOf("function");
    expect(seen.pending?.()).toBe(ops);
    expect(seenRef).toEqual({ id: BOOK, providerId: "drive", key: "folder-1" });
  });

  it("returns null for an unregistered provider id", async () => {
    const { providerFor } = await import("./resolve");
    const ref = { providerId: "nonsense", key: "x", name: "", openedAt: "" };
    expect(providerFor(ref, { store: null, projectId: BOOK })).toBeNull();
  });
});
