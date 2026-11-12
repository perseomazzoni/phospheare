// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  looksLikeTocEntry,
  matchHeading,
  matchMatter,
} from "../domain/patterns";
import { DROPPED_MATTER, type MatterKind } from "../domain/source";
import type { PreparedBook } from "./prepare";

// Front and back matter. A manuscript arrives with pages that are not
// chapters. Those the project already is, the title page and the contents
// list, are not imported (`DROPPED_MATTER`); the rest (a copyright page, a
// dedication, a prologue, acknowledgements) is the writer's text and becomes
// a Section, named for its kind when it has no title. An entry is matter when
// its title says so, when the package says so (epub `epub:type`), or when its
// content does: a © or an ISBN, lines that read like a contents list, a short
// opening page with the book's title or its author. The author shows by a
// "by" line, or by the title and author the file states about itself, which
// is how a page holding only an author's name and a title is known for the
// title page it is.

export interface MatterVerdict {
  matter: MatterKind | null;
  /**
   * Left out to begin with: a page the project makes itself, or an EPUB's
   * off-spine extra.
   */
  leftOut: boolean;
  /** An EPUB's off-spine extra (`linear="no"`), which the row's tag names. */
  offSpine: boolean;
}

const COPYRIGHT =
  /©|\(c\)\s*\d{4}|\bcopyright\b|\bisbn\b|all rights reserved|tutti i diritti riservati|todos los derechos|tous droits/i;
const BY_LINE = /^(by|di|de|par|von|por)\s+\S/i;

export function classify(
  book: PreparedBook,
  start: number,
  end: number,
  title: string,
  known: MatterKind | null,
  isFirst: boolean,
  bookTitle: string | undefined,
): MatterVerdict {
  const blocks = book.blocks.slice(start, end);
  const flow = blocks[0] ? book.flows[blocks[0].flow] : undefined;
  const words = blocks.reduce((sum, b) => sum + b.words, 0);
  let matter: MatterKind | null =
    known ??
    matchMatter(title)?.kind ??
    (flow && blocks[0]?.flowStart ? (flow.role ?? null) : null);
  // Matter by what blocks are marked as: an epub section, a .docx TOC heading.
  if (!matter) {
    const roles = blocks
      .map((b) => b.signals.role)
      .filter(
        (r): r is MatterKind =>
          !!r && r !== "title" && r !== "subtitle" && r !== "toc",
      );
    if (roles.length && roles.length >= blocks.length / 2) matter = roles[0];
    if (blocks.length && blocks.every((b) => b.signals.role === "toc"))
      matter = "toc";
  }
  // Matter by content, only for an entry the book does not itself call a
  // chapter or a Part. "Chapter 2" is a chapter whatever it says: a short one
  // that mentions copyright, or opens "By the time…", is story.
  if (!matter && blocks.length && !matchHeading(title)) {
    const lines = blocks.filter((b) => !b.scene);
    const tocLike = lines.filter(
      (b) => looksLikeTocEntry(b.text) || (b.short && !!matchHeading(b.text)),
    ).length;
    if (lines.length >= 3 && tocLike / lines.length >= 0.6) matter = "toc";
    else if (words <= 400 && lines.some((b) => COPYRIGHT.test(b.text)))
      matter = "copyright";
    else if (isFirst && words <= 150) {
      const same = (text: string, stated: string | undefined) =>
        !!stated && text.trim().toLowerCase() === stated.trim().toLowerCase();
      const hasTitle = lines.some(
        (b) =>
          b.signals.role === "title" ||
          same(b.text, bookTitle) ||
          same(b.text, book.meta.title),
      );
      // A by-line is a short line, never a sentence that begins "By".
      const hasBy = lines.some(
        (b) =>
          (b.short && !b.sentence && BY_LINE.test(b.text.trim())) ||
          same(b.text, book.meta.author),
      );
      if (hasTitle || hasBy) matter = "titlePage";
    }
  }
  const nonLinear = !!flow && !flow.linear && !!blocks[0]?.flowStart;
  return {
    matter,
    leftOut: nonLinear || (!!matter && DROPPED_MATTER.has(matter)),
    offSpine: nonLinear,
  };
}
