// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { roles } from "./roles";
import { defineFamily } from "../../domain/family";
import { withSharedPaint } from "../sharedPaint";
import { palette } from "./palette";

// ── Matte ────────────────────────────────────────────────────────────────────
//
// Matte: a cool off-white page under frosted glass panes, meta in the mono,
// labels in spaced capitals, and one accent that is never a fill under text.

export const matte = defineFamily({
  id: "matte",
  name: "Matte",
  palette,
  shared: {
    ...roles,
    // Square, or a capsule: a theme decides, so this is not a literal 999px
    // in the stylesheet.
    "--r-round": "999px",
    "--r-lg": "10px",
    "--r": "7px",
    "--r-sm": "4px",
    "--r-xs": "3px",

    "--f-ui":
      "'Geist Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    "--f-prose": "'Newsreader Optical', ui-serif, 'Times New Roman', serif",
    "--f-mono":
      "'Geist Mono Variable', ui-monospace, 'SF Mono', 'Cascadia Code', Consolas, monospace",

    "--focus-ring": "2px solid var(--accent)",

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
    "--display-weight": "400",
    "--display-tracking": "-0.02em",
    "--name-tracking": "-0.01em",
    "--aside-style": "italic",
    "--quote-style": "italic",
    // A chosen word lifted to 500; a Section's title at 500, a little
    // tight.
    "--title-weight": "500",
    "--title-tracking": "-0.015em",
    "--mode-from": "#a445ed",
    "--mode-to": "#0a84ff",
    // The shape glyph in the accent: each Part's ground the accent at 0.12
    // with a hatch for its unused room, the Sections at 0.85 and a Part's own
    // prose at 0.45.
    "--spine-odd": "var(--accent)",
    "--spine-even": "var(--accent)",
    "--spine-current-odd": "var(--accent)",
    "--spine-current-even": "var(--accent)",
    "--spine-ground-mix": "100%",
    "--spine-ground-opacity": "0.12",
    "--spine-hatch-opacity": "0.22",
    "--spine-bar-opacity": "0.85",
    "--spine-own-opacity": "0.45",
    "--frost": "blur(20px) saturate(1.4)",
  },
  frame: {
    comments: "cards",
    underBar: "slide",
    dockTabs: "track",
    panel: "float",
    spineGroups: "close",
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
  sheet: withSharedPaint(() => import("./theme.css?inline")),
});
