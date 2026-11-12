// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { TROPE_LIMIT, TROPE_MAX, asTropes, parseTropes } from "./genres";

// The declared tropes: the writer's own words, bounded.

describe("the declared tropes", () => {
  it("reads what the writer typed, split on commas, semicolons or lines", () => {
    expect(
      parseTropes("enemies to lovers,  found family;\nslow burn, , "),
    ).toEqual(["enemies to lovers", "found family", "slow burn"]);
    expect(parseTropes("")).toEqual([]);
  });

  it("keeps each once, ignoring case, a phrase long, and a handful at most", () => {
    expect(asTropes(["Found Family", "found family", "x"])).toEqual([
      "Found Family",
      "x",
    ]);
    expect(asTropes(["y".repeat(TROPE_MAX + 20)])[0]).toHaveLength(TROPE_MAX);
    expect(
      asTropes(Array.from({ length: TROPE_LIMIT + 3 }, (_, n) => `t${n}`)),
    ).toHaveLength(TROPE_LIMIT);
  });

  it("drops what a file forged: not a list, not strings", () => {
    expect(asTropes("enemies to lovers")).toEqual([]);
    expect(asTropes([3, null, { a: 1 }, "  ", "real"])).toEqual(["real"]);
  });
});
