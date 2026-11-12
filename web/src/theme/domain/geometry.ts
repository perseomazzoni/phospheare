// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── Shell geometry ───────────────────────────────────────────────────────────
//
// The editor's layout numbers that live in script rather than in a
// stylesheet: the frame's own, the same under every theme, so a writer who
// changes theme finds every area where it was. `EditorRoute` writes the
// panel's and the dock's widths as inline custom properties.
//
// Each number the stylesheets also need is a token in `editor.css`;
// `editorCss.test.ts` fails when a token and its copy here disagree.

export interface ShellGeometry {
  /** The structure panel's inset from the window's left edge. */
  panelLeft: number;
  /** The space between the open panel and the surface. */
  panelGutter: number;
  /** The space between the folded rail and the surface. */
  railGutter: number;
  measure: number;
  /** The surface's own right padding. */
  surfaceRight: number;
  /** The panel's width when the writer has never dragged it. */
  panelW: number;
  /** The folded panel's width. */
  railPanelW: number;
  /** The dock's width when the writer has never dragged it. */
  dockW: number;
  /** The dock's inset from the window's right edge (`--dock-inset`). */
  dockInset: number;
  /**
   * The narrowest window that keeps the panel and the measure side by side.
   * The media queries in `editor.css` are written against it.
   */
  narrowAt: number;
  /**
   * How much of a line a find result quotes, in characters, and how many of
   * them come before the match: two lines of the panel, so a quotation
   * never hides its match.
   */
  findExcerpt: ExcerptSpan;
  /**
   * The margin column the comments stand in as notes, right of the text,
   * where a theme picks notes: the gap before its rule, the column's width
   * and the notes' inset from the rule.
   */
  notes: { gap: number; column: number; inset: number };
  /**
   * The page's sheet: its gap from the panel, the window's edges and the
   * open dock, and the command bar's band at its top, the bar's seat below
   * the sheet's top edge and the bar's height. The page's face is the sheet
   * below that band. The bar stands on the titlebar's foot (`barSeat`), or,
   * where the text is cut at its foot or at the sheet's head, a seat down on
   * the page (`cutSeat`).
   */
  sheet: { gap: number; barSeat: number; cutSeat: number; bar: number };
}

/** A find excerpt's length and the lead-in before its match. */
export interface ExcerptSpan {
  width: number;
  before: number;
}

const PANEL_LEFT = 8; // --panel-left
// The text stands as far inside the sheet on the left as on the right: the
// sheet's gap and 32.
const PANEL_GUTTER = 40; // --panel-gutter
const MEASURE = 680; // --editor-width
const SURFACE_RIGHT = 40; // .editor-surface's own right padding
const PANEL_W = 248; // --panel-w

export const FRAME_GEOMETRY: ShellGeometry = {
  panelLeft: PANEL_LEFT,
  panelGutter: PANEL_GUTTER,
  // Must match `.editor-shell[data-rail], [data-peek]` in `editor.css`.
  railGutter: PANEL_GUTTER,
  measure: MEASURE,
  surfaceRight: SURFACE_RIGHT,
  panelW: PANEL_W,
  railPanelW: 52,
  dockW: 340,
  dockInset: 8,
  // The sum of what stands left and right of the full measure: 1016.
  narrowAt: PANEL_LEFT + PANEL_W + PANEL_GUTTER + MEASURE + SURFACE_RIGHT,
  findExcerpt: { width: 60, before: 30 },
  notes: { gap: 28, column: 180, inset: 14 },
  // The panel's inset, so the sheet, the panel and the dock stand on one
  // gap from each other and from the window (`--sheet-gap`, `--bar-seat`,
  // `--bar-h`).
  sheet: { gap: PANEL_LEFT, barSeat: 0, cutSeat: 10, bar: 46 },
};

// ── The dock against the window ──────────────────────────────────────────────
//
// The dock's own cap is a product constant, too narrow for a large monitor
// and wide enough on a laptop to bury the prose, so the window adds two
// numbers from the surface's own arithmetic:
//
// - reach: the widest the dock may be drawn. Its left edge stops the panel's
//   gutter short of the structure panel, so the dock never covers the panel
//   on the wide plane.
// - fit: the widest dock beside which the measure is wholly visible. The drag
//   does not stop there, but its detent holds the dock there for a moment, so
//   the width where prose starts to disappear is felt.

/**
 * The dock's window-relative widths at the writer's live panel. `panelWidth`
 * is what the surface reserves: the rail's width when the panel is folded.
 */
export function dockRoom(
  geometry: ShellGeometry,
  windowWidth: number,
  panelWidth: number,
  folded: boolean,
): { reach: number; fit: number } {
  const reserve =
    geometry.panelLeft +
    panelWidth +
    (folded ? geometry.railGutter : geometry.panelGutter);
  return {
    // The dock stands `dockInset` in from the window's right edge.
    reach: windowWidth - geometry.dockInset - reserve,
    fit: windowWidth - reserve - geometry.measure - geometry.surfaceRight,
  };
}
