// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SelectionBubble from "./SelectionBubble";
import { EditorEngine } from "../views/engine";
import type { Rect } from "../selectionBubble";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

// The bar above holds every one of these commands, and that is the point: the
// bar is where you go when you know what you want, and this is where the answer
// comes to you when you have just read a sentence and decided it is wrong.

const RECT: Rect = {
  left: 400,
  top: 300,
  right: 520,
  bottom: 320,
  width: 120,
  height: 20,
};

/**
 * jsdom answers every rect with zeros, so the host has to be stubbed for the
 * placement to mean anything. Only the host: the selection's rect is passed in.
 */
function hostOf(width = 1280, height = 860): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

function bubble(
  over: {
    rect?: Rect | null;
    text?: string;
    assistant?: boolean;
    comment?: boolean;
  } = {},
) {
  const engine = new EditorEngine();
  engine.open("She stood at the window.\n");
  const onFindEvery = vi.fn();
  const onAsk = vi.fn();
  render(
    <SelectionBubble
      engine={engine}
      rect={over.rect === undefined ? RECT : over.rect}
      host={hostOf()}
      text={over.text ?? "stood"}
      onFindEvery={onFindEvery}
      onAsk={over.assistant === false ? undefined : onAsk}
      onComment={over.comment ? () => undefined : undefined}
    />,
  );
  return { engine, onFindEvery, onAsk };
}

const box = () => document.querySelector(".ui-bubble") as HTMLElement | null;

describe("SelectionBubble", () => {
  it("is not there when nothing is selected", () => {
    bubble({ rect: null });
    expect(box()).toBeNull();
  });

  it("offers the marks a draft collects, and the two questions a phrase raises", () => {
    bubble();
    expect(screen.getByLabelText("toolbar.bold")).toBeTruthy();
    expect(screen.getByLabelText("toolbar.italic")).toBeTruthy();
    expect(screen.getByLabelText("toolbar.toggleCase")).toBeTruthy();
    expect(screen.getByText("bubble.everyOne")).toBeTruthy();
    expect(screen.getByText("bubble.ask")).toBeTruthy();
  });

  it("is a toolbar, so it is announced as one thing", () => {
    bubble();
    expect(screen.getByRole("toolbar").getAttribute("aria-label")).toBe(
      "bubble.label",
    );
  });

  it("places itself over the selection it points at", () => {
    bubble();
    const el = box();
    if (el === null)
      throw new Error("The bubble should be placed over a selection");
    // jsdom gives the bubble no size, so the centre is the selection's centre.
    expect(el.style.left).toBe("460px");
    expect(el.style.getPropertyValue("--tail")).toBe("0px");
    expect(el.dataset.below).toBe("0");
  });

  // A bubble tucked under the titlebar is a bubble the writer cannot click.
  it("flips below a selection that is up behind the chrome", () => {
    bubble({ rect: { ...RECT, top: 20, bottom: 40 } });
    const flipped = box();
    if (flipped === null)
      throw new Error("The flipped bubble should still be on the page");
    expect(flipped.dataset.below).toBe("1");
  });

  it("reaches the engine for the marks", () => {
    const { engine } = bubble();
    const before = engine.isBold;
    fireEvent.click(screen.getByLabelText("toolbar.bold"));
    expect(engine.isBold).not.toBe(before);
  });

  // Both of these need to know what is selected, which is why they are here
  // and not only in the bar.
  it("hands the selection to find, and to the assistant", () => {
    const { onFindEvery, onAsk } = bubble({ text: "the window" });
    fireEvent.click(screen.getByText("bubble.everyOne"));
    expect(onFindEvery).toHaveBeenCalledWith("the window");
    fireEvent.click(screen.getByText("bubble.ask"));
    expect(onAsk).toHaveBeenCalledWith("the window");
  });

  // With no Assistant there is nothing to ask, and the bubble offers what is
  // left rather than a button to a face that does not exist.
  it("offers no Ask where there is no Assistant, and still finds every one", () => {
    const { onFindEvery } = bubble({ text: "the window", assistant: false });
    expect(screen.queryByText("bubble.ask")).toBeNull();
    fireEvent.click(screen.getByText("bubble.everyOne"));
    expect(onFindEvery).toHaveBeenCalledWith("the window");
  });

  // Across paragraphs the engine marks and changes case, as the bar does,
  // and find reads a paragraph break, so "every one" stays too, handed the
  // passage with its break in it.
  it("offers everything on a selection across paragraphs", () => {
    const { onFindEvery } = bubble({
      text: "the window.\nShe",
      comment: true,
    });
    expect(screen.getByLabelText("toolbar.bold")).toBeTruthy();
    expect(screen.getByLabelText("toolbar.italic")).toBeTruthy();
    expect(screen.getByLabelText("toolbar.toggleCase")).toBeTruthy();
    expect(screen.getByText("bubble.comment")).toBeTruthy();
    expect(screen.getByText("bubble.ask")).toBeTruthy();
    fireEvent.click(screen.getByText("bubble.everyOne"));
    expect(onFindEvery).toHaveBeenCalledWith("the window.\nShe");
  });

  it("divides the marks from every one with neither Comment nor Ask", () => {
    const { engine } = bubble({ text: "window.\nShe", assistant: false });
    // "every one" is always there, so the divider always has a side.
    expect(box()?.querySelector("hr")).not.toBeNull();
    expect(screen.getByText("bubble.everyOne")).toBeTruthy();
    engine.updateSelection({
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 3 },
    });
    fireEvent.click(screen.getByLabelText("toolbar.bold"));
    expect(engine.doc[0].runs[0].format.bold).toBe(true);
  });

  // A pointerdown anywhere outside the prose collapses the selection, and then
  // the command it was about has nothing to act on.
  it("does not let the press take the selection away", () => {
    bubble();
    const event = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    });
    const target = box();
    if (target === null)
      throw new Error("The bubble should exist to receive the pointerdown");
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
