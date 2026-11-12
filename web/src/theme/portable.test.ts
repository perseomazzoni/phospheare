// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { allFamilies } from "./application/registry";
import "./index";
import { validPref } from "../profile/portableDoc";

// A copy of the settings from another installation is read only for themes
// the preference domain names (`portableDoc.ts`). A theme registered here and
// not there would be chosen, shown, and never reach the writer's other
// installations.

describe("the portable preference domain's themes", () => {
  it("accepts every choice a writer can make", () => {
    const choices = allFamilies().flatMap((family) =>
      ["light", "dark", "system"].map((mode) => `${family.id}-${mode}`),
    );
    for (const choice of choices) expect(validPref("theme", choice)).toBe(true);
  });

  it("refuses a name no family carries", () => {
    expect(validPref("theme", "dark")).toBe(false);
    expect(validPref("theme", "nowhere-light")).toBe(false);
  });
});
