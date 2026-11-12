// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { classify, somethingBroke } from "./fault";

// Pins which page each thrown value earns. The chunk messages are the
// three engines' own words for a dynamic import whose file is gone.

const answered = (status: number) =>
  Object.assign(new Error("Something went wrong."), { status });

describe("classify", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://x.test/assets/editor-1a2b.js",
    "error loading dynamically imported module: https://x.test/assets/editor-1a2b.js",
    "Importing a module script failed.",
    "Unable to preload CSS for /assets/editor-1a2b.css",
  ])("reads a missing chunk as a stale build: %s", (message) => {
    expect(classify(new TypeError(message), true)).toEqual({
      kind: "stale-build",
    });
  });

  it("reads a missing chunk offline as unreachable, since a reload cannot fetch it", () => {
    const error = new TypeError("Failed to fetch dynamically imported module");
    expect(classify(error, false).kind).toBe("unreachable");
  });

  it("reads a request that never got an answer as unreachable", () => {
    expect(classify(answered(0), true).kind).toBe("unreachable");
  });

  it("reads a 404 as not found, from a route response or the API", () => {
    expect(classify({ status: 404, statusText: "Not Found" }, true).kind).toBe(
      "not-found",
    );
    expect(classify(answered(404), true).kind).toBe("not-found");
  });

  it("reads everything else as unexpected, a 5xx included", () => {
    for (const thrown of [
      new Error("Cannot read properties of undefined"),
      answered(409),
      answered(500),
      answered(502),
      "a string",
      null,
      undefined,
      { status: "500" },
    ])
      expect(classify(thrown, true)).toEqual({ kind: "unexpected" });
  });
});

describe("somethingBroke", () => {
  it("counts a failure as a breakage, and a newer build or a wrong address as none", () => {
    expect(somethingBroke("unexpected")).toBe(true);
    expect(somethingBroke("unreachable")).toBe(true);
    expect(somethingBroke("stale-build")).toBe(false);
    expect(somethingBroke("not-found")).toBe(false);
  });
});
