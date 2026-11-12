// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  ARC_PREFIX,
  CHARACTER_PREFIX,
  GUIDEBOOK_PREFIX,
  MD_EXT,
  NOTES_PREFIX,
  SUMMARY_PREFIX,
  WORLD_PREFIX,
  stemAfterPrefix,
} from "./naming";
import {
  isSectionGroup,
  sectionIdOf,
  sectionIndex,
  sectionLabelKey,
} from "./referenceSections";
import { findNode, walk } from "./structure";
import type { DocumentStructure } from "./types";

// ── The reference folder ─────────────────────────────────────────────────────
//
// `reference/` holds what the project is written against: the bible, the
// characters and their arcs, the per-section summaries, the worldbuilding,
// the notes.
//
// The folder is the open half of the project (`naming.ts`), so nothing here
// refuses a file: an unprefixed one has no group, stays in the folder
// untouched, and is not drawn. The prefixes give an order and a grouping the
// writer can see in a file manager, in the idiom `document/` uses.

export type ReferenceGroupId =
  "guidebook" | "characters" | "arcs" | "summaries" | "world" | "notes";

export interface ReferenceDoc {
  /** The identity and the path's last part (`summary--EL5.md`). */
  fileName: string;
  /** What the panel shows: the stem, without prefix or extension. */
  title: string;
  /**
   * For a summary, the document node it belongs to. Read from the file name,
   * and trusted only once the structure confirms it.
   */
  boundTo?: string;
}

export interface ReferenceGroup {
  id: ReferenceGroupId;
  docs: ReferenceDoc[];
}

/**
 * The order groups are drawn in, fixed rather than alphabetical: a writer
 * looking for a character looks in the same place every time, and "Arcs"
 * belongs under "Characters".
 */
const GROUP_ORDER: ReferenceGroupId[] = [
  "guidebook",
  "characters",
  "arcs",
  "summaries",
  "world",
  "notes",
];

const PREFIXES: Record<ReferenceGroupId, string> = {
  guidebook: GUIDEBOOK_PREFIX,
  characters: CHARACTER_PREFIX,
  arcs: ARC_PREFIX,
  summaries: SUMMARY_PREFIX,
  world: WORLD_PREFIX,
  notes: NOTES_PREFIX,
};

/** The prefix a group's `[+]` writes with. */
export function referencePrefixOf(group: ReferenceGroupId): string {
  return PREFIXES[group];
}

/** The stem, with its prefix and extension taken off. */
export function referenceTitle(fileName: string): string {
  const stem = fileName.toLowerCase().endsWith(MD_EXT)
    ? fileName.slice(0, -MD_EXT.length)
    : fileName;
  for (const group of GROUP_ORDER) {
    const prefix = PREFIXES[group];
    if (stem.startsWith(prefix)) return stem.slice(prefix.length);
  }
  return stem;
}

/** Which group a file name declares, or null when it declares none. */
export function referenceGroupOf(fileName: string): ReferenceGroupId | null {
  for (const group of GROUP_ORDER) {
    if (fileName.startsWith(PREFIXES[group])) return group;
  }
  return null;
}

/**
 * Whether two reference file names belong to the same reader face. The Notes
 * face holds the files with its prefix; every other reference document is
 * read on the Reference face. The shell's dirty-draft guard asks this so that
 * opening a document never interrogates the other face's unsaved draft.
 */
export function sameReaderFace(a: string, b: string): boolean {
  return a.startsWith(NOTES_PREFIX) === b.startsWith(NOTES_PREFIX);
}

/**
 * The writer-facing name of a reference file. A catalogue section shows its
 * localized label (the stem is the English id); a summary shows the title of
 * the Part or Section it summarises; every other file is named by its title.
 *
 * A summary's file is named by node id (`summary--EL5.md`), because the id is
 * the binding and survives a rename, but an id is not a name. `structure`
 * supplies the node's current title, so a rename shows at once; the id shows
 * only for a summary whose node is gone, where nothing else identifies it.
 */
export function referenceDisplayTitle(
  fileName: string,
  translate: (key: string) => string,
  structure?: DocumentStructure | null,
): string {
  const group = referenceGroupOf(fileName);
  if (group !== null && isSectionGroup(group)) {
    const id = sectionIdOf(group, fileName);
    if (id !== null) return translate(sectionLabelKey(group, id));
  }
  const node = summaryNodeTitle(fileName, structure);
  return node ?? referenceTitle(fileName);
}

/** The title of the node a summary file is bound to, or null. */
function summaryNodeTitle(
  fileName: string,
  structure: DocumentStructure | null | undefined,
): string | null {
  if (!structure || !fileName.startsWith(SUMMARY_PREFIX)) return null;
  const id = fileName.slice(
    SUMMARY_PREFIX.length,
    fileName.length - MD_EXT.length,
  );
  return findNode(structure, id)?.title ?? null;
}

/**
 * Turn a listing of `reference/` into the groups the shelf reads.
 *
 * Every group is returned, empty or not, because the sections themselves are
 * the interface. The panel draws four cards (Guidebook, Characters,
 * Summaries, Worldbuilding) and folds the arcs under their character, so the
 * `arcs` group is for counting and binding, not drawing.
 *
 * In the two compiled groups only files whose stem is a catalogue id are
 * drawn, in catalogue order. A hand-made `world--nordkapp.md` stays in the
 * folder untouched, as a file that declares no group does. The other groups
 * are freeform and alphabetical.
 *
 * `structure` puts the summaries in the document's order: a reader of
 * summaries is reading the project, whose order the alphabet does not know. A
 * summary whose node is not in the structure sorts after the rest rather than
 * disappearing.
 */
export function groupReference(
  fileNames: readonly string[],
  structure?: DocumentStructure | null,
): ReferenceGroup[] {
  const order = structure
    ? documentOrder(structure)
    : new Map<string, number>();

  const docs = fileNames
    .filter((name) => name.toLowerCase().endsWith(MD_EXT))
    .map<ReferenceDoc>((fileName) => ({
      fileName,
      // A summary's title is its node's, as in `referenceDisplayTitle`, so a
      // tie in the document-order sort breaks on a name too.
      title: summaryNodeTitle(fileName, structure) ?? referenceTitle(fileName),
      boundTo: fileName.startsWith(SUMMARY_PREFIX)
        ? fileName.slice(SUMMARY_PREFIX.length, fileName.length - MD_EXT.length)
        : undefined,
    }));

  const byGroup = new Map<ReferenceGroupId, ReferenceDoc[]>();
  for (const doc of docs) {
    const group = referenceGroupOf(doc.fileName);
    if (group === null) continue;
    if (isSectionGroup(group) && sectionIdOf(group, doc.fileName) === null)
      continue;
    const bucket = byGroup.get(group) ?? [];
    bucket.push(doc);
    byGroup.set(group, bucket);
  }

  return GROUP_ORDER.map((id) => ({
    id,
    docs: (byGroup.get(id) ?? []).sort(comparerFor(id, order)),
  }));
}

/** The notes group of a folder. */
export function notesOf(fileNames: readonly string[]): ReferenceDoc[] {
  return (
    groupReference(fileNames, null).find((g) => g.id === "notes")?.docs ?? []
  );
}

/**
 * How many documents the Reference shelf holds, by the reading the panel
 * draws with: the compiled sections, the characters and their arcs, the
 * summaries. An arc counts although the panel nests it under its character.
 *
 * Notes are excluded: they have their own button and count, and a note
 * counted on both would be one file giving two answers. The tree's Reference
 * button and the shelf's cards share this number, so the badge matches what
 * the button opens.
 */
export function referenceCountOf(fileNames: readonly string[]): number {
  return groupReference(fileNames, null).reduce(
    (total, group) =>
      group.id === "notes" ? total : total + group.docs.length,
    0,
  );
}

function comparerFor(id: ReferenceGroupId, order: Map<string, number>) {
  // The compiled groups read in catalogue order, not alphabetically.
  if (isSectionGroup(id)) {
    return (a: ReferenceDoc, b: ReferenceDoc) => {
      const ai = sectionIndex(id, a.fileName) ?? Number.MAX_SAFE_INTEGER;
      const bi = sectionIndex(id, b.fileName) ?? Number.MAX_SAFE_INTEGER;
      return ai === bi ? byTitle(a, b) : ai - bi;
    };
  }
  if (id !== "summaries") return byTitle;
  return (a: ReferenceDoc, b: ReferenceDoc) => {
    const ai = order.get(a.boundTo ?? "") ?? Number.MAX_SAFE_INTEGER;
    const bi = order.get(b.boundTo ?? "") ?? Number.MAX_SAFE_INTEGER;
    return ai === bi ? byTitle(a, b) : ai - bi;
  };
}

// `localeCompare`, so "Ölund" sorts where a reader of that language expects
// it rather than after "Z".
const byTitle = (a: ReferenceDoc, b: ReferenceDoc) =>
  a.title.localeCompare(b.title);

function documentOrder(structure: DocumentStructure): Map<string, number> {
  const order = new Map<string, number>();
  let index = 0;
  walk(structure.children, (node) => order.set(node.id, index++));
  return order;
}

/**
 * Which reference document summarises a given node, according to the folder.
 *
 * The structure file is the authority on the binding; this is the folder's
 * answer to the same question. The panel shows the `§` marker only where both
 * agree, because a binding to a summary the folder does not hold would promise
 * a document that is not there. Nothing above the storage port knows whether
 * the folder is local or remote.
 */
export function summariesInFolder(
  fileNames: readonly string[],
): Map<string, string> {
  const found = new Map<string, string>();
  for (const fileName of fileNames) {
    if (!fileName.startsWith(SUMMARY_PREFIX)) continue;
    found.set(
      fileName.slice(SUMMARY_PREFIX.length, fileName.length - MD_EXT.length),
      fileName,
    );
  }
  return found;
}

// ── The character's arc ──────────────────────────────────────────────────────
//
// The writer names a character (`character--Maren Voss.md`); the arc is
// attached, never named on its own: `arc--Maren Voss.md` is her arc because
// the stems agree, and the Characters card draws the pair as one unit. The
// file-name pair is the whole binding, with no manifest. An arc whose
// character is gone is not drawn and stays in the folder, like a file that
// declares no group.

export interface CharacterEntry {
  character: ReferenceDoc;
  /** The character's arc document, when it exists. */
  arc: ReferenceDoc | null;
}

/** `arc--Maren Voss.md` for `character--Maren Voss.md`. */
export function arcFileNameForCharacter(characterFileName: string): string {
  return `${ARC_PREFIX}${stemAfterPrefix(characterFileName, CHARACTER_PREFIX)}${MD_EXT}`;
}

/** The other direction: `character--Maren Voss.md` for `arc--Maren Voss.md`. */
export function characterFileNameForArc(arcFileName: string): string {
  return `${CHARACTER_PREFIX}${stemAfterPrefix(arcFileName, ARC_PREFIX)}${MD_EXT}`;
}

/**
 * The Characters card's reading of the folder: every character with its arc
 * (or null), sorted by title so the card is stable across reloads.
 *
 * The stem comparison ignores case, as the platforms the app writes to do:
 * `arc--maren voss.md` belongs to Maren.
 */
export function charactersWithArcs(
  fileNames: readonly string[],
): CharacterEntry[] {
  const characters: ReferenceDoc[] = [];
  const arcs = new Map<string, ReferenceDoc>();
  for (const fileName of fileNames) {
    if (!fileName.toLowerCase().endsWith(MD_EXT)) continue;
    if (fileName.startsWith(CHARACTER_PREFIX)) {
      characters.push({ fileName, title: referenceTitle(fileName) });
    } else if (fileName.startsWith(ARC_PREFIX)) {
      const key = stemAfterPrefix(fileName, ARC_PREFIX).toLowerCase();
      // Among stems that differ only by case, the first listed wins.
      if (!arcs.has(key))
        arcs.set(key, { fileName, title: referenceTitle(fileName) });
    }
  }
  characters.sort((a, b) => a.title.localeCompare(b.title));

  const entries: CharacterEntry[] = [];
  for (const character of characters) {
    const key = stemAfterPrefix(
      character.fileName,
      CHARACTER_PREFIX,
    ).toLowerCase();
    entries.push({ character, arc: arcs.get(key) ?? null });
  }

  return entries;
}
