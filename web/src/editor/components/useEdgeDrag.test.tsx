// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, act } from "@testing-library/react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  DETENT_PX,
  RESIZE_KEY_STEP,
  useEdgeDrag,
  withDetent,
} from "./useEdgeDrag";

// ── The shared edge drag ─────────────────────────────────────────────────────
//
// One hook, two edges. These pins hold the two rules that differ per input
// device — the pointer follows the edge it holds, the keyboard means "more"
// on either side — and the teardown that stops an interrupted drag from
// committing anywhere.

afterEach(() => cleanup());

const clamp = (w: number) => Math.min(600, Math.max(200, w));

const down = (clientX: number) =>
  ({
    button: 0,
    clientX,
    preventDefault: vi.fn(),
  }) as unknown as ReactPointerEvent;

const key = (k: string) =>
  ({ key: k, preventDefault: vi.fn() }) as unknown as ReactKeyboardEvent;

// The width is the hook's one prop rather than a closed-over constant, so a
// test can move it the way the shell does — the hook is controlled, and
// "what it reports mid-drag" is a question that cannot be asked otherwise.
function setup(side: "left" | "right", width = 300) {
  const onResize = vi.fn();
  const onResizeEnd = vi.fn();
  const { result, unmount, rerender } = renderHook(
    (w: number) =>
      useEdgeDrag({
        width: w,
        side,
        clamp,
        keyStep: RESIZE_KEY_STEP,
        min: 200,
        max: 600,
        controls: "the-panel",
        onResize,
        onResizeEnd,
      }),
    { initialProps: width },
  );
  return { result, unmount, rerender, onResize, onResizeEnd };
}

const move = (clientX: number) =>
  act(() => {
    window.dispatchEvent(new PointerEvent("pointermove", { clientX }));
  });

const release = () =>
  act(() => {
    window.dispatchEvent(new PointerEvent("pointerup"));
  });

describe("useEdgeDrag", () => {
  // ── What the grip says about itself ────────────────────────────────────────
  //
  // A focusable `role="separator"` that takes arrow keys is a widget, and these
  // four attributes are the whole of what it owes a writer who cannot see it.
  // They live on the hook rather than on either call site so the two edges
  // cannot disagree about them.
  it("says where the edge stands and how far it can go", () => {
    const { result } = setup("left", 317);
    expect(result.current.separatorProps).toMatchObject({
      role: "separator",
      "aria-orientation": "vertical",
      tabIndex: 0,
      "aria-valuenow": 317,
      "aria-valuemin": 200,
      "aria-valuemax": 600,
      "aria-controls": "the-panel",
    });
  });

  it("reports the live width, not the settled one", () => {
    // The hook is controlled, so `width` is whatever the caller is rendering
    // this frame — which through a drag is the pointer's position. A value
    // that only moved on release would announce the width the writer left
    // rather than the one they are choosing.
    const { result, rerender } = setup("right", 400);
    act(() => rerender(360));
    expect(result.current.separatorProps["aria-valuenow"]).toBe(360);
  });

  it("rounds, because a width comes out of pointer arithmetic", () => {
    // Nothing offers "319.6" — the floor, the cap and the key step are all
    // whole px, and a fractional value announced is a number the writer cannot
    // aim at.
    const { result } = setup("left", 319.6);
    expect(result.current.separatorProps["aria-valuenow"]).toBe(320);
  });

  // The sign is the whole of what `side` decides, and it is the one thing a
  // shared hook could get backwards on one of its two call sites.
  it("grows a left-pinned panel as the pointer moves right", () => {
    const { result, onResize, onResizeEnd } = setup("left");
    act(() => result.current.onPointerDown(down(500)));
    move(540);
    expect(onResize).toHaveBeenLastCalledWith(340);
    release();
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    expect(onResizeEnd).toHaveBeenCalledWith(340);
  });

  it("grows a right-pinned panel as the pointer moves left", () => {
    const { result, onResize } = setup("right");
    act(() => result.current.onPointerDown(down(500)));
    move(460);
    expect(onResize).toHaveBeenLastCalledWith(340);
  });

  it("passes every drag through the clamp", () => {
    const { result, onResizeEnd } = setup("left");
    act(() => result.current.onPointerDown(down(500)));
    move(5000);
    release();
    expect(onResizeEnd).toHaveBeenCalledWith(600);

    act(() => result.current.onPointerDown(down(500)));
    move(-5000);
    release();
    expect(onResizeEnd).toHaveBeenLastCalledWith(200);
  });

  it("persists once on release, never per frame", () => {
    const { result, onResize, onResizeEnd } = setup("left");
    act(() => result.current.onPointerDown(down(500)));
    move(520);
    move(540);
    expect(onResize).toHaveBeenCalledTimes(2);
    expect(onResizeEnd).not.toHaveBeenCalled();
    release();
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
  });

  // ArrowRight means "more" on both edges, even though on a right-pinned dock
  // that is the opposite of where the pointer would travel. One rule per input
  // device.
  it.each([["left"], ["right"]] as const)(
    "steps %s by the arrow keys and floors/caps with Home and End",
    (side) => {
      const { result, onResizeEnd } = setup(side);
      act(() => result.current.onKeyDown(key("ArrowRight")));
      expect(onResizeEnd).toHaveBeenLastCalledWith(300 + RESIZE_KEY_STEP);
      act(() => result.current.onKeyDown(key("ArrowLeft")));
      expect(onResizeEnd).toHaveBeenLastCalledWith(300 - RESIZE_KEY_STEP);
      act(() => result.current.onKeyDown(key("Home")));
      expect(onResizeEnd).toHaveBeenLastCalledWith(200);
      act(() => result.current.onKeyDown(key("End")));
      expect(onResizeEnd).toHaveBeenLastCalledWith(600);
    },
  );

  it("ignores a non-primary button", () => {
    const { result, onResize } = setup("left");
    act(() =>
      result.current.onPointerDown({
        ...down(500),
        button: 2,
      } as unknown as ReactPointerEvent),
    );
    move(540);
    expect(onResize).not.toHaveBeenCalled();
  });

  it("takes its listeners off on unmount and commits nothing", () => {
    const removed = vi.spyOn(window, "removeEventListener");
    const { result, unmount, onResizeEnd } = setup("left");
    act(() => result.current.onPointerDown(down(500)));
    move(540);

    // The plane flips and the panel unmounts with the pointer still down.
    unmount();
    expect(removed.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining([
        "pointermove",
        "pointerup",
        "pointercancel",
        "blur",
      ]),
    );

    // The stray release lands nowhere, not in whatever project is open by now.
    release();
    expect(onResizeEnd).not.toHaveBeenCalled();
  });
});

// ── The detent ───────────────────────────────────────────────────────────────
//
// A width the edge sticks at on its way through: the dock's is where
// it starts to cover the measure. The pointer sits on it for one step's travel
// and then jumps back under the pointer; an arrow step that crosses it stops
// on it.
describe("withDetent", () => {
  it("holds a pointer width on the detent for one step past it", () => {
    expect(withDetent(499, 500)).toBe(499);
    expect(withDetent(500, 500)).toBe(500);
    expect(withDetent(500 + DETENT_PX - 1, 500)).toBe(500);
    // Through: the edge is back under the pointer, not trailing it.
    expect(withDetent(500 + DETENT_PX, 500)).toBe(500 + DETENT_PX);
  });

  it("stops an arrow step that crosses the detent, either way, and only once", () => {
    expect(withDetent(510, 500, 490)).toBe(500);
    expect(withDetent(490, 500, 510)).toBe(500);
    // From the detent itself the next step goes on.
    expect(withDetent(524, 500, 500)).toBe(524);
    expect(withDetent(476, 500, 500)).toBe(476);
  });

  it("is no detent at all when there is none", () => {
    expect(withDetent(510, null)).toBe(510);
    expect(withDetent(510, undefined, 490)).toBe(510);
  });
});

describe("useEdgeDrag with a detent", () => {
  it("sticks the drag, and the keys, at the detent", () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    const { result } = renderHook(() =>
      useEdgeDrag({
        width: 300,
        side: "right",
        clamp,
        keyStep: RESIZE_KEY_STEP,
        min: 200,
        max: 600,
        detent: 310,
        controls: "panel",
        onResize,
        onResizeEnd,
      }),
    );
    act(() => result.current.onPointerDown(down(500)));
    // 15px of travel (the dock grows leftwards): 315, inside the band.
    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 485 }));
    });
    expect(onResize).toHaveBeenLastCalledWith(310);
    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 460 }));
    });
    expect(onResize).toHaveBeenLastCalledWith(340);
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 460 }));
    });
    act(() => result.current.onKeyDown(key("ArrowRight")));
    expect(onResizeEnd).toHaveBeenLastCalledWith(310);
  });
});
