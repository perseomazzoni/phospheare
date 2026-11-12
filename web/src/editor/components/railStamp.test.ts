// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { railStamp, railStampFormatters } from "./railStamp";

// The walked step's stamp, pinned in Node: the fixed two-line shape
// "Wed, 12 Aug 2026 / 14:32:12", built from separate Intl calls so the
// punctuation is fixed while the words localize. The formatters take an
// explicit time zone in the tests so the output is deterministic regardless
// of the machine's clock.

const at = Date.UTC(2026, 7, 12, 14, 32, 12); // the stamp above, in UTC

describe("railStamp — the walked step's two-line stamp", () => {
  it("renders the fixed shape in English", () => {
    const fmt = railStampFormatters("en", { timeZone: "UTC" });
    expect(railStamp(fmt, at)).toBe("Wed, 12 Aug 2026\n14:32:12");
  });

  it("localizes the words, never the punctuation", () => {
    const fmt = railStampFormatters("it", { timeZone: "UTC" });
    expect(railStamp(fmt, at)).toBe("mer, 12 ago 2026\n14:32:12");
  });

  it("answers null for a missing or unusable stamp", () => {
    const fmt = railStampFormatters("en", { timeZone: "UTC" });
    expect(railStamp(fmt, null)).toBeNull();
    expect(railStamp(fmt, Number.NaN)).toBeNull();
    expect(railStamp(fmt, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
