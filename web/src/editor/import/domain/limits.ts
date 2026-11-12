// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// How much the import will read. Every byte of an import is untrusted: a
// file can come from anywhere, and a zip package can declare a few kilobytes
// that inflate to gigabytes. These are the ceilings, chosen far above any real
// manuscript (the longest novels in print are a few megabytes of text; a docx
// with pictures runs to tens) and far below what would take the tab down. A
// file over a cap is refused with its reason, never read in part: half a book
// imported silently is worse than none.

/** The largest file accepted, by format family, in bytes. */
export const MAX_FILE_BYTES = {
  /** docx, odt, epub: pictures ride along and are never inflated. */
  package: 200 * 1024 * 1024,
  /** rtf embeds pictures as hex, so a short book can be a large file. */
  rtf: 100 * 1024 * 1024,
  /** md, txt, html: text all the way down. */
  text: 32 * 1024 * 1024,
} as const;

/** Entries a zip package may list at all, counted before anything inflates. */
export const MAX_ZIP_ENTRIES = 10_000;

/**
 * The largest single part inflated: by its declared size before inflating,
 * and by what comes out while inflating, since the declaration is the
 * file's own word.
 */
export const MAX_PART_BYTES = 64 * 1024 * 1024;

/** The sum of every part inflated from one package, by the same two counts. */
export const MAX_INFLATED_BYTES = 256 * 1024 * 1024;

/** Files in one import; one per chapter is the most anyone has asked for. */
export const MAX_FILES = 500;

/**
 * Paragraphs in one flow (one file, or one chapter of an EPUB): ten times the
 * longest novel's. A pick of many files is held by `MAX_FILES` as well.
 */
export const MAX_BLOCKS = 400_000;

/** How many paragraphs a reader handles between yields to the page. */
export const YIELD_EVERY = 2_000;
