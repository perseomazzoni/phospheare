// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { useHenosis, type HenosisOptions } from "./useHenosis";

// Pins the hook against the shell it marks. The dim waits Y before it
// starts, so a case about coming back first writes until the fade has begun.

const SAID = { full: "Henosis mode", back: "Controls are back" };
const BASE: HenosisOptions = {
  enabled: true,
  afterS: 5,
  fadeS: 10,
  pauseS: 5,
  standDown: false,
  holdCaret: false,
  said: SAID,
};

// The shell as EditorRoute draws it, cut to what the hook reads: the prose
// (`.editor`), one control beside it, a composer, the chrome and the live line.
function Shell(props: Partial<HenosisOptions>) {
  const shell = useRef<HTMLDivElement>(null);
  useHenosis(shell, { ...BASE, ...props });
  return (
    <div ref={shell} data-testid="shell">
      <div className="chrome" />
      <div className="editor" contentEditable data-testid="prose">
        <p>words</p>
      </div>
      <button data-testid="control">a control</button>
      <textarea data-testid="composer" />
      <span data-henosis-live data-testid="live" />
    </div>
  );
}

const type = (target: Element) =>
  act(() => {
    target.dispatchEvent(
      new InputEvent("beforeinput", { bubbles: true, inputType: "insertText" }),
    );
  });
const move = (x: number, y: number) =>
  act(() => {
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: x, clientY: y }),
    );
  });
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/** Type every 200ms for `ms`, as a writer in full flow does. */
function write(prose: Element, ms: number) {
  for (let at = 0; at < ms; at += 200) {
    type(prose);
    wait(200);
  }
}

describe("useHenosis", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // ── Marking and coming back ────────────────────────────────────────────────

  it("says nothing until the writer has written", () => {
    const { getByTestId } = render(<Shell />);
    expect(getByTestId("shell").hasAttribute("data-henosis")).toBe(false);
  });

  it("marks the shell from the first keystroke in the prose", () => {
    const { getByTestId, getByText } = render(<Shell />);
    type(getByText("words"));
    expect(getByTestId("shell").getAttribute("data-henosis")).toBe("warming");
  });

  it("ignores typing anywhere but the prose", () => {
    const { getByTestId } = render(<Shell />);
    type(getByTestId("composer"));
    expect(getByTestId("shell").hasAttribute("data-henosis")).toBe(false);
  });

  it("comes back on a hand on the mouse, but not on the first stray event", () => {
    const { getByTestId } = render(<Shell />);
    const shell = getByTestId("shell");
    write(getByTestId("prose"), 5200);
    expect(shell.getAttribute("data-henosis")).toBe("fading");
    move(100, 100);
    expect(shell.getAttribute("data-henosis")).toBe("fading");
    move(103, 102);
    expect(shell.getAttribute("data-henosis")).toBe("fading");
    move(120, 110);
    expect(shell.getAttribute("data-henosis")).toBe("0");
  });

  // A shortcut in the prose is writing, such as a guillemet or a dash opening
  // a line of dialogue, and only Escape asks for the room back.
  it("stays through a shortcut in the prose, and comes back on Escape", () => {
    const { getByTestId } = render(<Shell />);
    const shell = getByTestId("shell");
    const prose = getByTestId("prose");
    write(prose, 5200);
    const key = (init: KeyboardEventInit) =>
      act(() => {
        prose.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, ...init }),
        );
      });
    key({ key: "a" });
    key({ key: "Control", ctrlKey: true });
    key({ key: "«", ctrlKey: true, shiftKey: true });
    key({ key: "Shift", shiftKey: true });
    expect(shell.getAttribute("data-henosis")).toBe("fading");
    key({ key: "Escape" });
    expect(shell.getAttribute("data-henosis")).toBe("0");
  });

  it("counts a shortcut in the prose as writing, so the pause starts over", () => {
    const { getByTestId } = render(<Shell />);
    const shell = getByTestId("shell");
    const prose = getByTestId("prose");
    write(prose, 5200);
    wait(4000);
    act(() => {
      prose.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "b",
          ctrlKey: true,
        }),
      );
    });
    wait(4000);
    expect(shell.getAttribute("data-henosis")).toBe("fading");
  });

  // Save edits nothing, so it is not writing, and a writer who saves at a
  // stop does not have the stop bridged into the fade.
  it("neither extends nor ends the burst on save", () => {
    const { getByTestId } = render(<Shell />);
    const shell = getByTestId("shell");
    const prose = getByTestId("prose");
    const save = () =>
      act(() => {
        prose.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            key: "s",
            ctrlKey: true,
          }),
        );
      });
    write(prose, 5200);
    save();
    expect(shell.getAttribute("data-henosis")).toBe("fading");
    wait(4000);
    save();
    // The pause runs from the last keystroke, not the save: 5s, so it ends.
    wait(1200);
    expect(shell.getAttribute("data-henosis")).toBe("0");
  });

  it("comes back when focus leaves the prose for a control", () => {
    const { getByTestId } = render(<Shell />);
    write(getByTestId("prose"), 5200);
    act(() => getByTestId("control").focus());
    expect(getByTestId("shell").getAttribute("data-henosis")).toBe("0");
  });

  it("comes back after a pause longer than Y, and each keystroke restarts the wait", () => {
    const { getByTestId } = render(<Shell />);
    const shell = getByTestId("shell");
    const prose = getByTestId("prose");
    // The last keystroke of `write` lands at 5000; the clock stands at 5200.
    write(prose, 5200);
    wait(4600);
    type(prose);
    wait(4800);
    expect(shell.getAttribute("data-henosis")).toBe("fading");
    wait(300);
    expect(shell.getAttribute("data-henosis")).toBe("0");
  });

  it("leaves no attribute behind when the editor goes", () => {
    const { getByTestId, unmount } = render(<Shell />);
    const shell = getByTestId("shell");
    write(getByTestId("prose"), 5200);
    unmount();
    expect(shell.hasAttribute("data-henosis")).toBe(false);
    expect(shell.style.getPropertyValue("--henosis-fade")).toBe("");
  });

  // ── Fading and returning ───────────────────────────────────────────────────

  it("waits Y before fading, and reaches full X after", () => {
    const { getByTestId } = render(<Shell afterS={3} fadeS={5} pauseS={3} />);
    const shell = getByTestId("shell");
    expect(shell.style.getPropertyValue("--henosis-fade")).toBe("5000ms");
    write(getByTestId("prose"), 2800);
    expect(shell.getAttribute("data-henosis")).toBe("warming");
    write(getByTestId("prose"), 400);
    expect(shell.getAttribute("data-henosis")).toBe("fading");
    write(getByTestId("prose"), 5000);
    expect(shell.getAttribute("data-henosis")).toBe("full");
    expect(getByTestId("live").textContent).toBe(SAID.full);
  });

  it("returns from full, says so, and settles to no attribute", () => {
    const { getByTestId } = render(<Shell afterS={3} fadeS={5} pauseS={3} />);
    const shell = getByTestId("shell");
    write(getByTestId("prose"), 8400);
    expect(shell.getAttribute("data-henosis")).toBe("full");
    wait(3000);
    expect(shell.getAttribute("data-henosis")).toBe("0");
    expect(getByTestId("live").textContent).toBe(SAID.back);
    wait(1000);
    expect(shell.hasAttribute("data-henosis")).toBe(false);
  });

  it("drops a burst that never faded without playing a return", () => {
    const { getByTestId } = render(<Shell />);
    const shell = getByTestId("shell");
    type(getByTestId("prose"));
    move(100, 100);
    move(200, 200);
    expect(shell.hasAttribute("data-henosis")).toBe(false);
  });

  it("never begins while something it must not hide is open, and ends when one opens", () => {
    const { getByTestId, rerender } = render(<Shell standDown />);
    const shell = getByTestId("shell");
    write(getByTestId("prose"), 6000);
    expect(shell.hasAttribute("data-henosis")).toBe(false);
    rerender(<Shell />);
    write(getByTestId("prose"), 5200);
    expect(shell.getAttribute("data-henosis")).toBe("fading");
    rerender(<Shell standDown />);
    expect(shell.getAttribute("data-henosis")).toBe("0");
  });

  it("ends on the writer's own pause, apart from Y", () => {
    const { getByTestId } = render(<Shell afterS={0} fadeS={0} pauseS={8} />);
    const shell = getByTestId("shell");
    const prose = getByTestId("prose");
    write(prose, 400);
    expect(shell.getAttribute("data-henosis")).toBe("full");
    // Six seconds of thinking: longer than Y, shorter than P.
    wait(6000);
    expect(shell.getAttribute("data-henosis")).toBe("full");
    // The last key at 200 ms: P runs out at 8.2 s, inside the return.
    wait(1900);
    expect(shell.getAttribute("data-henosis")).toBe("0");
  });

  it("does nothing at all while switched off", () => {
    const { getByTestId } = render(<Shell enabled={false} />);
    const shell = getByTestId("shell");
    write(getByTestId("prose"), 20000);
    expect(shell.hasAttribute("data-henosis")).toBe(false);
    expect(shell.style.getPropertyValue("--henosis-fade")).toBe("");
  });
});
