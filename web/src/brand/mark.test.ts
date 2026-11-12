// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { HOLE_PATH, SPARK_PATH } from "./mark";

// Pins the hole a spark leaves: one closed stroke of the spark itself, so it
// sits where the spark was drawn.

describe("the hole in the chest", () => {
  it("is one closed stroke of the spark", () => {
    expect(HOLE_PATH.startsWith("M")).toBe(true);
    expect(HOLE_PATH.match(/M/g)).toHaveLength(1);
    expect(SPARK_PATH).toContain(HOLE_PATH);
  });
});
