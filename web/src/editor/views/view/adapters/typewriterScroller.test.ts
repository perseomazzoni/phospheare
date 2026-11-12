// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { typewriterScroller } from "./typewriterScroller";
import { station } from "../../writing/station";
import { cancelScrollGlide } from "../../writing/scrollGlide";

// jsdom has no layout and every rect is empty, so the helpers degrade to
// null, never crashing or producing garbage. The dock math rows pin the
// geometry.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;

// The dock glides (`scrollGlide.ts`); one stub frame stamped a second past
// the start completes any glide synchronously for the assertions.
const realRaf = globalThis.requestAnimationFrame.bind(globalThis);
beforeEach(() => {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(performance.now() + 1000);
    return 0;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});

afterEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
  station.state = "docked";
  globalThis.requestAnimationFrame = realRaf;
  cancelScrollGlide();
});

/** A caret rect stubbed at `top` inside a 800×1000 surface. */
function caretAt(top: number) {
  const p = document.createElement("p");
  p.textContent = "text";
  const editor = document.createElement("div");
  editor.appendChild(p);
  const surface = document.createElement("div");
  surface.appendChild(editor);
  document.body.appendChild(surface);
  surface.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 1000,
      width: 800,
      height: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  const sel = window.getSelection();
  if (sel === null) throw new Error("typewriter fixture: no selection");
  sel.removeAllRanges();
  const range = document.createRange();
  const firstChild = p.firstChild;
  if (firstChild === null)
    throw new Error("typewriter fixture: paragraph has no text child");
  range.setStart(firstChild, 1);
  range.collapse(true);
  sel.addRange(range);
  const rects = [
    {
      left: 4,
      top,
      right: 5,
      bottom: top + 16,
      width: 1,
      height: 16,
      x: 4,
      y: top,
      toJSON: () => ({}),
    },
  ];
  Range.prototype.getClientRects = () => rects as unknown as DOMRectList;
  return { surface };
}

describe("typewriterScroller", () => {
  it("holds the caret centre at the vertical midpoint of the surface", () => {
    const { surface } = caretAt(900);
    // Container top 0, height 1000: the station is 543, the midpoint 500
    // plus the chrome half 43. Caret rect y 900, h 16: centre 908, delta
    // 365, so the new `scrollTop` is 365.
    surface.scrollTop = 0;
    const moved = typewriterScroller.hold({ y: 900, h: 16 }, surface);
    expect(moved).toBe(true);
    // The glide completes on the stub frame, so the page is at the station.
    expect(surface.scrollTop).toBe(365);
  });

  it("releases the station when the caret moved without the document changing", () => {
    // A non-collapsed selection means nothing is being written; the core
    // signals it as a null caret, and the station lets go rather than hold a
    // selection it cannot hold.
    const { surface } = caretAt(900);
    const moved = typewriterScroller.onCaretMove(null, surface);
    expect(moved).toBe(false);
    expect(station.state).toBe("released");
  });

  it("is a no-op for a hold when the caret was stubbed to no geometry", () => {
    const { surface } = caretAt(900);
    // `station.dock` with a delta of 0 (caret already on the visible centre
    // 543) does not scroll.
    surface.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 1000,
        width: 800,
        height: 1000,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const moved = typewriterScroller.hold({ y: 535, h: 16 }, surface);
    expect(moved).toBe(false);
    expect(surface.scrollTop).toBe(0);
  });

  it("docks a docked line the page reflowed under", () => {
    // A late font moved the line with no writer input; the same geometry as
    // the hold row lands the page at the station.
    const { surface } = caretAt(900);
    surface.scrollTop = 0;
    expect(typewriterScroller.reflow({ y: 900, h: 16 }, surface)).toBe(true);
    expect(surface.scrollTop).toBe(365);
  });

  it("leaves a page the writer moved where they put it on a reflow", () => {
    // Off-station (the wheel) and released (a selection) are the writer's
    // own places: a font landing does not pull the page back.
    for (const state of ["offStation", "released"] as const) {
      const { surface } = caretAt(900);
      surface.scrollTop = 0;
      station.state = state;
      expect(typewriterScroller.reflow({ y: 900, h: 16 }, surface)).toBe(false);
      expect(surface.scrollTop).toBe(0);
      expect(station.state).toBe(state);
    }
  });

  it("ratchets the wheel: one line per notch, never a free run", () => {
    // The typewriter's wheel never scrolls the page natively, and the core
    // learns that before the event lands so it can `preventDefault`.
    expect(typewriterScroller.wheelPolicy()).toBe("ratchet");
  });
});
