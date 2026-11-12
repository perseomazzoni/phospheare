// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import LoginSplash from "./LoginSplash";
import { PRODUCT } from "../../product";
import {
  IGNITE_MS,
  KINDLE_MS,
  AWAKEN_MS,
  SEARCH_MS,
  FLASH_PEAK_MS,
  REVEAL_FADE_MS,
  RETURN_MS,
  CHARGE_MS,
} from "./loginSpark";
const minimumSearch = IGNITE_MS + KINDLE_MS + AWAKEN_MS + SEARCH_MS;

// The rows read the pacing constants rather than literal times, so the art
// direction stays tunable. Each timer boundary is crossed in its own `act`.
// `loginSpark.test.ts` pins the minimum search.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("LoginSplash", () => {
  it("skips the ceremony and flash with reduced motion, but still waits for data", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }));
    const onReveal = vi.fn();
    const onFinished = vi.fn();
    const view = render(
      <LoginSplash
        onReveal={onReveal}
        onFinished={onFinished}
        dataReady={false}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(onReveal).not.toHaveBeenCalled();
    view.rerender(
      <LoginSplash onReveal={onReveal} onFinished={onFinished} dataReady />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(onReveal).toHaveBeenCalledOnce();
    expect(document.querySelector(".login-splash-still")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(REVEAL_FADE_MS);
    });
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("cancels all pending callbacks when the splash is removed", () => {
    const onReveal = vi.fn();
    const onFinished = vi.fn();
    const view = render(
      <LoginSplash onReveal={onReveal} onFinished={onFinished} dataReady />,
    );
    act(() => {
      vi.advanceTimersByTime(minimumSearch);
    });
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onReveal).not.toHaveBeenCalled();
    expect(onFinished).not.toHaveBeenCalled();
  });
  it("keeps the product name beside the decorative spark", () => {
    render(
      <LoginSplash onReveal={vi.fn()} onFinished={vi.fn()} dataReady={true} />,
    );
    expect(screen.getByText(PRODUCT.name)).toBeTruthy();
  });

  it("stands the figure without its spark, which the canvas lights instead", () => {
    render(
      <LoginSplash onReveal={vi.fn()} onFinished={vi.fn()} dataReady={true} />,
    );
    const figure = document.querySelector(".login-splash-figure");
    expect(figure?.querySelector(".brand-mark-figure")).not.toBeNull();
    expect(figure?.querySelector(".brand-mark-spark")).toBeNull();
    expect(figure?.querySelector(".login-splash-chest")).not.toBeNull();
  });

  it("brings in the emblem once the spark is back in the chest, and grows it with the bloom", () => {
    render(
      <LoginSplash onReveal={vi.fn()} onFinished={vi.fn()} dataReady={true} />,
    );
    const charging = () => document.querySelector(".login-splash-charging");
    act(() => {
      vi.advanceTimersByTime(minimumSearch);
    });
    expect(document.querySelector(".login-splash-resolving")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(RETURN_MS - 1);
    });
    expect(charging()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(charging()).not.toBeNull();
    const exploding = () => document.querySelector(".login-splash-exploding");
    act(() => {
      vi.advanceTimersByTime(CHARGE_MS - 1);
    });
    expect(exploding()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(exploding()).not.toBeNull();
  });

  it("with dataReady true throughout, fires onReveal at the flash's peak, then onFinished once the fade completes", () => {
    const onReveal = vi.fn();
    const onFinished = vi.fn();
    render(
      <LoginSplash
        onReveal={onReveal}
        onFinished={onFinished}
        dataReady={true}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(minimumSearch - 1);
    });
    expect(onReveal).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onReveal).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(FLASH_PEAK_MS - 1);
    });
    expect(onReveal).not.toHaveBeenCalled();
    expect(onFinished).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onReveal).toHaveBeenCalledOnce();
    expect(onFinished).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(REVEAL_FADE_MS - 1);
    });
    expect(onFinished).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("keeps searching — never calling onReveal — while dataReady is still false", () => {
    const onReveal = vi.fn();
    render(
      <LoginSplash
        onReveal={onReveal}
        onFinished={vi.fn()}
        dataReady={false}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(minimumSearch);
    });
    act(() => {
      vi.advanceTimersByTime(FLASH_PEAK_MS);
    });
    expect(onReveal).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onReveal).not.toHaveBeenCalled();
    expect(document.querySelector(".login-splash-resolving")).toBeNull();
  });

  it("starts the full ending when dataReady arrives after the minimum search", () => {
    const onReveal = vi.fn();
    const { rerender } = render(
      <LoginSplash
        onReveal={onReveal}
        onFinished={vi.fn()}
        dataReady={false}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(minimumSearch);
    });
    act(() => {
      vi.advanceTimersByTime(FLASH_PEAK_MS);
    });
    expect(onReveal).not.toHaveBeenCalled();

    rerender(
      <LoginSplash onReveal={onReveal} onFinished={vi.fn()} dataReady={true} />,
    );
    expect(onReveal).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(FLASH_PEAK_MS);
    });
    expect(onReveal).toHaveBeenCalledOnce();
  });

  it("does not restart either timer when the parent hands down fresh closures mid-animation", () => {
    const firstReveal = vi.fn();
    const firstFinished = vi.fn();
    const { rerender } = render(
      <LoginSplash
        onReveal={firstReveal}
        onFinished={firstFinished}
        dataReady={true}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(minimumSearch);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    const secondReveal = vi.fn();
    const secondFinished = vi.fn();
    rerender(
      <LoginSplash
        onReveal={secondReveal}
        onFinished={secondFinished}
        dataReady={true}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(FLASH_PEAK_MS - 300);
    });

    expect(secondReveal).toHaveBeenCalledOnce();
    expect(firstReveal).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    const thirdFinished = vi.fn();
    rerender(
      <LoginSplash
        onReveal={secondReveal}
        onFinished={thirdFinished}
        dataReady={true}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(REVEAL_FADE_MS - 200);
    });

    expect(thirdFinished).toHaveBeenCalledOnce();
    expect(secondFinished).not.toHaveBeenCalled();
    expect(firstFinished).not.toHaveBeenCalled();
  });
});
