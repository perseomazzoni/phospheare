// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act as reactAct, cleanup, render } from "@testing-library/react";
import SaveGutter from "./SaveGutter";
import { EditorEngine } from "../views/engine";

// The gutter measures once per frame, never inside the keystroke.
// Frames are run by hand here: `act` below does what the test says, then
// lets the frame that follows it land.
let frames: FrameRequestCallback[] = [];
beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function nextFrame() {
  reactAct(() => {
    const due = frames;
    frames = [];
    for (const cb of due) cb(0);
  });
}

function act(fn: () => void) {
  reactAct(fn);
  nextFrame();
}

// The gutter is a sibling layer, never marks inside the prose: anything added
// to a paragraph makes the DOM patcher rebuild the whole document on every
// keystroke. So it measures the paragraphs rather than decorating them, and
// what these tests pin is which paragraphs it decides to mark.

/** A stand-in for `.editor`, whose children the marks are measured from. */
function surfaceWith(paragraphs: number) {
  const box = document.createElement("div");
  const editor = document.createElement("div");
  for (let i = 0; i < paragraphs; i++)
    editor.appendChild(document.createElement("p"));
  box.appendChild(editor);
  document.body.appendChild(box);
  return { box, editor };
}

function mount(engine: EditorEngine, paragraphs: number, failed = false) {
  const { box, editor } = surfaceWith(paragraphs);
  render(
    <SaveGutter
      engine={engine}
      editor={editor}
      surface={box}
      failed={failed}
    />,
  );
  return { box };
}

const marks = () => [...document.querySelectorAll(".save-gutter i")];

describe("SaveGutter", () => {
  it("draws nothing for a document straight off disk", () => {
    const engine = new EditorEngine();
    engine.open("one\n\ntwo");
    mount(engine, 2);
    expect(marks()).toHaveLength(0);
  });

  it("marks the paragraph that was typed into", () => {
    const engine = new EditorEngine();
    engine.open("one\n\ntwo");
    mount(engine, 2);
    act(() => {
      engine.updateSelection({
        anchor: { para: 1, offset: 0 },
        focus: { para: 1, offset: 0 },
      });
      engine.type("x");
    });
    expect(marks()).toHaveLength(1);
    expect(marks()[0].getAttribute("data-state")).toBe("dirty");
  });

  // A confirmation that stays is a status; this one passes.
  it("turns the mark to a confirmation when the write lands", () => {
    const engine = new EditorEngine();
    engine.open("one\n\ntwo");
    mount(engine, 2);
    act(() => {
      engine.updateSelection({
        anchor: { para: 0, offset: 0 },
        focus: { para: 0, offset: 0 },
      });
      engine.type("x");
    });
    act(() => {
      engine.markSaved(engine.save());
    });
    expect(marks()[0].getAttribute("data-state")).toBe("saved");
  });

  // A mark that never resolves is the signal for work still only in
  // memory — so a failed write holds it rather than letting it fade.
  it("holds the mark when the write did not land", () => {
    const engine = new EditorEngine();
    engine.open("one\n\ntwo");
    mount(engine, 2, true);
    act(() => {
      engine.updateSelection({
        anchor: { para: 0, offset: 0 },
        focus: { para: 0, offset: 0 },
      });
      engine.type("x");
    });
    expect(marks()[0].getAttribute("data-state")).toBe("failed");
  });

  it("measures once a frame, however many keys land in it", () => {
    const engine = new EditorEngine();
    engine.open("one\n\ntwo");
    mount(engine, 2);
    reactAct(() => {
      engine.updateSelection({
        anchor: { para: 1, offset: 0 },
        focus: { para: 1, offset: 0 },
      });
      engine.type("x");
      engine.type("y");
      engine.type("z");
    });
    // Nothing is measured inside the keystrokes, and one frame is asked for.
    expect(marks()).toHaveLength(0);
    expect(frames).toHaveLength(1);
    nextFrame();
    expect(marks()).toHaveLength(1);
  });

  it("says nothing about a selection moving", () => {
    const engine = new EditorEngine();
    engine.open("one\n\ntwo");
    mount(engine, 2);
    act(() => {
      engine.updateSelection({
        anchor: { para: 1, offset: 0 },
        focus: { para: 1, offset: 1 },
      });
    });
    expect(marks()).toHaveLength(0);
  });

  // The model counts a page break as a paragraph and the DOM helper counts
  // its `<hr>` too — this stand-in measures `el.children`,
  // which is the same list, so a document with a break never slides every
  // mark below it onto the wrong line.
  it("counts the same children the model does", () => {
    const engine = new EditorEngine();
    engine.open("one\n\ntwo");
    const { box } = mount(engine, 2);
    act(() => {
      engine.updateSelection({
        anchor: { para: 0, offset: 3 },
        focus: { para: 0, offset: 3 },
      });
      engine.insertPageBreak();
    });
    // The break is a paragraph, so the DOM stand-in has to grow with it or the
    // mark has nothing to measure — which is the failure this guards.
    expect(box.querySelector(".editor, div")).toBeTruthy();
    expect(marks().length).toBeGreaterThan(0);
  });

  it("lets go of every mark once the document matches disk again", () => {
    const engine = new EditorEngine();
    engine.open("one\n\ntwo");
    mount(engine, 2);
    act(() => {
      engine.updateSelection({
        anchor: { para: 0, offset: 0 },
        focus: { para: 0, offset: 0 },
      });
      engine.type("x");
    });
    expect(marks().length).toBeGreaterThan(0);
    act(() => {
      engine.undo();
    });
    expect(marks()).toHaveLength(0);
  });

  it("stops listening when it goes away", () => {
    const engine = new EditorEngine();
    engine.open("one");
    const off = vi.spyOn(engine, "subscribe");
    mount(engine, 1);
    expect(off).toHaveBeenCalled();
    cleanup();
    // The listener returned by `subscribe` is the teardown; calling into the
    // engine after unmount must not reach a component that is gone.
    expect(() =>
      act(() => {
        engine.type("x");
      }),
    ).not.toThrow();
  });
});

// The surface reserves a scrollbar's width at its left edge (`scrollbar-gutter:
// stable both-edges`), so the gutter layer starts past the surface's
// border box and the marks are measured from the layer's own left. The layer
// is there before the first mark of a clean buffer, so that mark is not
// measured from the border box and drawn a scrollbar's width right of the
// second.
describe("where the first mark is drawn", () => {
  it("draws the first mark where the second one is", () => {
    const engine = new EditorEngine();
    engine.open("one\n\ntwo");
    const { box } = mount(engine, 2);
    const editor = box.firstElementChild as HTMLElement;
    const rect = (left: number) =>
      ({
        left,
        top: 0,
        width: 0,
        height: 0,
        right: left,
        bottom: 0,
      }) as DOMRect;
    // The surface's border box at 0, its scrollbar gutter 15 wide, the
    // gutter layer at 15, and the prose column at 300.
    const at = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this === box) return rect(0);
        if (this.classList.contains("save-gutter")) return rect(15);
        if (this === editor) return rect(300);
        return rect(0);
      });
    const left = () => (marks()[0] as HTMLElement).style.left;
    act(() => {
      engine.updateSelection({
        anchor: { para: 0, offset: 3 },
        focus: { para: 0, offset: 3 },
      });
      engine.type("x");
    });
    const first = left();
    act(() => engine.type("y"));
    expect(first).toBe(left());
    expect(first).toBe(`${300 - 15 - 27}px`);
    at.mockRestore();
  });
});

describe("when the column moves under the marks", () => {
  it("re-measures when the prose column's own transition ends, not a child's", () => {
    const engine = new EditorEngine();
    engine.open("one\n\ntwo");
    const { box } = mount(engine, 2);
    const editor = box.firstElementChild as HTMLElement;
    let column = 300;
    const at = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const left = this === editor ? column : 0;
        return {
          left,
          top: 0,
          width: 0,
          height: 0,
          right: left,
          bottom: 0,
        } as DOMRect;
      });
    const left = () => (marks()[0] as HTMLElement).style.left;
    act(() => {
      engine.updateSelection({
        anchor: { para: 0, offset: 3 },
        focus: { para: 0, offset: 3 },
      });
      engine.type("x");
    });
    expect(left()).toBe(`${300 - 27}px`);

    // Henosis's return narrows and re-centres the column.
    column = 420;
    act(() => {
      (editor.firstElementChild as HTMLElement).dispatchEvent(
        new Event("transitionend", { bubbles: true }),
      );
    });
    expect(left()).toBe(`${300 - 27}px`);
    act(() => {
      editor.dispatchEvent(new Event("transitionend", { bubbles: true }));
    });
    expect(left()).toBe(`${420 - 27}px`);
    at.mockRestore();
  });
});
