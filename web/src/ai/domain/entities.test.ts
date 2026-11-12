// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  aliasesOf,
  entityGroupsOf,
  entityKey,
  groupsOf,
  ENTITY_RECIPE_REVISION,
} from "./entities";

const NAMES = ["hale's gun", "la pistola", "the back door", "the old revolver"];

describe("entityKey", () => {
  it("folds a name and collapses its spacing", () => {
    expect(entityKey("  La  Pistóla ")).toBe("la pistola");
  });
});

describe("groupsOf", () => {
  it("reads groups of the list's own numbers, and nothing else", () => {
    expect(groupsOf({ groups: [[1, 2, 4]] }, NAMES)).toEqual([
      ["hale's gun", "la pistola", "the old revolver"],
    ]);
    expect(groupsOf({ groups: [] }, NAMES)).toEqual([]);
    for (const bad of [null, "1,2", { groups: "1,2" }])
      expect(groupsOf(bad, NAMES)).toBeNull();
  });

  it("leaves out a number off the list or used before, and a group left too small", () => {
    expect(
      groupsOf(
        {
          groups: [
            [1, 2, 2, 9, 0, 1.5, "3"],
            // 2 is already in a group: this one is left with 3 alone.
            [2, 3],
            "not a group",
            [3, 4],
          ],
        },
        NAMES,
      ),
    ).toEqual([
      ["hale's gun", "la pistola"],
      ["the back door", "the old revolver"],
    ]);
  });
});

describe("entityGroupsOf", () => {
  it("reads the kept groups, and nothing else", () => {
    // `asked` is the question as put, the lines shown, and `model` is who
    // was asked; the groups are keys.
    const kept = {
      recipeRevision: ENTITY_RECIPE_REVISION,
      names: {
        asked: NAMES.map((name) => `${JSON.stringify(name)} (thing)`),
        model: "ollama/m",
        groups: [["hale's gun", "la pistola"]],
      },
      labels: {
        asked: ['"colour of hair" (colour)', '"hair colour" (colour)'],
        model: "ollama/m",
        groups: [["colour of hair", "hair colour"]],
      },
      values: {
        asked: ['job: "baker"', 'job: "fornaio"'],
        model: "ollama/m",
        groups: [["job|baker", "job|fornaio"]],
      },
    };
    expect(entityGroupsOf(kept)).toEqual(kept);
    for (const bad of [
      null,
      { ...kept, recipeRevision: 1 },
      { ...kept, names: null },
      { ...kept, names: { ...kept.names, asked: [1] } },
      { ...kept, names: { ...kept.names, groups: "x" } },
      { ...kept, names: { ...kept.names, groups: [[1]] } },
      { ...kept, names: { ...kept.names, model: 7 } },
      { ...kept, labels: undefined },
      { ...kept, values: { asked: [] } },
    ])
      expect(entityGroupsOf(bad)).toBeNull();
  });
});

describe("aliasesOf", () => {
  it("stands each group in for its most noted name, the longer then the first on a tie", () => {
    const counts = new Map([
      ["hale's gun", 1],
      ["la pistola", 1],
      ["the old revolver", 3],
      ["the back door", 2],
      ["the door", 2],
      ["a door", 2],
      ["b door", 2],
    ]);
    expect(
      aliasesOf(
        [
          ["hale's gun", "la pistola", "the old revolver"],
          ["the door", "the back door"],
          ["b door", "a door"],
        ],
        counts,
      ),
    ).toEqual(
      new Map([
        ["hale's gun", "the old revolver"],
        ["la pistola", "the old revolver"],
        ["the door", "the back door"],
        ["b door", "a door"],
      ]),
    );
  });
});
