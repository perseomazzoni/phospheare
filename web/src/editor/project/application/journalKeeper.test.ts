// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { JournalStore, ProjectId } from "./stores";
import { JournalKeeper } from "./journalKeeper";
import { appLog } from "../../../log";

const A: ProjectId = { providerId: "fake", key: "a" };

/**
 * A store over a map of file name to journal. A name in `unreadable` throws
 * on read; `failWrites` makes every write throw.
 */
function fakeStore(files: Record<string, string> = {}) {
  const disk = new Map(Object.entries(files));
  const unreadable = new Set<string>();
  const log: string[] = [];
  let failWrites = false;
  const store: JournalStore<ProjectId> = {
    read: vi.fn(async (_project, fileName) => {
      if (unreadable.has(fileName)) throw new Error("unreadable");
      return disk.get(fileName) ?? null;
    }),
    write: vi.fn(async (_project, fileName, journal) => {
      if (failWrites) throw new Error("write failed");
      log.push(`write ${fileName}`);
      disk.set(fileName, journal);
    }),
    remove: vi.fn(async (_project, fileName) => {
      log.push(`remove ${fileName}`);
      disk.delete(fileName);
    }),
  };
  return {
    store,
    disk,
    log,
    unreadable,
    failWrites: (on: boolean) => {
      failWrites = on;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("JournalKeeper", () => {
  describe("an open", () => {
    it("reads the journal and records it as the baseline once opened", async () => {
      const { store } = fakeStore({ "c.md": "j1" });
      const keeper = new JournalKeeper<ProjectId>();
      const journal = await keeper.read(store, A, "c.md");
      expect(journal).toBe("j1");
      expect(keeper.baseline).toBeNull();
      keeper.opened(journal);
      expect(keeper.baseline).toBe("j1");
    });

    it("reads an absent journal as none", async () => {
      const { store } = fakeStore();
      const keeper = new JournalKeeper<ProjectId>();
      const journal = await keeper.read(store, A, "c.md");
      expect(journal).toBeUndefined();
      keeper.opened(journal);
      expect(keeper.baseline).toBeNull();
    });

    it("reads an unreadable journal as none, so the open goes ahead", async () => {
      const { store, unreadable } = fakeStore({ "c.md": "j1" });
      unreadable.add("c.md");
      const keeper = new JournalKeeper<ProjectId>();
      const warn = vi.spyOn(appLog, "warn");
      await expect(keeper.read(store, A, "c.md")).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        "history",
        expect.any(String),
        expect.objectContaining({ error: expect.any(String) }),
      );
    });
  });

  describe("a flush", () => {
    it("writes when the disk holds the baseline, and the baseline follows", async () => {
      const { store, disk } = fakeStore({ "c.md": "j1" });
      const keeper = new JournalKeeper<ProjectId>();
      keeper.opened("j1");
      await keeper.flush(store, A, "c.md", "j2");
      expect(disk.get("c.md")).toBe("j2");
      expect(keeper.baseline).toBe("j2");
      await keeper.flush(store, A, "c.md", "j3");
      expect(disk.get("c.md")).toBe("j3");
    });

    it("writes a first journal where the file had none", async () => {
      const { store, disk } = fakeStore();
      const keeper = new JournalKeeper<ProjectId>();
      keeper.opened(undefined);
      await keeper.flush(store, A, "c.md", "j1");
      expect(disk.get("c.md")).toBe("j1");
    });

    it("leaves a journal another device wrote", async () => {
      const { store, disk } = fakeStore({ "c.md": "theirs" });
      const keeper = new JournalKeeper<ProjectId>();
      keeper.opened("mine");
      await keeper.flush(store, A, "c.md", "mine2");
      expect(disk.get("c.md")).toBe("theirs");
      expect(keeper.baseline).toBe("mine");
      expect(store.write).not.toHaveBeenCalled();
    });

    it("writes nothing over a journal another device deleted", async () => {
      const { store, disk } = fakeStore();
      const keeper = new JournalKeeper<ProjectId>();
      keeper.opened("mine");
      await keeper.flush(store, A, "c.md", "mine2");
      expect(disk.has("c.md")).toBe(false);
    });

    it("never writes a journal it cannot read", async () => {
      const warn = vi.spyOn(appLog, "warn");
      const { store, unreadable } = fakeStore({ "c.md": "j1" });
      unreadable.add("c.md");
      const keeper = new JournalKeeper<ProjectId>();
      keeper.opened(undefined);
      await expect(
        keeper.flush(store, A, "c.md", "j2"),
      ).resolves.toBeUndefined();
      expect(store.write).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
    });

    it("keeps the lane open after a failed write", async () => {
      vi.spyOn(appLog, "warn");
      const { store, disk, failWrites } = fakeStore({ "c.md": "j1" });
      const keeper = new JournalKeeper<ProjectId>();
      keeper.opened("j1");
      failWrites(true);
      await keeper.flush(store, A, "c.md", "j2");
      failWrites(false);
      await keeper.move(store, A, "c.md", "d.md");
      expect(disk.get("d.md")).toBe("j1");
    });
  });

  describe("a move", () => {
    it("carries the journal to the new name", async () => {
      const { store, disk, log } = fakeStore({ "c.md": "j1" });
      const keeper = new JournalKeeper<ProjectId>();
      await keeper.move(store, A, "c.md", "d.md");
      expect(disk.get("d.md")).toBe("j1");
      expect(disk.has("c.md")).toBe(false);
      expect(log).toEqual(["write d.md", "remove c.md"]);
    });

    it("does nothing for a file with no journal", async () => {
      const { store, log } = fakeStore();
      const keeper = new JournalKeeper<ProjectId>();
      await keeper.move(store, A, "c.md", "d.md");
      expect(log).toEqual([]);
    });

    it("sees a flush queued before it", async () => {
      const { store, disk } = fakeStore({ "c.md": "j1" });
      const keeper = new JournalKeeper<ProjectId>();
      keeper.opened("j1");
      const flushed = keeper.flush(store, A, "c.md", "j2");
      const moved = keeper.move(store, A, "c.md", "d.md");
      await Promise.all([flushed, moved]);
      expect(disk.get("d.md")).toBe("j2");
      expect(disk.has("c.md")).toBe(false);
    });
  });

  describe("a removal", () => {
    it("removes the journal", async () => {
      const { store, disk } = fakeStore({ "c.md": "j1" });
      const keeper = new JournalKeeper<ProjectId>();
      await keeper.remove(store, A, "c.md");
      expect(disk.has("c.md")).toBe(false);
    });

    it("sends no remove for a file with no journal", async () => {
      const { store } = fakeStore();
      const keeper = new JournalKeeper<ProjectId>();
      await keeper.remove(store, A, "c.md");
      expect(store.remove).not.toHaveBeenCalled();
    });

    it("never fails the caller", async () => {
      const warn = vi.spyOn(appLog, "warn");
      const { store, unreadable } = fakeStore({ "c.md": "j1" });
      unreadable.add("c.md");
      const keeper = new JournalKeeper<ProjectId>();
      await expect(keeper.remove(store, A, "c.md")).resolves.toBeUndefined();
      expect(store.remove).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        "history",
        expect.any(String),
        expect.anything(),
      );
    });
  });
});
