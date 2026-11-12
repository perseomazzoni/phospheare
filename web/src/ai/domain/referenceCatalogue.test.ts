// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import {
  CATALOGUE,
  CATALOGUE_REVISION,
  fieldExtraction,
  pageOf,
  readCataloguePage,
  ROLE_POLICY,
  REFERENCE_ROLES,
} from "./referenceCatalogue";

// Pins the reference catalogue's own shape and the loader's strictness.
// The shipped templates are compared with it label by label in
// `editor/assistant/referenceLabels.test.ts`.

const page = (front: string) =>
  `---\npage: world:test\nname: Test\n${front}\n---\n\nWhat the page is for.\n`;

describe("the catalogue", () => {
  it("declares every page of the templates: 31 pages, 196 fields", () => {
    expect(CATALOGUE.size).toBe(31);
    expect(
      [...CATALOGUE.values()].reduce((sum, one) => sum + one.fields.length, 0),
    ).toBe(196);
    expect(CATALOGUE.get("character")?.entity).toBe("person");
    expect(CATALOGUE.get("guidebook:continuity")?.name).toBe(
      "Plot and narrative continuity",
    );
    for (const one of CATALOGUE.values())
      expect(one.purpose.length).toBeGreaterThan(80);
  });

  it("gives every role a heading and a usage line, and extraction only to what may be claimed", () => {
    for (const role of [...REFERENCE_ROLES, "unclassified" as const]) {
      expect(ROLE_POLICY[role].heading).toMatch(/^[A-Z' ]+$/);
      expect(ROLE_POLICY[role].usage.length).toBeGreaterThan(40);
    }
    expect(
      REFERENCE_ROLES.filter((role) => ROLE_POLICY[role].extraction),
    ).toEqual(["fact", "knowledge", "plan"]);
    expect(ROLE_POLICY.plan.extraction).toBe("planned");
    expect(ROLE_POLICY.unclassified.extraction).toBe("unclassified");
  });

  it("keeps the fields whose misuse cost a finding in their place", () => {
    const field = (pageId: string, id: string) => {
      const found = CATALOGUE.get(pageId)?.fields.find((one) => one.id === id);
      if (!found) throw new Error(`${pageId} ${id}`);
      return found;
    };
    // A guidebook's open questions and known contradictions are never a fact
    // to hold the prose to.
    expect(field("guidebook:continuity", "open")?.role).toBe("open");
    expect(field("guidebook:continuity", "contradictions")?.role).toBe(
      "known-issue",
    );
    // A person's fears explain them; they are never a claim.
    expect(field("character", "fears")?.role).toBe("inner");
    // A distance is a fact; a travel limit is a rule the rule check reads.
    expect(field("world:travel", "distances")?.role).toBe("fact");
    expect(field("world:travel", "limits")?.flags.has("rules")).toBe(true);
    // A block's fields carry its id; a system's exceptions qualify its rules.
    expect(
      field("world:systems", "system.exceptions")?.flags.has("exceptions"),
    ).toBe(true);
    // Another volume's plans are never extracted, even as planned.
    expect(fieldExtraction(field("guidebook:series", "books"))).toBe(false);
    expect(fieldExtraction(field("arc", "crisis"))).toBe("planned");
    expect(fieldExtraction(field("character", "age"))).toBe("as-stated");
  });

  it("finds the page a source is, and none for notes, summaries or prose", () => {
    const ref = (group: string, sectionId?: string) => ({
      kind: "reference" as const,
      group,
      ...(sectionId ? { sectionId } : {}),
    });
    expect(pageOf(ref("characters"))?.id).toBe("character");
    expect(pageOf(ref("arcs"))?.id).toBe("arc");
    expect(pageOf(ref("world", "timeline"))?.id).toBe("world:timeline");
    expect(pageOf(ref("guidebook", "nope"))).toBeNull();
    expect(pageOf(ref("world"))).toBeNull();
    expect(pageOf({ kind: "note", group: "notes" })).toBeNull();
    expect(pageOf({ ...ref("characters"), summarises: "EL1" })).toBeNull();
    expect(pageOf({ kind: "manuscript" })).toBeNull();
  });

  it("has a revision that holds while the files hold and moves when a role changes", async () => {
    expect(CATALOGUE_REVISION).toMatch(/^[0-9a-f]{8}$/);

    vi.resetModules();
    const reloaded = await import("./referenceCatalogue");
    expect(reloaded.CATALOGUE_REVISION).toBe(CATALOGUE_REVISION);

    // A ledger read under one catalogue is read again under another, so a
    // changed role must reach the revision.
    const arc = (await import("./references/arc.md?raw")).default;
    const edited = arc.replace("field.start: plan |", "field.start: fact |");
    expect(edited).not.toBe(arc);
    vi.doMock("./references/arc.md?raw", () => ({ default: edited }));
    vi.resetModules();
    try {
      const changed = await import("./referenceCatalogue");
      expect(
        changed.CATALOGUE.get("arc")?.fields.find((one) => one.id === "start")
          ?.role,
      ).toBe("fact");
      expect(changed.CATALOGUE_REVISION).toMatch(/^[0-9a-f]{8}$/);
      expect(changed.CATALOGUE_REVISION).not.toBe(CATALOGUE_REVISION);
    } finally {
      vi.doUnmock("./references/arc.md?raw");
      vi.resetModules();
    }
  });
});

describe("reading a catalogue file strictly", () => {
  it("reads groups, blocks, flags and notes", () => {
    const read = readCataloguePage(
      "t.md",
      page(
        [
          "group.g: Heading | Titolo",
          "field.a: fact, judge | g | A | A-it",
          "block.b: place | [Place] | [Luogo]",
          "field.b.names: fact, names | b | Names | Nomi",
          "note.b.names: Every name.",
        ].join("\n"),
      ),
    );
    expect(read.containers.map((one) => [one.id, one.kind])).toEqual([
      ["-", "top"],
      ["g", "group"],
      ["b", "block"],
    ]);
    expect(read.fields.map((one) => one.id)).toEqual(["a", "b.names"]);
    expect(read.fields[1].note).toBe("Every name.");
    expect([...read.fields[0].flags]).toEqual(["judge"]);
    expect(read.fields[1].labels).toEqual({ en: "Names", it: "Nomi" });
  });

  it.each([
    ["an unknown role", "field.a: truth | - | A | A"],
    ["an unknown flag", "field.a: fact, loud | - | A | A"],
    ["an unknown container", "field.a: fact | z | A | A"],
    ["a missing language", "field.a: fact | - | A"],
    [
      "a block field without its block's id",
      "block.b: place | [P] | [L]\nfield.a: fact | b | A | A",
    ],
    [
      "a duplicate field",
      "field.a: fact | - | A | A\nfield.a: fact | - | B | B",
    ],
    ["a note for no field", "field.a: fact | - | A | A\nnote.z: hi"],
    [
      "an unknown block entity",
      "block.b: planet | [P] | [L]\nfield.b.a: fact | b | A | A",
    ],
    ["an unknown key", "field.a: fact | - | A | A\nextra: 1"],
    ["no field at all", "group.g: G | G"],
  ])("throws on %s", (_, front) => {
    expect(() => readCataloguePage("t.md", page(front))).toThrow("t.md");
  });

  it("throws on an unknown page entity", () => {
    expect(() =>
      readCataloguePage(
        "t.md",
        "---\npage: x\nname: X\nentity: planet\nfield.a: fact | - | A | A\n---\n\nBody.\n",
      ),
    ).toThrow("unknown page entity");
  });
});
