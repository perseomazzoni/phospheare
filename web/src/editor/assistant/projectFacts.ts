// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import i18next from "i18next";
import type { ProjectFacts } from "../../ai/domain/types";
import { languageLabel } from "../../locales/languages";
import {
  SHAPE_IDS,
  partKeysFor,
  type ShapeId,
} from "../../project/startingShape";
import type { DocumentProperties } from "../../project/types";

/**
 * The book's own facts, narrowed for the assistant.
 *
 * The narrowing happens here rather than in the AI core because
 * `boundaries.test.ts` forbids that layer from importing the project layer,
 * and because `DocumentProperties` also carries `sync`, `stats`, `snapshots`
 * and `binnedSnapshots`, none of which is the model's business. A port member
 * that forwarded the whole object would make the boundary whatever someone
 * adds to that file next.
 *
 * The narrative structure is resolved through the project's language, not the
 * interface's: these beats are read beside a manifest of the writer's own Part
 * titles, in the language they write in. `getFixedT` falls back to English
 * for a language with no bundle, which is acceptable: the beats name the
 * shape's stages, and `projectBriefing` states that the Parts need not match
 * their wording. `"en-GB"` and `"en"` are one bundle, so only the primary
 * subtag is consulted, as in `referenceTemplates`.
 */
export function projectFactsOf(
  props: DocumentProperties | null,
): ProjectFacts | null {
  if (!props) return null;
  const doc = props.document;
  const shape = doc.structure;
  const known = (SHAPE_IDS as readonly string[]).includes(shape ?? "");
  // `empty` is a choice the writer made, to lay nothing out, and it is not a
  // declared structure. It reaches the model as absence, because the briefing
  // says opposite things in the two cases.
  const structured = known && shape !== null && shape !== "empty";
  const t = i18next.getFixedT(
    (doc.language || "en").toLowerCase().split("-")[0] ?? "en",
  );
  return {
    title: doc.title,
    type: doc.type,
    language: languageLabel(doc.language),
    // Chooses the Wikipedia edition a search goes to, and nothing else: no
    // prompt builder reads it.
    languageCode: doc.language || undefined,
    structure: structured
      ? {
          id: shape,
          label: t(`create.shape.${shape}`),
          description: t(`create.shapeDesc.${shape}`),
          beats: partKeysFor(shape as ShapeId).map((key) => t(key)),
        }
      : undefined,
    goal: doc.goal ?? undefined,
    genres: doc.genres.length ? doc.genres : undefined,
    ageCategory: doc.ageCategory ?? undefined,
    tropes: doc.tropes.length ? doc.tropes : undefined,
  };
}
