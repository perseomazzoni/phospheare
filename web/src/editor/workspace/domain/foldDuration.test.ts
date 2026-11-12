// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { foldDurationMs } from "./foldDuration";

describe("how long the bar waits for a fold to close", () => {
  it("reads seconds, as a computed style reports them", () => {
    expect(foldDurationMs("0.22s")).toBeCloseTo(220);
    expect(foldDurationMs("0s")).toBe(0);
  });

  it("reads milliseconds too", () => {
    expect(foldDurationMs("150ms")).toBe(150);
  });

  it("reads the first of a list, which every property shares", () => {
    expect(foldDurationMs("0.3s, 0.3s, 0.3s")).toBeCloseTo(300);
    expect(foldDurationMs(" 90ms, 90ms")).toBe(90);
  });

  it("waits for nothing when there is no fold or no value", () => {
    expect(foldDurationMs("")).toBe(0);
    expect(foldDurationMs("auto")).toBe(0);
  });
});
