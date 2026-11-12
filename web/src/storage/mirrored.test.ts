// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { applyPendingOps, mirror, pendingPresence, type Op } from "./mirrored";
import { memoryProvider } from "./memoryProvider";
import {
  StorageError,
  type DirEntry,
  type ProjectRef,
  type StorageProvider,
} from "./types";

/** A project with nothing outstanding — the shape most of these rows want. */
const noPending = () => [];

// `mirror()` runs over `memoryProvider` rather than the real local and Drive
// pair: the decorator does not know which two providers it bridges, and
// these rows show it does not need to.

const ref: ProjectRef = {
  providerId: "memory",
  key: "demo",
  name: "Demo",
  openedAt: "2026-01-01T00:00:00.000Z",
};

describe("mirror — reads and lifecycle", () => {
  it("delegates every read straight to the base provider", async () => {
    const provider = mirror(memoryProvider, async () => {}, noPending);

    expect(await provider.readFile(ref, "/document-properties.json")).toEqual(
      await memoryProvider.readFile(ref, "/document-properties.json"),
    );
    expect(await provider.listDir(ref, "/document")).toEqual(
      await memoryProvider.listDir(ref, "/document"),
    );
    expect(await provider.canAccess(ref)).toBe(
      await memoryProvider.canAccess(ref),
    );
  });

  it("delegates the lifecycle methods too, not just the reads", async () => {
    // Without these pins a decorator that dropped `exists` or answered
    // `isAvailable` itself would go unnoticed. The delegation row in
    // `cached.test.ts` has the same shape: both decorators wrap the same port.
    const provider = mirror(memoryProvider, async () => {}, noPending);

    expect(await provider.isAvailable()).toBe(
      await memoryProvider.isAvailable(),
    );
    expect(await provider.exists(ref, "/document-properties.json")).toBe(true);
    expect(await provider.exists(ref, "/nothing-here.md")).toBe(false);
    expect(await provider.reopenProject(ref)).toBe(
      await memoryProvider.reopenProject(ref),
    );
  });

  it("keeps the base provider label and id", () => {
    const provider = mirror(memoryProvider, async () => {}, noPending);
    expect(provider.id).toBe(memoryProvider.id);
    expect(provider.label).toBe(memoryProvider.label);
  });

  // The base here has `writeBytes`, since the demo keeps exports, and the
  // mirror still must not offer it: every write through a mirror
  // becomes a queued op the remote is owed, and the queue is text-only and
  // promises the writer's work. An export is written to each home's bare
  // provider instead, so absence is the answer.
  it("never offers writeBytes, even over a base that has it", () => {
    expect(memoryProvider.writeBytes).toBeTypeOf("function");
    const provider = mirror(memoryProvider, async () => {}, noPending);
    expect("writeBytes" in provider).toBe(false);
  });
});

describe("mirror — writes", () => {
  it("a write that succeeds resolves even when the enqueued push later fails", async () => {
    const queued: Op[] = [];
    const provider = mirror(
      memoryProvider,
      async (op) => {
        queued.push(op);
        // The real queue drain is async and can fail; that must never be
        // observable from the write that queued it.
        void Promise.reject(new Error("the remote is down")).catch(
          async () => {},
        );
      },
      noPending,
    );

    await expect(
      provider.writeFile(ref, "/document/section--mirrored.md", "hello"),
    ).resolves.toBeUndefined();

    expect(queued).toEqual([
      { kind: "put", path: "/document/section--mirrored.md" },
    ]);
  });

  it("queues exactly one op per write — no duplicate or missing enqueue", async () => {
    const enqueue = vi.fn();
    const provider = mirror(memoryProvider, enqueue, noPending);

    await provider.writeFile(ref, "/document/section--once.md", "x");

    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("does not resolve the write until the op is recorded", async () => {
    // A fire-and-forget `enqueue` resolves the write at least one microtask
    // before its row exists, every time, because the queue's lock body never
    // runs synchronously. For a project whose bytes live only in the working
    // copy, that window is work reported as saved with nothing that will
    // commit it, and a tab closed inside it loses the work.
    let recorded = false;
    const provider = mirror(
      memoryProvider,
      async () => {
        await Promise.resolve();
        recorded = true;
      },
      noPending,
    );

    await provider.writeFile(ref, "/document/section--once.md", "x");

    // No `waitFor`: the point is that it is already true here.
    expect(recorded).toBe(true);
  });

  it("fails the write when the op cannot be recorded at all", async () => {
    // `appendOp` throws with no signed-in user, as after a 401 mid-session
    // with the editor still mounted, so `resolve.ts` must not wrap this call
    // in `void`. A save that queued nothing must not read as
    // saved, so the failure surfaces where every other save failure does.
    const provider = mirror(
      memoryProvider,
      async () => {
        throw new StorageError("no signed-in user", "io");
      },
      noPending,
    );

    await expect(
      provider.writeFile(ref, "/document/section--once.md", "x"),
    ).rejects.toThrow("no signed-in user");
  });

  it("does not enqueue when the base write itself fails", async () => {
    const failing: StorageProvider = {
      ...memoryProvider,
      writeFile: async () => {
        throw new StorageError("nope", "io");
      },
    };
    const enqueue = vi.fn();
    const provider = mirror(failing, enqueue, noPending);

    await expect(provider.writeFile(ref, "/x.md", "x")).rejects.toThrow("nope");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("maps each mutating method to the right op shape", async () => {
    const queued: Op[] = [];
    const provider = mirror(
      memoryProvider,
      async (op) => {
        queued.push(op);
      },
      noPending,
    );

    await provider.createDir(ref, "/document/newdir");
    await provider.renameFile(
      ref,
      "/document/section--the_dark.EL5.00.md",
      "renamed.md",
    );
    await provider.moveFile(
      ref,
      "/document/section--the_first_light.EL6.00.md",
      "/document/newdir",
    );
    await provider.removeFile(ref, "/document/section--the_flame.EL10.00.md");

    expect(queued).toEqual([
      { kind: "mkdir", path: "/document/newdir" },
      {
        kind: "rename",
        path: "/document/section--the_dark.EL5.00.md",
        newName: "renamed.md",
      },
      {
        kind: "mv",
        from: "/document/section--the_first_light.EL6.00.md",
        toDir: "/document/newdir",
      },
      { kind: "rm", path: "/document/section--the_flame.EL10.00.md" },
    ]);
  });
});

// The listing reflects outstanding work. For a remote-primary project
// `cached` does not write through, so a delete touches nothing the base can
// see until the queue drains, and a listing taken straight off the base still
// holds the deleted file: a deleted note comes back on the next listing with
// nothing said. These rows pin the projection that closes that gap.

const entry = (dir: string, name: string): DirEntry => ({
  path: dir === "/" ? `/${name}` : `${dir}/${name}`,
  name,
  kind: "file",
});

describe("applyPendingOps", () => {
  const dir = "/reference";
  const base = [entry(dir, "a.md"), entry(dir, "b.md")];
  const names = (out: DirEntry[]) => out.map((one) => one.name);

  it("subtracts a pending delete", () => {
    expect(
      names(
        applyPendingOps(base, dir, [{ kind: "rm", path: "/reference/a.md" }]),
      ),
    ).toEqual(["b.md"]);
  });

  it("subtracts a file moved out and adds one moved in", () => {
    // The bin: the same op removes the row from the reference folder and puts
    // it in `/recyclebin`. Reading only one half shows a binned document in
    // both places, or in neither.
    const op: Op = {
      kind: "mv",
      from: "/reference/a.md",
      toDir: "/recyclebin",
    };
    expect(names(applyPendingOps(base, dir, [op]))).toEqual(["b.md"]);
    expect(names(applyPendingOps([], "/recyclebin", [op]))).toEqual(["a.md"]);
  });

  it("adds a pending write and a pending folder", () => {
    const out = applyPendingOps(base, dir, [
      { kind: "put", path: "/reference/c.md" },
      { kind: "mkdir", path: "/reference/sub" },
    ]);
    expect(names(out)).toEqual(["a.md", "b.md", "c.md", "sub"]);
    expect(out.find((one) => one.name === "sub")?.kind).toBe("folder");
    expect(out.find((one) => one.name === "c.md")?.path).toBe(
      "/reference/c.md",
    );
  });

  it("renames in place and keeps the entry's kind", () => {
    const withFolder = [
      ...base,
      { ...entry(dir, "sub"), kind: "folder" as const },
    ];
    const out = applyPendingOps(withFolder, dir, [
      { kind: "rename", path: "/reference/sub", newName: "moved" },
    ]);
    expect(names(out)).toContain("moved");
    expect(names(out)).not.toContain("sub");
    expect(out.find((one) => one.name === "moved")?.kind).toBe("folder");
  });

  it("ignores ops that are not about this folder's own children", () => {
    // `listDir` is shallow, so a write two folders down changes nothing here,
    // and a sibling folder's delete must not take a same-named entry with it.
    expect(
      names(
        applyPendingOps(base, dir, [
          { kind: "put", path: "/reference/sub/deep.md" },
          { kind: "rm", path: "/document/a.md" },
        ]),
      ),
    ).toEqual(["a.md", "b.md"]);
  });

  it("applies ops oldest first, so a delete and a re-create resolve in order", () => {
    expect(
      names(
        applyPendingOps(base, dir, [
          { kind: "rm", path: "/reference/a.md" },
          { kind: "put", path: "/reference/a.md" },
        ]),
      ),
    ).toEqual(["b.md", "a.md"]);
  });
});

describe("mirror — listDir", () => {
  it("hides a file whose delete is still queued", async () => {
    // Written here rather than taken from the fixture: the write rows mutate
    // the shared `memoryProvider`, so a test that assumed a fixture file would
    // pass or fail on what ran before it.
    const doomed = "/document/section--pending_delete.md";
    await memoryProvider.writeFile(ref, doomed, "x");

    const provider = mirror(
      memoryProvider,
      async () => {},
      () => [{ kind: "rm", path: doomed }],
    );

    expect(
      (await provider.listDir(ref, "/document")).map((e) => e.name),
    ).not.toContain("section--pending_delete.md");
    // The base still holds it, the state in which the delete looks as though
    // it had not taken.
    expect(
      (await memoryProvider.listDir(ref, "/document")).map((e) => e.name),
    ).toContain("section--pending_delete.md");
  });

  it("answers a folder the base has never heard of when work is queued into it", async () => {
    // `moveFile` creates the target folder, but for a remote-primary project
    // only when the op drains, so the bin does not exist yet while the writer
    // has already put something in it.
    const provider = mirror(
      {
        ...memoryProvider,
        listDir: async () => {
          throw new StorageError("gone", "not-found");
        },
      },
      async () => {},
      () => [{ kind: "mv", from: "/reference/a.md", toDir: "/recyclebin" }],
    );

    expect(
      (await provider.listDir(ref, "/recyclebin")).map((e) => e.name),
    ).toEqual(["a.md"]);
  });

  it("rethrows a failed listing rather than answering with the pending half", async () => {
    // Offline, or a lapsed grant. Answering with the queue alone would report
    // a folder as holding one file when it holds forty.
    const provider = mirror(
      {
        ...memoryProvider,
        listDir: async () => {
          throw new StorageError("offline", "unavailable");
        },
      },
      async () => {},
      () => [{ kind: "put", path: "/reference/a.md" }],
    );

    await expect(provider.listDir(ref, "/reference")).rejects.toThrow(
      "offline",
    );
  });

  it("rethrows not-found when nothing is queued into that folder", async () => {
    const provider = mirror(
      {
        ...memoryProvider,
        listDir: async () => {
          throw new StorageError("gone", "not-found");
        },
      },
      async () => {},
      noPending,
    );

    await expect(provider.listDir(ref, "/recyclebin")).rejects.toThrow("gone");
  });
});

// `exists` answers what the path will be once the queue has drained, like
// `listDir`. A comments file saved offline is a pending put the remote has
// never seen; answering from the base alone reads it as missing, and the next
// save writes over every comment in it.
describe("mirror — exists", () => {
  /** A base that holds exactly `present`, and records what it was asked. */
  function baseHolding(present: string[]): StorageProvider {
    return {
      ...memoryProvider,
      exists: vi.fn(async (_ref: ProjectRef, path: string) =>
        present.includes(path),
      ),
    };
  }

  it("finds a file whose save is still queued, which the base has never seen", async () => {
    const base = baseHolding([]);
    const provider = mirror(
      base,
      async () => {},
      () => [{ kind: "put", path: "/comments/n1.json" }],
    );
    expect(await provider.exists(ref, "/comments/n1.json")).toBe(true);
    // The folder the put lands in exists too.
    expect(await provider.exists(ref, "/comments")).toBe(true);
  });

  it("misses a file whose delete is still queued, which the base still holds", async () => {
    const provider = mirror(
      baseHolding(["/a.md"]),
      async () => {},
      () => [{ kind: "rm", path: "/a.md" }],
    );
    expect(await provider.exists(ref, "/a.md")).toBe(false);
  });

  it("follows a queued rename and move to the new path", async () => {
    const provider = mirror(
      baseHolding(["/document/a.md", "/reference/c.md"]),
      async () => {},
      () => [
        { kind: "rename", path: "/document/a.md", newName: "b.md" },
        { kind: "mv", from: "/reference/c.md", toDir: "/recyclebin" },
      ],
    );
    expect(await provider.exists(ref, "/document/a.md")).toBe(false);
    expect(await provider.exists(ref, "/document/b.md")).toBe(true);
    expect(await provider.exists(ref, "/reference/c.md")).toBe(false);
    expect(await provider.exists(ref, "/recyclebin/c.md")).toBe(true);
    expect(await provider.exists(ref, "/recyclebin")).toBe(true);
  });

  it("lets the newest op decide, as the writer performed them", async () => {
    expect(
      pendingPresence("/a.md", [
        { kind: "put", path: "/a.md" },
        { kind: "rm", path: "/a.md" },
      ]),
    ).toBe(false);
    expect(
      pendingPresence("/a.md", [
        { kind: "rm", path: "/a.md" },
        { kind: "put", path: "/a.md" },
      ]),
    ).toBe(true);
    expect(
      pendingPresence("/b.md", [
        { kind: "rename", path: "/a.md", newName: "b.md" },
        { kind: "rename", path: "/b.md", newName: "c.md" },
      ]),
    ).toBe(false);
  });

  it("asks the base about a path no queued op names", async () => {
    const base = baseHolding(["/a.md"]);
    const provider = mirror(
      base,
      async () => {},
      () => [{ kind: "put", path: "/other.md" }],
    );
    expect(await provider.exists(ref, "/a.md")).toBe(true);
    expect(await provider.exists(ref, "/b.md")).toBe(false);
    expect(base.exists).toHaveBeenCalledTimes(2);
  });

  it("gives the same answer over a device base that has already applied the ops", async () => {
    // A Local+Synced project writes the disk first, so its base already
    // shows the rename the queue still owes the remote.
    const provider = mirror(
      baseHolding(["/b.md"]),
      async () => {},
      () => [{ kind: "rename", path: "/a.md", newName: "b.md" }],
    );
    expect(await provider.exists(ref, "/b.md")).toBe(true);
    expect(await provider.exists(ref, "/a.md")).toBe(false);
  });
});
