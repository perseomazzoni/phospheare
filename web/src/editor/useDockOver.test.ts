// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDockOver } from "./useDockOver";

// The stylesheet resolves `--dock-over`; jsdom does not, so each case states
// the resolved length the shell would report.
function shellReporting(value: () => string, dock = "1") {
  const el = document.createElement("div");
  el.dataset.dock = dock;
  document.body.append(el);
  const real = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((target) => {
    if (target !== el) return real(target);
    const style = real(el);
    return {
      ...style,
      getPropertyValue: (name: string) =>
        name === "--dock-over" ? value() : style.getPropertyValue(name),
    } as CSSStyleDeclaration;
  });
  return el;
}

async function attribute(el: HTMLElement, name: string, value: string) {
  await act(async () => {
    el.setAttribute(name, value);
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useDockOver", () => {
  it("reads the Dock as over the measure at 1px and beside it at 0px", () => {
    let reported = "0px";
    const el = shellReporting(() => reported);
    const ref = { current: el };
    const { result } = renderHook(() => useDockOver(ref));
    expect(result.current.over).toBe(false);

    reported = "1px";
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current.over).toBe(true);
  });

  it("reads again when the shell's inputs change", async () => {
    let reported = "0px";
    const el = shellReporting(() => reported, "0");
    const ref = { current: el };
    const { result } = renderHook(() => useDockOver(ref));

    reported = "1px";
    await attribute(el, "data-dock", "1");
    expect(result.current.over).toBe(true);
  });

  it("holds the face while the Dock is closed", async () => {
    let reported = "1px";
    const el = shellReporting(() => reported);
    const ref = { current: el };
    const { result } = renderHook(() => useDockOver(ref));
    expect(result.current.over).toBe(true);

    reported = "0px";
    await attribute(el, "data-dock", "0");
    expect(result.current.over).toBe(true);
  });

  it("settles two frames after the Dock opens, and unsettles on close", async () => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame"],
    });
    const el = shellReporting(() => "1px", "0");
    const ref = { current: el };
    const { result } = renderHook(() => useDockOver(ref));
    expect(result.current.settled).toBe(false);

    await attribute(el, "data-dock", "1");
    expect(result.current.settled).toBe(false);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(result.current.settled).toBe(false);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.settled).toBe(true);

    await attribute(el, "data-dock", "0");
    expect(result.current.settled).toBe(false);
  });

  it("is beside with no value to read", () => {
    const el = shellReporting(() => "");
    const ref = { current: el };
    const { result } = renderHook(() => useDockOver(ref));
    expect(result.current.over).toBe(false);
  });
});
