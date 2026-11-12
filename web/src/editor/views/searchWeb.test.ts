// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { searchWebUrl } from "./searchWeb";

describe("searchWebUrl", () => {
  it("builds a Google query for the plain text", () => {
    expect(searchWebUrl("the storm")).toBe(
      "https://www.google.com/search?q=the%20storm",
    );
  });

  it("encodes query characters", () => {
    expect(searchWebUrl("a & b?")).toBe(
      "https://www.google.com/search?q=a%20%26%20b%3F",
    );
  });
});
