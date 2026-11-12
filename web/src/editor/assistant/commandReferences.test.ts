// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { SourceDescriptor } from "../../ai/domain/types";
import { referenceNames } from "./commandReferences";

const doc = (
  id: string,
  group: string,
  title: string,
  over: Partial<SourceDescriptor> = {},
): SourceDescriptor => ({
  id: `reference:${id}`,
  kind: group === "notes" ? "note" : "reference",
  title,
  path: `reference/${id}`,
  authority: "reference",
  group,
  ...over,
});

const LABELS: Record<string, readonly string[]> = {
  "editing-brief": ["Editing brief", "Brief editoriale"],
  locations: ["Key Locations", "Luoghi chiave"],
  timeline: ["Timeline", "Timeline"],
};
const labelsOf = (source: SourceDescriptor) =>
  LABELS[source.sectionId ?? ""] ?? [];

const READS = [
  { group: "guidebook", sectionId: "editing-brief" },
  { group: "characters" },
  { group: "arcs" },
  { group: "world" },
  { group: "notes" },
] as const;

describe("referenceNames", () => {
  it("names each reference as the writer sees it, a character as sheet and arc together", () => {
    const catalogue = [
      doc("character--Marta.md", "characters", "Marta"),
      doc("world--locations.md", "world", "locations", {
        sectionId: "locations",
      }),
      doc("arc--Marta.md", "arcs", "Marta"),
      // An arc with no sheet is still that character.
      doc("arc--Aldo.md", "arcs", "Aldo"),
      doc("notes--harbour.md", "notes", "The harbour"),
      doc("guidebook--editing-brief.md", "guidebook", "editing-brief", {
        sectionId: "editing-brief",
      }),
      // Never nameable, whatever it claims.
      doc("summary--S1.md", "summaries", "S1", { kind: "summary" }),
      {
        id: "node:S1",
        kind: "manuscript",
        title: "Marta",
        path: "document/s1.md",
        nodeId: "S1",
        authority: "manuscript",
      } satisfies SourceDescriptor,
    ];
    const names = referenceNames(catalogue, READS, labelsOf);
    // The shelf's order, the interface's label.
    expect(names.shown).toEqual([
      "Marta",
      "Key Locations",
      "Aldo",
      "The harbour",
      "Editing brief",
    ]);
    expect(names.accepted).toEqual([
      {
        name: "Marta",
        ids: ["reference:character--Marta.md", "reference:arc--Marta.md"],
      },
      { name: "Key Locations", ids: ["reference:world--locations.md"] },
      // The other language's label is taken too, and not shown.
      { name: "Luoghi chiave", ids: ["reference:world--locations.md"] },
      { name: "Aldo", ids: ["reference:arc--Aldo.md"] },
      { name: "The harbour", ids: ["reference:notes--harbour.md"] },
      {
        name: "Editing brief",
        ids: ["reference:guidebook--editing-brief.md"],
      },
      {
        name: "Brief editoriale",
        ids: ["reference:guidebook--editing-brief.md"],
      },
    ]);
  });

  it("names only what the command reads", () => {
    const catalogue = [
      doc("character--Marta.md", "characters", "Marta"),
      doc("guidebook--prose-style.md", "guidebook", "prose-style", {
        sectionId: "prose-style",
      }),
    ];
    const names = referenceNames(
      catalogue,
      [{ group: "characters" }],
      labelsOf,
    );
    expect(names.shown).toEqual(["Marta"]);
    expect(referenceNames(catalogue, [], labelsOf)).toEqual({
      accepted: [],
      shown: [],
    });
  });

  it("takes one spelling once, and shows no name two references share", () => {
    const catalogue = [
      // A label both languages spell alike is one name.
      doc("world--timeline.md", "world", "timeline", {
        sectionId: "timeline",
      }),
      // A note and a character of one name: the parse takes neither by it,
      // so the list does not offer it.
      doc("character--Bruno.md", "characters", "Bruno"),
      doc("notes--bruno.md", "notes", "bruno"),
    ];
    const names = referenceNames(catalogue, READS, labelsOf);
    expect(
      names.accepted.filter((one) => one.name === "Timeline"),
    ).toHaveLength(1);
    expect(names.shown).toEqual(["Timeline"]);
    expect(names.accepted.map((one) => one.name)).toEqual([
      "Timeline",
      "Bruno",
      "bruno",
    ]);
  });
});
