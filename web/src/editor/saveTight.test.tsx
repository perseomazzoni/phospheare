// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { useSaveTight } from "./saveTight";

// jsdom has no ResizeObserver; the repo guards with a feature check, and this
// test stands in with a fake that hands the callbacks back so the measure can
// be fired on demand.
class FakeRO {
  static instances: FakeRO[] = [];
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeRO.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

// The bar lives in a stack in the centring row; the hook measures against the
// stack's cap where it declares one (the desk's `max-width`) and the row's
// width where it does not — the bar's own box only grows with its content.
function Harness({ cap }: { cap?: number }) {
  const barRef = useRef<HTMLDivElement>(null);
  const { tight } = useSaveTight(barRef);
  return (
    <div className="bar-row">
      <div
        className="bar-stack"
        style={cap === undefined ? undefined : { maxWidth: `${cap}px` }}
      >
        <div
          ref={barRef}
          data-testid="bar"
          data-save-tight={tight ? "1" : undefined}
        >
          <div className="ed-save-wrap">
            <button className="ed-save">
              <span className="ed-save-label">Saved · 14:32</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const bar = () => document.querySelector('[data-testid="bar"]') as HTMLElement;
const label = () => document.querySelector(".ed-save-label") as HTMLElement;
const attr = () => bar().getAttribute("data-save-tight");

const setWidths = (scroll: number, barClient: number, rowClient: number) => {
  Object.defineProperty(bar(), "scrollWidth", {
    value: scroll,
    configurable: true,
  });
  Object.defineProperty(bar(), "clientWidth", {
    value: barClient,
    configurable: true,
  });
  Object.defineProperty(
    document.querySelector(".bar-row") as HTMLElement,
    "clientWidth",
    {
      value: rowClient,
      configurable: true,
    },
  );
};
const setLabelW = (w: number) => {
  Object.defineProperty(label(), "offsetWidth", {
    value: w,
    configurable: true,
  });
};
const fire = () =>
  act(() => {
    FakeRO.instances.forEach((ro) =>
      ro.callback([], ro as unknown as ResizeObserver),
    );
  });

describe("useSaveTight", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", FakeRO);
    FakeRO.instances = [];
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the word while the bar fits the row", () => {
    render(<Harness />);
    setLabelW(90);
    setWidths(500, 500, 600);
    fire();
    expect(attr()).toBeNull();
  });

  it("collapses the label the moment the bar overflows the row with it showing", () => {
    render(<Harness />);
    setLabelW(90);
    setWidths(560, 500, 500);
    fire();
    expect(attr()).toBe("1");
  });

  it("stays collapsed while the label alone would re-overflow the bar", () => {
    render(<Harness />);
    setLabelW(90);
    setWidths(560, 500, 500);
    fire();
    expect(attr()).toBe("1");
    // The collapse reclaimed the label, so the bar fits; bringing the word
    // back would overflow it again, so it stays collapsed.
    setWidths(500, 500, 500);
    fire();
    expect(attr()).toBe("1");
  });

  it("restores the word only when there is room for it", () => {
    render(<Harness />);
    setLabelW(90);
    setWidths(560, 500, 500);
    fire();
    // Still not enough room (520 + 90 > 500).
    setWidths(520, 500, 500);
    fire();
    expect(attr()).toBe("1");
    // Now the row has room even with the word back (500 + 90 <= 600).
    setWidths(500, 500, 600);
    fire();
    expect(attr()).toBeNull();
  });

  it("shows the word again once a wide row has room, however narrow the bar box is", () => {
    render(<Harness />);
    setLabelW(90);
    // Overflows the row -> collapse, even though the bar's own box is small.
    setWidths(560, 400, 500);
    fire();
    expect(attr()).toBe("1");
    // The row widens; the bar box is unchanged but the label now fits.
    setWidths(560, 400, 700);
    fire();
    expect(attr()).toBeNull();
  });

  it("re-measures on a window resize", () => {
    render(<Harness />);
    setLabelW(90);
    setWidths(560, 500, 500);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(attr()).toBe("1");
  });

  it("starts collapsed when the bar already overflows on mount", () => {
    // The mount measure must catch pre-existing overflow, so the geometry is
    // in place before the hook's effect first reads it — stubbed on the
    // prototype, since the elements do not exist yet.
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const have = (p: string) => Object.getOwnPropertyDescriptor(proto, p);
    const scroll = have("scrollWidth");
    const client = have("clientWidth");
    const off = have("offsetWidth");
    Object.defineProperty(proto, "scrollWidth", {
      get: () => 560,
      configurable: true,
    });
    Object.defineProperty(proto, "clientWidth", {
      get: () => 500,
      configurable: true,
    });
    Object.defineProperty(proto, "offsetWidth", {
      get: () => 90,
      configurable: true,
    });
    try {
      render(<Harness />);
      expect(attr()).toBe("1");
    } finally {
      const restore = (p: string, d: PropertyDescriptor | undefined) => {
        if (d) Object.defineProperty(proto, p, d);
        else delete proto[p];
      };
      restore("scrollWidth", scroll);
      restore("clientWidth", client);
      restore("offsetWidth", off);
    }
  });

  it("keeps the word while an open fold is what overflows the bar", () => {
    render(<Harness />);
    const fold = document.createElement("div");
    fold.className = "ed-fold";
    const face = document.createElement("span");
    face.className = "ed-fold-face";
    fold.appendChild(face);
    bar().appendChild(fold);
    Object.defineProperty(fold, "offsetWidth", { value: 132 });
    Object.defineProperty(face, "offsetWidth", { value: 34 });
    setLabelW(90);
    // 560 open is 462 at rest, inside the 500 row.
    setWidths(560, 500, 500);
    fire();
    expect(attr()).toBeNull();
  });

  it("holds through a save, and measures the settled chip", async () => {
    render(<Harness />);
    const chip = document.querySelector(".ed-save") as HTMLElement;
    setLabelW(90);
    setWidths(480, 480, 500);
    fire();
    expect(attr()).toBeNull();
    // The tick beside the word overflows the row for the confirmation's
    // moment; the chip does not fold for it.
    await act(async () => {
      chip.setAttribute("data-state", "saved");
      await Promise.resolve();
    });
    setWidths(520, 500, 500);
    fire();
    expect(attr()).toBeNull();
    // Settled, the chip is measured as it is.
    setWidths(560, 500, 500);
    await act(async () => {
      chip.setAttribute("data-state", "clean");
      await Promise.resolve();
    });
    expect(attr()).toBe("1");
  });

  it("restores the word when a dragged Dock gives the room back", async () => {
    // A drag writes the Dock's width into the shell's `style` and resizes
    // nothing the bar observes, so the shell's style is what re-measures.
    function Shell() {
      const barRef = useRef<HTMLDivElement>(null);
      const { tight } = useSaveTight(barRef);
      return (
        <div className="editor-shell" data-dock="1">
          <div className="doc-tree" />
          <div className="bar-row">
            <div
              ref={barRef}
              data-testid="bar"
              data-save-tight={tight ? "1" : undefined}
            >
              <span className="ed-save-label">Saved · 14:32</span>
            </div>
          </div>
          <div className="ed-dock" />
        </div>
      );
    }
    render(<Shell />);
    const shell = document.querySelector(".editor-shell") as HTMLElement;
    const panel = document.querySelector(".doc-tree") as HTMLElement;
    const dock = document.querySelector(".ed-dock") as HTMLElement;
    panel.getBoundingClientRect = () => ({ right: 200 }) as DOMRect;
    let dockLeft = 716; // room 716 - 200 - 16 = 500
    dock.getBoundingClientRect = () => ({ left: dockLeft }) as DOMRect;
    setLabelW(90);
    setWidths(560, 560, 2000);
    fire();
    expect(attr()).toBe("1");
    // Folded, the bar is 470; the Dock narrows to a room of 600.
    setWidths(470, 470, 2000);
    dockLeft = 816;
    await act(async () => {
      shell.style.setProperty("--dock-w", "300px");
      await Promise.resolve();
    });
    expect(attr()).toBeNull();
  });

  it("restores the word against the stack's cap, not the whole row", () => {
    // On a desk the stack is capped (`.bar-stack`'s `max-width`) well inside
    // a row as wide as the window, and the cap is the room the bar can grow
    // to. Measured against the row instead, the word would come back into a
    // bar that then overflows its cap and scrolls.
    render(<Harness cap={600} />);
    setLabelW(90);
    setWidths(560, 500, 1000);
    fire();
    expect(attr()).toBe("1");
    // The row has room for 560 + 90; the cap does not.
    fire();
    expect(attr()).toBe("1");
    // 500 + 90 fits the cap.
    setWidths(500, 500, 1000);
    fire();
    expect(attr()).toBeNull();
  });
});
