// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The theme contract: the custom properties something other than a theme's
// own sheet reads, so every theme must state them. A `const` array rather
// than a type alias, so it can be iterated at runtime.
//
// A theme paints the app in its own sheet (`themes/<family>/theme.css`) with
// whatever tokens it chooses; those are its own, and no other theme shares
// them. The contract holds only what reaches past the theme: the Settings
// tile that previews it, the components that paint from code, the frame's
// keyframes and the product's marks, and the contrast check that holds every
// theme to WCAG. `theme/contract.test.ts` keeps the list to exactly these
// readers.

export const THEME_TOKENS = [
  // The grounds and inks: the page, a raised panel, a sunk well and a
  // field; the ink in its steps, the prose's and the ink on a filled
  // control. Read by the preview tile and by the contrast check.
  "--paper",
  "--paper-raised",
  "--paper-sunk",
  "--field",
  "--ink",
  "--ink-2",
  "--ink-3",
  "--prose-ink",
  "--on-fill",
  // The edges, the accent and the attention and danger hues, with the
  // accent's leaf. The frame's keyframes pulse in the accent and its shadow.
  "--hair",
  "--hair-soft",
  "--accent",
  "--leaf",
  "--attention",
  "--danger",
  "--shadow-panel",
  "--shadow-accent",
  // The shell's ground, its grain and its glass, as the tile draws them.
  "--ground",
  "--grain",
  "--glass",
  // A tip and a pressed control, held to WCAG with their inks; the chosen
  // thing's foot, which the tile draws its chosen key, button and Part with.
  "--tip-solid",
  "--tip-ink",
  "--press-ground",
  "--press-ink",
  "--press-foot",
  // The ink of a row in a list, which the tile draws the panel's rows in.
  "--row-ink",
  // The command bar's edge, which the tile draws its bar with.
  "--bar-edge",
  // The page's edge and its corners as the theme draws them, which the
  // tile draws its page with: an edge, or none, and crop marks, or none.
  "--page-edge",
  "--page-corners",
  // The corners the tile draws with, and the rail's arithmetic reads.
  "--r-round",
  "--r-lg",
  "--r",
  // The interface's face; the splash's name in the label's case, caps,
  // tracking and weight; the tile's label weight.
  "--f-chrome",
  "--label-case",
  "--label-caps",
  "--label-tracking",
  "--label-weight",
  "--bold-weight",
  // The shape glyph (`SpineGlyph`), drawn from code: each Part's hue, odd
  // and even, plain and current; the plan's ground and its room; the
  // ground's mix and opacity, the hatch's, the edge's, the bars' and a
  // Part's own.
  "--spine-odd",
  "--spine-even",
  "--spine-current-odd",
  "--spine-current-even",
  "--spine-plan",
  "--spine-room",
  "--spine-ground-mix",
  "--spine-ground-opacity",
  "--spine-hatch-opacity",
  "--spine-edge",
  "--spine-bar-opacity",
  "--spine-own-opacity",
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];
