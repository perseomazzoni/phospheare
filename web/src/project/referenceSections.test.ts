// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  GUIDEBOOK_SECTION_IDS,
  WORLD_SECTION_IDS,
  isSectionGroup,
  sectionFileName,
  sectionIdOf,
  sectionIndex,
  sectionIdsOf,
} from "./referenceSections";

// The catalogue decides how the shelf reads the two compiled spaces: fixed
// ids in a chosen order, never user input. These tests pin the shape the
// picker, the filter and the completeness test rely on.

const ALL = [...GUIDEBOOK_SECTION_IDS, ...WORLD_SECTION_IDS];

describe("the catalogues", () => {
  it("holds unique, kebab-case ids", () => {
    expect(new Set(ALL).size).toBe(ALL.length);
    for (const id of ALL) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("holds the fixed section counts", () => {
    // 14 including the Back Cover (`blurb`), the one Guidebook section a beta
    // reader may see.
    expect(GUIDEBOOK_SECTION_IDS).toHaveLength(14);
    expect(WORLD_SECTION_IDS).toHaveLength(15);
  });

  it("is unanswered for groups the writer names by hand", () => {
    expect(isSectionGroup("guidebook")).toBe(true);
    expect(isSectionGroup("world")).toBe(true);
    expect(isSectionGroup("characters")).toBe(false);
    expect(isSectionGroup("arcs")).toBe(false);
    expect(isSectionGroup("summaries")).toBe(false);
    expect(isSectionGroup("notes")).toBe(false);
  });

  it("returns the ids in canonical order", () => {
    expect(sectionIdsOf("guidebook")[0]).toBe("at-a-glance");
    expect(sectionIdsOf("world")[0]).toBe("rules");
    expect(sectionIdsOf("characters")).toEqual([]);
  });
});

describe("sectionIdOf", () => {
  it("reads the id from the file name", () => {
    expect(sectionIdOf("world", "world--economy.md")).toBe("economy");
    expect(sectionIdOf("guidebook", "guidebook--at-a-glance.md")).toBe(
      "at-a-glance",
    );
  });

  it("is case-insensitive, because the platforms are", () => {
    expect(sectionIdOf("world", "world--Economy.md")).toBe("economy");
  });

  it("answers null for a hand-made file in a compiled group", () => {
    expect(sectionIdOf("world", "world--nordkapp.md")).toBeNull();
    expect(sectionIdOf("guidebook", "guidebook--my-bible.md")).toBeNull();
  });

  it("answers null for groups without a catalogue", () => {
    expect(sectionIdOf("characters", "character--maren.md")).toBeNull();
    expect(sectionIdOf("notes", "notes--research.md")).toBeNull();
  });
});

describe("sectionFileName", () => {
  it("joins the group's prefix, the id and the extension", () => {
    expect(sectionFileName("world", "economy")).toBe("world--economy.md");
    expect(sectionFileName("guidebook", "logline")).toBe(
      "guidebook--logline.md",
    );
  });
});

describe("sectionIndex", () => {
  it("reports the catalogue position the shelf sorts by", () => {
    expect(sectionIndex("world", "world--rules.md")).toBe(0);
    const economy = sectionIndex("world", "world--economy.md") ?? -1;
    const factions = sectionIndex("world", "world--factions.md") ?? -1;
    expect(economy).toBeLessThan(factions);
    expect(sectionIndex("world", "world--nordkapp.md")).toBeNull();
    expect(sectionIndex("characters", "character--maren.md")).toBeNull();
  });
});
