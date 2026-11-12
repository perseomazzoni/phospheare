// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
//
// Pins the wheel ratchet as the core wires it. The core's wheel and touch
// listeners ask the strategy what a notch means: the scroll view lets it run
// (no `preventDefault`, no stepping), and the typewriter stops the native
// scroll and steps the page one visual line per notch (`writing/ratchet.ts`).
// jsdom has no layout, so the line box height is an inline `line-height` on
// the editor (the path a browser takes through computed styles), and the
// rows assert the stepping: `scrollTop` moves by that line box, the event is
// prevented, and the wheel trips the station off-station.
//
// The step is the line box, not the caret rect's height, which is the font
// box: at `--leading: 1.92` that is about half a line, so each notch would
// fall half a line short.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { TypewriterView } from "./adapters/typewriter";
import { ScrollView } from "./adapters/scroll";
import { EditorEngine } from "../engine";
import { propsFor } from "./viewProps.fixture";
import { station } from "../writing/station";
import { cancelScrollGlide } from "../writing/scrollGlide";

// jsdom has no layout and no real scrolling, so the dock's `scrollTo` would
// throw.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Element.prototype.scrollTo = () => {};

// Every page move glides (`scrollGlide.ts`); one stub frame stamped a second
// past the start completes any glide synchronously, so the assertions read
// the step that landed.
const realRaf = globalThis.requestAnimationFrame.bind(globalThis);
beforeEach(() => {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(performance.now() + 1000);
    return 0;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
  station.state = "docked";
  globalThis.requestAnimationFrame = realRaf;
  cancelScrollGlide();
});

// 19px prose at `--leading` 1.92: the line box the step travels.
const LINE = 19 * 1.92;

/** A caret rect 16px tall at viewport (4, 40): the font box, not a line box. */
function stubCaretRect() {
  Range.prototype.getClientRects = () =>
    [
      {
        left: 4,
        top: 40,
        right: 5,
        bottom: 56,
        width: 1,
        height: 16,
        x: 4,
        y: 40,
        toJSON: () => ({}),
      },
    ] as unknown as DOMRectList;
}

/** Mount the typewriter with the editor's line box supplied inline. */
function mountTypewriter() {
  stubCaretRect();
  const engine = new EditorEngine();
  engine.open("Hello world");
  const view = render(<TypewriterView {...propsFor(engine)} />);
  const editable = view.container.querySelector(
    "[contenteditable]",
  ) as HTMLElement;
  const surface = view.container.querySelector(
    ".editor-surface",
  ) as HTMLElement;
  editable.style.lineHeight = `${LINE}px`;
  editable.focus();
  const para = editable.querySelector("p");
  if (para === null)
    throw new Error("typewriter mount: no <p> under the editable");
  const text = para.firstChild as Text;
  const sel = window.getSelection();
  if (sel === null) throw new Error("typewriter mount: no selection");
  sel.removeAllRanges();
  const range = document.createRange();
  range.setStart(text, 3);
  range.collapse(true);
  sel.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
  return { engine, editable, surface };
}

/** One wheel event on the surface; returns whether the core prevented it. */
function wheel(
  surface: HTMLElement,
  deltaY: number,
  deltaMode: number,
): boolean {
  const evt = new WheelEvent("wheel", {
    deltaY,
    deltaMode,
    bubbles: true,
    cancelable: true,
  });
  surface.dispatchEvent(evt);
  return evt.defaultPrevented;
}

describe("the typewriter wheel", () => {
  it("steps the page one full line box per notch, not the font box", () => {
    const { surface } = mountTypewriter();
    const before = surface.scrollTop;
    // A line-mode notch (`deltaMode` 1) reports ±3 in Chromium, and the
    // ratchet reads it as one notch. The step is the whole line box; a caret
    // stubbed at 16px (the font box) does not shrink it to half.
    expect(wheel(surface, 3, 1)).toBe(true);
    expect(surface.scrollTop).toBe(before + LINE);
    // The writer took the page: off-station, with no quiet window involved.
    expect(station.state).toBe("offStation");
  });

  it("accumulates trackpad pixels and steps only once a full line has passed", () => {
    const { surface } = mountTypewriter();
    const before = surface.scrollTop;
    // Half a line each: the first does nothing, the second completes the step.
    expect(wheel(surface, LINE / 2, 0)).toBe(true);
    expect(surface.scrollTop).toBe(before);
    expect(wheel(surface, LINE / 2, 0)).toBe(true);
    expect(surface.scrollTop).toBe(before + LINE);
  });

  it("steps back up on the reverse notch", () => {
    const { surface } = mountTypewriter();
    const before = surface.scrollTop;
    wheel(surface, 3, 1);
    const down = surface.scrollTop;
    wheel(surface, -3, 1);
    expect(surface.scrollTop).toBe(down - LINE);
    expect(surface.scrollTop).toBeGreaterThanOrEqual(before);
  });

  it("drops the carried fraction when the prose size changes mid-accumulation", () => {
    const { editable, surface } = mountTypewriter();
    const before = surface.scrollTop;
    // 30px against the 36.48px line is a partial step, with no movement.
    expect(wheel(surface, 30, 0)).toBe(true);
    expect(surface.scrollTop).toBe(before);
    // The prose size changes mid-accumulation. The leftover was measured in
    // the old size's pixels, so it is reset and never completes against the
    // new line box: 25px at a 50px line is still partial.
    editable.style.lineHeight = "50px";
    expect(wheel(surface, 25, 0)).toBe(true);
    expect(surface.scrollTop).toBe(before);
    // Without the reset, 30 + 25 = 55px would have completed one 50px line.
    expect(wheel(surface, 25, 0)).toBe(true);
    expect(surface.scrollTop).toBe(before + 50);
  });

  it("falls back to the caret rect only when no line box can be resolved", () => {
    stubCaretRect();
    const engine = new EditorEngine();
    engine.open("Hello world");
    const view = render(<TypewriterView {...propsFor(engine)} />);
    const surface = view.container.querySelector(
      ".editor-surface",
    ) as HTMLElement;
    // jsdom resolves no stylesheet, so without an inline `line-height` the
    // computed value is "normal", and the fallback is the caret rect's
    // height.
    const before = surface.scrollTop;
    wheel(surface, 3, 1);
    expect(surface.scrollTop).toBe(before + 16);
  });
});

describe("the scroll view wheel", () => {
  it("lets the wheel mean what it always meant — no prevention, no stepping", () => {
    const engine = new EditorEngine();
    engine.open("Hello world");
    const view = render(<ScrollView {...propsFor(engine)} />);
    const editable = view.container.querySelector(
      "[contenteditable]",
    ) as HTMLElement;
    const surface = view.container.querySelector(
      ".editor-surface",
    ) as HTMLElement;
    editable.style.lineHeight = `${LINE}px`;
    editable.focus();
    const para = editable.querySelector("p");
    if (para === null)
      throw new Error("scroll mount: no <p> under the editable");
    const text = para.firstChild as Text;
    const sel = window.getSelection();
    if (sel === null) throw new Error("scroll mount: no selection");
    sel.removeAllRanges();
    const range = document.createRange();
    range.setStart(text, 3);
    range.collapse(true);
    sel.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const before = surface.scrollTop;
    expect(wheel(surface, 3, 1)).toBe(false);
    expect(surface.scrollTop).toBe(before);
  });
});
