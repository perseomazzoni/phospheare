// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  GUIDEBOOK_PREFIX,
  MD_EXT,
  WORLD_PREFIX,
  stemAfterPrefix,
} from "./naming";
import type { ReferenceGroupId } from "./reference";

// The section catalogue.
//
// The guidebook and the world are compiled, not filled: each catalogue id is
// one small document the writer creates on demand, named `prefix + id + .md`.
// The static catalogue answers what can exist, the order it is drawn in, and
// whether a file on disk is a named section or something else left behind.
//
// The ids are code constants, never user input, so a section file's name is
// as trusted as a constant. Labels live in the locales under
// `reference.section.<group>.<id>`; the file stem stays English, so the
// writer's file manager reads the same on every machine.
//
// Pure, with no template imports: the asset table is `referenceTemplates.ts`
// on the editor side, and a completeness test joins the two.

export type SectionGroupId = "guidebook" | "world";

/**
 * Canonical order, not alphabetical: the order a story is built up in and the
 * picker draws, so a writer always finds a section in the same place.
 */
export const GUIDEBOOK_SECTION_IDS: readonly string[] = [
  "at-a-glance",
  "editing-brief",
  "prose-style",
  "theme",
  "view",
  "promise",
  "logline",
  "blurb",
  "query",
  "summary",
  "alignment",
  "continuity",
  "series",
  "research",
];

export const WORLD_SECTION_IDS: readonly string[] = [
  "rules",
  "systems",
  "geography",
  "locations",
  "travel",
  "timeline",
  "peoples",
  "cultures",
  "religion",
  "language",
  "economy",
  "factions",
  "ecology",
  "myths",
  "conflict",
];

const CATALOGS: Record<SectionGroupId, readonly string[]> = {
  guidebook: GUIDEBOOK_SECTION_IDS,
  world: WORLD_SECTION_IDS,
};

const PREFIXES: Record<SectionGroupId, string> = {
  guidebook: GUIDEBOOK_PREFIX,
  world: WORLD_PREFIX,
};

/** Whether a group is compiled from a catalogue rather than named by hand. */
export function isSectionGroup(
  group: ReferenceGroupId,
): group is SectionGroupId {
  return group === "guidebook" || group === "world";
}

/** The catalogue of a group, in canonical order; empty for the others. */
export function sectionIdsOf(group: ReferenceGroupId): readonly string[] {
  return isSectionGroup(group) ? CATALOGS[group] : [];
}

/**
 * The catalogue id a file name declares, or null when it declares none. The
 * comparison ignores case, as the platforms the app writes to do:
 * `world--Economy.md` on a case-preserving filesystem is the Economy section.
 */
export function sectionIdOf(
  group: ReferenceGroupId,
  fileName: string,
): string | null {
  if (!isSectionGroup(group)) return null;
  const stem = stemAfterPrefix(fileName, PREFIXES[group]).toLowerCase();
  return CATALOGS[group].find((id) => id === stem) ?? null;
}

/** The file name a section is created with (`world--economy.md`). */
export function sectionFileName(group: SectionGroupId, id: string): string {
  return `${PREFIXES[group]}${id}${MD_EXT}`;
}

/**
 * A section's catalogue position, or null when the file is not a section.
 * `groupReference` sorts by it, so the shelf reads in catalogue order.
 */
export function sectionIndex(
  group: ReferenceGroupId,
  fileName: string,
): number | null {
  const id = sectionIdOf(group, fileName);
  if (id === null || !isSectionGroup(group)) return null;
  const index = CATALOGS[group].indexOf(id);
  return index === -1 ? null : index;
}

/**
 * The i18n key of a section's label, shared by the picker, the card and the
 * reader's meta line so they cannot disagree on the key's shape.
 */
export function sectionLabelKey(group: SectionGroupId, id: string): string {
  return `reference.section.${group}.${id}`;
}

/** The i18n key of the picker's one-line description for a section. */
export function sectionDescriptionKey(
  group: SectionGroupId,
  id: string,
): string {
  return `reference.sectionDesc.${group}.${id}`;
}
