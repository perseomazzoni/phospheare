// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { useScrollReveal } from "./useScrollReveal";
import { REVEAL_HOLD_MS } from "./reveal";

function Host({ on }: { on: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useScrollReveal(root, on);
  return (
    <div ref={root}>
      <div data-testid="scroller" />
    </div>
  );
}

describe("useScrollReveal", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("marks a scroller while it scrolls and unmarks it after the hold", () => {
    const { getByTestId } = render(<Host on />);
    const scroller = getByTestId("scroller");
    scroller.dispatchEvent(new Event("scroll"));
    expect(scroller.getAttribute("data-scrolling")).toBe("1");
    vi.advanceTimersByTime(REVEAL_HOLD_MS);
    expect(scroller.hasAttribute("data-scrolling")).toBe(false);
  });

  it("marks nothing while it is off", () => {
    const { getByTestId } = render(<Host on={false} />);
    const scroller = getByTestId("scroller");
    scroller.dispatchEvent(new Event("scroll"));
    expect(scroller.hasAttribute("data-scrolling")).toBe(false);
  });

  it("clears its marks when it is turned off mid-scroll", () => {
    const { getByTestId, rerender } = render(<Host on />);
    const scroller = getByTestId("scroller");
    scroller.dispatchEvent(new Event("scroll"));
    rerender(<Host on={false} />);
    expect(scroller.hasAttribute("data-scrolling")).toBe(false);
  });
});
