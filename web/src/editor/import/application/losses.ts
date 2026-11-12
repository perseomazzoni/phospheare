// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ReadReport } from "../domain/source";

// What cannot come across. The import converts everything the app can hold
// and says nothing about it: lists and tables become paragraphs with their
// text, tracked changes are accepted, a link keeps its words. The writer
// hears only about what would otherwise vanish without a trace, content the
// project has no place for at all: footnotes, pictures and text boxes have no
// home in a manuscript of prose. Comments are not on the list,
// because an editor's comments come across into each chapter's margin.

export type LossKey = "footnotes" | "endnotes" | "images" | "textBoxes";

export interface Loss {
  key: LossKey;
  count: number;
}

const ORDER: readonly LossKey[] = [
  "footnotes",
  "endnotes",
  "images",
  "textBoxes",
];

/** What the file holds that the project will not, with how many of each. */
export function losses(report: ReadReport): Loss[] {
  return ORDER.flatMap((key) => {
    const count = report[key] ?? 0;
    return count > 0 ? [{ key, count }] : [];
  });
}
