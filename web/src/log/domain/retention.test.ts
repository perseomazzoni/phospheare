// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { MAX_SIZE, TRIM_TO, dropsOldest } from "./retention";

describe("the size limit", () => {
  it("drops nothing while the lines fit", () => {
    expect(dropsOldest(MAX_SIZE, false)).toBe(false);
    expect(dropsOldest(0, false)).toBe(false);
  });

  it("drops the oldest from past the limit down to the trim size", () => {
    const mib = 1024 * 1024;
    let total = 11 * mib;
    let trimming = false;
    let dropped = 0;
    while (dropsOldest(total, trimming)) {
      trimming = true;
      total -= mib;
      dropped += 1;
    }
    // 11 MiB is over 10; the oldest three go, leaving 8.
    expect(dropped).toBe(3);
    expect(total).toBe(TRIM_TO);
  });
});
