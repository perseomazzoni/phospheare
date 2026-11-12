// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { TIP_COOL_AFTER, TIP_WARM_AFTER, useTipWarmth } from "./useTipWarmth";

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

// The delay belongs to the group, not to the button. A writer who has read one
// tip is reading the bar, and a fresh delay on each neighbour would turn that
// into a sequence of pauses.

describe("useTipWarmth", () => {
  it("starts cold", () => {
    expect(renderHook(() => useTipWarmth()).result.current.warm).toBe(false);
  });

  it("warms once the pointer has stayed long enough to read one", () => {
    const { result } = renderHook(() => useTipWarmth());
    act(() => result.current.onPointerEnter());
    tick(TIP_WARM_AFTER - 1);
    expect(result.current.warm).toBe(false);
    tick(1);
    expect(result.current.warm).toBe(true);
  });

  it("stays cold for a pointer only passing through", () => {
    const { result } = renderHook(() => useTipWarmth());
    act(() => result.current.onPointerEnter());
    tick(200);
    act(() => result.current.onPointerLeave());
    tick(TIP_WARM_AFTER + TIP_COOL_AFTER);
    expect(result.current.warm).toBe(false);
  });

  it("goes cold again once the pointer has been away long enough", () => {
    const { result } = renderHook(() => useTipWarmth());
    act(() => result.current.onPointerEnter());
    tick(TIP_WARM_AFTER);
    act(() => result.current.onPointerLeave());
    tick(TIP_COOL_AFTER - 1);
    expect(result.current.warm).toBe(true);
    tick(1);
    expect(result.current.warm).toBe(false);
  });

  // Crossing the hairline between two segments does not reset the group.
  it("keeps the group warm across a brief leave and return", () => {
    const { result } = renderHook(() => useTipWarmth());
    act(() => result.current.onPointerEnter());
    tick(TIP_WARM_AFTER);
    act(() => result.current.onPointerLeave());
    tick(100);
    act(() => result.current.onPointerEnter());
    tick(TIP_COOL_AFTER);
    expect(result.current.warm).toBe(true);
  });

  it("settles nothing after the bar has gone away", () => {
    const { result, unmount } = renderHook(() => useTipWarmth());
    act(() => result.current.onPointerEnter());
    unmount();
    // No `act()`: nothing is scheduled to update state.
    expect(() => vi.advanceTimersByTime(TIP_WARM_AFTER * 2)).not.toThrow();
  });
});
