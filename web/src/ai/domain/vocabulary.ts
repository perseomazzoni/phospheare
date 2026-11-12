// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The assistant's closed vocabularies: the chat kinds, review tasks, scope
// and word kinds, reference roles and read groups, each a list the codecs
// check a file against.

/**
 * Every kind of chat, in the order every picker shows them.
 *
 * The array is the source and the union derives from it, so the pickers and
 * the codec's validator cannot fall out of step. A kind the codec missed
 * would be a chat the app can create and cannot read back.
 *
 * The order runs from the widest to the most particular reading: anything at
 * all, writing with help, a first reader, a later reader, an editor's sweep.
 */
export const CHAT_KINDS = [
  "general",
  "drafting",
  "alpha-reader",
  "beta-reader",
  "editorial",
] as const;

export type ChatKind = (typeof CHAT_KINDS)[number];

/**
 * The review tasks, as a list the codecs can check a file against: a task is
 * read back from a chat file or a review checkpoint in the project folder, and
 * it picks the rubric that goes into the model's instructions, so a value
 * that is not one of these never gets that far.
 */
export const REVIEW_TASKS = [
  "unresolved",
  "continuity",
  "consistency",
  "developmental",
  "line",
  // The sensitivity reader: how the book renders people and places not the
  // writer's own.
  "sensitivity",
] as const;

export type ReviewTask = (typeof REVIEW_TASKS)[number];

/**
 * The words a writer can type after a command to say how much it reads.
 * They are the app's own nouns, because the writer's project has a
 * Structure of Parts and Sections, not a "book", and not a "full" anything.
 *
 * Only what a run can serve is listed: any other word would parse, reach the
 * exhaustive switch in `runReview`, and have nowhere to go.
 */
export const SCOPE_KINDS = ["section", "part", "structure"] as const;

export type ScopeKind = (typeof SCOPE_KINDS)[number];

/**
 * Which word counts a command's run prints beside its rows: `words:`
 * in its file. `part` is a Part's whole count, its own opening and every
 * Section inside it (`partWords`); `section` is a Section's own.
 */
export const WORD_KINDS = ["part", "section"] as const;

export type WordKind = (typeof WORD_KINDS)[number];

/**
 * How much a scoped command reads, resolved; never the words that were typed.
 *
 * - `current`: nothing was typed. The quote when one is attached, otherwise
 *   the open Section.
 * - `section`: the whole open Section, even with a quote attached.
 * - `part`: every Section of the Part that holds the open Section (or of the
 *   open Part). A plan never stores it: the Part is resolved when the run
 *   starts and planned as the `node` that names it, so a resume reads the
 *   Part that was meant, not whichever one is open then.
 * - `structure`: every Section in the Structure (a Part's own file is its
 *   heading, and is not read as prose).
 * - `node`: one Part or Section the writer named by its title; for a Part,
 *   every Section of it, read together. Only its id is held: a stored title
 *   would stop matching once the node is renamed, and a resumed run would
 *   then read something else.
 */
export type ReviewScope =
  { kind: "current" } | { kind: ScopeKind } | { kind: "node"; nodeId: string };

/**
 * What a reference field is for: the catalogue gives every field one
 * (`referenceCatalogue.ts`, which re-exports these), and a command's `reads:`
 * may narrow a group to some of them (`characters(rule)`). They live here,
 * where nothing is imported, so the frontmatter parser can check a role
 * without importing the catalogue it parses.
 */
export const REFERENCE_ROLES = [
  "fact",
  "knowledge",
  "plan",
  "rule",
  "open",
  "known-issue",
  "inner",
  "intent",
  "texture",
  "brief",
] as const;

export type ReferenceRole = (typeof REFERENCE_ROLES)[number];

/** A record's role: a catalogued field's, or `unclassified` when unplaced. */
export type RecordRole = ReferenceRole | "unclassified";

/**
 * The reference groups a command may declare it reads (`reads:` in its skill
 * file). A copy of the project layer's group ids, because this layer
 * may not import that one; `readsCatalogue.test.ts` on the editor side pins
 * the two together. `summaries` is left out: a summary is the model's own
 * output, not the writer's intent, and a review that checked the prose
 * against it would be checking the model against itself.
 */
export const READ_GROUPS = [
  "guidebook",
  "characters",
  "arcs",
  "world",
  "notes",
] as const;

export type ReadGroup = (typeof READ_GROUPS)[number];

/**
 * One entry of a command's `reads:`: a whole group, or one catalogue section
 * of a group that has them (`guidebook:prose-style`). Matched against
 * `SourceDescriptor.group` and `.sectionId`, which the adapter fills only from
 * the catalogue, so a file cannot name itself into a command's reads.
 */
export interface ReadRef {
  readonly group: ReadGroup;
  readonly sectionId?: string;
  /**
   * The roles of the records this entry attaches: a line edit needs
   * a sheet's voice and the style rules, never its wound or its history.
   * Absent: every record. It narrows what is shown, never what is readable:
   * the document's text as read is still the evidence a quote is checked in.
   */
  readonly roles?: readonly RecordRole[];
}
