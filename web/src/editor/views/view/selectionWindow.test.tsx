// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ScrollView } from "./adapters/scroll";
import { EditorEngine } from "../engine";
import { propsFor } from "./viewProps.fixture";

// Pins a selection made while the core is settling a patch. After a patch
// the core ignores `selectionchange` for two frames, so its own restore is
// not taken for a move of the writer's. A selection the writer makes inside
// those frames is turned away too, and `selectionchange` fires once, so
// when the frames end the page's selection is read again if one was turned
// away. Otherwise the engine keeps the old caret while the page shows the
// new selection, and the margin silently refuses a comment on it.

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
Element.prototype.scrollTo = () => {};

const realRaf = globalThis.requestAnimationFrame.bind(globalThis);
let frames: FrameRequestCallback[] = [];

/** Run every frame queued so far, and the ones they queue, to the end. */
function flushFrames() {
  for (let round = 0; round < 10 && frames.length > 0; round += 1) {
    const now = frames;
    frames = [];
    for (const frame of now) frame(performance.now());
  }
}

beforeEach(() => {
  frames = [];
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
  globalThis.requestAnimationFrame = realRaf;
});

function mount() {
  const engine = new EditorEngine();
  engine.open("Hello world\n\nSecond line\n");
  const view = render(<ScrollView {...propsFor(engine)} />);
  const editable = view.container.querySelector(
    "[contenteditable]",
  ) as HTMLElement;
  editable.focus();
  flushFrames();
  return { engine, editable };
}

/** Selects `length` characters of paragraph `index` from `start`, in the
 * page. */
function selectInPage(
  editable: HTMLElement,
  index: number,
  start: number,
  length: number,
) {
  const text = editable.querySelectorAll("p")[index]?.firstChild;
  if (!text) throw new Error(`no text in paragraph ${index}`);
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, start + length);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

/** A patch: an edit the engine reports as "doc", opening the window. */
function patch(engine: EditorEngine) {
  engine.updateSelection({
    anchor: { para: 0, offset: 0 },
    focus: { para: 0, offset: 5 },
  });
  engine.toggleBold();
}

describe("a selection made while the core settles a patch", () => {
  it("reaches the engine once the window closes", () => {
    const { engine, editable } = mount();
    patch(engine);
    // Inside the window: turned away, as an echo of the core's own would be.
    selectInPage(editable, 1, 0, 6);
    expect(engine.selection.anchor).toEqual({ para: 0, offset: 0 });
    flushFrames();
    expect(engine.selection).toEqual({
      anchor: { para: 1, offset: 0 },
      focus: { para: 1, offset: 6 },
    });
  });

  it("reads nothing again when only the core's own restore was turned away", () => {
    const { engine } = mount();
    patch(engine);
    let heard = 0;
    const count = () => (heard += 1);
    document.addEventListener("selectionchange", count);
    flushFrames();
    document.removeEventListener("selectionchange", count);
    // The page holds what the engine restored, so there is nothing to hand
    // over, and the selection handler, the station's entry point, does not run.
    expect(heard).toBe(0);
    expect(engine.selection).toEqual({
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 5 },
    });
  });
});
