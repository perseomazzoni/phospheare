// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── Decorations ──────────────────────────────────────────────────────────────
//
// The slots the frame declares for a theme to draw in. A decoration adds no
// interaction and no information found nowhere else, and takes no room: the
// frame's layout is the same whether a slot is filled or left blank.
//
// Every theme names what it draws in each slot, "none" included.

export interface Decorations {
  /** The page's corners: blank, or crop marks. */
  pageCorners: "none" | "crop";
  /** Above the text: blank, or a running head naming the book and Section. */
  pageHead: "none" | "running";
  /** Below the text: blank, or a folio. */
  pageFoot: "none" | "folio";
  /** The Desk draws the book's spine as its glyph, or as ruled lines. */
  spine: "glyph" | "rules";
  /** The notes' margin (`FrameOptions.comments`): blank, or a hairline rule. */
  marginRule: "none" | "hairline";
}
