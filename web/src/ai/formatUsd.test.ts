// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { formatUsd } from "./formatUsd";

// Money in the writer's language.

describe("formatUsd", () => {
  it("writes two fraction digits from one cent up", () => {
    expect(formatUsd(0.01, "en")).toBe("$0.01");
    expect(formatUsd(1.5, "en")).toBe("$1.50");
    expect(formatUsd(12.345, "en")).toBe("$12.35");
  });

  it("never writes money that was spent as nothing", () => {
    for (const spent of [0.007, 0.0049, 0.00001])
      expect(formatUsd(spent, "en"), String(spent)).not.toMatch(/^\$0\.00$/);
    expect(formatUsd(0.007, "en")).toBe("$0.007");
    expect(formatUsd(0.0049, "en")).toBe("$0.0049");
  });

  it("writes nothing spent as zero", () => {
    expect(formatUsd(0, "en")).toBe("$0.00");
  });

  it("follows the writer's language", () => {
    // Italian writes the comma and names the currency after the amount.
    expect(formatUsd(1.5, "it")).toMatch(/^1,50\s(USD|US\$)$/);
    expect(formatUsd(0.007, "it")).toMatch(/^0,007\s(USD|US\$)$/);
  });
});
