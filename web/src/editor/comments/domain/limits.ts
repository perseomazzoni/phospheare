// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The comments' tunable numbers. Every number the comments feature turns on
// is here, so a change to one applies everywhere.

/**
 * How many ghost comments one persona may have waiting in one chapter.
 *
 * A review that finds forty things must not fill a chapter's margin in one
 * go; `proposals.ts` applies the cap.
 */
export const GHOST_COMMENTS_PER_SECTION = 8;

/** Characters of text kept either side of a passage, to find it again. */
export const ANCHOR_CONTEXT = 32;

/** The longest body one entry may hold, from anyone. */
export const ENTRY_BODY_MAX = 4000;

/** The longest reply a persona writes in a thread. */
export const REPLY_BODY_MAX = 1200;

/** The most searches one reply keeps, and pages one search keeps. */
export const SEARCHES_PER_ENTRY_MAX = 8;
export const LINKS_PER_SEARCH_MAX = 10;

/** The longest query, page address and page title a reply's search keeps. */
export const QUERY_MAX = 500;
export const URL_MAX = 2000;
export const TITLE_MAX = 300;

/** The longest editor name an imported comment keeps. */
export const NAME_MAX = 80;

/**
 * The least room right of the prose, in CSS pixels, for comments to stand as
 * cards in the margin. Below it they fold into markers that open on demand.
 */
export const MARGIN_MIN_W = 220;
