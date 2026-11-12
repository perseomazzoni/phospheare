// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { keepInView, revealDelta } from "./scrollStrategy";
import { cancelScrollGlide } from "../writing/scrollGlide";
// The keep-in-band pull glides (`scrollGlide.ts`); one stub frame stamped a
// second past the start completes any glide synchronously for the assertions.
const realRaf = globalThis.requestAnimationFrame.bind(globalThis);
beforeEach(() => {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(performance.now() + 1000);
    return 0;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});
afterEach(() => {
  globalThis.requestAnimationFrame = realRaf;
  cancelScrollGlide();
});

/** A surface whose viewport is 800 tall at the top of the page. */
function surfaceStub(scrollTop = 0) {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 800,
      width: 800,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  el.scrollTop = scrollTop;
  return el;
}

describe("keepInView.hold", () => {
  it("scrolls down by exactly the overflow when the caret crosses the bottom band", () => {
    const surface = surfaceStub(0);
    // The bottom band starts at 800 - 80 = 720; a caret ending at 776
    // overflows by 56.
    const moved = keepInView.hold({ y: 736, h: 40 }, surface);
    expect(moved).toBe(true);
    expect(surface.scrollTop).toBe(56);
  });

  it("scrolls up when the caret crosses the top band", () => {
    const surface = surfaceStub(300);
    // A caret top at 40 sits inside the 120px top band and moves to 120.
    const moved = keepInView.hold({ y: 60, h: 20 }, surface);
    expect(moved).toBe(true);
    expect(surface.scrollTop).toBe(240);
  });

  it("does not move while the caret is inside the band", () => {
    const surface = surfaceStub(0);
    // The centre of the viewport, 380 to 420, is inside the bands.
    const moved = keepInView.hold({ y: 380, h: 20 }, surface);
    expect(moved).toBe(false);
    expect(surface.scrollTop).toBe(0);
  });

  it("does not move on a reflow, even with the caret out of the band", () => {
    // The writer may have scrolled the caret away; a font landing is not
    // theirs to undo.
    const surface = surfaceStub(0);
    expect(keepInView.reflow({ y: 900, h: 20 }, surface)).toBe(false);
    expect(surface.scrollTop).toBe(0);
  });

  it("lets the wheel mean what it always meant: a free page", () => {
    // The scroll view has no station to hold, so a wheel notch is a native
    // scroll, and the core does not `preventDefault` it.
    expect(keepInView.wheelPolicy()).toBe("free");
  });
});

describe("revealDelta", () => {
  it("scrolls up so a caret above the bar lands one full line below it", () => {
    // Caret 146px above the bar (bar bottom 86, line box 27): the page moves
    // up by that distance plus the one-line gap, a negative delta.
    expect(revealDelta({ y: -60, h: 16 }, 86, 27, 720)).toBe(-173);
  });

  it("scrolls down so a caret below the surface lands one full line above it", () => {
    // Caret 80px below the surface bottom (720, line box 27): the page moves
    // down so it lands at 693, a positive delta.
    expect(revealDelta({ y: 800, h: 16 }, 86, 27, 720)).toBe(107);
  });

  it("does not move a caret already in view", () => {
    expect(revealDelta({ y: 140, h: 16 }, 86, 27, 720)).toBe(0);
  });

  it("does not move a caret exactly on the bar border", () => {
    // Sitting on the border is visible, not hidden, so nothing is revealed.
    expect(revealDelta({ y: 86, h: 16 }, 86, 27, 720)).toBe(0);
  });

  it("does not move a caret exactly on the surface bottom", () => {
    expect(revealDelta({ y: 720, h: 16 }, 86, 27, 720)).toBe(0);
  });
});

describe("keepInView.onCaretMove", () => {
  /** A surface inside an editor shell with a command bar and a prose column.
   * jsdom has no layout, so every rect is stubbed. */
  function revealSurface(scrollTop: number) {
    const shell = document.createElement("div");
    shell.className = "editor-shell";
    const chrome = document.createElement("div");
    chrome.className = "chrome";
    const bar = document.createElement("div");
    bar.className = "ui-bar";
    bar.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 86,
        width: 400,
        height: 46,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    chrome.appendChild(bar);
    const surface = document.createElement("div");
    surface.className = "editor-surface";
    surface.scrollTop = scrollTop;
    surface.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 1280,
        bottom: 720,
        width: 1280,
        height: 720,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const editor = document.createElement("div");
    editor.className = "editor";
    editor.style.lineHeight = "27px";
    surface.appendChild(editor);
    shell.appendChild(surface);
    shell.appendChild(chrome);
    return { surface, editor };
  }

  it("snaps a caret that moved above the bar back into view", () => {
    const { surface } = revealSurface(500);
    const moved = keepInView.onCaretMove({ y: -60, h: 16 }, surface);
    expect(moved).toBe(true);
    // 500 - (86 + 27) - (-60): the caret lands one line below the bar.
    expect(surface.scrollTop).toBe(327);
  });

  it("snaps a caret that moved below the surface back into view", () => {
    const { surface } = revealSurface(500);
    const moved = keepInView.onCaretMove({ y: 800, h: 16 }, surface);
    expect(moved).toBe(true);
    expect(surface.scrollTop).toBe(607);
  });

  it("does not move a caret already in view", () => {
    const { surface } = revealSurface(500);
    const moved = keepInView.onCaretMove({ y: 200, h: 16 }, surface);
    expect(moved).toBe(false);
    expect(surface.scrollTop).toBe(500);
  });

  it("does nothing when there is no caret rect (a selection)", () => {
    const { surface } = revealSurface(0);
    expect(keepInView.onCaretMove(null, surface)).toBe(false);
    expect(surface.scrollTop).toBe(0);
  });
});
