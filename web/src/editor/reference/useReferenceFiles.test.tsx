// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { useReferenceFiles } from "./referenceShared";
import type { DirEntry, ProjectRef, StorageProvider } from "../../storage";

// ── The hook the reference/notes faces share ─────────────────────────────────
//
// These pins keep the hook's own contracts: a missing folder reads as empty
// (the ordinary Drive case), and no project means no read at all.
//
// The provider is created outside the `renderHook` callback: the hook's effect
// depends on `provider`, and an object recreated per render would re-run the
// effect forever.

afterEach(() => cleanup());

const REF: ProjectRef = {
  providerId: "memory",
  key: "demo",
  name: "Demo",
  openedAt: "",
};

function providerWith(names: string[] | Error): StorageProvider {
  return {
    listDir: async (): Promise<DirEntry[]> => {
      if (names instanceof Error) throw names;
      return names.map((name) => ({
        path: `/reference/${name}`,
        name,
        kind: "file" as const,
      }));
    },
  } as unknown as StorageProvider;
}

describe("useReferenceFiles", () => {
  it("lists the folder's files by name", async () => {
    const provider = providerWith(["guidebook--the-ferry.md", "scrap.md"]);
    const { result } = renderHook(() => useReferenceFiles(provider, REF));
    await waitFor(() =>
      expect(result.current.files).toEqual([
        "guidebook--the-ferry.md",
        "scrap.md",
      ]),
    );
  });

  // `listDir` throws on a folder that is not there, which on Drive is the
  // ordinary case for one nobody has written to. An empty list is the right
  // answer; an error is not.
  it("treats a missing folder as an empty one", async () => {
    const provider = providerWith(new Error("not found"));
    const { result } = renderHook(() => useReferenceFiles(provider, REF));
    await waitFor(() => expect(result.current.files).toEqual([]));
  });

  it("reads nothing at all without a project", async () => {
    const listDir = vi.fn();
    const provider = { listDir } as unknown as StorageProvider;
    const { result } = renderHook(() => useReferenceFiles(provider, null));
    expect(listDir).not.toHaveBeenCalled();
    expect(result.current.files).toEqual([]);
  });

  it("reload() re-lists the folder in every mounted consumer", async () => {
    const calls: string[][] = [];
    const listDir = vi.fn(async (): Promise<DirEntry[]> => {
      calls.push(["once"]);
      return [{ path: "/reference/a.md", name: "a.md", kind: "file" }];
    });
    const provider = { listDir } as unknown as StorageProvider;
    const { result } = renderHook(() => useReferenceFiles(provider, REF));
    await waitFor(() => expect(result.current.files).toEqual(["a.md"]));
    listDir.mockImplementation(async (): Promise<DirEntry[]> => {
      calls.push(["twice"]);
      return [
        { path: "/reference/a.md", name: "a.md", kind: "file" },
        { path: "/reference/b.md", name: "b.md", kind: "file" },
      ];
    });
    result.current.reload();
    await waitFor(() => expect(result.current.files).toEqual(["a.md", "b.md"]));
    expect(calls).toEqual([["once"], ["twice"]]);
  });
});
