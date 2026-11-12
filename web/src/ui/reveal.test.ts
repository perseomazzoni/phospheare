// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVEAL_HOLD_MS, createReveal } from "./reveal";

const clock = {
  set: (run: () => void, ms: number) => setTimeout(run, ms),
  clear: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
};

describe("the scrollbar reveal", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows a bar on the first scroll and hides it a second after the last", () => {
    const show = vi.fn();
    const reveal = createReveal(show, clock);
    reveal.touch("prose");
    expect(show).toHaveBeenCalledWith("prose", true);
    vi.advanceTimersByTime(REVEAL_HOLD_MS - 1);
    expect(show).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenLastCalledWith("prose", false);
  });

  it("holds the bar through a long scroll without flickering it", () => {
    const show = vi.fn();
    const reveal = createReveal(show, clock);
    for (let i = 0; i < 10; i++) {
      reveal.touch("prose");
      vi.advanceTimersByTime(500);
    }
    expect(show).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(show).toHaveBeenCalledTimes(2);
    expect(show).toHaveBeenLastCalledWith("prose", false);
  });

  it("keeps each scroller's hold apart", () => {
    const show = vi.fn();
    const reveal = createReveal(show, clock);
    reveal.touch("prose");
    vi.advanceTimersByTime(600);
    reveal.touch("dock");
    vi.advanceTimersByTime(400);
    expect(show).toHaveBeenLastCalledWith("prose", false);
    vi.advanceTimersByTime(600);
    expect(show).toHaveBeenLastCalledWith("dock", false);
  });

  it("hides what is still shown when it is disposed", () => {
    const show = vi.fn();
    const reveal = createReveal(show, clock);
    reveal.touch("prose");
    reveal.dispose();
    expect(show).toHaveBeenLastCalledWith("prose", false);
    vi.advanceTimersByTime(REVEAL_HOLD_MS);
    expect(show).toHaveBeenCalledTimes(2);
  });
});
