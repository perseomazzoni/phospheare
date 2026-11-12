// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  MAX_PANEL_W,
  MIN_PANEL_W,
  NARROW_AT,
  PANEL_W,
  PHONE_AT,
  RAIL_PANEL_W,
  clampPanelWidth,
  useNarrow,
  usePhone,
} from "./useNarrow";
import { FRAME_GEOMETRY, dockRoom } from "../theme/editor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// One state, not four media queries. The dock's sheet, the bar's fold and the
// surface's padding all give way at the same width, and written separately
// they drift apart. The structure panel's fold is the writer's own state and
// not part of this.

/** A `matchMedia` whose answer can be changed, and which reports the change. */
function stubMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  let matches = initial;
  vi.stubGlobal("matchMedia", (media: string) => ({
    media,
    get matches() {
      return matches;
    },
    addEventListener: (_: string, fn: () => void) => {
      listeners.add(fn);
    },
    removeEventListener: (_: string, fn: () => void) => {
      listeners.delete(fn);
    },
  }));
  return {
    set(next: boolean) {
      matches = next;
      act(() => {
        listeners.forEach((fn) => fn());
      });
    },
    get listening() {
      return listeners.size;
    },
  };
}

describe("useNarrow", () => {
  it("answers the query at the moment it is asked", () => {
    stubMedia(true);
    expect(renderHook(() => useNarrow()).result.current).toBe(true);
  });

  it("answers false in a wide window", () => {
    stubMedia(false);
    expect(renderHook(() => useNarrow()).result.current).toBe(false);
  });

  it("follows the window across the threshold, in both directions", () => {
    const media = stubMedia(false);
    const { result } = renderHook(() => useNarrow());
    media.set(true);
    expect(result.current).toBe(true);
    media.set(false);
    expect(result.current).toBe(false);
  });

  it("stops listening when the editor goes away", () => {
    const media = stubMedia(false);
    const { unmount } = renderHook(() => useNarrow());
    expect(media.listening).toBe(1);
    unmount();
    expect(media.listening).toBe(0);
  });

  // A server render or an old embedder gets the wide layout, which degrades
  // gracefully, rather than a crash on a missing global.
  it("survives a browser with no matchMedia at all", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(renderHook(() => useNarrow()).result.current).toBe(false);
  });

  // The width is derived, so this pins the sum rather than a constant:
  // 8 + 248 + 40 + 680 + 40, the five widths between the window's edges and
  // the measure. That the five numbers match the five tokens in `editor.css`
  // is pinned in `editorCss.test.ts`, where the stylesheet is readable.
  it("names the width the three columns stop fitting at, and derives it", () => {
    expect(NARROW_AT).toBe(1016);
  });

  it("is strictly narrower than the fitting width", () => {
    // At 1016 the columns fit, so 1016 is wide. An off-by-one here would put
    // the plane's edge inside the layout it is meant to protect.
    const seen: string[] = [];
    vi.stubGlobal(
      "matchMedia",
      vi.fn((q: string) => {
        seen.push(q);
        return {
          matches: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        };
      }),
    );
    renderHook(() => useNarrow());
    expect(seen[0]).toBe("(max-width: 1015.98px)");
  });
});

// ── The phone plane ──────────────────────────────────────────────────────────
//
// A second question, not a second degree of the first. Narrow says the three
// columns stopped fitting; phone says there is one column and the chrome has
// nowhere to stand beside it, so it goes to the bottom edge. A 760px tablet
// answers yes to the first and no to the second, so the two states can
// disagree.

describe("usePhone", () => {
  it("answers the query at the moment it is asked", () => {
    stubMedia(true);
    expect(renderHook(() => usePhone()).result.current).toBe(true);
  });

  it("follows a rotation across the threshold, in both directions", () => {
    const media = stubMedia(false);
    const { result } = renderHook(() => usePhone());
    media.set(true);
    expect(result.current).toBe(true);
    media.set(false);
    expect(result.current).toBe(false);
  });

  it("stops listening when the editor goes away", () => {
    const media = stubMedia(false);
    const { unmount } = renderHook(() => usePhone());
    expect(media.listening).toBe(1);
    unmount();
    expect(media.listening).toBe(0);
  });

  it("survives a browser with no matchMedia at all", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(renderHook(() => usePhone()).result.current).toBe(false);
  });

  // 720 is where the shell stops offering the palette route (`.app-find` in
  // `webapp.css`). Any other number makes a band that is a phone to the
  // editor and a desktop to the stylesheet.
  it("adopts the width the shell already treats as a phone", () => {
    expect(PHONE_AT).toBe(720);
  });

  // Inclusive, unlike the narrow query's 1015.98: 720 is a phone, because the
  // rule it inherits is `max-width: 720px`. The asymmetry is why both queries
  // are written out rather than shared.
  it("counts 720 itself as a phone", () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "matchMedia",
      vi.fn((q: string) => {
        seen.push(q);
        return {
          matches: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        };
      }),
    );
    renderHook(() => usePhone());
    expect(seen[0]).toBe("(max-width: 720px)");
  });

  // The two planes are separate states, and the editor asks both. A phone is
  // always narrow; a narrow window is not always a phone.
  it("is a narrower plane than narrow", () => {
    expect(PHONE_AT).toBeLessThan(NARROW_AT);
  });
});

// ── The panel-width clamp ────────────────────────────────────────────────────
//
// `clampPanelWidth` is the one gate every drag, keystroke and loaded value
// passes through, and `EditorRoute` interpolates its answer into
// `--panel-w: ${w}px`. `Math.min`/`Math.max` propagate NaN in both orderings,
// and `--panel-w: NaNpx` is a declaration the browser drops, leaving the
// panel at whatever the cascade last said. So the gate answers a finite width
// for NaN by construction, not only because its inputs are finite.
describe("clampPanelWidth", () => {
  it("holds the panel's two bounds", () => {
    expect(clampPanelWidth(10)).toBe(MIN_PANEL_W);
    expect(clampPanelWidth(10_000)).toBe(MAX_PANEL_W);
    expect(clampPanelWidth(-Infinity)).toBe(MIN_PANEL_W);
    expect(clampPanelWidth(Infinity)).toBe(MAX_PANEL_W);
  });

  it("— answers a width for every number, so `${w}px` is never NaNpx", () => {
    const w = clampPanelWidth(Number.NaN);
    expect(Number.isFinite(w)).toBe(true);
    expect(w).toBe(PANEL_W);
    expect(`${w}px`).not.toContain("NaN");
  });
});

// ── The dock's two window widths ─────────────────────────────────────────────
//
// `reach` keeps the dock off the structure panel; `fit` is the widest dock
// beside which the whole measure stays visible, and the drag's detent.
describe("dockRoom", () => {
  it("measures both against the open panel and its 40px gutter", () => {
    // 1920 − 8 (the dock's own inset) − (8 + 248 + 40) = 1616, and
    // 1920 − 296 − 680 − 40 = 904: a 1920 monitor keeps the whole measure
    // beside a dock wider than 720.
    expect(dockRoom(FRAME_GEOMETRY, 1920, PANEL_W, false)).toEqual({
      reach: 1616,
      fit: 904,
    });
    // At the plane's own edge the dock may not reach past the panel's gutter.
    expect(dockRoom(FRAME_GEOMETRY, NARROW_AT, PANEL_W, false).reach).toBe(712);
    // And at NARROW_AT nothing beside the measure is left at all.
    expect(dockRoom(FRAME_GEOMETRY, NARROW_AT, PANEL_W, false).fit).toBe(0);
  });

  it("counts a folded panel as the rail it draws, with the rail's gutter", () => {
    // 1300 − (8 + 52 + 40) = 1200; − 8 = 1192 reach; − 680 − 40 = 480 fit.
    expect(dockRoom(FRAME_GEOMETRY, 1300, RAIL_PANEL_W, true)).toEqual({
      reach: 1192,
      fit: 480,
    });
  });
});
