// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserPage, consoleReporter, sessionReloadMemory } from "./browser";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
});

// Pins what the page reports about itself: the path without its query, which
// may carry a sign-in code, and the browser's own connectivity verdict.
// jsdom's `location.reload` cannot be replaced, so the reload itself
// is the e2e spec's.

describe("the browser page", () => {
  it("reports the path and never the query", () => {
    window.history.replaceState(null, "", "/auth/callback?code=secret");
    expect(browserPage.path()).toBe("/auth/callback");
  });

  it("is online unless the browser says it is not", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get");
    onLine.mockReturnValue(true);
    expect(browserPage.online()).toBe(true);
    onLine.mockReturnValue(false);
    expect(browserPage.online()).toBe(false);
  });

  it("tells the time in epoch milliseconds", () => {
    vi.spyOn(Date, "now").mockReturnValue(42);
    expect(browserPage.now()).toBe(42);
  });
});

// Pins that the console receives the thrown value itself, so its stack and
// cause stay inspectable there and nowhere else.

describe("the console reporter", () => {
  it("logs the kind, site and path with the thrown value", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");

    consoleReporter.report(error, {
      site: "window",
      kind: "unexpected",
      path: "/app",
    });

    expect(log).toHaveBeenCalledWith(
      "Fault: unexpected, met at window, on /app",
      error,
    );
  });

  it("adds React's component stack when there is one", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");

    consoleReporter.report(error, {
      site: "react",
      kind: "unexpected",
      path: "/app",
      componentStack: "\n    at Library",
    });

    expect(log).toHaveBeenCalledWith(
      "Fault: unexpected, met at react, on /app",
      error,
      "\n    at Library",
    );
  });
});

// Pins that a storage the browser refuses never allows an unlimited reload:
// `mark` reports false and `last` reads nothing.

describe("the session reload memory", () => {
  it("remembers a reload across reads", () => {
    expect(sessionReloadMemory.last()).toBeNull();
    expect(sessionReloadMemory.mark(1234)).toBe(true);
    expect(sessionReloadMemory.last()).toBe(1234);
  });

  it("reads a value it cannot parse as nothing", () => {
    sessionStorage.setItem("fault:reloaded-at", "soon");
    expect(sessionReloadMemory.last()).toBeNull();
  });

  it("reports a refused write, so no reload goes unremembered", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(sessionReloadMemory.mark(1234)).toBe(false);
  });

  it("reads nothing from a storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(sessionReloadMemory.last()).toBeNull();
  });
});
