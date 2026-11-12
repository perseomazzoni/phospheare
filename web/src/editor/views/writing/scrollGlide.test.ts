// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import BASE_CSS from "../../../styles/base.css?raw";
import {
  cancelScrollGlide,
  easeOut,
  glideScrollTo,
  SCROLL_GLIDE_MS,
} from "./scrollGlide";

afterEach(() => {
  cancelScrollGlide();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A surface with a live `scrollTop`, in a jsdom that cannot lay out. */
function makeSurface(top = 0): HTMLElement {
  const el = document.createElement("div");
  el.scrollTop = top;
  return el;
}

function useFakeFrames(): void {
  // The fake timers cover `requestAnimationFrame` and `performance` only
  // when asked; left real, the glide would run on wall-clock frames no test
  // can wait for.
  vi.useFakeTimers({
    toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
  });
}

describe("easeOut", () => {
  it("lands on the fade-in curve: starts fast, ends at 1, never overshoots", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBe(0.875);
    expect(easeOut(0.9)).toBeGreaterThan(0.9);
    expect(easeOut(0.5)).toBeLessThanOrEqual(1);
  });
});

describe("glideScrollTo", () => {
  it("settles on the target after the fade-in’s own duration", () => {
    useFakeFrames();
    const surface = makeSurface(0);
    expect(glideScrollTo(surface, 100)).toBe(true);
    expect(surface.scrollTop).toBe(0); // not yet — the first frame has not run
    // A frame's slack past the duration: the settling frame lands on the
    // next tick after `p` reaches 1, and runs before the target is final.
    vi.advanceTimersByTime(SCROLL_GLIDE_MS + 20);
    expect(surface.scrollTop).toBe(100);
  });

  it("is strictly between the start and the target mid-flight — no overshoot", () => {
    useFakeFrames();
    const surface = makeSurface(0);
    glideScrollTo(surface, 100);
    vi.advanceTimersByTime(SCROLL_GLIDE_MS / 2);
    expect(surface.scrollTop).toBeGreaterThan(0);
    expect(surface.scrollTop).toBeLessThan(100);
  });

  it("retargets from the live position when a new move interrupts it", () => {
    useFakeFrames();
    const surface = makeSurface(0);
    glideScrollTo(surface, 100);
    vi.advanceTimersByTime(SCROLL_GLIDE_MS / 2);
    const mid = surface.scrollTop;
    expect(mid).toBeGreaterThan(0);
    // A second keystroke's dock lands while the first is arriving: the page
    // re-aims from where it is, never jumping back to the old start.
    glideScrollTo(surface, 200);
    vi.advanceTimersByTime(SCROLL_GLIDE_MS + 20);
    expect(surface.scrollTop).toBe(200);
  });

  it("snaps instantly when the writer asked for reduced motion", () => {
    useFakeFrames();
    const real = window.matchMedia;
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes("reduced-motion"),
    })) as unknown as typeof window.matchMedia;
    try {
      const surface = makeSurface(0);
      expect(glideScrollTo(surface, 80)).toBe(false);
      expect(surface.scrollTop).toBe(80);
    } finally {
      window.matchMedia = real;
    }
  });

  it("is a no-op, not an animation, when the page already sits at the target", () => {
    useFakeFrames();
    const surface = makeSurface(50);
    expect(glideScrollTo(surface, 50)).toBe(false);
  });

  it("arrives in the time a typed character takes to fade in", () => {
    // The duration is TypeScript and the fade's token is CSS, so no compiler
    // sees both.
    const fade = /--t-char-fade:\s*([\d.]+)ms/.exec(BASE_CSS)?.[1];
    expect(Number(fade)).toBe(SCROLL_GLIDE_MS);
  });
});
