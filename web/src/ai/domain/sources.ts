// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What a chat can read: the project's structure and facts, and each source
// as the catalogue describes it and as a run reads it.

import type { SummaryState } from "./workflows";

/**
 * What kind of thing a source is. There is no `snapshot`.
 *
 * A snapshot is prose the writer set aside, an earlier take or an alternative
 * they did not adopt, and it is the one thing in a project that must never
 * reach a model: an assistant that reads it answers from a draft the writer
 * rejected and quotes it back as if it were the book, and the writer cannot
 * tell which of the two they are being shown. The adopted file is the work.
 *
 * Enforced by absence rather than by a filter: a filter must be repeated on
 * every path in, and one path without it leaves the way open. With no such
 * kind in this union, the port cannot describe a snapshot without a compile
 * error.
 */
export type SourceKind = "manuscript" | "reference" | "note" | "summary";

/**
 * Where a source stands: the writer's own prose, something they wrote about
 * it, or something the app generated. A reference document carries no
 * settled-or-tentative flag.
 */
export type Authority = "reference" | "derived" | "manuscript";

/**
 * How much of a source the model saw. Reported in receipts and coverage so
 * "checked" is never claimed for a source that was only mapped.
 */
export type ContextCoverage = "full-text" | "excerpt" | "summary-only";

/**
 * The writer's declared narrative structure, resolved.
 *
 * `id` is the `ShapeId` stored in the project; everything else is derived for
 * the model's benefit. `beats` are the Part titles the shape scaffolds with,
 * resolved in the project's own language: an Italian book's Parts are named
 * `Presentazione / Confronto / Risoluzione` on disk, and this field exists to
 * compare those names against what the manuscript holds. An English beat
 * list would make that a translation instead of a comparison.
 *
 * A project that chose no shape has no `ProjectStructure` at all, rather than
 * one with an empty `beats`. The two are opposite instructions: "compare the
 * Parts against these beats" and "the writer declared nothing, so do not
 * impose a formula", as `domain/skills/50-structure-and-motivation.md` says.
 */
export interface ProjectStructure {
  /** The stored `ShapeId`: `"threeact"`, `"kishotenketsu"`. */
  id: string;
  /** The shape's display name, e.g. "Kishōtenketsu (four acts)". */
  label: string;
  /** What the shape is, never who it suits (that is `create.shapeFit.*`). */
  description: string;
  /** The Part titles it scaffolds with, in order, in the project's language. */
  beats: string[];
}

/**
 * What the model is told about the book itself, as opposed to its contents,
 * and, in one field that says so, what the app needs to know about it.
 *
 * Every fact the model reads answers a named question: what is this called,
 * what kind of thing is it, what language is it in, what shape did the
 * writer declare, what length are they aiming at. `languageCode` answers
 * "which Wikipedia edition" and is never told to the model.
 * `document-properties.json` also holds `id`, `createdAt` and `updatedAt`;
 * none answers a question a reader of the manuscript would ask, and
 * `updatedAt` changes on every save, churn in a block sent on every turn.
 *
 * Declared here rather than imported from `project/types`:
 * `boundaries.test.ts` forbids this layer from importing the project layer,
 * and the narrowing is the point. `DocumentProperties` also carries `sync`,
 * `stats`, `snapshots` and `binnedSnapshots`; a shape that forwarded the
 * whole object would make this boundary whatever someone adds to that file
 * next.
 */
export interface ProjectFacts {
  title: string;
  /** "Novel", "Short Story": the writer's own words, free text by design. */
  type: string;
  language: string;
  /**
   * The project's language as its file states it (`"it"`, `"en-GB"`), for
   * the Wikipedia engine's edition and nothing else.
   *
   * Raw and file-controlled, so only `wikiLanguage` may read it, and no
   * prompt builder does: the label above already tells the model the
   * language, and a code beside it would be a second statement that could
   * disagree with the first. It sits here rather than behind a second
   * language thunk, because one question, what language this book is in,
   * gets one answer.
   */
  languageCode?: string;
  /** Absent when the writer chose no structure, as `ProjectStructure` says. */
  structure?: ProjectStructure;
  /** A word target for the whole document, when the writer set one. */
  goal?: number;
  /**
   * The genre ids the writer declared, lead first (`project/genres.ts`).
   * Only an id with a pack reaches a prompt (`genreBriefing`), so a forged
   * one in a shared file is dropped, never quoted.
   */
  genres?: readonly string[];
  /** Who the book is for, as its id; only a known id reaches a prompt. */
  ageCategory?: string;
  /**
   * The tropes the writer means the book to deliver, in their own words.
   * Data the writer typed: quoted in a prompt, never obeyed.
   */
  tropes?: readonly string[];
}

/**
 * What a person or a place in the book is called: the name it is
 * filed under first, then the other names the writer recorded for it. Read
 * host-side from a character sheet's names field or a Locations place, and
 * nothing else from either document: the port hands the core names, never a
 * sheet, so no workflow that routes by them can read what a sheet says.
 */
export interface KnownName {
  /** The document the names were read from, as the catalogue lists it. */
  sourceId: string;
  /** A character sheet, or a place in the world's Locations. */
  kind: "character" | "place";
  names: string[];
}

export interface SourceDescriptor {
  id: string;
  kind: SourceKind;
  title: string;
  path: string;
  nodeId?: string;
  /**
   * For a summary, the node it summarises: the binding its file name
   * carries, declared by the port so this layer never parses a path. `/where`
   * routes each Section by its summary.
   *
   * Its own field rather than `nodeId`, which means "this source is that
   * node": a reader chat's horizon is found by `nodeId`, and a summary that
   * answered to it would be one list-order change away from being taken for
   * the node itself.
   */
  summarises?: string;
  /** Present for manuscript sources: what the structure calls the node. */
  nodeKind?: "part" | "section";
  order?: number;
  /**
   * The reference shelf this source sits on (`guidebook`, `characters`,
   * `arcs`, `world`, `summaries`, `notes`), for reference-shaped sources only.
   *
   * A finer axis than `kind`, which collapses four of those into `reference`
   * because they are read the same way. The model needs the finer one: a
   * character sheet and a worldbuilding document answer different questions.
   *
   * A plain string, not the project layer's `ReferenceGroupId`, for the
   * boundary `ProjectFacts` states; nothing here branches on the value: it is
   * a label the model reads, not a discriminator the app switches on. An id
   * is the only way to address a source; a group never becomes an address.
   */
  group?: string;
  /**
   * The catalogue section a guidebook or world document is (`prose-style`,
   * `timeline`, …), so a command can declare what it reads by what a document
   * is rather than by its title. The adapter hands over only an id it
   * matched against the catalogue, never a file name's raw stem, so a file
   * in a shared folder cannot name a section into existence.
   */
  sectionId?: string;
  /**
   * The Part a Part or Section sits in, by node id; absent at the top of the
   * Structure. The listing is flat and in reading order; this is the one
   * thing the order cannot say.
   */
  partId?: string;
  /** Words in a Part or Section, from the project's own stats, when known. */
  words?: number;
  /**
   * A Part or Section whose summary the writer kept from the assistant.
   * The bar drops the summary from the listing, so
   * without this a run could not tell "barred" from "missing", and would
   * write over the writer's file to fill the gap. It says only that one
   * exists and is barred: never its name or a word of it.
   */
  summaryBarred?: true;
  authority: Authority;
  revision?: string;
  freshness?: SummaryState;
}

/** One captured read: the text plus the revision it was captured at. */
export interface SourceText {
  text: string;
  revision: string;
  /**
   * Where the bytes came from. A live-buffer read is the writer's unsaved
   * text; a project-file read is what is on disk. The distinction travels
   * into the receipt because a pin that resolves to a live buffer is a
   * different fact from a pin that resolves to a file.
   */
  origin: "live-buffer" | "project-file";
}
