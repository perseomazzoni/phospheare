// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The book's facts as the export reads them: the stored metadata, with each
// coded value already turned into words by the host. A genre id is the host's
// to name, through the locale; this module never imports the project's
// catalogues. `type` is the one fact kept raw, because the stored type decides
// the manuscript's story or novel shape, and the app shows the type verbatim
// everywhere ("Novel", or the writer's own words).

export interface BookFacts {
  id: string;
  title: string;
  author: string;
  /** The stored type verbatim: "Novel", "Short Story" or the writer's own. */
  type: string;
  /** BCP-47 base code. */
  language: string;
  languageLabel: string;
  genres: string[];
  ageCategory: string | null;
  tropes: string[];
  structure: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A Part or Section of the manuscript, in reading order. */
export interface ManuscriptNode {
  id: string;
  kind: "part" | "section";
  title: string;
  children: ManuscriptNode[];
}

export type ReferenceGroupId =
  "guidebook" | "characters" | "arcs" | "summaries" | "world" | "notes";

/** One document from the book's reference folder, notes included. */
export interface ReferenceEntry {
  fileName: string;
  group: ReferenceGroupId;
  title: string;
}

/**
 * The order an export reads the reference shelf in. Arcs are not a group of
 * their own here: each rides with its character (`exportGroupOf`), as the
 * shelf folds the arc under its character. Notes are an area of their own,
 * after.
 */
export const REFERENCE_GROUP_ORDER = [
  "guidebook",
  "characters",
  "world",
  "summaries",
] as const satisfies readonly ReferenceGroupId[];

/** The group a reference is exported under: an arc goes with its character. */
export function exportGroupOf(group: ReferenceGroupId): ReferenceGroupId {
  return group === "arcs" ? "characters" : group;
}
