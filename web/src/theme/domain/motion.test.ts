// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { fadesOnSwitch } from "./motion";

describe("a theme switch's fade", () => {
  it("fades from one theme to another", () => {
    expect(fadesOnSwitch("vision-light", "vision-dark", false)).toBe(true);
    expect(fadesOnSwitch("matte-light", "vision-light", false)).toBe(true);
  });

  it("does not fade the first theme on, the same theme, or for less motion", () => {
    expect(fadesOnSwitch(undefined, "matte-light", false)).toBe(false);
    expect(fadesOnSwitch("matte-light", "matte-light", false)).toBe(false);
    expect(fadesOnSwitch("matte-light", "matte-dark", true)).toBe(false);
  });
});
