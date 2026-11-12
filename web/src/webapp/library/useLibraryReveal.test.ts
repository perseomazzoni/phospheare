// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useLibraryReveal } from "./useLibraryReveal";

// The hook neither fetches nor adopts: it awaits the one reconciliation
// (`syncProfile`, single-flight, shared with `SessionGate`'s own kick)
// and gates the reveal on its library half. An empty mirror needs the
// profile's verdict; a non-empty one is already the answer.
//
// A changed membership repaints first (rescan) and reports only once the
// rescan's own gather settles, watched through the gather's start and settle
// counters. `listing` can net out unchanged under batching, so a gate on the
// boolean can hold forever. A settle of a gather already in
// flight before the rescan belongs to the pre-change paint.

const syncProfileMock = vi.fn();
vi.mock("../../profile/profileSync", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../profile/profileSync")>();
  return {
    ...actual,
    syncProfile: (...args: unknown[]) => syncProfileMock(...args),
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  syncProfileMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const settled = { librarySettled: true, membershipChanged: false };

const opts = (
  overrides: Partial<{
    userId: string;
    mirrorEmpty: boolean;
    gatherStarts: number;
    gatherSettles: number;
    rescan: () => void;
    refreshContent: () => void;
    reconcileUI: () => void;
    reportDataReady: () => void;
  }> = {},
) => ({
  userId: "u1",
  mirrorEmpty: true,
  gatherStarts: 0,
  gatherSettles: 0,
  rescan: vi.fn(),
  refreshContent: vi.fn(),
  reconcileUI: vi.fn(),
  reportDataReady: vi.fn(),
  ...overrides,
});

describe("useLibraryReveal", () => {
  it("reports ready immediately when the mirror was not empty, and still joins the shared reconciliation", () => {
    syncProfileMock.mockResolvedValue(settled);
    const o = opts({ mirrorEmpty: false });
    renderHook(() => useLibraryReveal(o));

    // The reveal never waits on a warm mirror: the mirror is the answer.
    expect(o.reportDataReady).toHaveBeenCalledOnce();
    // The shared chain still runs (`SessionGate`'s single-flight kick), so a
    // cross-device change that lands is still bridged below.
    expect(syncProfileMock).toHaveBeenCalledTimes(1);
  });

  it("bridges a membership change on a warm mirror to a rescan, without ever gating the reveal", async () => {
    syncProfileMock.mockResolvedValue({
      librarySettled: true,
      membershipChanged: true,
    });
    const o = opts({ mirrorEmpty: false });

    renderHook(() => useLibraryReveal(o));

    expect(o.reportDataReady).toHaveBeenCalledOnce();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // A cross-device add landed while the shelf was up: the gather re-runs,
    // independent of any sync timing.
    expect(o.rescan).toHaveBeenCalledOnce();
    expect(o.reportDataReady).toHaveBeenCalledOnce();
  });

  it("an unchanged warm-mirror reconciliation rescans nothing — it reconciles the UI and refreshes content in place", async () => {
    syncProfileMock.mockResolvedValue(settled);
    const o = opts({ mirrorEmpty: false });

    renderHook(() => useLibraryReveal(o));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(o.rescan).not.toHaveBeenCalled();
    // The settled chain is the one home for both post-pull adjustments: the
    // profile's prefs reconcile into the visible state, and the idempotent
    // content refresh applies any cross-device card update without a
    // provider read.
    expect(o.reconcileUI).toHaveBeenCalledOnce();
    expect(o.refreshContent).toHaveBeenCalledOnce();
    expect(o.reportDataReady).toHaveBeenCalledOnce();
  });

  it("a settled membership change on a warm mirror rescans instead of refreshing content (the rescan subsumes it)", async () => {
    syncProfileMock.mockResolvedValue({
      librarySettled: true,
      membershipChanged: true,
    });
    const o = opts({ mirrorEmpty: false });

    renderHook(() => useLibraryReveal(o));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(o.reconcileUI).toHaveBeenCalledOnce();
    expect(o.rescan).toHaveBeenCalledOnce();
    expect(o.refreshContent).not.toHaveBeenCalled();
  });

  it("an unsettled warm reconciliation runs neither reconcile nor bridges", async () => {
    syncProfileMock.mockResolvedValue({
      librarySettled: false,
      membershipChanged: false,
    });
    const o = opts({ mirrorEmpty: false });

    renderHook(() => useLibraryReveal(o));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Nothing pulled, nothing to apply; the next trigger tries again.
    expect(o.reconcileUI).not.toHaveBeenCalled();
    expect(o.rescan).not.toHaveBeenCalled();
    expect(o.refreshContent).not.toHaveBeenCalled();
  });

  it("reports ready once the pull settles with an unchanged membership (a genuinely empty account)", async () => {
    syncProfileMock.mockResolvedValue(settled);
    const o = opts();

    renderHook(() => useLibraryReveal(o));

    expect(o.reportDataReady).not.toHaveBeenCalled();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(o.reportDataReady).toHaveBeenCalledOnce();
    expect(o.rescan).not.toHaveBeenCalled();
    expect(o.reconcileUI).toHaveBeenCalledOnce();
  });

  it("rescans and holds the reveal until the rescan's own gather settles when the pull changed membership", async () => {
    syncProfileMock.mockResolvedValue({
      librarySettled: true,
      membershipChanged: true,
    });
    const o = opts();
    let starts = 0;
    let settles = 0;

    const { rerender } = renderHook(() =>
      useLibraryReveal({ ...o, gatherStarts: starts, gatherSettles: settles }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The change landed: the shelf is repainting, and the reveal holds.
    expect(o.rescan).toHaveBeenCalledOnce();
    expect(o.reportDataReady).not.toHaveBeenCalled();

    // The rescan's gather started (start 1) and settled (settle 1): the
    // settle the gate waits for, the (startsAtRescan + 1)-th.
    starts = 1;
    settles = 1;
    rerender();
    expect(o.reportDataReady).toHaveBeenCalledOnce();
  });

  it("— ignores the settle of a gather that was already in flight when the change landed", async () => {
    syncProfileMock.mockResolvedValue({
      librarySettled: true,
      membershipChanged: true,
    });
    const o = opts();
    // A gather is already in flight when the pull resolves: start 1
    // happened, its settle has not. The rescan's gather will be start 2.
    let starts = 1;
    let settles = 0;

    const { rerender } = renderHook(() =>
      useLibraryReveal({ ...o, gatherStarts: starts, gatherSettles: settles }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(o.rescan).toHaveBeenCalledOnce();

    // The in-flight gather settles first (settle 1). It belongs to the
    // pre-change paint and does not reveal into it.
    settles = 1;
    rerender();
    expect(o.reportDataReady).not.toHaveBeenCalled();

    // The rescan's gather (start 2) settles (settle 2): the shelf has painted
    // the post-change shape, so it reveals.
    starts = 2;
    settles = 2;
    rerender();
    expect(o.reportDataReady).toHaveBeenCalledOnce();
  });

  it("reports once when the rescan's gather settles, and a later settle does not double-report", async () => {
    syncProfileMock.mockResolvedValue({
      librarySettled: true,
      membershipChanged: true,
    });
    const o = opts();
    let starts = 0;
    let settles = 0;

    const { rerender } = renderHook(() =>
      useLibraryReveal({ ...o, gatherStarts: starts, gatherSettles: settles }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    starts = 1;
    settles = 1;
    rerender();
    expect(o.reportDataReady).toHaveBeenCalledOnce();

    // A later unrelated gather does not report again.
    starts = 2;
    settles = 2;
    rerender();
    expect(o.reportDataReady).toHaveBeenCalledOnce();
  });

  it("defense-in-depth — fails open on the settle timeout when the rescan's gather never settles", async () => {
    syncProfileMock.mockResolvedValue({
      librarySettled: true,
      membershipChanged: true,
    });
    const o = opts();
    // `useProjects` guarantees that every gather start settles, and this wait
    // still has its own ceiling; here the settles never arrive.
    const starts = 0;
    const settles = 0;

    renderHook(() =>
      useLibraryReveal({ ...o, gatherStarts: starts, gatherSettles: settles }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The change landed and the rescan fired; the settle it awaits never
    // comes.
    expect(o.rescan).toHaveBeenCalledOnce();
    expect(o.reportDataReady).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(o.reportDataReady).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1); // t=2000: the settle timeout fires
    });
    expect(o.reportDataReady).toHaveBeenCalledOnce();
  });

  it("— the settle timeout never fires once the awaited settle lands normally", async () => {
    syncProfileMock.mockResolvedValue({
      librarySettled: true,
      membershipChanged: true,
    });
    const o = opts();
    let starts = 0;
    let settles = 0;

    const { rerender } = renderHook(() =>
      useLibraryReveal({ ...o, gatherStarts: starts, gatherSettles: settles }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    starts = 1;
    settles = 1;
    rerender();
    expect(o.reportDataReady).toHaveBeenCalledOnce();

    // The normal path clears the settle timeout's timer, so advancing well
    // past it produces no second report.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(o.reportDataReady).toHaveBeenCalledOnce();
  });

  it("fails open on the verdict timeout when the pull never settles", async () => {
    syncProfileMock.mockReturnValue(new Promise(() => {}));
    const o = opts();

    renderHook(() => useLibraryReveal(o));

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(o.reportDataReady).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1); // t=5000: the verdict timeout fires
    });
    expect(o.reportDataReady).toHaveBeenCalledOnce();
  });

  it("fails open immediately when the reconciliation's library half reports it could not settle", async () => {
    syncProfileMock.mockResolvedValue({
      librarySettled: false,
      membershipChanged: false,
    });
    const o = opts();

    renderHook(() => useLibraryReveal(o));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // A settled "could not pull" reveals at once, failing open; the timeout
    // owns only the case that never resolves.
    expect(o.reportDataReady).toHaveBeenCalledOnce();
  });

  it("re-runs the check when the user id changes", () => {
    syncProfileMock.mockResolvedValue(settled);
    const reportDataReady = vi.fn();

    const { rerender } = renderHook(
      ({ userId }) => useLibraryReveal(opts({ userId, reportDataReady })),
      { initialProps: { userId: "u1" } },
    );
    expect(syncProfileMock).toHaveBeenCalledTimes(1);

    rerender({ userId: "u2" });
    expect(syncProfileMock).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a user id (demo/anonymous renders)", () => {
    const o = opts({ userId: "" });
    renderHook(() => useLibraryReveal(o));
    expect(syncProfileMock).not.toHaveBeenCalled();
  });
});
