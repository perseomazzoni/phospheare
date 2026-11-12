// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { useChromeInset } from "./useChromeInset";

// The hook measures the station's chrome because hand-written constants go
// stale. `station.test.ts` pins the arithmetic; these rows pin
// when to measure: not before there is a layout, not before the chrome has
// mounted, and in an environment that cannot observe either.
//
// jsdom lays nothing out and every rect is zero, so the geometry is stubbed
// per element. The assertions are about which reading the hook takes and
// when, and the numbers are the ones measured off real profiles in
// `station.test.ts`.

/** Real rects, keyed by the selector the hook looks each element up with. */
function stubLayout(boxes: Record<string, [number, number] | null>) {
  for (const [sel, span] of Object.entries(boxes)) {
    const el = document.querySelector(sel);
    if (!el || !span) continue;
    el.getBoundingClientRect = () =>
      ({
        top: span[0],
        bottom: span[1],
        height: span[1] - span[0],
      }) as DOMRect;
  }
}

function mountChrome(parts: string[]) {
  for (const cls of parts) {
    const el = document.createElement("div");
    el.className = cls;
    document.body.append(el);
  }
}

const realRaf = globalThis.requestAnimationFrame;
let observed: Element[] = [];

beforeEach(() => {
  observed = [];
  // Immediate frames, as in `useKeyboardInset.test.ts`: the coalescing stays
  // real and the tests still assert synchronously.
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {}
      unobserve() {}
    },
  );
  window.innerHeight = 1024;
});

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf;
  cleanup();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** A surface element, and the getter the hook is handed to reach it. */
function surface(span: [number, number]): () => HTMLElement {
  const el = document.createElement("div");
  el.className = "editor-surface";
  document.body.append(el);
  el.getBoundingClientRect = () =>
    ({ top: span[0], bottom: span[1], height: span[1] - span[0] }) as DOMRect;
  return () => el;
}

describe("useChromeInset", () => {
  it("measures the whole stack once every part of it is mounted", () => {
    const get = surface([0, 1024]);
    mountChrome(["titlebar", "bar-row"]);
    // The desk under a coarse pointer: titlebar 48 (the shared band grown to
    // hold a 44px control) plus a 56px bar row, flush. The declared
    // fallback says 86, which would leave the station 9px high.
    stubLayout({ ".titlebar": [0, 48], ".bar-row": [48, 104] });

    const { result } = renderHook(() => useChromeInset(get));
    expect(result.current).toEqual({ top: 104, bottom: 0 });
  });

  it("waits for the whole stack rather than measuring a piece of it", () => {
    // A frame queue rather than the immediate stub, because the row pins the
    // waiting, and a frame that runs inline cannot be observed mid-wait.
    const frames: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    }) as typeof requestAnimationFrame;
    const flush = () => {
      const due = frames.splice(0, frames.length);
      for (const cb of due) act(() => cb(0));
    };

    const get = surface([0, 1024]);
    // The editor holds on entry: the core mounts against a
    // skeleton and the chrome arrives after. Measuring whatever exists would
    // report 48 on a page wearing 104, the titlebar counted and the bar row
    // not yet there.
    mountChrome(["titlebar"]);
    stubLayout({ ".titlebar": [0, 48] });

    const { result } = renderHook(() => useChromeInset(get));
    flush();
    expect(result.current).toBeNull();
    expect(observed.map((el) => el.className)).not.toContain("titlebar");

    // The rest of the chrome arrives, the ordinary case.
    mountChrome(["bar-row"]);
    stubLayout({ ".bar-row": [48, 104] });
    flush();
    flush();
    expect(result.current).toEqual({ top: 104, bottom: 0 });
  });

  it("gives up waiting rather than polling for a part that never comes", () => {
    // The wait ends: a part that never arrives would leave a frame chain
    // running for the life of the editor, to guard a 9px error. With frames
    // that run inline the budget is spent at once, and the hook settles for
    // what is on the page, which is correct if the bar is gone.
    const get = surface([0, 1024]);
    mountChrome(["titlebar"]);
    stubLayout({ ".titlebar": [0, 48] });

    const { result } = renderHook(() => useChromeInset(get));
    expect(result.current).toEqual({ top: 48, bottom: 0 });
  });

  it("answers null where nothing can be observed, so the fallback stands", () => {
    const get = surface([0, 1024]);
    mountChrome(["titlebar", "bar-row"]);
    stubLayout({ ".titlebar": [0, 48], ".bar-row": [48, 104] });
    vi.stubGlobal("ResizeObserver", undefined);

    const { result } = renderHook(() => useChromeInset(get));
    expect(result.current).toBeNull();
  });

  it("answers null for a surface that has not been laid out", () => {
    // Zero height means no measurement, not no chrome. A chrome of
    // `{ 0, 0 }` would look like a real reading and put the station at the
    // raw midpoint.
    const get = surface([0, 0]);
    mountChrome(["titlebar", "bar-row"]);
    stubLayout({ ".titlebar": [0, 48], ".bar-row": [48, 104] });

    const { result } = renderHook(() => useChromeInset(get));
    expect(result.current).toBeNull();
  });

  it("answers null when there is no surface at all", () => {
    const { result } = renderHook(() => useChromeInset(() => null));
    expect(result.current).toBeNull();
  });

  it("watches the surface as well as the chrome", () => {
    // The insets are measured relative to the surface, so a surface that
    // moves changes both numbers with no piece of chrome changing.
    const get = surface([0, 1024]);
    mountChrome(["titlebar", "bar-row"]);
    stubLayout({ ".titlebar": [0, 48], ".bar-row": [48, 104] });

    renderHook(() => useChromeInset(get));
    expect(observed.map((el) => el.className).sort()).toEqual([
      "bar-row",
      "editor-surface",
      "titlebar",
    ]);
  });

  it("puts the same stack below when that is where the phone draws it", () => {
    window.innerHeight = 667;
    const get = surface([0, 667]);
    mountChrome(["titlebar", "bar-row"]);
    // The phone keeps its titlebar and collapses it to nothing, so a
    // zero-height part is a real answer rather than a missing one.
    stubLayout({ ".titlebar": [0, 0], ".bar-row": [599, 667] });

    const { result } = renderHook(() => useChromeInset(get));
    expect(result.current).toEqual({ top: 0, bottom: 68 });
  });
});
