// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cached } from "./cached";
import type { CacheStore, CachedEntry } from "./cacheStore";
import {
  StorageError,
  type FileFingerprint,
  type ProviderKind,
  type StorageProvider,
} from "../types";

// The decorator puts the writer's bytes in the working copy before the queue
// is told they exist, and branches only on the base provider's `kind`. So
// every row is either "which side got written, in which order" or "what the
// miss did".
//
// The order rows assert a sequence, not two independent calls: `disk → cache`
// and `cache → queue` is the required sequence. A test that only
// checked both happened would pass on the arrangement that loses a
// manuscript, a cache entry describing bytes the writer's own file does not
// hold.

function fakeStore(): CacheStore {
  return {
    read: vi.fn(async () => null),
    write: vi.fn(async (_path: string, text: string) => ({
      text,
      hash: "hash",
    })),
    has: vi.fn(async () => false),
    remove: vi.fn(async () => {}),
    dropProject: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}

/** Records the order calls arrive in, across both sides of the decorator. */
let calls: string[];

function fakeBase(kind: ProviderKind): StorageProvider {
  return {
    id: kind === "device" ? "local" : "drive",
    kind,
    label: "Base",
    icon: "folder",
    isAvailable: vi.fn(async () => true),
    reopenProject: vi.fn(async () => "granted" as const),
    canAccess: vi.fn(async () => "granted" as const),
    listDir: vi.fn(async () => []),
    exists: vi.fn(async () => true),
    readFile: vi.fn(async () => {
      calls.push("base.readFile");
      return "from the base";
    }),
    writeFile: vi.fn(async () => {
      calls.push("base.writeFile");
    }),
    createDir: vi.fn(async () => {
      calls.push("base.createDir");
    }),
    removeFile: vi.fn(async () => {
      calls.push("base.removeFile");
    }),
    renameFile: vi.fn(async () => {
      calls.push("base.renameFile");
    }),
    moveFile: vi.fn(async () => {
      calls.push("base.moveFile");
    }),
    fingerprintFile: vi.fn(async () => null),
    fingerprintDir: vi.fn(async () => new Map()),
  } as unknown as StorageProvider;
}

const REF = { providerId: "local", key: "book", name: "", openedAt: "" };
/** A lock with one holder at a time, as the composition root's is. */
function oneAtATime() {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
}
/** The queue owes the remote nothing: every row below but the `owing` ones. */
const NOTHING_OWED = {
  owes: () => false,
  owedNow: async () => false,
  exclusive: oneAtATime(),
  lostRead: () => {},
};
/** The queue owes the remote a put on `path`, and records a lost read. */
const owing = (path: string) => ({
  owes: (p: string) => p === path,
  owedNow: async (p: string) => p === path,
  exclusive: oneAtATime(),
  lostRead: vi.fn(),
});
const PATH = "/document/a.md";

beforeEach(() => {
  calls = [];
});

describe("a device project — disk, then the working copy", () => {
  it("writes the writer's own file FIRST and the working copy second", async () => {
    // The order is the contract. The disk is the file the writer can open in
    // another editor, so it must be true first; a working copy written ahead
    // of it could describe bytes no file on the machine holds.
    const store = fakeStore();
    store.write = vi.fn(async (_p: string, text: string) => {
      calls.push("store.write");
      return { text, hash: "hash" };
    });
    const base = fakeBase("device");

    await cached(base, store, NOTHING_OWED).writeFile(REF, PATH, "prose");

    expect(calls).toEqual(["base.writeFile", "store.write"]);
  });

  it("does not write the working copy when the disk refuses", async () => {
    // So `mirror` never enqueues: an op whose source was never written drains
    // a stale file or none at all.
    const store = fakeStore();
    const base = fakeBase("device");
    base.writeFile = vi.fn(async () => {
      throw new Error("no permission");
    });

    await expect(
      cached(base, store, NOTHING_OWED).writeFile(REF, PATH, "prose"),
    ).rejects.toThrow();
    expect(store.write).not.toHaveBeenCalled();
  });

  it("passes a structural op straight to the disk", async () => {
    // The inverse of the remote case: for a device project every structural
    // op is on the writer's own file system, and the queue's copy of it is a
    // separate errand.
    const store = fakeStore();
    const base = fakeBase("device");
    const provider = cached(base, store, NOTHING_OWED);

    await provider.createDir(REF, "/document");
    await provider.removeFile(REF, PATH);
    await provider.renameFile(REF, PATH, "b.md");
    await provider.moveFile(REF, PATH, "/other");

    expect(calls).toEqual([
      "base.createDir",
      "base.removeFile",
      "base.renameFile",
      "base.moveFile",
    ]);
  });

  it("reads the disk, never the working copy", async () => {
    // The disk is the truth for these projects. The working copy is the
    // queue's source, not a stand-in for the writer's own file: serving it
    // would hide an edit made in another editor.
    const store = fakeStore();
    const base = fakeBase("device");

    expect(await cached(base, store, NOTHING_OWED).readFile(REF, PATH)).toBe(
      "from the base",
    );
    expect(store.read).not.toHaveBeenCalled();
  });

  // An entry can vanish under a queued put, as when an in-memory storage
  // partition drops OPFS bytes when idle. For a device project the disk was
  // written first and holds everything the put is for, and ordinary reads
  // never touch the working copy, so this read is the only refill; without
  // it the put retries to the cap while the bytes sit on disk.
  it("— refills a vanished entry the queue still owes, from the disk", async () => {
    const store = fakeStore();
    const base = fakeBase("device");

    const text = await cached(base, store, owing(PATH)).readFile(REF, PATH);

    expect(text).toBe("from the base");
    expect(store.write).toHaveBeenCalledWith(PATH, "from the base");
  });

  it("leaves a present entry the queue owes exactly as it is", async () => {
    // The entry is the put's source; rewriting it on every read costs an OPFS
    // write per read and proves nothing.
    const store = fakeStore();
    store.has = vi.fn(async () => true);
    const base = fakeBase("device");

    await cached(base, store, owing(PATH)).readFile(REF, PATH);

    expect(store.write).not.toHaveBeenCalled();
  });

  it("asks the working copy nothing for a path the queue does not owe", async () => {
    // The common read stays free.
    const store = fakeStore();
    const base = fakeBase("device");

    await cached(base, store, NOTHING_OWED).readFile(REF, PATH);

    expect(store.has).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
  });
});

describe("a remote project — the working copy and nothing else", () => {
  it("writes ONLY the working copy, never straight to the network", async () => {
    // The queue is the only path to a remote. A direct write here is a save
    // that reports success while the connection is still deciding.
    const store = fakeStore();
    const base = fakeBase("remote");

    await cached(base, store, NOTHING_OWED).writeFile(REF, PATH, "prose");

    expect(store.write).toHaveBeenCalledWith(PATH, "prose");
    expect(base.writeFile).not.toHaveBeenCalled();
  });

  it("serves a hit from the working copy without touching the remote", async () => {
    const store = fakeStore();
    store.read = vi.fn(async () => ({ text: "cached prose", hash: "hash" }));
    const base = fakeBase("remote");

    expect(await cached(base, store, NOTHING_OWED).readFile(REF, PATH)).toBe(
      "cached prose",
    );
    expect(base.readFile).not.toHaveBeenCalled();
  });

  it("fills the working copy on a miss, through the ordinary read", async () => {
    // The refill is read-through, not a separate entry point: a store with its
    // own "refill" method would have two ways to become populated and only one
    // of them exercised by ordinary use.
    const store = fakeStore();
    const base = fakeBase("remote");
    const provider = cached(base, store, NOTHING_OWED);

    expect(await provider.readFile(REF, PATH)).toBe("from the base");
    expect(calls).toEqual(["base.readFile"]);
    expect(store.write).toHaveBeenCalledWith(PATH, "from the base");
  });

  // The working copy can be the only copy of a queued change, and the remote
  // holds the state before it. Filling the vanished entry from the remote
  // would make those older bytes the put's source: the queue would send the
  // remote what it already has, clear, and drop the held-work notice.
  it("— serves the remote's text for an owed path but never makes it the queue's source", async () => {
    const store = fakeStore();
    const base = fakeBase("remote");

    const text = await cached(base, store, owing(PATH)).readFile(REF, PATH);

    expect(text).toBe("from the base");
    expect(store.write).not.toHaveBeenCalled();
  });

  // That read is the earliest point anything knows the queued change is
  // gone, and the only one that knows the text it served is the older one.
  it("reports the owed read that fell back to the remote, and only that one", async () => {
    const queue = owing(PATH);
    const store = fakeStore();
    const provider = cached(fakeBase("remote"), store, queue);

    await provider.readFile(REF, PATH);
    await provider.readFile(REF, "/document/other.md");

    expect(queue.lostRead).toHaveBeenCalledTimes(1);
    expect(queue.lostRead).toHaveBeenCalledWith(PATH);
  });

  it("reports nothing for a device base, whose disk still holds the change", async () => {
    const queue = owing(PATH);
    await cached(fakeBase("device"), fakeStore(), queue).readFile(REF, PATH);
    expect(queue.lostRead).not.toHaveBeenCalled();
  });

  it("sends no structural op to the remote either", async () => {
    // As with the write: `mkdir`, `rm`, `mv` and `rename` all reach the remote
    // through the queue, in the order the writer made them. A rename of an
    // uncached path reads the remote to carry the bytes, which is a read, not
    // a structural op.
    const store = fakeStore();
    const base = fakeBase("remote");
    const provider = cached(base, store, NOTHING_OWED);

    await provider.createDir(REF, "/document");
    await provider.removeFile(REF, PATH);
    await provider.renameFile(REF, PATH, "b.md");
    await provider.moveFile(REF, PATH, "/other");

    expect(calls.filter((call) => call !== "base.readFile")).toEqual([]);
  });
});

describe("what both shapes share", () => {
  it("drops the working copy's entry for a path that stopped existing", async () => {
    // A stale entry for a removed or renamed path would be served to a later
    // read of a path the writer has already dealt with.
    for (const kind of ["device", "remote"] as const) {
      const store = fakeStore();
      const provider = cached(fakeBase(kind), store, NOTHING_OWED);

      await provider.removeFile(REF, PATH);
      await provider.renameFile(REF, PATH, "b.md");
      await provider.moveFile(REF, PATH, "/other");

      expect(store.remove).toHaveBeenCalledTimes(3);
      expect(store.remove).toHaveBeenCalledWith(PATH);
    }
  });

  // The entry follows its file. For a Remote-only project whose rename is
  // still queued, the remote has not moved the file yet, so a new path left
  // to refill from its durable side has none.
  it("— carries an entry to the file's new path on a rename or a move", async () => {
    for (const kind of ["device", "remote"] as const) {
      const store = fakeStore();
      store.read = vi.fn(async () => ({ text: "the prose", hash: "hash" }));
      const provider = cached(fakeBase(kind), store, NOTHING_OWED);

      await provider.renameFile(REF, PATH, "b.md");
      await provider.moveFile(REF, PATH, "/other");

      expect(store.write).toHaveBeenCalledWith("/document/b.md", "the prose");
      expect(store.write).toHaveBeenCalledWith("/other/a.md", "the prose");
    }
  });

  // A save and then a rename, move or delete of the same file, both still
  // queued, drain in that order, and the save's source is the old path's
  // entry. Dropping it strands the queue's head with no source, and for a
  // Remote-only project the saved text exists nowhere else.
  it("— keeps an entry the queue still owes through a rename, a move or a delete", async () => {
    for (const kind of ["device", "remote"] as const) {
      const store = fakeStore();
      const provider = cached(fakeBase(kind), store, owing(PATH));

      await provider.renameFile(REF, PATH, "b.md");
      await provider.moveFile(REF, PATH, "/other");
      await provider.removeFile(REF, PATH);

      expect(store.remove).not.toHaveBeenCalled();
    }
  });

  it("keeps the base's kind, because caching bytes does not move them", async () => {
    // As in `mirror()` for the same field: flipping it would make every cached
    // project read as remote-only to every caller that branches on the one
    // axis above the port.
    expect(cached(fakeBase("device"), fakeStore(), NOTHING_OWED).kind).toBe(
      "device",
    );
    expect(cached(fakeBase("remote"), fakeStore(), NOTHING_OWED).kind).toBe(
      "remote",
    );
  });

  it("delegates everything that is not one file's bytes", async () => {
    // The working copy holds files, not a tree. A `listDir` answered from
    // what is cached makes a half-filled copy look like a project with
    // missing chapters.
    const store = fakeStore();
    const base = fakeBase("remote");
    const provider = cached(base, store, NOTHING_OWED);

    await provider.listDir(REF, "/");
    await provider.exists(REF, PATH);
    await provider.canAccess(REF);
    await provider.isAvailable();
    await provider.reopenProject(REF);
    await provider.fingerprintFile(REF, PATH);
    await provider.fingerprintDir(REF, "/");

    expect(base.listDir).toHaveBeenCalled();
    expect(base.exists).toHaveBeenCalled();
    expect(base.canAccess).toHaveBeenCalled();
    expect(base.isAvailable).toHaveBeenCalled();
    expect(base.reopenProject).toHaveBeenCalled();
    expect(base.fingerprintFile).toHaveBeenCalled();
    expect(base.fingerprintDir).toHaveBeenCalled();
  });

  it("carries the optional port members only when the base has them", async () => {
    // Their absence is the answer above the port. A device provider
    // has no bin and no web address, and a decorator that invented one would
    // offer the writer an action that cannot work.
    const bare = cached(fakeBase("device"), fakeStore(), NOTHING_OWED);
    expect(bare.folderUrl).toBeUndefined();
    expect(bare.trashProject).toBeUndefined();

    const base = fakeBase("remote");
    base.folderUrl = vi.fn(() => "https://example.test/folder");
    base.trashProject = vi.fn(async () => {});
    const rich = cached(base, fakeStore(), NOTHING_OWED);

    expect(rich.folderUrl?.(REF)).toBe("https://example.test/folder");
    // A backend with the capability but no address for this project answers
    // `null`, not `undefined`: the card asks one question and gets one kind of
    // answer.
    base.folderUrl = vi.fn(() => null);
    expect(cached(base, fakeStore(), NOTHING_OWED).folderUrl?.(REF)).toBeNull();
    await rich.trashProject?.(REF);
    expect(base.trashProject).toHaveBeenCalled();
  });

  it("passes statFile through only when the base implements it", async () => {
    const base = fakeBase("remote");
    expect(cached(base, fakeStore(), NOTHING_OWED).statFile).toBeUndefined();

    base.statFile = vi.fn(async () => null);
    await cached(base, fakeStore(), NOTHING_OWED).statFile?.(REF, PATH);
    expect(base.statFile).toHaveBeenCalled();
  });

  // Unlike the pass-throughs, `writeBytes` is withheld. The working
  // copy is text-only and the queue promises the writer's work; an export is
  // binary and can be made again, so it is written to each home's bare
  // provider, around this decorator. Offering `writeBytes` here, even as a
  // plain delegation, would invite a caller to route an export through the
  // cache, and on this port absence is the answer.
  it("never offers writeBytes, even over a base that has it", () => {
    for (const kind of ["device", "remote"] as const) {
      const base = fakeBase(kind);
      base.writeBytes = vi.fn(async () => {});
      expect("writeBytes" in cached(base, fakeStore(), NOTHING_OWED)).toBe(
        false,
      );
    }
  });
});

/** A store over a map, hashing as `h:<text>` so a listing below can match. */
function mapStore(seed: Record<string, string> = {}) {
  const entries = new Map<string, CachedEntry>(
    Object.entries(seed).map(([path, text]) => [
      path,
      { text, hash: `h:${text}` },
    ]),
  );
  const store = {
    entries,
    read: vi.fn(async (path: string) => entries.get(path) ?? null),
    write: vi.fn(async (path: string, text: string) => {
      const entry = { text, hash: `h:${text}` };
      entries.set(path, entry);
      return entry;
    }),
    has: vi.fn(async (path: string) => entries.has(path)),
    remove: vi.fn(async (path: string) => {
      entries.delete(path);
    }),
    dropProject: vi.fn(async () => entries.clear()),
    dispose: vi.fn(),
  };
  return store satisfies CacheStore;
}

/** One folder's remote fingerprints, keyed by file name. */
function listing(files: Record<string, string>): Map<string, FileFingerprint> {
  return new Map(
    Object.entries(files).map(([name, text]) => [name, { hash: `h:${text}` }]),
  );
}

// A path the queue owes a put is in the project although a remote base has
// never seen it. Asking the remote alone reads a comments file saved offline
// as missing, and the next save writes over every comment in it.
describe("exists over a remote base", () => {
  it("finds a path the queue owes a put whose bytes are in the working copy", async () => {
    const base = fakeBase("remote");
    base.exists = vi.fn(async () => false);
    const store = mapStore({ [PATH]: "offline comments" });

    expect(await cached(base, store, owing(PATH)).exists(REF, PATH)).toBe(true);
    expect(base.exists).not.toHaveBeenCalled();
  });

  it("asks the remote about a leftover entry nothing owes", async () => {
    // `release` keeps the entry of a path deleted while owed, so an entry
    // alone proves nothing once the queue has drained.
    const base = fakeBase("remote");
    base.exists = vi.fn(async () => false);
    const store = mapStore({ [PATH]: "left behind" });

    expect(await cached(base, store, NOTHING_OWED).exists(REF, PATH)).toBe(
      false,
    );
  });

  it("asks the disk for a device base, which was written first", async () => {
    const base = fakeBase("device");
    base.exists = vi.fn(async () => false);

    expect(
      await cached(base, mapStore({ [PATH]: "x" }), owing(PATH)).exists(
        REF,
        PATH,
      ),
    ).toBe(false);
  });
});

// A rename or move queued for a path that exists nowhere can never land on
// the remote, and the queue stops at it. The local provider refuses the same
// rename with `not-found`, so the remote base does too.
describe("rename and move over a remote base", () => {
  function missingEverywhere(): StorageProvider {
    const base = fakeBase("remote");
    base.readFile = vi.fn(async () => {
      throw new StorageError("gone", "not-found");
    });
    return base;
  }

  it("refuses to rename or move a path that exists nowhere", async () => {
    const store = mapStore();
    const provider = cached(missingEverywhere(), store, NOTHING_OWED);

    await expect(provider.renameFile(REF, PATH, "b.md")).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(provider.moveFile(REF, PATH, "/other")).rejects.toMatchObject({
      code: "not-found",
    });
    expect(store.write).not.toHaveBeenCalled();
  });

  it("lets a rename through when the remote cannot be reached", async () => {
    // Offline is not absence: the queue carries the rename once the
    // connection is back.
    const base = fakeBase("remote");
    base.readFile = vi.fn(async () => {
      throw new StorageError("offline", "unavailable");
    });

    await expect(
      cached(base, mapStore(), NOTHING_OWED).renameFile(REF, PATH, "b.md"),
    ).resolves.toBeUndefined();
  });

  it("lets a rename through for a path the queue owes, whose entry vanished", async () => {
    // The put that created it is still queued, so the remote has not seen it
    // and its `not-found` proves nothing.
    await expect(
      cached(missingEverywhere(), mapStore(), owing(PATH)).renameFile(
        REF,
        PATH,
        "b.md",
      ),
    ).resolves.toBeUndefined();
  });

  it("reads an uncached file through the remote, so the new path opens before the rename drains", async () => {
    const store = mapStore();
    const provider = cached(fakeBase("remote"), store, NOTHING_OWED);

    await provider.renameFile(REF, PATH, "b.md");

    expect(store.entries.get("/document/b.md")?.text).toBe("from the base");
    expect(store.entries.has(PATH)).toBe(false);
  });
});

// The reader already holds the text when the fill runs. A full disk or a
// locked file is the working copy's problem, never the reader's.
describe("a fill that fails", () => {
  it("still answers the read, for both bases", async () => {
    for (const kind of ["device", "remote"] as const) {
      const store = fakeStore();
      store.write = vi.fn(async () => {
        throw new StorageError("full", "no-space");
      });
      const queue = kind === "device" ? owing(PATH) : NOTHING_OWED;

      expect(
        await cached(fakeBase(kind), store, queue).readFile(REF, PATH),
      ).toBe("from the base");
      expect(store.write).toHaveBeenCalled();
    }
  });
});

// Another device can save after this one filled its working copy. A hit is
// checked once per open against the remote's checksum, so a stale entry is
// not served for as long as it survives.
describe("revalidating a hit over a remote base", () => {
  it("serves the remote's newer text and refills the entry", async () => {
    const store = mapStore({ [PATH]: "old prose" });
    const base = fakeBase("remote");
    base.fingerprintDir = vi.fn(async () =>
      listing({ "a.md": "from the base" }),
    );
    const provider = cached(base, store, NOTHING_OWED);

    expect(await provider.readFile(REF, PATH)).toBe("from the base");
    expect(store.entries.get(PATH)?.text).toBe("from the base");
    expect(base.fingerprintDir).toHaveBeenCalledWith(REF, "/document");
  });

  it("serves a matching entry without downloading it, and asks once per open", async () => {
    const store = mapStore({ [PATH]: "same", "/document/b.md": "also same" });
    const base = fakeBase("remote");
    base.fingerprintDir = vi.fn(async () =>
      listing({ "a.md": "same", "b.md": "also same" }),
    );
    const provider = cached(base, store, NOTHING_OWED);

    expect(await provider.readFile(REF, PATH)).toBe("same");
    expect(await provider.readFile(REF, PATH)).toBe("same");
    expect(await provider.readFile(REF, "/document/b.md")).toBe("also same");
    expect(base.readFile).not.toHaveBeenCalled();
    // One listing answers every file in the folder.
    expect(base.fingerprintDir).toHaveBeenCalledTimes(1);
  });

  it("serves the entry when the remote cannot be asked, and asks again later", async () => {
    const store = mapStore({ [PATH]: "cached prose" });
    const base = fakeBase("remote");
    base.fingerprintDir = vi.fn(async () => {
      throw new StorageError("offline", "unavailable");
    });
    const provider = cached(base, store, NOTHING_OWED);

    expect(await provider.readFile(REF, PATH)).toBe("cached prose");
    expect(await provider.readFile(REF, PATH)).toBe("cached prose");
    expect(base.fingerprintDir).toHaveBeenCalledTimes(2);
  });

  it("serves the entry when the remote does not list the file", async () => {
    // Absence from one listing does not prove a file gone.
    const store = mapStore({ [PATH]: "cached prose" });
    const provider = cached(fakeBase("remote"), store, NOTHING_OWED);

    expect(await provider.readFile(REF, PATH)).toBe("cached prose");
  });

  it("never revalidates an entry the queue owes, or one written in this open", async () => {
    const base = fakeBase("remote");
    base.fingerprintDir = vi.fn(async () => listing({ "a.md": "remote" }));

    const owed = mapStore({ [PATH]: "unsent change" });
    expect(await cached(base, owed, owing(PATH)).readFile(REF, PATH)).toBe(
      "unsent change",
    );

    const provider = cached(base, mapStore(), NOTHING_OWED);
    await provider.writeFile(REF, PATH, "just typed");
    expect(await provider.readFile(REF, PATH)).toBe("just typed");
    expect(base.fingerprintDir).not.toHaveBeenCalled();
  });

  it("keeps a save that lands while the remote is being read", async () => {
    const store = mapStore({ [PATH]: "old prose" });
    const base = fakeBase("remote");
    base.fingerprintDir = vi.fn(async () => listing({ "a.md": "remote" }));
    const provider = cached(base, store, NOTHING_OWED);
    base.readFile = vi.fn(async () => {
      await provider.writeFile(REF, PATH, "just typed");
      return "remote";
    });

    expect(await provider.readFile(REF, PATH)).toBe("just typed");
    expect(store.entries.get(PATH)?.text).toBe("just typed");
  });
});

// The working copy is shared by every tab, and this tab's view of the queue
// hears only its own ops. A fill from the remote over an entry another tab
// saved and has not sent would hand that tab's drain the older text to push.
describe("a refill over an entry another tab or instance owns", () => {
  it("keeps cached prose if the changed remote cannot be read", async () => {
    const store = mapStore({ [PATH]: "only local copy" });
    const base = fakeBase("remote");
    base.fingerprintDir = vi.fn(async () => listing({ "a.md": "new remote" }));
    base.readFile = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await cached(base, store, NOTHING_OWED).readFile(REF, PATH)).toBe(
      "only local copy",
    );
    expect(store.entries.get(PATH)?.text).toBe("only local copy");
  });
  it.each([true, false])(
    "does not replace bytes when queue ownership cannot be checked, cached=%s",
    async (hit) => {
      const store = mapStore(hit ? { [PATH]: "held copy" } : {});
      const base = fakeBase("remote");
      base.fingerprintDir = vi.fn(async () =>
        listing({ "a.md": "new remote" }),
      );
      const queue = {
        ...NOTHING_OWED,
        owedNow: async () => {
          throw new Error("queue unavailable");
        },
      };
      expect(await cached(base, store, queue).readFile(REF, PATH)).toBe(
        hit ? "held copy" : "from the base",
      );
      expect(store.entries.get(PATH)?.text).toBe(hit ? "held copy" : undefined);
    },
  );
  it("serves a concurrent saved entry instead of refilling a cold read with older remote text", async () => {
    const store = mapStore();
    const base = fakeBase("remote");
    base.readFile = vi.fn(async () => {
      await store.write(PATH, "new in another tab");
      return "old remote";
    });
    expect(await cached(base, store, NOTHING_OWED).readFile(REF, PATH)).toBe(
      "new in another tab",
    );
    expect(store.entries.get(PATH)?.text).toBe("new in another tab");
  });
  it("does not refill a path deleted through this instance while its cold read was pending", async () => {
    const store = mapStore();
    const base = fakeBase("remote");
    const provider = cached(base, store, NOTHING_OWED);
    base.readFile = vi.fn(async () => {
      await provider.removeFile(REF, PATH);
      return "remote snapshot";
    });
    expect(await provider.readFile(REF, PATH)).toBe("remote snapshot");
    expect(store.entries.has(PATH)).toBe(false);
  });
  it("re-reads after another instance removes a cached entry during validation", async () => {
    const store = mapStore({ [PATH]: "old local" });
    const base = fakeBase("remote");
    base.fingerprintDir = vi.fn(async () => listing({ "a.md": "remote" }));
    base.readFile = vi
      .fn()
      .mockImplementationOnce(async () => {
        await store.remove(PATH);
        return "outdated response";
      })
      .mockResolvedValue("fresh response");
    expect(await cached(base, store, NOTHING_OWED).readFile(REF, PATH)).toBe(
      "fresh response",
    );
    expect(store.entries.get(PATH)?.text).toBe("fresh response");
  });
  it("keeps a newer save that lands while a queue ownership check is pending", async () => {
    const store = mapStore();
    const base = fakeBase("remote");
    const queue = {
      ...NOTHING_OWED,
      owedNow: async () => {
        await provider.writeFile(REF, PATH, "newest save");
        return false;
      },
    };
    const provider: StorageProvider = cached(base, store, queue);
    await provider.readFile(REF, PATH);
    expect(store.entries.get(PATH)?.text).toBe("newest save");
  });
  it("never replaces an entry another tab's queue still owes the remote", async () => {
    const store = mapStore({ [PATH]: "unsent in the other tab" });
    const base = fakeBase("remote");
    base.fingerprintDir = vi.fn(async () => listing({ "a.md": "older" }));
    base.readFile = vi.fn(async () => "older");
    const queue = {
      ...NOTHING_OWED,
      owedNow: async (p: string) => p === PATH,
      lostRead: vi.fn(),
    };

    expect(await cached(base, store, queue).readFile(REF, PATH)).toBe(
      "unsent in the other tab",
    );
    expect(store.entries.get(PATH)?.text).toBe("unsent in the other tab");
    expect(queue.lostRead).not.toHaveBeenCalled();
  });

  it("never replaces an entry another instance saved while the remote was read", async () => {
    const store = mapStore({ [PATH]: "old prose" });
    const base = fakeBase("remote");
    base.fingerprintDir = vi.fn(async () => listing({ "a.md": "remote" }));
    const writer = cached(fakeBase("remote"), store, NOTHING_OWED);
    const reader = cached(base, store, NOTHING_OWED);
    base.readFile = vi.fn(async () => {
      await writer.writeFile(REF, PATH, "just typed");
      return "remote";
    });

    expect(await reader.readFile(REF, PATH)).toBe("just typed");
    expect(store.entries.get(PATH)?.text).toBe("just typed");
  });

  it("reports a miss another tab's queue owes as lost, and fills nothing", async () => {
    const store = mapStore();
    const queue = {
      ...NOTHING_OWED,
      owedNow: async (p: string) => p === PATH,
      lostRead: vi.fn(),
    };

    expect(
      await cached(fakeBase("remote"), store, queue).readFile(REF, PATH),
    ).toBe("from the base");
    expect(store.entries.has(PATH)).toBe(false);
    expect(queue.lostRead).toHaveBeenCalledWith(PATH);
  });

  it("does not fill while a save holds the working copy", async () => {
    const store = mapStore({ [PATH]: "old prose" });
    const base = fakeBase("remote");
    base.fingerprintDir = vi.fn(async () => listing({ "a.md": "remote" }));
    base.readFile = vi.fn(async () => "remote");
    const queue = { ...NOTHING_OWED, exclusive: oneAtATime() };
    let owed = false;
    queue.owedNow = async () => owed;
    // A save in another tab: its entry write and its queued op inside one
    // hold of the lock.
    let finish!: () => void;
    const held = new Promise<void>((resolve) => (finish = resolve));
    const saving = queue.exclusive(async () => {
      await store.write(PATH, "just typed");
      await held;
      owed = true;
    });

    const read = cached(base, store, queue).readFile(REF, PATH);
    finish();
    await saving;

    expect(await read).toBe("just typed");
    expect(store.entries.get(PATH)?.text).toBe("just typed");
  });
});
