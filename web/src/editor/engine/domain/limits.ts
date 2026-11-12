// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// How much one paste may bring into the engine. The clipboard is untrusted
// input parsed whole on the main thread, so a paste of many megabytes takes
// the tab, and the unsaved work in it, down. The ceilings are far above a
// chapter; a whole manuscript goes through the import, under caps of its own
// (`import/domain/limits.ts`). A paste over a cap is refused before it is
// parsed, never inserted in part.

/** Characters of the plain flavor parsed in one paste. */
export const MAX_PASTE_CHARS = 1024 * 1024;

/**
 * Characters of the rich flavor parsed in one paste. Word processors wrap a
 * character in several of markup, so the rich flavor of the same text is
 * several times the plain one.
 */
export const MAX_PASTE_HTML_CHARS = 4 * 1024 * 1024;

/** Paragraphs one paste may add, counted after the parse. */
export const MAX_PASTE_PARAGRAPHS = 100_000;
