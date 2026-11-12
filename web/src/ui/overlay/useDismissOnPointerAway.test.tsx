// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useRef, useState } from "react";
import { useDismissOnPointerAway } from "./useDismissOnPointerAway";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Pins the three details the hook exists for. A popover that closes on
// `click` lets the press through to whatever was underneath. A listener
// registered synchronously catches the press that opened the panel and closes
// it before it paints. A listener on the bubbling phase is switched off by any
// `stopPropagation()` between the target and the document.

function press(target: Node) {
  target.dispatchEvent(
    new window.PointerEvent("pointerdown", { bubbles: true }),
  );
}

/** A panel and its trigger, wired as `Menu` and the shelf bar wire them. */
function Popover({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  useDismissOnPointerAway(true, [panel.current, trigger], onClose);
  return (
    <div>
      <button ref={setTrigger} data-testid="trigger">
        open
      </button>
      <div ref={panel} data-testid="panel">
        <button data-testid="inside">an action</button>
      </div>
      <button data-testid="outside">something else</button>
    </div>
  );
}

describe("useDismissOnPointerAway", () => {
  it("closes on a press outside everything it was given", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { getByTestId } = render(<Popover onClose={onClose} />);

    act(() => void vi.runAllTimers());
    press(getByTestId("outside"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores a press inside the panel, however deep", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { getByTestId } = render(<Popover onClose={onClose} />);

    act(() => void vi.runAllTimers());
    press(getByTestId("inside"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores a press on the trigger, which owns its own toggle", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { getByTestId } = render(<Popover onClose={onClose} />);

    act(() => void vi.runAllTimers());
    press(getByTestId("trigger"));

    // Closing here as well as toggling would shut and reopen on one press.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not hear the press that opened it", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { getByTestId } = render(<Popover onClose={onClose} />);

    // No timers run: the listener is still one frame away, as it is while the
    // opening pointerdown is still travelling.
    press(getByTestId("outside"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("listens to nothing while closed", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    function Closed() {
      useDismissOnPointerAway(false, [], onClose);
      return <button data-testid="outside">elsewhere</button>;
    }
    const { getByTestId } = render(<Closed />);

    act(() => void vi.runAllTimers());
    press(getByTestId("outside"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("sees an element that attached after the listener did", () => {
    // The panel renders its own contents on a later pass. A listener that
    // captured the element list when it was installed would think the panel
    // was empty and close on a press inside it.
    vi.useFakeTimers();
    const onClose = vi.fn();

    function LateContent() {
      const panel = useRef<HTMLDivElement>(null);
      const [shown, setShown] = useState(false);
      useDismissOnPointerAway(true, [panel.current], onClose);
      return (
        <div>
          <button data-testid="reveal" onClick={() => setShown(true)}>
            reveal
          </button>
          <div ref={panel}>
            {shown && <button data-testid="late">late</button>}
          </div>
        </div>
      );
    }

    const { getByTestId } = render(<LateContent />);
    act(() => void vi.runAllTimers());
    act(() => getByTestId("reveal").click());

    press(getByTestId("late"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("hears a press a descendant tried to swallow", () => {
    // The structure panel's row actions stop the press so the row's drag
    // never starts under the overflow button. A bubbling listener would then
    // miss a press on another row's overflow button and leave two menus open.
    // Capture runs before the target sees the event, so nothing between the
    // target and the document can hide it.
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { getByTestId } = render(<Popover onClose={onClose} />);
    const swallower = getByTestId("outside");
    swallower.addEventListener("pointerdown", (event) =>
      event.stopPropagation(),
    );

    act(() => void vi.runAllTimers());
    press(swallower);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
