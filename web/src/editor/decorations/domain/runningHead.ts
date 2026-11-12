// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { findParent, sectionNumbers } from "../../../project/structure";
import type { DocumentStructure } from "../../../project/types";

// ── The running head and the folio ───────────────────────────────────────────
//
// A printed page heads itself with the book's name and the Part it stands
// in, and numbers itself at the head and the foot. The number is the
// Section's place in the whole book, the one the structure panel draws.

export interface RunningHead {
  book: string;
  /** The Part holding the Section, or null for a Section at the root. */
  part: string | null;
  /** The Section's place in the book, or null for a node that is not one. */
  folio: number | null;
}

/** The head of the page that shows node `id` of the book titled `book`. */
export function runningHeadOf(
  structure: DocumentStructure,
  id: string,
  book: string,
): RunningHead {
  return {
    book,
    part: findParent(structure, id)?.title ?? null,
    folio: sectionNumbers(structure).get(id) ?? null,
  };
}
