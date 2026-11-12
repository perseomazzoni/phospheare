// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { keyboardInset, useKeyboardInset } from "./useKeyboardInset";

// The hook coalesces through one animation frame, because the keyboard's
// opening animation fires a `resize` and a `scroll` per frame, and each would
// re-render the writing surface. A frame that runs immediately keeps the
// coalescing real and lets a test assert synchronously, as `station.test.ts`
// does.
const realRaf = globalThis.requestAnimationFrame;
beforeEach(() => {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf;
  cleanup();
  vi.unstubAllGlobals();
  delete (window as { visualViewport?: unknown }).visualViewport;
});

// The keyboard does not resize the page: both engines keep the layout
// viewport at full height and shrink only the visual one. A bar pinned to the
// bottom of the layout viewport sits under the keyboard, and only
// `visualViewport` says by how much.

/** A movable `visualViewport` band that reports as the real one does. */
function stubViewport({
  height,
  offsetTop = 0,
  innerHeight = 667,
}: {
  height: number;
  offsetTop?: number;
  innerHeight?: number;
}) {
  const listeners = new Map<string, Set<() => void>>();
  const vv = {
    height,
    offsetTop,
    addEventListener: (type: string, fn: () => void) => {
      const set = listeners.get(type) ?? new Set<() => void>();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, fn: () => void) => {
      listeners.get(type)?.delete(fn);
    },
  };
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    writable: true,
    value: vv,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: innerHeight,
  });
  return {
    /** Move the band and fire the event the browser would fire. */
    set(next: { height?: number; offsetTop?: number }, type = "resize") {
      if (next.height !== undefined) vv.height = next.height;
      if (next.offsetTop !== undefined) vv.offsetTop = next.offsetTop;
      act(() => {
        listeners.get(type)?.forEach((fn) => fn());
      });
    },
    get listening() {
      return (
        (listeners.get("resize")?.size ?? 0) +
        (listeners.get("scroll")?.size ?? 0)
      );
    },
  };
}

describe("keyboardInset", () => {
  it("is zero on a browser with no visualViewport at all", () => {
    // A browser old enough to be missing it has no on-screen keyboard either,
    // so the absent API and the absent keyboard are the same answer.
    expect(keyboardInset()).toBe(0);
  });

  it("is zero when the visual viewport fills the layout one", () => {
    stubViewport({ height: 667 });
    expect(keyboardInset()).toBe(0);
  });

  it("is the height of the band the keyboard covers", () => {
    stubViewport({ height: 331 });
    expect(keyboardInset()).toBe(336);
  });

  it("counts the offset, not just the height", () => {
    // The browser scrolls the visual viewport to keep a focused field above
    // the keys, moving the band down inside the layout viewport. Only
    // `height + offsetTop` gives its bottom edge; height alone over-reports by
    // the offset.
    stubViewport({ height: 331, offsetTop: 40 });
    expect(keyboardInset()).toBe(296);
  });

  it("ignores what is not a keyboard", () => {
    // A URL bar collapsing on scroll, a pinch, an iPadOS floating toolbar.
    // The smallest phone keyboard is over 200px even in landscape and browser
    // chrome shifts stay well under 100, so the floor separates them without
    // asking which engine is running.
    stubViewport({ height: 667 - 90 });
    expect(keyboardInset()).toBe(0);
    stubViewport({ height: 667 - 121 });
    expect(keyboardInset()).toBe(121);
  });

  it("never reports a negative band", () => {
    // iOS reports a visual viewport taller than the layout one while the URL
    // bar retracts. A negative inset would push the bar off the bottom of the
    // screen.
    stubViewport({ height: 700 });
    expect(keyboardInset()).toBe(0);
  });
});

describe("useKeyboardInset", () => {
  it("reads on mount rather than waiting for the next event", () => {
    // A phone can reload the page with a field already focused, and a
    // listener only reports what happens next.
    stubViewport({ height: 331 });
    expect(renderHook(() => useKeyboardInset()).result.current).toBe(336);
  });

  it("follows the keyboard up and back down", () => {
    const vp = stubViewport({ height: 667 });
    const { result } = renderHook(() => useKeyboardInset());
    expect(result.current).toBe(0);
    vp.set({ height: 331 });
    expect(result.current).toBe(336);
    vp.set({ height: 667 });
    expect(result.current).toBe(0);
  });

  it("hears the scroll the browser fires alongside the resize", () => {
    const vp = stubViewport({ height: 667 });
    const { result } = renderHook(() => useKeyboardInset());
    vp.set({ height: 331, offsetTop: 0 }, "scroll");
    expect(result.current).toBe(336);
  });

  it("stops listening when the editor goes away", () => {
    const vp = stubViewport({ height: 667 });
    const { unmount } = renderHook(() => useKeyboardInset());
    expect(vp.listening).toBe(2);
    unmount();
    expect(vp.listening).toBe(0);
  });

  it("survives a browser with no visualViewport", () => {
    expect(renderHook(() => useKeyboardInset()).result.current).toBe(0);
  });
});
