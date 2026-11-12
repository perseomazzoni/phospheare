// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { roles } from "./roles";
import { defineFamily } from "../../domain/family";
import { withSharedPaint } from "../sharedPaint";
import { palette } from "./palette";

// ── Shine ────────────────────────────────────────────────────────────────────
//
// Shine sets the app as an instrument: the chrome in Geist, its labels in
// spaced capitals, its readings in mono. Light is flat and marks what is on
// in teal; dark outlines its surfaces in cyan and lights what is on
// (`palette.ts`, `theme.css`).
//
// The Parts of the shape glyph alternate two hues, so a book's movements
// read as a rhythm without a whole spectrum. The written and cut overlays
// keep `--leaf` and `--attention`, and neither Part hue is the theme's
// `--attention`, or a cut would vanish into its own bar.

export const shine = defineFamily({
  id: "shine",
  name: "Shine",
  palette,
  shared: {
    ...roles,
    // Not `none`: the stylesheets compose this after a shadow in a list.
    "--glass-edge": "0 0 0 0 transparent",

    // A commented passage is marked as a selection is, more faintly.
    "--mark-comment":
      "color-mix(in srgb, var(--mark-selection) 55%, transparent)",

    "--ground-quiet": "none",
    "--grain": "none",

    // A drawn box turns its corners softly; controls stay tighter.
    // `--r-round` stays a capsule: it is what dots and pills are drawn with,
    // and a square dot is not a dot.
    "--r-round": "999px",
    "--r-lg": "6px",
    "--r": "3px",
    "--r-sm": "3px",
    "--r-xs": "2px",

    "--f-ui":
      "'Geist Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    "--f-prose": "'Newsreader Optical', ui-serif, 'Times New Roman', serif",
    "--f-mono":
      "'Geist Mono Variable', ui-monospace, 'SF Mono', 'Cascadia Code', Consolas, monospace",

    // Labels in spaced capitals; meta lightly tracked, its columns in tabular
    // figures; controls at 560, names at 600, headings bold.
    "--label-case": "uppercase",
    "--label-tracking": "0.14em",
    "--meta-tracking": "0.02em",
    "--figures": "tabular-nums",
    "--strong-weight": "560",
    "--quiet-weight": "560",
    "--name-weight": "600",
    "--link-weight": "400",
    "--heading-weight": "700",
    "--head-weight": "550",
    "--label-weight": "620",
    "--bold-weight": "600",
    "--medium-weight": "500",
    "--display-weight": "600",
    "--display-tracking": "-0.025em",
    "--f-display": "var(--f-ui)",
    "--name-tracking": "-0.01em",
    "--aside-style": "italic",
    "--quote-style": "italic",
    // A chosen word lifted to 500; a Section's title at 500, a little
    // tight.
    "--title-weight": "500",
    "--title-tracking": "-0.015em",
    "--mode-to": "var(--accent)",
    // No ground under a Part and no hatch: its unused room is an outlined
    // empty box (`theme.css`).
    "--spine-ground-mix": "100%",
    "--spine-ground-opacity": "0",
    "--spine-hatch-opacity": "0",
    "--frost": "blur(20px) saturate(1.4)",
    // The room between the titlebar's rule and the command bar, which the
    // Dock's top keeps too (`theme.css`).
    "--shine-bar-gap": "12px",
    // A seated track marks the chosen cell with a line along its foot, on
    // no trough.
    "--seat-trough": "transparent",
    // The line is a band on the thumb's foot, not an inset shadow: the thumb
    // is measured to fractions of a pixel, and at some zooms an inset shadow
    // leaves a sliver of the mark the thumb's full height on its edge.
    "--seat-ground":
      "linear-gradient(var(--shine-mark), var(--shine-mark)) bottom / 100% 2px no-repeat",
    "--seat-shadow": "none",
    "--seat-radius": "0px",
    "--seat-ink": "var(--accent)",
  },
  frame: {
    comments: "cards",
    underBar: "slide",
    dockTabs: "track",
    panel: "attached",
    spineGroups: "apart",
    barCentre: "prose",
    leaves: "under",
  },
  decorations: {
    pageCorners: "none",
    pageHead: "none",
    pageFoot: "none",
    spine: "glyph",
    marginRule: "none",
  },
  sheet: withSharedPaint(() => import("./theme.css?inline"), "paint"),
});
