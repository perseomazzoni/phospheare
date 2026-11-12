// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isStationProbeEnabled, paintStationProbe } from "./stationProbe";

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

function enableProbe(): void {
  window.history.replaceState({}, "", "/?debug=station");
}

function surfaceStub(
  top: number,
  height: number,
  scrollTop = 0,
  scrollHeight = 0,
) {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top,
      right: 800,
      bottom: top + height,
      width: 800,
      height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  el.scrollTop = scrollTop;
  // Getter-only on `HTMLElement` in jsdom; the probe reads them, so they are
  // stubbed like every other metric this module needs.
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    value: height,
  });
  return el;
}

describe("isStationProbeEnabled", () => {
  it("is off without the debug flag", () => {
    expect(isStationProbeEnabled()).toBe(false);
  });

  it("is on with ?debug=station", () => {
    enableProbe();
    expect(isStationProbeEnabled()).toBe(true);
  });

  it("ignores debug flags that are not the station", () => {
    window.history.replaceState({}, "", "/?debug=feeds");
    expect(isStationProbeEnabled()).toBe(false);
  });
});

describe("paintStationProbe", () => {
  it("paints nothing while disabled — the overlay costs nothing until asked", () => {
    paintStationProbe(() => ({ y: 0, h: 0 }), surfaceStub(0, 800));
    expect(document.querySelector(".station-probe")).toBeNull();
  });

  it("shows station, caret centre and a zero delta when docked", () => {
    enableProbe();
    // An 800-tall surface at 100 has its geometric midpoint at 500, but the
    // station is held at the visible centre, 43px lower, at 543.
    paintStationProbe(() => ({ y: 535, h: 16 }), surfaceStub(100, 800));
    const el = document.querySelector(".station-probe") as HTMLElement;
    expect(el.textContent).toContain("station 543.0");
    expect(el.textContent).toContain("caret   543.0");
    expect(el.textContent).toContain("delta   +0.0");
  });

  it("reports a caret below the station as a positive delta — the reported bug shape", () => {
    enableProbe();
    paintStationProbe(() => ({ y: 850, h: 16 }), surfaceStub(100, 800));
    const el = document.querySelector(".station-probe") as HTMLElement;
    expect(el.textContent).toContain("delta   +315.0");
  });

  it("shows the clamp state when the caret cannot reach the station", () => {
    enableProbe();
    // Scroll pinned at its maximum: any further dock is unsatisfiable.
    paintStationProbe(
      () => ({ y: 790, h: 16 }),
      surfaceStub(0, 800, 1200, 2000),
    );
    const el = document.querySelector(".station-probe") as HTMLElement;
    expect(el.textContent).toContain("scroll  1200 / 1200");
    expect(el.textContent).toContain("at end");
  });

  it("shows a caret tick only when a caret rect exists", () => {
    enableProbe();
    paintStationProbe(null, surfaceStub(0, 800));
    const el = document.querySelector(".station-probe") as HTMLElement;
    expect(el.textContent).toContain("caret   —");
    // The station line and the visible-centre line, and no caret tick.
    expect(el.querySelectorAll("div").length).toBe(2);
  });

  it("prints the visible centre of the page, not just the surface midpoint", () => {
    enableProbe();
    // An 800-tall surface at 100; the window is 768 tall and jsdom draws no
    // chrome, so the visible band is [100, 768], centre 434, 66px off the
    // surface midpoint of 500. The probe reports that gap as a number.
    paintStationProbe(() => ({ y: 492, h: 16 }), surfaceStub(100, 800));
    const el = document.querySelector(".station-probe") as HTMLElement;
    expect(el.textContent).toContain("visible 434.0");
  });

  it("repaints on the next call rather than stacking overlays", () => {
    enableProbe();
    paintStationProbe(() => ({ y: 392, h: 16 }), surfaceStub(0, 800));
    paintStationProbe(() => ({ y: 492, h: 16 }), surfaceStub(0, 800));
    expect(document.querySelectorAll(".station-probe").length).toBe(1);
    const el = document.querySelector(".station-probe") as HTMLElement;
    expect(el.textContent).toContain("caret   500.0");
  });
});
