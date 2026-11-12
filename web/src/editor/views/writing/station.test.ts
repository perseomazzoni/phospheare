// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QuietWindow,
  StationMachine,
  dockDelta,
  feedDepths,
  isAtStation,
  stationY,
  stationOffset,
  STATION_CHROME_HALF,
  chromeFromSpans,
  DESKTOP_CHROME,
  PHONE_CHROME,
  withKeyboard,
} from "./station";
import { cancelScrollGlide } from "./scrollGlide";

// The dock glides (`scrollGlide.ts`), so every test that moves the page lets
// the animation finish. One stub frame, stamped a second past the start,
// completes any glide synchronously; `cancelScrollGlide` clears the in-flight
// state between tests.
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
  vi.restoreAllMocks();
});

describe("the chrome offset", () => {
  // 43 is titlebar 40 plus bar 46, halved, which holds only while all the
  // chrome is above the prose. The phone plane puts it at the bottom edge,
  // where the same reasoning gives the opposite sign.
  it("is half the chrome above, when all the chrome is above", () => {
    expect(stationOffset({ top: 86, bottom: 0 })).toBe(43);
    expect(STATION_CHROME_HALF).toBe(43);
  });

  it("rises when the chrome is below instead — the phone plane", () => {
    // Zero top chrome and a 44px bar at the bottom: the visible centre is
    // 22px above the box's midpoint, so the station follows it up.
    expect(stationOffset({ top: 0, bottom: 44 })).toBe(-22);
    expect(stationY({ top: 0, height: 1000 }, { top: 0, bottom: 44 })).toBe(
      478,
    );
  });

  // The product's two planes as numbers. 86 is titlebar 40 plus bar 46; 68
  // is the bar's `--tap` 44 with its 12 of padding and border, plus the 12
  // the row holds it off the edge.
  //
  // These are the fallback, not the truth: the chrome is measured in the DOM
  // and handed in (`chromeFromSpans`, `useChromeInset`), because declared
  // constants go stale silently when other changes move the chrome.
  // They describe each plane's chrome under a mouse, and the
  // station uses them for the frames before there is a surface to measure.
  it("names both planes, and they lean opposite ways", () => {
    expect(DESKTOP_CHROME).toEqual({ top: 86, bottom: 0 });
    expect(PHONE_CHROME).toEqual({ top: 0, bottom: 68 });
    expect(stationOffset(DESKTOP_CHROME)).toBeGreaterThan(0);
    expect(stationOffset(PHONE_CHROME)).toBeLessThan(0);
  });

  // The cases below are measurements off real device profiles, except the
  // one marked as constructed.

  // iPad mini and phone landscape are coarse and wide, so they take the desk
  // branch and draw a titlebar at 48 rather than 40, because the shared band
  // grows to hold a 44px control. The declared 86 is 104 there, and
  // half that difference would put the station 9px off.
  it("adds up a stack that floats above the prose", () => {
    expect(
      chromeFromSpans({ top: 0, bottom: 1024 }, 1024, [
        { top: 0, bottom: 48 },
        { top: 48, bottom: 104 },
      ]),
    ).toEqual({ top: 104, bottom: 0 });
  });

  // The same call on the other plane: on a phone the titlebar collapses to
  // nothing and the bar row sits at the foot. Measured at 375x667. A
  // function that assumed "above" would be 68px wrong here.
  it("puts the same stack below when that is where it sits", () => {
    expect(
      chromeFromSpans({ top: 0, bottom: 667 }, 667, [
        { top: 0, bottom: 0 },
        { top: 599, bottom: 667 },
      ]),
    ).toEqual({ top: 0, bottom: 68 });
  });

  // A part with no height hides no surface. That is how the phone's
  // collapsed titlebar arrives, and how a bar that has not mounted yet does:
  // the editor holds on entry, so the core is measured before its chrome
  // exists.
  it("skips a piece with no height, and tolerates one that is absent", () => {
    expect(
      chromeFromSpans({ top: 0, bottom: 800 }, 800, [
        null,
        undefined,
        { top: 0, bottom: 0 },
      ]),
    ).toEqual({ top: 0, bottom: 0 });
  });

  // Constructed rather than measured: no profile gives the surface more
  // height than the window. It pins the two halves of the function agreeing
  // on where the middle is; a surface twice the window's height would put its
  // own midpoint below the fold, and a bar pinned to the window's bottom
  // would be classified as sitting in the top half.
  it("measures against the visible surface, not the part below the fold", () => {
    expect(
      chromeFromSpans({ top: 0, bottom: 2000 }, 400, [
        { top: 340, bottom: 400 },
      ]),
    ).toEqual({ top: 0, bottom: 60 });
  });

  // The furthest extent, never the sum: the stack is drawn flush, so adding
  // 48 and 56 would charge 104 for a chrome that ends at 104.
  it("takes the furthest extent of an overlapping stack", () => {
    expect(
      chromeFromSpans({ top: 0, bottom: 1000 }, 1000, [
        { top: 0, bottom: 104 },
        { top: 48, bottom: 104 },
      ]),
    ).toEqual({ top: 104, bottom: 0 });
  });

  // A keyboard is surface the writer cannot see, so it is chrome, and the
  // largest piece of it: 336 of a 667px phone. It does not resize the page,
  // so nothing else in the geometry notices it, and a station that ignored
  // it would centre the caret in a page whose bottom half is under the keys.
  it("counts the keyboard as chrome along the bottom", () => {
    expect(withKeyboard(PHONE_CHROME, 336)).toEqual({ top: 0, bottom: 404 });
    // A tablet is a desk by width and gets a keyboard all the same, so this is
    // not a phone-plane rule.
    expect(withKeyboard(DESKTOP_CHROME, 336)).toEqual({ top: 86, bottom: 336 });
  });

  it("is the same chrome when there is no keyboard", () => {
    // Identity: `EditorCore` assigns the result on every plane or keyboard
    // change, and a fresh object would be a new assignment for a value that
    // did not move.
    expect(withKeyboard(DESKTOP_CHROME, 0)).toBe(DESKTOP_CHROME);
  });

  it("raises the station by half the keyboard", () => {
    // The visible band's centre, not the page's. On a 667px phone with the
    // keys up the station moves from 299 to 131, 168px or half of 336, which
    // keeps the caret's line visible.
    const box = { top: 0, height: 667 };
    expect(stationY(box, PHONE_CHROME)).toBe(299.5);
    expect(stationY(box, withKeyboard(PHONE_CHROME, 336))).toBe(131.5);
  });

  it("cancels when both edges hide the same amount", () => {
    // No plane has this state, and the arithmetic needs no special case:
    // with equal occlusion the geometric midpoint is the visible centre.
    expect(stationOffset({ top: 44, bottom: 44 })).toBe(0);
  });
});

describe("stationY", () => {
  it("is the vertical centre of the *visible* page, below the chrome", () => {
    // A 1000-tall surface at the top of the window: its geometric midpoint is
    // 500, but the top 86px hide behind the floating chrome, so the visible
    // middle, where the station is held, is 43px lower.
    expect(stationY({ top: 0, height: 1000 })).toBe(543);
    expect(stationY({ top: 200, height: 800 })).toBe(643);
  });
});

describe("dockDelta", () => {
  it("measures from the caret rect centre, not its top", () => {
    // A collapsed range's rect is the font box, and with real leading the
    // glyphs sit below it, so aligning its top leaves the line off the
    // station. The centre is `pos.y + pos.h / 2`.
    const box = { top: 0, height: 1000 }; // station at 543 (visible centre)
    expect(dockDelta({ y: 900, h: 16 }, box)).toBe(365); // centre 908 - 543
    expect(dockDelta({ y: 535, h: 16 }, box)).toBe(0); // centre 543 - 543
    expect(dockDelta({ y: 492, h: 16 }, box)).toBe(-43); // centre 500 - 543
  });
});

describe("isAtStation", () => {
  it("treats sub-pixel deltas as already docked", () => {
    expect(isAtStation(0)).toBe(true);
    expect(isAtStation(0.4)).toBe(true);
    expect(isAtStation(-0.99)).toBe(true);
    expect(isAtStation(1)).toBe(false);
    expect(isAtStation(-40)).toBe(false);
  });
});

describe("feedDepths", () => {
  it("is half the scroller each way, so the first and last line can reach the station", () => {
    expect(feedDepths(1000)).toEqual({ top: 500, bottom: 500 });
    expect(feedDepths(0)).toEqual({ top: 0, bottom: 0 });
  });
});

describe("QuietWindow", () => {
  it("quiets the 90ms instant window after a dock", () => {
    const q = new QuietWindow();
    q.extend(1000);
    expect(q.isQuiet(1000)).toBe(true);
    expect(q.isQuiet(1089)).toBe(true);
    expect(q.isQuiet(1090)).toBe(false);
  });
});

describe("StationMachine.dock", () => {
  const box = () =>
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

  function surfaceStub(scrollTop = 0) {
    const el = document.createElement("div");
    el.getBoundingClientRect = box;
    el.scrollTop = scrollTop;
    el.scrollTo = vi.fn((opts: ScrollToOptions) => {
      if (typeof opts.top === "number") el.scrollTop = opts.top;
    }) as unknown as typeof el.scrollTo;
    return el;
  }

  afterEach(() => vi.restoreAllMocks());

  // The machine carries the plane's chrome as state because the caller that
  // docks, `typewriterScroller.ts`, is a module object that cannot see a
  // React hook. The same caret on the same surface gets a station 77px apart
  // depending on where the chrome stands.
  it("docks to the plane it was told it is on", () => {
    const desk = new StationMachine();
    const phone = new StationMachine();
    phone.chrome = PHONE_CHROME;
    const caret = { y: 400, h: 16 };

    const deskSurface = surfaceStub(0);
    desk.dock(deskSurface, caret, 1000);
    const phoneSurface = surfaceStub(0);
    phone.dock(phoneSurface, caret, 1000);

    // Desk: station at 500 + 43. Phone: 500 - 34. The caret is the same, so
    // the whole 77px difference is the chrome moving edges.
    expect(deskSurface.scrollTop).toBe(408 - 543);
    expect(phoneSurface.scrollTop).toBe(408 - 466);
    expect(deskSurface.scrollTop - phoneSurface.scrollTop).toBe(-77);
  });

  it("holds the docked invariant at the first line of a Section", () => {
    const m = new StationMachine();
    const surface = surfaceStub(0);
    // The very first line, near the top of an otherwise empty scroller,
    // reachable only because of the paper feed that `feedDepths` sizes.
    const moved = m.dock(surface, { y: 40, h: 16 }, 1000);
    expect(moved).toBe(true);
    expect(m.state).toBe("docked");
    // The glide completes on the stub frame, so the page is at the station:
    // target = scrollTop + delta.
    expect(surface.scrollTop).toBe(40 + 8 - 543);
  });

  it("holds the docked invariant at the last line of a Section", () => {
    const m = new StationMachine();
    const surface = surfaceStub(2000);
    const moved = m.dock(surface, { y: 960, h: 16 }, 1000);
    expect(moved).toBe(true);
    expect(surface.scrollTop).toBe(2000 + (960 + 8 - 543));
  });

  it("holds the docked invariant for an empty paragraph (a lone <br>)", () => {
    // An empty paragraph's measured rect has a real height (the probe
    // character in `measureCaretRect`), so nothing here special-cases it.
    const m = new StationMachine();
    const surface = surfaceStub(500);
    m.dock(surface, { y: 500, h: 22 }, 1000);
    expect(surface.scrollTop).toBe(500 + (500 + 11 - 543));
  });

  it("re-stations instantly after a prose-size change moves the caret rect", () => {
    const m = new StationMachine();
    const surface = surfaceStub(0);
    m.dock(surface, { y: 535, h: 16 }, 1000); // centre 543 — already docked, no-op
    expect(surface.scrollTop).toBe(0);
    // Prose size grows: the same logical line now measures a taller rect and
    // sits off-centre until the next dock.
    const moved = m.dock(surface, { y: 543, h: 24 }, 1001);
    expect(moved).toBe(true);
    expect(surface.scrollTop).toBe(12);
  });

  it("is a no-op, but still reports docked, once the caret is already centred", () => {
    const m = new StationMachine();
    const surface = surfaceStub(0);
    const moved = m.dock(surface, { y: 535, h: 16 }, 1000); // centre 543
    expect(moved).toBe(false);
    expect(m.state).toBe("docked");
    expect(surface.scrollTop).toBe(0);
  });
});

describe("StationMachine — released and off-station", () => {
  it("releases on a live selection, and a subsequent dock re-engages", () => {
    const m = new StationMachine();
    m.release();
    expect(m.state).toBe("released");
    const surface = document.createElement("div");
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
    surface.scrollTo = vi.fn() as unknown as typeof surface.scrollTo;
    m.dock(surface, { y: 492, h: 16 }, 1000);
    expect(m.state).toBe("docked");
  });

  it("a scroll inside our own quiet window does not trip off-station", () => {
    const m = new StationMachine();
    const surface = document.createElement("div");
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
    surface.scrollTo = vi.fn() as unknown as typeof surface.scrollTo;
    m.dock(surface, { y: 900, h: 16 }, 1000); // glide quiets until 1340
    m.noteScroll(1050);
    expect(m.state).toBe("docked");
  });

  it("a scroll outside the quiet window trips off-station", () => {
    const m = new StationMachine();
    const surface = document.createElement("div");
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
    surface.scrollTo = vi.fn() as unknown as typeof surface.scrollTo;
    m.dock(surface, { y: 900, h: 16 }, 1000); // glide quiets until 1340
    m.noteScroll(1400);
    expect(m.state).toBe("offStation");
  });

  it("a synthetic wheel event trips off-station unconditionally — no quiet window involved", () => {
    const m = new StationMachine();
    expect(m.state).toBe("docked");
    m.noteWheel();
    expect(m.state).toBe("offStation");
  });
});
