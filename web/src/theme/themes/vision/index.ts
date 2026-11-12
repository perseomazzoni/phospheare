// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { roles } from "./roles";
import { defineFamily } from "../../domain/family";
import { withSharedPaint } from "../sharedPaint";
import { palette } from "./palette";

// ── Vision ───────────────────────────────────────────────────────────────────
//
// Vision draws the page as a book set in the manner of the Vienna
// workshops: plaster white and near-black, gold only on the fine details.
// Surfaces are told apart by crop marks and hairlines, never by a radius or a
// soft shadow; what lies over the page is a leaf, its edge inked, a gold rule
// inside it and a flat shade cast on the page beside it; a chosen thing is
// set in ink over a gold rule; the chrome is set in the book's own face.

/** The page's top crop marks, as background layers; the tile cuts the
 * page off above its foot, so it draws no foot's marks. */
function cropMarks(ink: string): string {
  const arm = (at: string, size: string) =>
    `linear-gradient(${ink}, ${ink}) ${at} / ${size} no-repeat`;
  return ["0 0", "100% 0"]
    .flatMap((at) => [arm(at, "48px 4px"), arm(at, "4px 48px")])
    .join(", ");
}

export const vision = defineFamily({
  id: "vision",
  name: "Vision",
  palette,
  shared: {
    ...roles,
    // Square: a sheet has corners, not radii. What is round is round by its
    // own geometry (a dot, an avatar), which `--r-round` keeps.
    "--r-round": "999px",
    "--r-lg": "0px",
    "--r": "0px",
    "--r-sm": "0px",
    "--r-xs": "0px",

    // The book's face is Brygada 1918, a book roman of the years the Vienna
    // workshops printed in, served with the app (`styles/base.css`).
    "--f-ui":
      "'Geist Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    "--f-prose": "'Brygada 1918', ui-serif, 'Times New Roman', serif",
    "--f-mono":
      "'Geist Mono Variable', ui-monospace, 'SF Mono', 'Cascadia Code', Consolas, monospace",

    // The interface, its figures and its labels are set in the book's face,
    // the labels in widely spaced capitals, as the Secession letters its
    // walls: a capital stands a third taller than a small one, so a label
    // reads at the frame's size. Code and keys keep the mono.
    "--f-chrome": "var(--f-prose)",
    "--f-meta": "var(--f-prose)",
    "--label-case": "uppercase",
    "--label-caps": "normal",
    "--label-tracking": "0.14em",
    // The book's voice: heads and controls in small capitals, the text's
    // figures old style and the chrome's lining, meta untracked. The weights
    // above the regular are the palette's, a step lighter on the night. Only
    // a tool takes a ground under the pointer; rows, links and folds answer
    // in ink.
    "--meta-tracking": "0em",
    "--figures": "lining-nums",
    "--figures-text": "oldstyle-nums",
    "--head-caps": "all-small-caps",
    "--head-tracking": "0.12em",
    "--control-caps": "all-small-caps",
    "--control-tracking": "0.1em",
    "--quiet-weight": "400",
    "--display-weight": "400",
    "--display-tracking": "-0.02em",
    "--name-tracking": "-0.01em",
    "--aside-style": "italic",
    "--quote-style": "italic",
    "--hover-row": "transparent",
    "--hover-tool": "var(--wash)",
    "--hover-quiet": "transparent",
    "--hover-accent": "transparent",
    "--hover-sunk": "transparent",
    // A row set with leaders: its title in the third ink, its leaders in the
    // fourth; the chosen row in the first.
    "--row-ink": "var(--ink-3)",
    "--leader-ink": "var(--vision-ink-4)",
    // The page in the theme tile as the editor draws it: no box, its top
    // corners marked in the third ink. The tile is drawn at four times its
    // size, so an arm is 48 long and 4 thick.
    "--page-edge": "transparent",
    "--page-corners": cropMarks("var(--ink-3)"),
    "--title-weight": "400",
    "--title-tracking": "-0.01em",
    "--title-ink": "var(--ink)",
    // The accent token is the ink, so the spark is given back to the connected
    // dot, with no glow, and the Mode track runs from the gold at its precise
    // end to the ink at its creative end.
    "--live": "var(--spark)",
    "--live-glow": "none",
    "--mode-from": "var(--vision-gilt)",
    "--mode-to": "var(--ink)",
    // The shape is drawn as rules (`spine` below); the glyph, where the frame
    // draws one, is the accent's, the Part the writer is in gilt.
    "--spine-odd": "var(--accent)",
    "--spine-even": "var(--accent)",
    "--spine-current-odd": "var(--vision-gilt)",
    "--spine-current-even": "var(--vision-gilt)",
    "--spine-ground-mix": "100%",
    "--spine-ground-opacity": "0.12",
    "--spine-hatch-opacity": "0.22",
    "--spine-bar-opacity": "0.85",
    "--spine-own-opacity": "0.45",
    // Bare paper and no glass anywhere: the panes have no edge or shadow, and
    // a bar is a line of tools on the page's own paper.
    "--frost": "none",
    "--pane-edge": "transparent",
    "--pane-shadow": "none",
    "--pane-frost": "none",
    "--bar-ground": "var(--paper)",
    "--bar-edge": "transparent",
    "--bar-shadow": "none",
    "--bar-frost": "none",
    // A chosen thing keeps its ground, its word in ink over a gold rule.
    "--press-ground": "transparent",
    "--press-ink": "var(--ink)",
    "--press-mark": "inset 0 -1px 0 var(--vision-gilt)",
    "--press-hover": "var(--wash-subtle)",
    "--press-edge": "var(--hair)",
    "--press-foot": "var(--vision-gilt)",
    "--press-ring": "none",
    "--seat-trough": "none",
    "--seat-ground": "none",
    "--seat-shadow": "inset 0 -1px 0 var(--vision-gilt)",
    "--seat-radius": "0px",
    // What floats is a slip of the page under one firm hairline; a tip or a
    // toast leaves the inverse ground for the page's; a field is its text on
    // a rule in the third ink, an ink rule twice as heavy under the focus.
    "--slip-edge": "var(--hair-firm)",
    "--tip": "var(--paper-raised)",
    "--tip-solid": "var(--paper-raised)",
    "--tip-ink": "var(--ink)",
    "--tip-ink-strong": "var(--ink)",
    "--tip-raised": "var(--wash)",
    "--tip-raised-hover": "var(--wash)",
    "--tip-edge": "var(--hair-firm)",
    "--field-edge": "transparent",
    "--field-foot": "var(--ink-3)",
    "--field-radius": "0px",
    "--field-focus-edge": "transparent",
    "--field-focus-foot": "var(--ink)",
    "--field-focus-ring": "inset 0 -1px 0 var(--ink)",
  },
  // Margin notes; the panel attached, the bar centred on the paper, as
  // Radiant has them; the text cut on the page's top edge, where the crop
  // marks stand, so it never runs over them; the Dock's faces named in
  // words.
  frame: {
    comments: "notes",
    underBar: "cut",
    dockTabs: "words",
    panel: "attached",
    spineGroups: "close",
    barCentre: "paper",
    leaves: "row",
  },
  // Crop marks, a running head and folio, the shape as rules, and a
  // hairline down the notes' margin.
  decorations: {
    pageCorners: "crop",
    pageHead: "running",
    pageFoot: "folio",
    spine: "rules",
    marginRule: "hairline",
  },
  sheet: withSharedPaint(() => import("./theme.css?inline"), "paint"),
});
