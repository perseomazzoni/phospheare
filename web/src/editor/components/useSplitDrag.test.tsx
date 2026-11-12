// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, act } from "@testing-library/react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useSplitDrag } from "./useSplitDrag";

// ── The shared divider hook ──────────────────────────────────────────────────
//
// The one contract behind every dock face that splits top/bottom. These pins
// hold the keyboard voice and the clamp: the divider can never leave the
// contract's bounds, whatever the input asks for.

afterEach(() => cleanup());

const OPTS = {
  default: 0.38,
  min: 0.2,
  max: 0.6,
  keyStep: 0.04,
};

/** The synthetic event the panels' onKeyDown hands the hook. */
const key = (k: string) =>
  ({
    key: k,
    preventDefault: vi.fn(),
  }) as unknown as ReactKeyboardEvent<HTMLDivElement>;

describe("useSplitDrag", () => {
  it("starts at the default and clamps any keyboard step to the contract's bounds", () => {
    const { result } = renderHook(() => useSplitDrag(OPTS));
    expect(result.current.split).toBe(0.38);
    act(() => result.current.stepSplit(100));
    expect(result.current.split).toBe(0.6);
    act(() => result.current.stepSplit(-100));
    expect(result.current.split).toBe(0.2);
  });

  it("the divider keys step and floor/cap exactly", () => {
    const { result } = renderHook(() => useSplitDrag(OPTS));
    act(() => result.current.onSplitKeyDown(key("ArrowUp")));
    expect(result.current.split).toBe(0.34);
    act(() => result.current.onSplitKeyDown(key("ArrowDown")));
    expect(result.current.split).toBe(0.38);
    act(() => result.current.onSplitKeyDown(key("Home")));
    expect(result.current.split).toBe(0.2);
    act(() => result.current.onSplitKeyDown(key("End")));
    expect(result.current.split).toBe(0.6);
  });

  it("commits the settled fraction on a keyboard step when a persistence seam exists", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useSplitDrag({ ...OPTS, onCommit }));
    act(() => result.current.stepSplit(0.04));
    expect(onCommit).toHaveBeenLastCalledWith(0.42);
    act(() => result.current.onSplitKeyDown(key("Home")));
    expect(onCommit).toHaveBeenLastCalledWith(0.2);
  });

  it("drives the split from an external value when one arrives", () => {
    const { result, rerender } = renderHook(
      ({ external }) => useSplitDrag({ ...OPTS, external }),
      { initialProps: { external: null as number | null } },
    );
    expect(result.current.split).toBe(0.38);
    rerender({ external: 0.55 });
    expect(result.current.split).toBe(0.55);
    rerender({ external: 0.99 });
    expect(result.current.split).toBe(0.6);
  });

  // ── The pointer path, and what happens when it is interrupted ──────────────
  //
  // The drag measures its face, so the test gives `panelRef` a box: jsdom
  // measures nothing, and a hook that refuses a zero-height box (it does, on
  // purpose) would otherwise never start.

  /** A face 400px tall, so a 40px drag is a tenth of the split. */
  function mountFace(result: { current: { panelRef: { current: unknown } } }) {
    const face = document.createElement("div");
    face.getBoundingClientRect = () => ({ height: 400 }) as DOMRect;
    result.current.panelRef.current = face;
  }

  const down = (clientY: number) =>
    ({
      button: 0,
      clientY,
      preventDefault: vi.fn(),
    }) as unknown as React.PointerEvent<HTMLDivElement>;

  it("tracks the pointer and commits the settled fraction once, on release", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useSplitDrag({ ...OPTS, onCommit }));
    mountFace(result);

    act(() => result.current.beginSplitDrag(down(100)));
    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientY: 140 }));
    });
    expect(result.current.split).toBeCloseTo(0.48);
    // The persist is the release, not the drag, as the dock's is.
    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup"));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0.48);
  });

  it("takes its listeners off on unmount and commits nothing", () => {
    const onCommit = vi.fn();
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const { result, unmount } = renderHook(() =>
      useSplitDrag({ ...OPTS, onCommit }),
    );
    mountFace(result);

    act(() => result.current.beginSplitDrag(down(100)));
    const names = (spy: typeof added) =>
      spy.mock.calls.map(([type]) => type).filter((t) => t !== "error");
    expect(names(added)).toEqual(
      expect.arrayContaining([
        "pointermove",
        "pointerup",
        "pointercancel",
        "blur",
      ]),
    );

    // The plane flips, the face unmounts, and the writer's finger is down.
    unmount();
    expect(names(removed)).toEqual(
      expect.arrayContaining([
        "pointermove",
        "pointerup",
        "pointercancel",
        "blur",
      ]),
    );

    // A stray release after the face is gone must find nothing listening, and
    // must not write a fraction into whatever project is open by now.
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup"));
    });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
