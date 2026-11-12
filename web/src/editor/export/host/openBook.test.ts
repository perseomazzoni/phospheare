// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PROPERTIES_FILE, STRUCTURE_FILE } from "../../../project/naming";
import { memoryProvider } from "../../../storage/memoryProvider";
import type { ProjectRef, StorageProvider } from "../../../storage/types";

// Pins how a Library card opens a book: `openExportBook` reads it as the
// editor does, without the editor. It reads through the working copy when the
// book has a remote, reconciles the records onto the nodes so each node names
// the file its text is in, and refuses a folder the editor would refuse,
// never reading it leniently. The three lookups that need IndexedDB, OPFS or
// the registry are mocked; the demo book in memory is the folder.

const remoteFor = vi.fn();
vi.mock("../../../project/sync/remoteFor", () => ({
  remoteFor: (ref: unknown) => remoteFor(ref),
}));
const dispose = vi.fn();
const openCacheStore = vi.fn<(target: unknown) => { dispose: typeof dispose }>(
  () => ({ dispose }),
);
vi.mock("../../../storage/cache/opfsCacheStore", () => ({
  openCacheStore: (target: unknown) => openCacheStore(target),
}));
let provider: StorageProvider | null = memoryProvider;
const providerFor = vi.fn<(...args: unknown[]) => StorageProvider | null>(
  () => provider,
);
vi.mock("../../../project/sync/resolve", () => ({
  providerFor: (...args: unknown[]) => providerFor(...args),
}));

const { EXPORT_UNOPENABLE, openExportBook } = await import("./openBook");

const ref: ProjectRef = {
  providerId: memoryProvider.id,
  key: "demo",
  name: "Once Dark",
  openedAt: "",
};

/** The demo book, with one file answered differently. */
function withFile(path: string, content: string | null): StorageProvider {
  return {
    ...memoryProvider,
    readFile: async (target, at) => {
      if (at !== path) return memoryProvider.readFile(target, at);
      if (content === null) throw new Error("not found");
      return content;
    },
  };
}

function reset(
  remote: unknown = null,
  over: StorageProvider | null = memoryProvider,
) {
  remoteFor.mockReset().mockResolvedValue(remote);
  openCacheStore.mockClear();
  providerFor.mockClear();
  dispose.mockClear();
  provider = over;
}

describe("openExportBook", () => {
  it("reads a book with no remote straight from its provider, records on its nodes", async () => {
    reset();
    const book = await openExportBook(ref, "book-1");
    expect(remoteFor).toHaveBeenCalledWith({ ...ref, id: "book-1" });
    expect(openCacheStore).not.toHaveBeenCalled();
    expect(providerFor).toHaveBeenCalledWith(ref, {
      store: null,
      projectId: "book-1",
    });
    expect(book.storage).toBe(memoryProvider);
    // Every node knows the file its text is read from.
    const first = book.structure.children[0];
    expect(first.adopted).toMatch(/\.md$/);
    expect(book.properties.document.title).toBeTruthy();
  });

  // A queue not yet drained to the remote holds the writer's latest, so the
  // export reads it there, as the editor does.
  it("reads a book with a remote through its working copy, and lets go of it", async () => {
    const remote = { providerId: "drive", key: "folder-1" };
    reset(remote);
    const book = await openExportBook(ref, "book-1");
    expect(openCacheStore).toHaveBeenCalledWith({ id: "book-1", remote });
    expect(providerFor).toHaveBeenCalledWith(ref, {
      store: expect.objectContaining({ dispose }),
      projectId: "book-1",
    });
    book.dispose();
    book.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no provider for the book", null],
    ["a folder that is not a project", withFile(PROPERTIES_FILE, null)],
    [
      "a structure that does not parse",
      withFile(STRUCTURE_FILE, "children: ["),
    ],
  ])("refuses %s, as the editor would", async (_, over) => {
    reset(null, over);
    await expect(openExportBook(ref, "book-1")).rejects.toThrow(
      EXPORT_UNOPENABLE,
    );
  });

  it("lets go of the working copy when it refuses", async () => {
    reset(
      { providerId: "drive", key: "folder-1" },
      withFile(STRUCTURE_FILE, "children: ["),
    );
    await expect(openExportBook(ref, "book-1")).rejects.toThrow(
      EXPORT_UNOPENABLE,
    );
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
