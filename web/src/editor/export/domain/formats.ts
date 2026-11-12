// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The formats a book can leave as, one row each: what the file is called and
// what it is. `paged` is the one axis the export window branches on. A paged
// format has pages, so layout and paper mean something; a reflowing one (an
// ebook, a web page, Markdown, plain text) takes the reader's screen as its
// page, and the window does not offer choices that would do nothing.

export const FORMAT_IDS = [
  "docx",
  "odt",
  "pdf",
  "rtf",
  "epub",
  "html",
  "md",
  "txt",
] as const;
export type FormatId = (typeof FORMAT_IDS)[number];

export interface FormatSpec {
  extension: string;
  mime: string;
  paged: boolean;
}

export const FORMATS: Record<FormatId, FormatSpec> = {
  docx: {
    extension: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    paged: true,
  },
  odt: {
    extension: "odt",
    mime: "application/vnd.oasis.opendocument.text",
    paged: true,
  },
  pdf: { extension: "pdf", mime: "application/pdf", paged: true },
  rtf: { extension: "rtf", mime: "application/rtf", paged: true },
  epub: { extension: "epub", mime: "application/epub+zip", paged: false },
  html: { extension: "html", mime: "text/html", paged: false },
  md: { extension: "md", mime: "text/markdown", paged: false },
  txt: { extension: "txt", mime: "text/plain", paged: false },
};

/**
 * Whether a visible table of contents is a choice. An EPUB always has one,
 * because its navigation document is required and ebook stores also want an
 * inline contents page, so for an EPUB the window shows it ticked and locked.
 */
export function tocRequired(format: FormatId): boolean {
  return format === "epub";
}
