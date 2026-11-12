// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { PERSONAS } from "../../ai/domain/personas";
import {
  CATALOGUE,
  type CataloguePage,
} from "../../ai/domain/referenceCatalogue";
import { ROOMS } from "../../ai/domain/rooms";
import { EDITING_BRIEF, aiSkills } from "../../ai/domain/skills";
import { CHAT_KINDS, READ_GROUPS, type ReadRef } from "../../ai/domain/types";
import {
  referenceGroupOf,
  referencePrefixOf,
  type ReferenceGroupId,
} from "../../project/reference";
import { isSectionGroup, sectionIdsOf } from "../../project/referenceSections";

// ── Reads against the real catalogue ─────────────────────────────────────────
//
// The AI layer may not import the project layer (`boundaries.test.ts`), so it
// keeps its own copy of the group ids and checks a `reads:` section only for
// its shape. This file sees both, so a misspelt `world:timline` fails
// here rather than as a review that never attaches the Timeline.

describe("the declared reads", () => {
  it("names only groups the project has", () => {
    // Compile-time: a group the project does not have fails to typecheck.
    const groups = READ_GROUPS satisfies readonly ReferenceGroupId[];
    // Runtime: each one is the group its own files are filed under.
    for (const group of groups)
      expect(referenceGroupOf(`${referencePrefixOf(group)}x.md`)).toBe(group);
  });

  it("names only sections the catalogue has, in every bundled skill", () => {
    const reads = aiSkills.flatMap((skill) => skill.reads);
    expect(reads).toContainEqual(EDITING_BRIEF);
    for (const read of reads) {
      if (read.sectionId === undefined) continue;
      expect(isSectionGroup(read.group)).toBe(true);
      expect(sectionIdsOf(read.group)).toContain(read.sectionId);
    }
  });

  it("gives every review something to check the prose against", () => {
    for (const skill of aiSkills)
      if (skill.reviewTask) expect(skill.reads.length).toBeGreaterThan(1);
  });
});

// ── The reads matrix ─────────────────────────────────────────────────────────
//
// Who reads which page: every command, every room and every persona's focus.
// A page nothing reads is a page the writer fills in for nobody.

/** Every place that declares reads, by a name a failure can point at. */
const consumers: Array<{ name: string; reads: readonly ReadRef[] }> = [
  ...aiSkills.map((skill) => ({
    name: `/${skill.command}`,
    reads: skill.reads,
  })),
  ...CHAT_KINDS.map((kind) => ({
    name: `room ${kind}`,
    reads: ROOMS[kind].reads,
  })),
  ...PERSONAS.flatMap((persona) =>
    persona.presets.map((preset) => ({
      name: `preset ${preset.id}`,
      reads: preset.reads,
    })),
  ),
];

/** The catalogue pages one entry reaches: a group reaches all of its own. */
function pagesOf(read: ReadRef): CataloguePage[] {
  const pages = [...CATALOGUE.values()];
  if (read.group === "characters")
    return pages.filter((page) => page.id === "character");
  if (read.group === "arcs") return pages.filter((page) => page.id === "arc");
  return pages.filter(
    (page) =>
      page.id.startsWith(`${read.group}:`) &&
      (read.sectionId === undefined ||
        page.id === `${read.group}:${read.sectionId}`),
  );
}

describe("the reads matrix", () => {
  it("names only sections the catalogue has, in every room and every focus too", () => {
    for (const { name, reads } of consumers)
      for (const read of reads) {
        if (read.sectionId === undefined) continue;
        expect(sectionIdsOf(read.group), name).toContain(read.sectionId);
      }
    for (const skill of aiSkills)
      for (const need of skill.needs)
        if (need.sectionId !== undefined)
          expect(sectionIdsOf(need.group), skill.command).toContain(
            need.sectionId,
          );
  });

  it("narrows only to roles the page it narrows carries", () => {
    // `characters(texture)` would attach nothing at all, in silence.
    for (const { name, reads } of consumers)
      for (const read of reads) {
        if (!read.roles) continue;
        for (const role of read.roles)
          expect(
            pagesOf(read).some((page) =>
              page.fields.some((field) => field.role === role),
            ),
            `${name}: ${read.group}(${role})`,
          ).toBe(true);
      }
  });

  it("has every page read by at least two besides /canon", () => {
    for (const page of CATALOGUE.values()) {
      const readers = consumers
        .filter(({ name }) => name !== "/canon")
        .filter(({ reads }) =>
          reads.some((read) => pagesOf(read).includes(page)),
        )
        .map(({ name }) => name);
      expect(
        readers.length,
        `${page.id}: ${readers.join(", ")}`,
      ).toBeGreaterThan(1);
    }
  });

  it("never lets a reader's focus read past its room's extras", () => {
    // A reader's allowed set is the manuscript through its horizon and the
    // room's extras: a focus that declared more would ask for what the
    // boundary drops, and say it read it.
    for (const persona of PERSONAS)
      for (const preset of persona.presets)
        for (const kind of preset.chats)
          for (const read of preset.reads)
            expect(
              ROOMS[kind].readerExtras.length === 0 ||
                ROOMS[kind].readerExtras.some(
                  (one) =>
                    one.group === read.group &&
                    one.sectionId === read.sectionId,
                ),
              `preset ${preset.id} in ${kind}`,
            ).toBe(true);
  });
});
