// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import AppBoot from "./AppBoot";

// `onReveal` fires once both the minimum-hold floor has elapsed and
// `dataReady` is true, whichever settles last. `SessionGate.tsx`
// states why `dataReady` exists. Fake timers, as in `Toast.test.tsx`.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AppBoot", () => {
  it("shows the shared loading voice", () => {
    render(<AppBoot onReveal={vi.fn()} dataReady={true} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("does not call onReveal before the minimum hold has elapsed, even with dataReady", () => {
    const onReveal = vi.fn();
    render(<AppBoot onReveal={onReveal} dataReady={true} />);
    act(() => {
      vi.advanceTimersByTime(219);
    });
    expect(onReveal).not.toHaveBeenCalled();
  });

  it("does not call onReveal once the floor elapses if dataReady is still false", () => {
    const onReveal = vi.fn();
    render(<AppBoot onReveal={onReveal} dataReady={false} />);
    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(onReveal).not.toHaveBeenCalled();
  });

  it("calls onReveal once both the floor has elapsed and dataReady is true", () => {
    const onReveal = vi.fn();
    render(<AppBoot onReveal={onReveal} dataReady={true} />);
    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(onReveal).toHaveBeenCalledOnce();
  });

  it("calls onReveal once dataReady arrives after the floor already elapsed", () => {
    const onReveal = vi.fn();
    const { rerender } = render(
      <AppBoot onReveal={onReveal} dataReady={false} />,
    );
    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(onReveal).not.toHaveBeenCalled();

    rerender(<AppBoot onReveal={onReveal} dataReady={true} />);
    expect(onReveal).toHaveBeenCalledOnce();
  });

  it("does not call onReveal again on an unrelated re-render", () => {
    const onReveal = vi.fn();
    const { rerender } = render(
      <AppBoot onReveal={onReveal} dataReady={true} />,
    );
    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(onReveal).toHaveBeenCalledOnce();

    rerender(<AppBoot onReveal={onReveal} dataReady={true} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onReveal).toHaveBeenCalledOnce();
  });

  it("calls the latest onReveal closure, not a stale one from before a re-render", () => {
    const first = vi.fn();
    const { rerender } = render(<AppBoot onReveal={first} dataReady={true} />);

    const second = vi.fn();
    rerender(<AppBoot onReveal={second} dataReady={true} />);
    act(() => {
      vi.advanceTimersByTime(220);
    });

    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
});
