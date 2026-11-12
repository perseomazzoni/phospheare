// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  STRUCTURE_VERSION,
  type DocumentStructure,
  type PartNode,
} from "./types";
import { snapshotFileName, toSlug } from "./naming";
import { EMPTY_CONTENT_HASH } from "./mutations";

// ── What a new project starts as ─────────────────────────────────────────────
//
// Empty, or a scaffold of Parts. Every shape the dialog offers is a list of
// Parts holding nothing yet, so no choice can produce a Part holding both
// Parts and Sections: that is the Golden Rule's enforcement at creation.
//
// The chosen id is what `document-properties.json` records in
// `document.structure` ("empty" persists as null), so the creation choice
// outlives the dialog. The ids are full names for the reader of that file:
// "threeact", never "three".

export interface StartingShape {
  structure: DocumentStructure;
  /** The snapshot files to write: one `.00` per Part, which holds text. */
  files: { fileName: string; content: string }[];
}

// ── The catalogue ────────────────────────────────────────────────────────────
//
// The values are locale keys, not words. The dialog resolves them, so a
// writer working in Italian gets Italian Part names, and this file stays pure.
//
// The resolved titles become file names through `toSlug` and
// `snapshotFileName`. "Kishōtenketsu" and "dénouement" appear in the option
// labels, which nothing writes to disk, never in the Parts themselves.

export type ShapeId =
  "empty" | "threeact" | "kishotenketsu" | "freytagspyramid" | "herosjourney";

/**
 * "No structure": a choice in the selects, never a value in the file, which
 * keeps it as null (`asStructureId`). Every crossing between the two names it
 * here.
 */
export const NO_STRUCTURE: ShapeId = "empty";

/** Offer order; the default, first, is the one that assumes least. */
export const SHAPE_IDS: readonly ShapeId[] = [
  "empty",
  "threeact",
  "kishotenketsu",
  "freytagspyramid",
  "herosjourney",
] as const;

const PART_KEYS: Record<ShapeId, readonly string[]> = {
  empty: [],
  threeact: [
    "create.partSetup",
    "create.partConfrontation",
    "create.partResolution",
  ],
  kishotenketsu: [
    "create.partKi",
    "create.partSho",
    "create.partTen",
    "create.partKetsu",
  ],
  freytagspyramid: [
    "create.partExposition",
    "create.partRising",
    "create.partClimax",
    "create.partFalling",
    "create.partDenouement",
  ],
  herosjourney: [
    "create.partDeparture",
    "create.partInitiation",
    "create.partReturn",
  ],
};

/**
 * The locale keys naming each Part of a shape, in order.
 *
 * A shape must never repeat a key: `startingShape` drops a duplicate title,
 * so a repeat would ship a four-Part scaffold to a writer who chose five.
 */
export function partKeysFor(shape: ShapeId): readonly string[] {
  return PART_KEYS[shape];
}

/**
 * A structure of Parts with the given titles, and the files that back them.
 *
 * Duplicate titles are dropped rather than suffixed. The titles come from a
 * fixed, translated list, so a collision means the translation repeated
 * itself; the id in every file name would let "Part One 2" open, but it would
 * ship that bug into the writer's folder.
 *
 * Every Part starts with one snapshot, its `.00` file, adopted, so a fresh
 * project satisfies the validator on the first open. `at` is the moment the
 * snapshots' `created` fields record; tests pass a fixed date.
 */
export function startingShape(
  partTitles: readonly string[],
  at = new Date().toISOString(),
): StartingShape {
  const seen = new Set<string>();
  const children: PartNode[] = [];
  const files: StartingShape["files"] = [];

  for (const raw of partTitles) {
    const title = raw.trim();
    if (!title) continue;
    const slug = toSlug(title);
    if (seen.has(slug)) continue;
    seen.add(slug);

    const id = `EL${children.length + 1}`;
    const file = snapshotFileName("part", slug, id, 0);
    children.push({
      kind: "part",
      id,
      title,
      adopted: file,
      snapshots: [
        {
          file,
          title: `${title} 1`,
          created: at,
          contentHash: EMPTY_CONTENT_HASH,
        },
      ],
      children: [],
    });
    // Empty, not a heading: the title is already in the file name, and a
    // `# Part One` in `part--part_one.EL1.00.md` would be words the writer did
    // not write.
    files.push({ fileName: file, content: "" });
  }

  return { structure: { version: STRUCTURE_VERSION, children }, files };
}
