// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { setCurrentUserId } from "../../auth/currentUser";
import { setPref } from "../../profile/profileSync";
import type { ProjectRef } from "../../storage/types";
import { useLibraryView } from "./useLibraryView";
import type { ProjectCard } from "./useProjects";

// The shelf renders only behind `SessionGate`, so a signed-in user is a real
// precondition of these prefs: `getPref` answers from the per-user store and
// tells an anonymous caller nothing. Drive is stubbed because `setPref`
// pushes in the background once there is a user to push for.
vi.mock("../../storage/driveProvider", () => ({
  driveProvider: {
    id: "drive",
    writeFile: () => Promise.resolve(),
    readFile: () => Promise.resolve("{}"),
  },
}));

const ref = (providerId: string, key: string, name = key): ProjectRef => ({
  providerId,
  key,
  name,
  openedAt: "2026-07-28T10:00:00.000Z",
});

const card = (over: Partial<ProjectCard> = {}): ProjectCard => ({
  id: "book-a",
  ref: ref("local", "a", "a"),
  state: "ready",
  content: null,
  fresh: true,
  problem: null,
  ...over,
});

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage);
  setCurrentUserId("test-user");
});

afterEach(() => {
  cleanup();
  setCurrentUserId(null);
  vi.unstubAllGlobals();
});

describe("defaults", () => {
  it("starts grid, all sources, empty query", () => {
    const { result } = renderHook(() => useLibraryView([]));
    expect(result.current.density).toBe("grid");
    expect(result.current.filter).toBe("all");
    expect(result.current.query).toBe("");
  });

  it("is not filtering when nothing is asked", () => {
    const { result } = renderHook(() => useLibraryView([]));
    expect(result.current.filtering).toBe(false);
  });
});

describe("prefs", () => {
  const both = [
    card({ ref: ref("local", "a", "a") }),
    card({ ref: ref("drive", "b", "b") }),
  ];

  it("persists filter and density through setPref", () => {
    const first = renderHook(() => useLibraryView(both));
    act(() => first.result.current.setFilter("drive"));
    act(() => first.result.current.setDensity("list"));
    first.unmount();

    const second = renderHook(() => useLibraryView(both));
    expect(second.result.current.filter).toBe("drive");
    expect(second.result.current.density).toBe("list");
  });

  it("reconcile re-reads the prefs after they changed underneath", () => {
    const { result } = renderHook(() => useLibraryView([]));
    act(() => {
      setPref("density", "list");
    });
    expect(result.current.density).toBe("grid");
    act(() => result.current.reconcile());
    expect(result.current.density).toBe("list");
  });
});

describe("sources", () => {
  const both = [
    card({ ref: ref("local", "a", "a") }),
    card({ ref: ref("drive", "b", "b") }),
  ];

  it("counts per provider, including a store with nothing in it", () => {
    const { result } = renderHook(() => useLibraryView(both));
    expect(result.current.counts).toEqual({ local: 1, drive: 1 });

    const only = renderHook(() => useLibraryView([both[0]]));
    expect(only.result.current.counts).toEqual({ local: 1, drive: 0 });
  });

  // A place with no projects in it is an answer, not a choice to refuse, so
  // the filter never snaps back to "all" when a store is empty. Snapping back
  // makes the storage panel look as if it ignored the click.
  it("holds a source filter on a store that has nothing in it", () => {
    const { result } = renderHook(() => useLibraryView([both[0]]));
    act(() => result.current.setFilter("drive"));
    expect(result.current.filter).toBe("drive");
    expect(result.current.visible).toEqual([]);
  });
});

describe("visible", () => {
  it("filters the cards by query, newest first", () => {
    const cards = [
      card({
        ref: ref("local", "salt", "once-dark"),
        content: {
          id: "x",
          title: "Once Dark",
          type: "novel",
          words: 100,
          parts: 1,
          sections: 1,
          goal: null,
          perNode: [],
          structure: { version: 1, children: [] },
          updatedAt: "2026-07-01T00:00:00.000Z",
          cachedAt: "2026-07-01T00:00:00.000Z",
        },
      }),
      card({
        ref: ref("drive", "water", "hollow-water"),
        content: {
          id: "y",
          title: "Hollow Water",
          type: "novel",
          words: 100,
          parts: 1,
          sections: 1,
          goal: null,
          perNode: [],
          structure: { version: 1, children: [] },
          updatedAt: "2026-07-02T00:00:00.000Z",
          cachedAt: "2026-07-02T00:00:00.000Z",
        },
      }),
    ];
    const { result } = renderHook(() => useLibraryView(cards));
    expect(result.current.visible.map((c) => c.ref.name)).toEqual([
      "hollow-water",
      "once-dark",
    ]);

    act(() => result.current.setQuery("dark"));
    expect(result.current.visible.map((c) => c.ref.name)).toEqual([
      "once-dark",
    ]);
    expect(result.current.filtering).toBe(true);
  });

  // `visible` hands back the original card reference for anything `shown()`
  // did not need to touch. A fresh object per recompute gives an unchanged
  // card a new identity and defeats `React.memo` on `ProjectCard`.
  it("keeps the original card reference for a card that did not change, even though the cards array itself is a new reference", () => {
    const unchanged = card({ ref: ref("local", "a", "a") });
    const changing = card({ ref: ref("drive", "b", "b") });
    const { result, rerender } = renderHook(
      ({ cards }: { cards: ProjectCard[] }) => useLibraryView(cards),
      { initialProps: { cards: [unchanged, changing] } },
    );

    // A new top-level array, as `setCards`'s functional updater produces,
    // with `unchanged` the same object: the shape a gather's single-card
    // read landing takes.
    const changingAgain = card({ ...changing, state: "loading" });
    rerender({ cards: [unchanged, changingAgain] });

    const found = result.current.visible.find(
      (c) => c.ref.key === "a" && c.ref.providerId === "local",
    );
    expect(found).toBe(unchanged);
  });
});
