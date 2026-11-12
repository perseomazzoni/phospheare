// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatUsdPerMillion } from "./AiSettingsPane";

describe("a price a writer can compare", () => {
  it("rounds ordinary money to cents", () => {
    expect(formatUsdPerMillion(0.5)).toBe("$0.50");
    expect(formatUsdPerMillion(15)).toBe("$15.00");
  });

  it("does not round a real price down to nothing", () => {
    // Two decimals turn both $0.001 and $0.009 into "$0.00", which reads as
    // free on the surface that says what is free, and the cheapest models are
    // the ones a writer watching their credit scans for.
    expect(formatUsdPerMillion(0.001)).toBe("$0.0010");
    expect(formatUsdPerMillion(0.009)).toBe("$0.0090");
    expect(formatUsdPerMillion(0.0001)).toBe("$0.0001");
  });

  it("shows a true zero as zero rather than as four decimals of it", () => {
    // A free model never reaches here, because `isFreeModel` answers first.
    // A model free to prompt and charged to answer renders both halves, and
    // the free half reads as plain money beside the other.
    expect(formatUsdPerMillion(0)).toBe("$0.00");
  });
});
