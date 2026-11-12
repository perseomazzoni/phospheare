// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  faults,
  installFaultListeners,
  reactRootOptions,
  updateReady,
} from "./compose";

// Pins the global wiring: every failure React did not render a page for is
// reported once, with the browser's own log cancelled, and a chunk that
// failed to load raises "A newer version is ready".

afterEach(() => vi.restoreAllMocks());

installFaultListeners();

describe("the fault listeners", () => {
  it("reports an uncaught error once and cancels the browser's log", () => {
    const report = vi.spyOn(faults, "report").mockImplementation(() => {});
    const error = new Error("boom");
    const event = new ErrorEvent("error", { error, cancelable: true });

    window.dispatchEvent(event);

    expect(report).toHaveBeenCalledWith(error, "window");
    expect(event.defaultPrevented).toBe(true);
  });

  it("reports a cross-origin script error by its message, which is all it carries", () => {
    const report = vi.spyOn(faults, "report").mockImplementation(() => {});
    window.dispatchEvent(
      new ErrorEvent("error", { message: "Script error.", cancelable: true }),
    );
    expect(report).toHaveBeenCalledWith("Script error.", "window");
  });

  it.each([
    "ResizeObserver loop completed with undelivered notifications.",
    "ResizeObserver loop limit exceeded",
  ])("does not report the browser notice %s and keeps its log", (message) => {
    const report = vi.spyOn(faults, "report").mockImplementation(() => {});
    const event = new ErrorEvent("error", { message, cancelable: true });

    window.dispatchEvent(event);

    expect(report).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("reports an unhandled rejection and cancels the browser's log", () => {
    const report = vi.spyOn(faults, "report").mockImplementation(() => {});
    const reason = new Error("nobody caught this");
    const event = new Event("unhandledrejection", { cancelable: true });
    Object.assign(event, { reason });

    window.dispatchEvent(event);

    expect(report).toHaveBeenCalledWith(reason, "window");
    expect(event.defaultPrevented).toBe(true);
  });

  it("says nothing about an update when the chunk failed because the device is offline", () => {
    // Offline, a missing chunk is the connection, not a newer build: a Reload
    // there lands on the browser's own offline page.
    const mark = vi.spyOn(updateReady, "mark");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const event = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(event);

    expect(mark).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("raises the update notice when a chunk fails to load, and lets the import fail", () => {
    const event = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(event);

    expect(updateReady.showing()).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it("hands React's render errors to the reporter with their component stack", () => {
    const report = vi.spyOn(faults, "report").mockImplementation(() => {});
    const error = new Error("render");

    reactRootOptions.onCaughtError(error, { componentStack: "\n at A" });
    reactRootOptions.onUncaughtError(error, {});
    reactRootOptions.onRecoverableError(error, {});

    expect(report).toHaveBeenNthCalledWith(1, error, "react", "\n at A");
    expect(report).toHaveBeenNthCalledWith(2, error, "react", undefined);
    expect(report).toHaveBeenCalledTimes(3);
  });
});
