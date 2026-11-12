// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { titleProblem } from "../../../project/naming";
import { countWords } from "../../../project/stats";
import { TYPE_GOAL_DEFAULTS, typeForWords } from "../../../project/types";
import type { MatterKind } from "../domain/source";
import type { ProjectRules, TitleWords } from "../ports";

// The project's rules, handed to the import. The application may not import
// the project (`boundaries.test.ts`), and must still count words the app's
// way, refuse the titles the app refuses and propose a type by the creation
// dialog's ranges, so the host wires the project's own functions behind the
// port, and the two can never disagree.

export const projectRules: ProjectRules = {
  countWords,
  titleProblem: (title) => titleProblem(title)?.code ?? null,
  typeForWords,
  typeGoal: (type) => TYPE_GOAL_DEFAULTS[type],
};

/** A translate function fixed to one language: `i18n.getFixedT(lang)`. */
export type FixedT = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

/**
 * The words the import writes into the book, in the book's language: a piece
 * with no title in an Italian manuscript is "Senza titolo" even when the
 * interface is in English. A language the app has no strings for falls back
 * through i18n's own fallback (English).
 */
export function titleWords(t: FixedT): TitleWords {
  return {
    untitled: t("import.title.untitled"),
    matter: (kind: MatterKind) => t(`import.title.matter.${kind}`),
    scene: (chapter: string, n: number) =>
      t("import.title.scene", { title: chapter, n }),
    split: (row: string, n: number) =>
      t("import.title.split", { title: row, n }),
    shared: (title: string, n: number) =>
      t("import.title.shared", { title, n }),
  };
}
