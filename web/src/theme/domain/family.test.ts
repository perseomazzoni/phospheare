// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { THEME_TOKENS } from "./tokens";
import { defineFamily, type FamilyDress, type TokenValues } from "./family";

// A family states every contract token, none blank, or does not build: a
// token left out would draw nothing with every gate green.

const whole = Object.fromEntries(
  THEME_TOKENS.map((token) => [token, "#000"]),
) as TokenValues;

function dress(shared: TokenValues): FamilyDress {
  return {
    id: "test",
    name: "Test",
    palette: () => ({}),
    shared,
    frame: {
      comments: "cards",
      underBar: "slide",
      dockTabs: "track",
      panel: "float",
      spineGroups: "close",
      barCentre: "prose",
      leaves: "under",
    },
    decorations: {
      pageCorners: "none",
      pageHead: "none",
      pageFoot: "none",
      spine: "glyph",
      marginRule: "none",
    },
    sheet: async () => "",
  };
}

describe("defineFamily", () => {
  it("builds a family that states every token, its own apart", () => {
    const family = defineFamily(dress({ ...whole, "--test-own": "1px" }));
    expect(family.light.id).toBe("test-light");
    expect(family.dark.own).toEqual({ "--test-own": "1px" });
  });

  it("refuses a family that leaves a contract token out", () => {
    const { "--paper": _left, ...rest } = whole;
    expect(() => defineFamily(dress(rest))).toThrow("--paper");
  });

  it("refuses a family that states a contract token blank", () => {
    expect(() => defineFamily(dress({ ...whole, "--ink": " " }))).toThrow(
      "--ink",
    );
  });
});
