// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { summaryBody } from "../../ai/adapters/summaryCodec";
import { CHARACTER_NAMES_MAX } from "../../ai/application/budgets";
import type { KnownName, SourceDescriptor } from "../../ai/domain/types";
import { stripUnansweredQuestions } from "../../project/referenceAnswers";
import { placeNames, sheetAliases } from "../../project/referenceNames";
import { stripAsides } from "../../project/asides";
import { NAME_FIELDS } from "../reference/referenceTemplates";

// What a model reads of a source, and the names it records.
//
// The two readings the project adapter makes of a document's bytes, as
// functions of the bytes alone, so the evaluation runners
// (`scripts/eval-common.mjs`) read a book as the app does, and a measurement
// of the fact check measures the reader the writer meets. One function each,
// called by the adapter and by the runners: a strip added to one is added to
// both.
//
// The book export reads references through the same two
// (`editor/export/host/projectSource.ts`), because what a reader of an
// exported file sees of a sheet is what a reader of the shelf sees, so a
// strip added here also changes every exported file.

/**
 * The asides strip every read applies first: nothing a writer wrote
 * to nobody reaches a model. `knownNames` reads this far and no further.
 */
export function withoutAsides(text: string): string {
  return stripAsides(text);
}

/**
 * A source's text as a model reads it: the asides gone, and then by kind a
 * reference's unanswered questions, which are a template's scaffolding,
 * and a summary's metadata block. `text` is already
 * `withoutAsides`.
 */
export function modelText(
  kind: SourceDescriptor["kind"],
  text: string,
): string {
  if (kind === "reference") return stripUnansweredQuestions(text);
  if (kind === "summary") return summaryBody(text);
  return text;
}

/**
 * The most name entries a reading gathers: the block shows
 * `CHARACTER_NAMES_MAX`, and the one past it says there were more.
 */
export const NAMES_MOST = CHARACTER_NAMES_MAX + 1;

/**
 * The names one reference records: a character sheet's title
 * and the answers under its names field, or each place the world's
 * Locations names; nothing from any other document. `text` is `withoutAsides`;
 * `room` bounds how many entries a place list may add.
 */
export function namesOf(
  source: Pick<SourceDescriptor, "id" | "group" | "sectionId" | "title">,
  text: string,
  room: number,
): KnownName[] {
  if (source.group === "world" && source.sectionId === "locations")
    return placeNames(text, NAME_FIELDS, room).map((names) => ({
      sourceId: source.id,
      kind: "place" as const,
      names,
    }));
  if (source.group !== "characters") return [];
  return [
    {
      sourceId: source.id,
      kind: "character",
      names: [source.title, ...sheetAliases(text, NAME_FIELDS)],
    },
  ];
}
