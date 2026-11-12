// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { TYPE_GOAL_DEFAULTS, typeForWords } from "./types";

// The import proposes a type from a manuscript's length, on the same ranges
// the creation dialog's guidance states (`create.typeGuide.*`).
describe("typeForWords", () => {
  it("reads a length off the guidance ranges", () => {
    expect(typeForWords(0)).toBe("Flash Fiction");
    expect(typeForWords(999)).toBe("Flash Fiction");
    expect(typeForWords(1_000)).toBe("Short Story");
    expect(typeForWords(19_999)).toBe("Short Story");
    expect(typeForWords(20_000)).toBe("Novella");
    expect(typeForWords(49_999)).toBe("Novella");
    expect(typeForWords(50_000)).toBe("Novel");
    expect(typeForWords(110_000)).toBe("Novel");
    expect(typeForWords(110_001)).toBe("Epic Novel");
  });

  it("proposes only types that carry a goal default", () => {
    for (const words of [0, 5_000, 30_000, 90_000, 200_000]) {
      expect(TYPE_GOAL_DEFAULTS[typeForWords(words)]).toBeGreaterThan(0);
    }
  });
});
