// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { LibraryReconcileResult } from "../../profile/profileSync";
import type { SweepWatch } from "./useProjects";

// Pins what the storage search window shows: the restore that connecting
// Remote Storage runs, the "Find projects" sweeps, and that a search the
// window was closed on never shows again.

const syncProfile = vi.hoisted(() =>
  vi.fn<(userId: string) => Promise<LibraryReconcileResult>>(),
);
vi.mock("../../profile/profileSync", () => ({
  syncProfile,
  libraryRows: () => [{}, {}, {}],
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars?.count !== undefined ? `${key}:${String(vars.count)}` : key,
  }),
}));

const { useStorageSearch } = await import("./useStorageSearch");

type Opts = Parameters<typeof useStorageSearch>[0];

const opts = (over: Partial<Opts> = {}): Opts => ({
  userId: "u1",
  driveConnected: false,
  gatherStarts: 0,
  gatherSettles: 0,
  rescan: vi.fn(),
  refreshContent: vi.fn(),
  reconcileUI: vi.fn(),
  scanDrive: vi.fn(async () => 0),
  scanLocal: vi.fn(async () => 0),
  ...over,
});

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

const result = (remote: LibraryReconcileResult["remote"], changed = false) => ({
  librarySettled: true,
  membershipChanged: changed,
  remote,
});

beforeEach(() => syncProfile.mockReset());

describe("the restore on connecting Remote Storage", () => {
  it("shows the search, then what came back", async () => {
    let finish!: (r: LibraryReconcileResult) => void;
    syncProfile.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const o = opts();
    const { result: hook, rerender } = renderHook(
      (p: Partial<Opts>) => useStorageSearch({ ...o, ...p }),
      { initialProps: {} },
    );
    rerender({ driveConnected: true });
    expect(hook.current.view).toMatchObject({ kind: "working", current: 0 });

    finish(result("found"));
    await flush();
    expect(o.reconcileUI).toHaveBeenCalled();
    expect(o.refreshContent).toHaveBeenCalled();
    expect(hook.current.view).toEqual({
      kind: "result",
      title: "library.restore.foundTitle",
      lead: "library.restore.foundLead",
      items: ["accountData.settings", "library.restore.library:3"],
    });
  });

  it("waits for the rescan's own gather when the membership changed", async () => {
    syncProfile.mockResolvedValue(result("found", true));
    const o = opts();
    const { result: hook, rerender } = renderHook(
      (p: Partial<Opts>) => useStorageSearch({ ...o, ...p }),
      { initialProps: {} },
    );
    rerender({ driveConnected: true });
    await flush();
    expect(o.rescan).toHaveBeenCalledOnce();
    expect(hook.current.view).toMatchObject({ kind: "working", current: 1 });

    rerender({ driveConnected: true, gatherStarts: 1, gatherSettles: 1 });
    await flush();
    expect(hook.current.view).toMatchObject({
      kind: "result",
      title: "library.restore.foundTitle",
    });
  });

  it.each([
    ["none", "library.restore.noneTitle"],
    ["unreachable", "library.search.unreachableTitle"],
  ] as const)("says when Remote Storage held %s", async (remote, title) => {
    syncProfile.mockResolvedValue(result(remote));
    const { result: hook, rerender } = renderHook(
      (p: Partial<Opts>) => useStorageSearch(opts(p)),
      { initialProps: {} },
    );
    rerender({ driveConnected: true });
    await flush();
    expect(hook.current.view).toMatchObject({ kind: "result", title });
  });

  it("closes without a word when the account changed during the merge", async () => {
    syncProfile.mockResolvedValue({
      librarySettled: false,
      membershipChanged: false,
      remote: "off",
    });
    const { result: hook, rerender } = renderHook(
      (p: Partial<Opts>) => useStorageSearch(opts(p)),
      { initialProps: {} },
    );
    rerender({ driveConnected: true });
    await flush();
    expect(hook.current.view).toBeNull();
  });

  it("does not count a connection there at mount, a disconnect or another account as connecting", () => {
    syncProfile.mockResolvedValue(result("found"));
    const { rerender } = renderHook(
      (p: Partial<Opts>) => useStorageSearch(opts(p)),
      { initialProps: { driveConnected: true } as Partial<Opts> },
    );
    rerender({ driveConnected: false });
    rerender({ userId: "u2", driveConnected: true });
    expect(syncProfile).not.toHaveBeenCalled();
  });

  it("drops the result of a search the window was closed on", async () => {
    let finish!: (r: LibraryReconcileResult) => void;
    syncProfile.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result: hook, rerender } = renderHook(
      (p: Partial<Opts>) => useStorageSearch(opts(p)),
      { initialProps: {} },
    );
    rerender({ driveConnected: true });
    act(() => hook.current.close());
    finish(result("found"));
    await flush();
    expect(hook.current.view).toBeNull();
  });
});

describe("Find projects in Remote Storage", () => {
  it("counts the projects it reads, then names the ones it added", async () => {
    let watch!: SweepWatch;
    let finish!: () => void;
    const scanDrive = vi.fn(
      (w?: SweepWatch) =>
        new Promise<number>((resolve) => {
          watch = w as SweepWatch;
          finish = () => resolve(7);
        }),
    );
    const { result: hook } = renderHook(() =>
      useStorageSearch(opts({ scanDrive })),
    );
    void act(() => void hook.current.findInDrive());
    act(() => watch.step({ phase: "reading", done: 2, total: 7 }));
    expect(hook.current.view).toMatchObject({
      kind: "working",
      current: 1,
      detail: "library.search.count",
    });
    for (const name of ["A", "B", "C", "D", "E", "F", "G"]) watch.added(name);
    finish();
    await flush();
    expect(hook.current.view).toEqual({
      kind: "result",
      title: "library.search.foundTitle",
      lead: "library.search.added",
      items: ["A", "B", "C", "D", "E"],
      after: ["library.search.more:2"],
    });
  });

  it("offers to try again when Remote Storage could not be read", async () => {
    const scanDrive = vi.fn(async () => {
      throw new Error("offline");
    });
    const { result: hook } = renderHook(() =>
      useStorageSearch(opts({ scanDrive })),
    );
    await act(() => hook.current.findInDrive());
    expect(hook.current.view).toMatchObject({
      kind: "result",
      lead: "library.findDriveFailed",
    });
    expect(
      hook.current.view?.kind === "result" && hook.current.view.retry,
    ).toBeTypeOf("function");
  });
});

describe("Find projects on this device", () => {
  it("shows nothing when no sweep ran", async () => {
    const { result: hook } = renderHook(() => useStorageSearch(opts()));
    await act(() => hook.current.findOnDevice());
    expect(hook.current.view).toBeNull();
  });

  it("says when the sweep found nothing new", async () => {
    const scanLocal = vi.fn(async (w?: SweepWatch) => {
      w?.step({ phase: "listing" });
      return 0;
    });
    const { result: hook } = renderHook(() =>
      useStorageSearch(opts({ scanLocal })),
    );
    await act(() => hook.current.findOnDevice());
    expect(hook.current.view).toMatchObject({
      kind: "result",
      title: "library.search.noneTitle",
      lead: "library.findLocalNone",
    });
  });
});
