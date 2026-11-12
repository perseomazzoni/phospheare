// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useFoldBehaviour } from "./foldBehaviour";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// The hook is exercised through a harness that wears the bar's real
// attributes, so the integration is under test, not a mock of the DOM the CSS
// reads. Three controls declare themselves folds, the way the bar composes
// them: the two folding tracks and the save/autosave reveal. A bar subpanel
// (find/chars) sits in the same bar-stack, as in the editor.
function Harness({ delays }: { delays?: Record<string, number> } = {}) {
  const { barRef, open, engaged } = useFoldBehaviour(delays);
  const openFor = (name: string) => (open(name) ? "1" : "0");
  return (
    <div className="bar-stack">
      <div ref={barRef} data-testid="bar" data-engaged={engaged ? "1" : "0"}>
        <div className="ed-fold" data-fold="block" data-open={openFor("block")}>
          {/* A cell, so a tap that chose a face can be told from a tap on the
              fold's own box. In the bar these are the track's buttons. */}
          <button type="button" data-testid="block-h1">
            H1
          </button>
        </div>
        <div
          className="ed-fold"
          data-fold="align"
          data-open={openFor("align")}
        />
        <div
          className="ed-save-wrap"
          data-fold="save"
          data-open={openFor("save")}
        />
      </div>
      <div className="ed-drop" data-bar-panel data-open="0" />
    </div>
  );
}

const bar = () => document.querySelector('[data-testid="bar"]') as HTMLElement;
const block = () =>
  document.querySelector('[data-fold="block"]') as HTMLElement;
const align = () =>
  document.querySelector('[data-fold="align"]') as HTMLElement;
const save = () => document.querySelector('[data-fold="save"]') as HTMLElement;
const panel = () => document.querySelector("[data-bar-panel]") as HTMLElement;
const open = (el: HTMLElement) => el.getAttribute("data-open");

const tick = (ms: number) => {
  void act(() => vi.advanceTimersByTime(ms));
};

describe("useFoldBehaviour · latched", () => {
  beforeEach(() => vi.useFakeTimers());

  it("opens nothing on bar entry alone", () => {
    render(<Harness />);
    fireEvent.pointerEnter(bar());
    expect(open(block())).toBe("0");
    expect(open(align())).toBe("0");
    expect(open(save())).toBe("0");
  });

  it("opens a fold 80ms after the pointer reaches it", () => {
    render(<Harness />);
    fireEvent.pointerEnter(bar());
    fireEvent.pointerOver(block());
    tick(79);
    expect(open(block())).toBe("0");
    tick(1);
    expect(open(block())).toBe("1");
  });

  it("cancels the open when the pointer passes a fold in mid-intent", () => {
    render(<Harness />);
    fireEvent.pointerEnter(bar());
    fireEvent.pointerOver(block());
    fireEvent.pointerOut(block(), { relatedTarget: bar() });
    tick(120);
    expect(open(block())).toBe("0");
  });

  it("stays open after the fold is left - that is the latch", () => {
    render(<Harness />);
    fireEvent.pointerEnter(bar());
    fireEvent.pointerOver(block());
    tick(80);
    fireEvent.pointerOut(block(), { relatedTarget: bar() });
    tick(300);
    expect(open(block())).toBe("1");
  });

  it("opens the second fold without shutting the first", () => {
    render(<Harness />);
    fireEvent.pointerEnter(bar());
    fireEvent.pointerOver(block());
    tick(80);
    fireEvent.pointerOver(align());
    tick(80);
    expect(open(block())).toBe("1");
    expect(open(align())).toBe("1");
  });

  it("collapses both folds on bar exit", () => {
    render(<Harness />);
    fireEvent.pointerEnter(bar());
    fireEvent.pointerOver(block());
    fireEvent.pointerOver(align());
    tick(80);
    fireEvent.pointerLeave(bar());
    tick(200);
    expect(open(block())).toBe("0");
    expect(open(align())).toBe("0");
  });

  it("reveals the autosave switch the same way", () => {
    render(<Harness />);
    fireEvent.pointerEnter(bar());
    fireEvent.pointerOver(save());
    tick(80);
    expect(open(save())).toBe("1");
    expect(open(block())).toBe("0");
  });

  it("opens a fold on its own declared delay, not the shared 80ms", () => {
    // The autosave reveal waits a second: its hover-intent delay is declared
    // per fold, and the shared intent does not leak in.
    render(<Harness delays={{ save: 1000 }} />);
    fireEvent.pointerEnter(bar());
    fireEvent.pointerOver(save());
    tick(999);
    expect(open(save())).toBe("0");
    tick(1);
    expect(open(save())).toBe("1");
  });

  it("keeps the shared intent delay for a fold without its own", () => {
    render(<Harness delays={{ save: 1000 }} />);
    fireEvent.pointerEnter(bar());
    fireEvent.pointerOver(block());
    tick(80);
    expect(open(block())).toBe("1");
  });

  it("still opens a delayed fold on focus, without waiting its hover delay", () => {
    // The second is a mouse intent; a keyboard user has already said which
    // control they want, so tabbing in opens the reveal immediately.
    render(<Harness delays={{ save: 1000 }} />);
    fireEvent.focusIn(save());
    expect(open(save())).toBe("1");
  });

  it("cancels the close when the pointer comes back within the grace", () => {
    render(<Harness />);
    fireEvent.pointerEnter(bar());
    fireEvent.pointerOver(block());
    tick(80);
    expect(open(block())).toBe("1");
    fireEvent.pointerLeave(bar());
    tick(150);
    fireEvent.pointerEnter(bar());
    tick(400);
    expect(open(block())).toBe("1");
  });

  it("lifts the bar on hover before anything has opened", () => {
    render(<Harness />);
    expect(bar().getAttribute("data-engaged")).toBe("0");
    fireEvent.pointerEnter(bar());
    // The bar is engaged the moment the pointer reaches it; the z-index lift
    // does not wait for a fold to open.
    expect(bar().getAttribute("data-engaged")).toBe("1");
    expect(open(block())).toBe("0");
    fireEvent.pointerLeave(bar());
    tick(200);
    expect(bar().getAttribute("data-engaged")).toBe("0");
  });

  it("opens the fold a focused cell belongs to", () => {
    render(<Harness />);
    fireEvent.pointerEnter(bar());
    fireEvent.focusIn(align());
    expect(open(align())).toBe("1");
    expect(open(block())).toBe("0");
  });

  it("holds the bar open while a fold keeps focus even after the pointer leaves", () => {
    render(<Harness />);
    fireEvent.pointerEnter(bar());
    fireEvent.focusIn(block());
    fireEvent.pointerLeave(bar());
    tick(400);
    expect(open(block())).toBe("1");
    fireEvent.focusOut(block(), { relatedTarget: document.body });
    tick(200);
    expect(open(block())).toBe("0");
  });
});

// A panel the bar grew, find or the character keys, holds the bar's state for
// as long as it is open: it keeps whatever was open open and keeps the bar
// lifted, without inflating anything itself. jsdom's own `MutationObserver`
// never delivers a callback, so a fake stands in and the tests hand it the
// mutation a browser would report. It also records how the real one is
// configured: a browser needs the `subtree` bit to see the panels'
// `data-open` at all, so it is asserted.
class FakeMO {
  static instances: FakeMO[] = [];
  static options: MutationObserverInit[] = [];
  callback: MutationCallback;
  constructor(callback: MutationCallback) {
    this.callback = callback;
    FakeMO.instances.push(this);
  }
  observe(_target: Node, options?: MutationObserverInit) {
    FakeMO.options.push(options ?? {});
  }
  disconnect() {}
  takeRecords() {
    return [];
  }
}

describe("useFoldBehaviour · held open by a bar subpanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("MutationObserver", FakeMO);
    FakeMO.instances = [];
    FakeMO.options = [];
  });
  afterEach(() => vi.unstubAllGlobals());

  const openPanel = () =>
    act(() => {
      panel().setAttribute("data-open", "1");
      last().callback([], {} as unknown as MutationObserver);
    });
  const closePanel = () =>
    act(() => {
      panel().setAttribute("data-open", "0");
      last().callback([], {} as unknown as MutationObserver);
    });
  const last = () => FakeMO.instances[FakeMO.instances.length - 1];

  it("watches the panels’ open state on the whole stack, not just the stack’s own attributes", () => {
    render(<Harness />);
    expect(FakeMO.options[0]).toMatchObject({
      attributes: true,
      attributeFilter: ["data-open"],
      subtree: true,
    });
  });

  it("does not inflate the bar on its own — a panel keeps the bar’s state, not an all-open", () => {
    render(<Harness />);
    expect(bar().getAttribute("data-engaged")).toBe("0");
    openPanel();
    // The bar stays at rest: only the engagement (the lift) appears.
    expect(open(block())).toBe("0");
    expect(open(align())).toBe("0");
    expect(open(save())).toBe("0");
    expect(bar().getAttribute("data-engaged")).toBe("1");
  });

  it("keeps a fold open that was reached before the panel opened, while the panel holds it", () => {
    render(<Harness />);
    fireEvent.pointerEnter(bar());
    fireEvent.pointerOver(block());
    tick(80);
    expect(open(block())).toBe("1");
    openPanel();
    fireEvent.pointerLeave(bar());
    tick(400);
    // The latch survives the panel and the pointer's exit, because the panel
    // blocks the collapse, but the untouched folds stay closed.
    expect(open(block())).toBe("1");
    expect(open(align())).toBe("0");
    expect(bar().getAttribute("data-engaged")).toBe("1");
  });

  it("lets the writer expand a fold while the panel is open", () => {
    render(<Harness />);
    openPanel();
    fireEvent.pointerEnter(bar());
    fireEvent.pointerOver(align());
    tick(80);
    expect(open(align())).toBe("1");
    expect(open(block())).toBe("0");
  });

  it("shuts the bar once the panel closes with the pointer away", () => {
    render(<Harness />);
    openPanel();
    closePanel();
    expect(open(block())).toBe("0");
    expect(bar().getAttribute("data-engaged")).toBe("0");
  });
});

// The tap opens a fold on a screen with no hover: the row is
// `pointer-events: none` until `:hover`, `:focus-within` or `data-open`, and
// the fallback is a modifier a soft keyboard cannot produce.
//
// The desktop behaviour does not change, and the guard is the gesture rather
// than the device, so the first row presses with a mouse and asserts that
// nothing new happens.

/** A finger. `pointerdown` is what carries the type; `click` is what acts. */
function tap(el: HTMLElement) {
  void act(() => {
    fireEvent.pointerDown(el, { pointerType: "touch" });
    fireEvent.click(el);
  });
}

/** The same two events from a mouse, which keep the desktop behaviour. */
function mouseClick(el: HTMLElement) {
  void act(() => {
    fireEvent.pointerDown(el, { pointerType: "mouse" });
    fireEvent.click(el);
  });
}

describe("useFoldBehaviour · the tap", () => {
  beforeEach(() => vi.useFakeTimers());

  it("leaves a mouse press alone — the desk is unchanged", () => {
    render(<Harness />);
    mouseClick(block());
    expect(open(block())).toBe("0");
    expect(bar().getAttribute("data-engaged")).toBe("0");
  });

  it("opens a fold on a tap", () => {
    render(<Harness />);
    tap(block());
    expect(open(block())).toBe("1");
  });

  it("survives the finger lifting, which is a pointerleave", () => {
    // The tap is not another member of `hovered`. A tap fires `pointerover`
    // on the way in and `pointerleave` on the way out, so the hover path alone
    // would open the fold at 80ms and shut it 200ms later. A fold that closes
    // when the finger that opened it lifts has not opened.
    render(<Harness />);
    tap(block());
    void act(() => fireEvent.pointerLeave(bar()));
    tick(400);
    expect(open(block())).toBe("1");
  });

  it("opens one fold at a time", () => {
    // The tap's own rule. Hovering two folds on a desk still opens both: that
    // is the latch.
    render(<Harness />);
    tap(block());
    tap(align());
    expect(open(align())).toBe("1");
    expect(open(block())).toBe("0");
  });

  it("closes on a second tap on the same fold", () => {
    render(<Harness />);
    tap(block());
    tap(block());
    expect(open(block())).toBe("0");
  });

  it("closes when a face is chosen", () => {
    // The cell's own button applies the change; the fold gets out of the way,
    // which is what a writer expects from a menu they have just answered.
    render(<Harness />);
    tap(block());
    tap(document.querySelector('[data-testid="block-h1"]') as HTMLElement);
    expect(open(block())).toBe("0");
  });

  it("closes on a tap elsewhere in the bar", () => {
    render(<Harness />);
    tap(block());
    tap(save());
    expect(open(block())).toBe("0");
  });

  it("closes on a press outside the bar", () => {
    // The exit the desk gets from `pointerleave` and a finger never will.
    render(<Harness />);
    tap(block());
    tick(1);
    void act(() => {
      document.body.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(open(block())).toBe("0");
  });

  // A touch screen's emulated mouse stays where the finger lifted, and the row
  // the tap opened grows under it, so a mouse `pointerover` lands inside the
  // open fold. The press outside closes that hover too, whether its open has
  // landed or is still on its way.
  const pressOutside = () =>
    void act(() => {
      document.body.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true }),
      );
    });

  it("stays closed when a hover that began inside the open fold lands late", () => {
    render(<Harness />);
    tap(block());
    tick(1);
    void act(() =>
      fireEvent.pointerOver(
        document.querySelector('[data-testid="block-h1"]') as HTMLElement,
      ),
    );
    pressOutside();
    tick(400);
    expect(open(block())).toBe("0");
  });

  it("closes a hover that landed inside the open fold before the press", () => {
    render(<Harness />);
    tap(block());
    tick(1);
    void act(() =>
      fireEvent.pointerOver(
        document.querySelector('[data-testid="block-h1"]') as HTMLElement,
      ),
    );
    tick(100);
    pressOutside();
    expect(open(block())).toBe("0");
  });

  it("spends Escape on the fold and no further", () => {
    // One press, one layer.
    render(<Harness />);
    tap(block());
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    void act(() => fireEvent.keyDown(bar(), { key: "Escape" }));
    document.removeEventListener("keydown", outer);
    expect(open(block())).toBe("0");
    expect(outer).not.toHaveBeenCalled();
  });

  it("lifts the bar while a tapped fold is open", () => {
    // The z-index lift is what puts the bar over the panels. A fold expanded
    // under the structure panel is a row the writer cannot reach.
    render(<Harness />);
    tap(block());
    void act(() => fireEvent.pointerLeave(bar()));
    tick(400);
    expect(bar().getAttribute("data-engaged")).toBe("1");
  });
});
