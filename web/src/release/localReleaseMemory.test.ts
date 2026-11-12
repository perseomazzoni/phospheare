// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localReleaseMemory as memory } from "./localReleaseMemory";

const V2 = { tag: "v2.0.0", url: "https://pages.test/v2.0.0" };

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("localReleaseMemory", () => {
  it("keeps the last check and the dismissed tag", () => {
    expect(memory.lastCheck()).toBeNull();
    expect(memory.dismissed()).toBeNull();
    memory.rememberCheck(42, V2);
    memory.dismiss("v2.0.0");
    expect(memory.lastCheck()).toEqual({ at: 42, release: V2 });
    expect(memory.dismissed()).toBe("v2.0.0");
    memory.rememberCheck(43, null);
    expect(memory.lastCheck()).toEqual({ at: 43, release: null });
  });

  it.each([
    "not json",
    JSON.stringify({ release: V2 }),
    JSON.stringify({ at: "soon", release: V2 }),
  ])("reads a damaged check as none: %s", (raw) => {
    localStorage.setItem("release:check", raw);
    expect(memory.lastCheck()).toBeNull();
  });

  it("reads a damaged release as none, and keeps the time", () => {
    localStorage.setItem(
      "release:check",
      JSON.stringify({ at: 5, release: { tag: 1 } }),
    );
    expect(memory.lastCheck()).toEqual({ at: 5, release: null });
  });

  it("keeps working when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => memory.rememberCheck(1, V2)).not.toThrow();
    expect(() => memory.dismiss("v2.0.0")).not.toThrow();
    expect(memory.lastCheck()).toBeNull();
    expect(memory.dismissed()).toBeNull();
  });
});
