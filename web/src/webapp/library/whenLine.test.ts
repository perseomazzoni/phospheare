// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { whenLine } from "./whenLine";

// One date answers when the project last changed. The document's own edit
// stamp answers first; the last observed change (`cachedAt`, which advances
// only when content changed) is the fallback; a card with neither says
// nothing rather than inventing a date.

describe("whenLine", () => {
  it("prints the document's own edit stamp when there is one", () => {
    expect(whenLine("3 hours ago", "2 seconds ago")).toEqual({
      id: "edited",
      when: "3 hours ago",
    });
  });

  it("falls back to the last observed change when the writing has no stamp of its own", () => {
    // `updatedAt` is '' for a folder listed but never read, which `elapsed`
    // turns into null. The fallback stamp says when a change was last
    // observed, the best edit proxy when the document's own stamp is missing.
    expect(whenLine(null, "24 minutes ago")).toEqual({
      id: "edited",
      when: "24 minutes ago",
    });
  });

  it("says nothing rather than inventing a date when neither is known", () => {
    expect(whenLine(null, null)).toBeNull();
  });

  it("keeps the edit when only the observed-change timestamp is missing", () => {
    expect(whenLine("3 hours ago", null)).toEqual({
      id: "edited",
      when: "3 hours ago",
    });
  });
});
