// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { asAgeCategory, asGenres, asTropes } from "./genres";
import { asAuthor, asDocumentType, asGoal, asStructureId } from "./properties";
import type { DocumentMeta, DocumentProperties } from "./types";

// A project's facts: what the writer declared about the book. This file is
// the one place that knows which fields of the `document` block those are,
// and every write of them after creation goes through `withFacts`. The rest
// of the block is the app's own.
//
// `guarded` runs every value through the guard `parseProperties` reads with,
// so a fact written here is one the reader keeps, whatever a form let
// through. An empty title or language is not an answer: the reader would
// refuse the first (`validateProperties`) and fall back on the second, so the
// stored one stands.

export type ProjectFacts = Pick<
  DocumentMeta,
  | "title"
  | "author"
  | "type"
  | "goal"
  | "language"
  | "structure"
  | "genres"
  | "ageCategory"
  | "tropes"
>;

/** The facts as the properties file holds them. */
export function factsOf(props: DocumentProperties): ProjectFacts {
  const d = props.document;
  return {
    title: d.title,
    author: d.author,
    type: d.type,
    goal: d.goal,
    language: d.language,
    structure: d.structure,
    genres: d.genres,
    ageCategory: d.ageCategory,
    tropes: d.tropes,
  };
}

/** The properties with these facts written in, and nothing else touched. */
export function withFacts(
  props: DocumentProperties,
  facts: ProjectFacts,
): DocumentProperties {
  const d = props.document;
  const next = guarded(facts);
  return {
    ...props,
    document: {
      ...d,
      ...next,
      title: next.title || d.title,
      language: next.language || d.language,
    },
  };
}

/**
 * Whether two answers say the same thing, compared after the guards as the
 * file would hold them; a save that changes nothing writes nothing.
 */
export function sameFacts(a: ProjectFacts, b: ProjectFacts): boolean {
  return JSON.stringify(guarded(a)) === JSON.stringify(guarded(b));
}

/**
 * Every fact through the guard `parseProperties` reads the `document` block
 * with. A guard changed there must change here too.
 */
function guarded(facts: ProjectFacts): ProjectFacts {
  return {
    title: facts.title.trim(),
    author: asAuthor(facts.author),
    type: asDocumentType(facts.type.trim()),
    goal: asGoal(facts.goal),
    language: facts.language.trim(),
    structure: asStructureId(facts.structure),
    genres: asGenres(facts.genres),
    ageCategory: asAgeCategory(facts.ageCategory),
    tropes: asTropes(facts.tropes),
  };
}
