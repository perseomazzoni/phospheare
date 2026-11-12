// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectRef, StorageProvider } from "../storage/types";

// The storage a window outside the editor works through, such as the export
// or the Library's Properties window: the working copy when the book
// has a remote, the bare provider when it has none, and nothing left open when
// no provider answers.

const remoteFor = vi.fn<(ref: unknown) => Promise<unknown>>();
vi.mock("./sync/remoteFor", () => ({
  remoteFor: (ref: unknown) => remoteFor(ref),
}));
const dispose = vi.fn();
const openCacheStore = vi.fn<(target: unknown) => { dispose: typeof dispose }>(
  () => ({ dispose }),
);
vi.mock("../storage/cache/opfsCacheStore", () => ({
  openCacheStore: (target: unknown) => openCacheStore(target),
}));
const bare = { id: "bare" } as unknown as StorageProvider;
let answer: StorageProvider | null = bare;
const providerFor = vi.fn<(...args: unknown[]) => StorageProvider | null>(
  () => answer,
);
vi.mock("./sync/resolve", () => ({
  providerFor: (...args: unknown[]) => providerFor(...args),
}));

const { openProjectStorage } = await import("./projectStorage");

const ref: ProjectRef = {
  providerId: "drive",
  key: "k",
  name: "once-dark",
  openedAt: "2026-07-28T10:00:00.000Z",
};

beforeEach(() => {
  remoteFor.mockReset();
  openCacheStore.mockClear();
  dispose.mockClear();
  providerFor.mockClear();
  answer = bare;
});

describe("openProjectStorage", () => {
  it("opens no working copy for a book without a remote", async () => {
    remoteFor.mockResolvedValueOnce(null);
    const opened = await openProjectStorage(ref, "book-1");

    expect(opened?.storage).toBe(bare);
    expect(openCacheStore).not.toHaveBeenCalled();
    expect(providerFor).toHaveBeenCalledWith(ref, {
      store: null,
      projectId: "book-1",
    });
  });

  it("works through the working copy when the book has a remote, and lets it go", async () => {
    const remote = { providerId: "drive", key: "k" };
    remoteFor.mockResolvedValueOnce(remote);
    const opened = await openProjectStorage(ref, "book-1");

    expect(openCacheStore).toHaveBeenCalledWith({ id: "book-1", remote });
    expect(providerFor).toHaveBeenCalledWith(ref, {
      store: { dispose },
      projectId: "book-1",
    });
    opened?.dispose();
    opened?.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("is null, with nothing left open, when no provider answers", async () => {
    remoteFor.mockResolvedValueOnce({ providerId: "drive", key: "k" });
    answer = null;
    expect(await openProjectStorage(ref, "book-1")).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
