// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { TFunction } from "i18next";
import { folderNameFor } from "../../project/naming";
import { refIdentity } from "../../project/refIdentity";
import type { ProjectRef } from "../../storage";
import type { ProjectCard as Card } from "./useProjects";

/**
 * What is about to be binned, for the mono evidence block: the folder name,
 * then the size, because a folder name alone does not tell two similar
 * projects apart.
 *
 * An unread folder gets its name alone. A card never shows zeros for
 * something it could not read, and a confirmation least of all.
 */
export function evidenceFor(
  card: Card,
  t: TFunction,
  language: string,
): string {
  const folder = `${card.ref.name}/`;
  if (!card.content) return folder;

  const words = new Intl.NumberFormat(language).format(card.content.words);
  const shape = t("library.shape", {
    parts: card.content.parts,
    sections: card.content.sections,
  });
  return `${folder}\n${words} ${t("library.words")} · ${shape}`;
}

/**
 * The folder names already taken on this shelf. A clash with a folder outside
 * the library is caught by the provider, which alone can see it. `except` is
 * the project being renamed, so it is never refused its own name.
 */
export function takenFolders(
  cards: readonly Card[],
  except?: ProjectRef,
): Set<string> {
  return new Set(
    cards
      .filter(
        (card) => !except || refIdentity(card.ref) !== refIdentity(except),
      )
      .map((card) => folderNameFor(card.ref.name)),
  );
}
