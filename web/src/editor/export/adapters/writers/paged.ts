// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What every paged writer shares. DOCX, ODT, RTF and PDF split a book the same
// way: the pages before the text (tech page, title page, contents), unnumbered
// and with no running head, and the text itself, numbered from 1 on its first
// page as standard manuscript format requires. They all print the same page
// furniture. Deciding both here keeps four writers from disagreeing about
// which page is page 1.

import { geometryOf, type Geometry } from "../../domain/layout";
import type { Chapter, ExportDocument } from "../../domain/model";

/** Points to twentieths of a point, DOCX's and RTF's lengths. */
export const twips = (pt: number) => Math.round(pt * 20);

/** Points to half-points, DOCX's `w:sz` and RTF's `\fs`. */
export const halfPoints = (pt: number) => Math.round(pt * 2);

export interface PagedPlan {
  geometry: Geometry;
  /** Unnumbered pages before the text; may be empty. */
  front: Chapter[];
  /** The numbered chapters; empty for a book exported as its tech page. */
  body: Chapter[];
  /**
   * The text's first page carries no running head: in standard manuscript
   * format a story's first page holds the contact block and title instead.
   */
  bareFirstPage: boolean;
  /** "Surname / Title / " before the page number; `null` for none. */
  runningHead: string | null;
}

export function pagedPlan(doc: ExportDocument): PagedPlan {
  const geometry = geometryOf(doc.layout, doc.page);
  const split = doc.chapters.findIndex((chapter) => chapter.numbered);
  const front = split === -1 ? doc.chapters : doc.chapters.slice(0, split);
  const body = split === -1 ? [] : doc.chapters.slice(split);
  return {
    geometry,
    front,
    body,
    bareFirstPage: body[0]?.opening !== undefined,
    runningHead:
      geometry.layout.runningHead && doc.runningHeader
        ? `${doc.runningHeader} / `
        : geometry.layout.runningHead
          ? ""
          : null,
  };
}

/**
 * The review copy's footer, split around its two numbers so each writer can
 * put its own page and page-count fields between the pieces:
 * `["Draft · 1 Oct 2026 · page ", " of ", ""]`.
 */
export function draftFooterParts(
  doc: ExportDocument,
): [string, string, string] {
  const template = `${doc.furniture.draft} · ${doc.furniture.pageOf}`;
  const [before, rest = ""] = template.split("{page}");
  const [middle, after = ""] = rest.split("{pages}");
  return [before, middle, after];
}
