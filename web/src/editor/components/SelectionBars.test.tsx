// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import SelectionBars, { barsFor, lineBoxFor } from "./SelectionBars";

// The selection bars' geometry: one bar at the leading edge of the line where
// the selection starts, one at the trailing edge of the line where it ends —
// each expanded from the font box `getClientRects()` reports (the only box
// Chromium gives) to the full line box the `::selection` wash paints. The
// rects in these fixtures are font boxes; the containers carry the computed
// line-height the expansion reads.

const LINE = 40; // the font box, as getClientRects() reports it

function container(): Element {
  const p = document.createElement("p");
  p.style.fontSize = "20px";
  p.style.lineHeight = "48px";
  return p;
}

function range(lines: { left: number; top: number; right: number }[]): Range {
  const lineRects = lines.map((l) => ({
    left: l.left,
    top: l.top,
    right: l.right,
    bottom: l.top + LINE,
    width: l.right - l.left,
    height: LINE,
    x: l.left,
    y: l.top,
    toJSON: () => ({}),
  }));
  return {
    getClientRects: () => lineRects,
    startContainer: container(),
    endContainer: container(),
  } as unknown as Range;
}

describe("lineBoxFor", () => {
  it("expands a font box to the full line box, centred on the glyphs", () => {
    // 21px font box inside a 36.48px line box → half-leading above and below.
    const bars = lineBoxFor(
      { top: 50, height: 21 },
      { fontSize: 19, lineHeight: 36.48 },
    );
    expect(bars.height).toBeCloseTo(36.48);
    expect(bars.top).toBeCloseTo(42.26);
  });

  it("passes a rect through when it already spans its line box", () => {
    expect(
      lineBoxFor({ top: 50, height: 40 }, { fontSize: 19, lineHeight: 36.48 }),
    ).toEqual({
      top: 50,
      height: 40,
    });
  });

  it("falls back to 1.2em when line-height resolves to normal", () => {
    // 20px × 1.2 = 24px line box around a 21px font box → 1.5 half-leading.
    expect(
      lineBoxFor({ top: 50, height: 21 }, { fontSize: 20, lineHeight: 0 }),
    ).toEqual({
      top: 48.5,
      height: 24,
    });
  });

  it("passes a rect through when no style resolves at all", () => {
    expect(
      lineBoxFor({ top: 50, height: 40 }, { fontSize: 0, lineHeight: 0 }),
    ).toEqual({
      top: 50,
      height: 40,
    });
  });
});

describe("barsFor", () => {
  it("brackets a single line with full line-box height", () => {
    const bars = barsFor(range([{ left: 100, top: 50, right: 220 }]));
    // Font box 40 tall at 50 → line box 48 → 4 half-leading, bar from 46 to 94.
    expect(bars).toEqual({
      start: { left: 100, top: 46, height: 48 },
      end: { left: 220, top: 46, height: 48 },
    });
  });

  it("one bar per end line, on a multi-line selection", () => {
    const bars = barsFor(
      range([
        { left: 60, top: 50, right: 400 },
        { left: 40, top: 90, right: 210 },
      ]),
    );
    expect(bars).toEqual({
      start: { left: 60, top: 46, height: 48 },
      end: { left: 210, top: 86, height: 48 },
    });
  });

  it("returns null when there is no line to mark", () => {
    expect(barsFor(range([]))).toBeNull();
  });

  it("passes the rects through when no container style resolves", () => {
    // Orphaned text nodes have no parentElement to read computed style from —
    // the bars fall back to the font box, the only geometry available.
    const r = range([{ left: 100, top: 50, right: 220 }]) as unknown as {
      startContainer: Node;
      endContainer: Node;
    };
    r.startContainer = document.createTextNode("a");
    r.endContainer = document.createTextNode("b");
    expect(barsFor(r as unknown as Range)).toEqual({
      start: { left: 100, top: 50, height: 40 },
      end: { left: 220, top: 50, height: 40 },
    });
  });
});

// ── The follow-the-wash contract ─────────────────────────────────────────────
// The wash is repainted by the browser whenever the layout or the scroll moves;
// the bars are painted by the component. These rows pin every event the bars
// listen to, so a bar never disagrees with the wash about where a selection is.

afterEach(() => cleanup());

function rectFor(left: number, top: number, height = 40): DOMRect {
  return {
    left,
    top,
    right: left + 100,
    bottom: top + height,
    width: 100,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("SelectionBars", () => {
  let surface: HTMLElement;
  let rects: DOMRect[];
  // The shape the next getSelection() call answers with — tests flip these
  // fields, then fire an event to make the component re-measure.
  let sel: { rangeCount: number; isCollapsed: boolean; startContainer: Node };
  let getSelection: ReturnType<typeof vi.spyOn>;

  function mount() {
    return render(<SelectionBars getSurface={() => surface} />);
  }

  beforeEach(() => {
    surface = document.createElement("div");
    document.body.appendChild(surface);
    rects = [rectFor(10, 20)];
    sel = { rangeCount: 1, isCollapsed: false, startContainer: surface };
    getSelection = vi.spyOn(window, "getSelection").mockImplementation(
      () =>
        ({
          rangeCount: sel.rangeCount,
          isCollapsed: sel.isCollapsed,
          getRangeAt: () => ({
            getClientRects: () => rects,
            startContainer: sel.startContainer,
            endContainer: sel.startContainer,
          }),
        }) as unknown as Selection,
    );
  });

  afterEach(() => {
    getSelection.mockRestore();
    document.documentElement.removeAttribute("style");
    surface.remove();
  });

  const startBar = () =>
    document.querySelector(".selection-bar") as HTMLElement | null;
  const endBar = () =>
    document.querySelector(".selection-bar-end") as HTMLElement | null;

  it("draws the two bars over the live selection on mount", () => {
    mount();
    expect(startBar()?.style.left).toBe("10px");
    expect(startBar()?.style.top).toBe("20px");
    expect(startBar()?.style.height).toBe("40px");
    expect(endBar()?.style.left).toBe("110px");
  });

  it("re-measures when the surface scrolls", () => {
    mount();
    rects[0] = rectFor(10, 120);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(startBar()?.style.top).toBe("120px");
  });

  it("re-measures when the window resizes", () => {
    mount();
    rects[0] = rectFor(10, 160);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(startBar()?.style.top).toBe("160px");
  });

  it("re-measures when the SURFACE's box changes, not just the window's", () => {
    // A `resize` event is delivered before the editor's own React response
    // to it, so the window listener alone reads a column not yet re-laid-out
    // and leaves the bars away from the wash for good.
    //
    // An observer fires after layout, which is what makes the second pass land.
    // jsdom has no ResizeObserver, so this stands one up and keeps the
    // callback: what is pinned is that the surface is observed at all, and
    // that the callback re-measures.
    let observed: Element | null = null;
    let fire: (() => void) | null = null;
    class FakeResizeObserver {
      constructor(cb: () => void) {
        fire = cb;
      }
      observe(el: Element) {
        observed = el;
      }
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    try {
      mount();
      expect(observed).toBe(surface);

      rects[0] = rectFor(10, 240);
      act(() => fire?.());
      expect(startBar()?.style.top).toBe("240px");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("re-measures when the surface's style changes (a prose-size change)", async () => {
    mount();
    rects[0] = rectFor(10, 200);
    await act(async () => {
      surface.setAttribute("style", "--prose-size: 21px");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(startBar()?.style.top).toBe("200px");
  });

  it("re-measures when the root's style changes (a theme change)", async () => {
    mount();
    rects[0] = rectFor(10, 300);
    await act(async () => {
      document.documentElement.setAttribute("style", "--leading: 1.6");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(startBar()?.style.top).toBe("300px");
  });

  it("hides when the selection collapses", () => {
    mount();
    sel.isCollapsed = true;
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(document.querySelector(".selection-bar")).toBeNull();
  });

  it("hides when the selection leaves the prose", () => {
    mount();
    sel.startContainer = document.body;
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(document.querySelector(".selection-bar")).toBeNull();
  });

  it("starts listening before the surface exists", () => {
    let present = false;
    render(<SelectionBars getSurface={() => (present ? surface : null)} />);
    expect(document.querySelector(".selection-bar")).toBeNull();
    present = true;
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(startBar()).not.toBeNull();
  });
});
