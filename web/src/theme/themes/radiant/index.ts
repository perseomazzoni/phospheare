// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { roles } from "./roles";
import { defineFamily } from "../../domain/family";
import { withSharedPaint } from "../sharedPaint";
import { palette, radiantPalette } from "./palette";

// ── Radiant ──────────────────────────────────────────────────────────────────
//
// Radiant draws the page as a sheet on a desk, lit from above. The chrome
// lies flat on the desk in a sans, the Section is the one sheet, the bar
// floats over it as a pill, a pressed tool stands on a raised chip, and the
// only filled shapes are the action that confirms and the one that destroys.

/** The writer's face is the day's in both variants. */
const DAY = radiantPalette("light");

export const radiant = defineFamily({
  id: "radiant",
  name: "Radiant",
  palette,
  shared: {
    ...roles,
    // The sheet and the Library's cards have a 12px corner, the bar and its
    // tools are pills, and the kit keeps 8 and 4.
    "--radiant-r-raised": "12px",
    // How far the page's shadow reaches into the panel and the Dock.
    "--radiant-cast-width": "10px",
    // The shadow's falloff, one profile for its straight run along an edge
    // and its ring round the page's rounded head, so the two meet unbroken.
    "--radiant-cast-falloff":
      "var(--radiant-cast), color-mix(in srgb, var(--radiant-cast) 45%, transparent) 30%, color-mix(in srgb, var(--radiant-cast) 15%, transparent) 62%, transparent",
    "--radiant-cast-ring":
      "var(--radiant-cast) var(--radiant-r-raised), color-mix(in srgb, var(--radiant-cast) 45%, transparent) calc(var(--radiant-r-raised) + var(--radiant-cast-width) * 0.3), color-mix(in srgb, var(--radiant-cast) 15%, transparent) calc(var(--radiant-r-raised) + var(--radiant-cast-width) * 0.62), transparent calc(var(--radiant-r-raised) + var(--radiant-cast-width))",
    // The destructive action lit as the primary is: a fill brighter at its
    // head, a lit top edge, a darker rim and a drop in its own hue.
    "--radiant-danger":
      "linear-gradient(180deg, color-mix(in srgb, var(--danger) 90%, white), var(--danger))",
    "--radiant-danger-lift":
      "inset 0 1px 0 rgba(255,255,255,0.18), 0 0 0 1px color-mix(in srgb, var(--danger) 80%, black), 0 4px 12px -4px color-mix(in srgb, var(--danger) 55%, transparent)",
    "--r-round": "999px",
    "--r-lg": "8px",
    "--r": "4px",
    "--r-sm": "3px",
    "--r-xs": "2px",

    "--f-ui":
      "'Geist Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    "--f-prose": "'Newsreader Optical', ui-serif, 'Times New Roman', serif",
    "--f-mono":
      "'Geist Mono Variable', ui-monospace, 'SF Mono', 'Cascadia Code', Consolas, monospace",

    // The chrome, its figures and its labels are set in Geist, the labels in
    // sentence case; mono is kept for code, keys and paths.
    "--f-meta": "var(--f-ui)",
    "--label-case": "none",
    "--label-tracking": "0",
    // Meta untracked, its columns in tabular figures; controls at 560; names
    // and group headings at 500.
    "--meta-tracking": "0em",
    "--figures": "tabular-nums",
    "--strong-weight": "560",
    "--quiet-weight": "560",
    "--name-weight": "500",
    "--link-weight": "400",
    "--heading-weight": "500",
    "--head-weight": "550",
    "--label-weight": "620",
    "--bold-weight": "600",
    "--medium-weight": "500",
    "--display-weight": "400",
    "--display-tracking": "-0.02em",
    "--name-tracking": "-0.01em",
    "--aside-style": "italic",
    "--quote-style": "italic",
    // A row's title is the second ink; a chosen one is lifted to 500.
    "--row-ink": "var(--ink-2)",
    // The account's face: the day's ember under a white initial, in both
    // variants. Every initial holds 5:1 on it, where the night's
    // filled-action ink does not.
    "--face": DAY.ember,
    "--face-ink": DAY.onPrimary,
    // The title in the first ink at the face's regular weight, and the open
    // comment's passage in the selection's tint.
    "--title-weight": "400",
    "--title-tracking": "-0.01em",
    "--title-ink": "var(--ink)",
    "--mark-comment-active": "var(--mark-selection)",
    // The live marks in the spark, with no glow, and the Mode track from the
    // spark to the ink.
    "--live": "var(--spark)",
    "--live-glow": "none",
    "--mode-from": "var(--spark)",
    "--mode-to": "var(--ink)",
    // The shape glyph in the palette's three tones, solid, with no edge and
    // no hatch: the plan's ground, the current Part's Sections in the first
    // (the palette's), the rest in the second.
    "--spine-odd": "var(--spine-b)",
    "--spine-even": "var(--spine-b)",
    "--spine-ground-mix": "0%",
    "--spine-ground-opacity": "1",
    "--spine-room": "var(--spine-plan)",
    "--spine-hatch-opacity": "0",
    "--spine-edge": "transparent",
    "--spine-bar-opacity": "1",
    "--spine-own-opacity": "1",
    // The shell is a desk: the panes lie flat on it, with no edge, corner,
    // shadow or frost, and a bar floats over the page as a frosted pill
    // under a hairline, its top edge lit.
    "--frost": "blur(20px) saturate(1.4)",
    "--pane-ground": "var(--canvas)",
    "--pane-edge": "transparent",
    "--pane-radius": "0px",
    "--pane-shadow": "none",
    "--pane-frost": "none",
    "--bar-ground": "var(--radiant-bar-ground)",
    "--bar-radius": "var(--r-round)",
    "--bar-shadow": "var(--radiant-float)",
    "--bar-frost": "var(--frost)",
  },
  // The comments as notes in the sheet's margin, the text scrolling on under
  // the frosted bar and cut at the sheet's head, and the bar centred on the
  // paper, not on the prose beside the notes. The panel is attached to the window's
  // edge and the title bar, so a peek opens from the window, not beside it.
  frame: {
    comments: "notes",
    underBar: "sheet",
    dockTabs: "track",
    panel: "attached",
    spineGroups: "close",
    barCentre: "paper",
    leaves: "under",
  },
  decorations: {
    pageCorners: "none",
    pageHead: "none",
    pageFoot: "none",
    spine: "glyph",
    marginRule: "hairline",
  },
  sheet: withSharedPaint(() => import("./theme.css?inline"), "paint"),
});
