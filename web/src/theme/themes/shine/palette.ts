// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Scheme } from "../../domain/types";
import type { TokenValues } from "../../domain/family";

// ── Shine's palette ──────────────────────────────────────────────────────────
//
// Once dark, the light scheme, is white page and surfaces separated by
// hairlines of a faint slate, not by fills or shadows: a contact line under
// what sits on the page, one soft, low shadow under what floats, and nothing
// wider, because a shadow allowed to bloom makes the page soft. No gradients,
// and nothing glows. The controls are greys with a hint of slate blue; the
// family's teal is kept for the thin marks of "here, now": the open row's
// edge, the chosen tab, a pressed control's foot, the comment card brought
// forward, the caret, the focus ring.
//
// Still dark, the dark scheme, is a near-black ground with a hint of blue,
// so the cyan reads as part of it. Surfaces are outlined, not filled, and
// what floats has a halo in place of a shadow (`litEdges`). Glass is
// frosted, there is no grain, and the controls dim while the writer types.
//
// Ink is held under white: the prose sits at about 12:1, not 15, because a
// column of near-white text on black vibrates over a long session.

// The slate every grey of once dark is mixed from, at low alpha for tints.
const SLATE_RGB = "82, 101, 122";
const WASH = (a: number) => `rgba(${SLATE_RGB}, ${a})`;
// The family's deep teal: light's marks of "here, now" and its focus ring.
const TEAL = "#086570";
// A shadow's tone: the ink's slate, never black.
const SHADE = (a: number) => `rgba(29, 33, 38, ${a})`;
const CYAN = "94, 211, 222";

// ── Lit edges ────────────────────────────────────────────────────────────────
//
// Still dark's borders and elevation, as one idea: a surface is outlined in
// a line of the accent's colour, and anything that floats has a faint halo
// of it instead of a shadow. The higher it floats (a card, a panel, a menu,
// a dialog), the wider and stronger the halo; that is the whole elevation
// scale, with no offset and no dark tone.
//
// `line` is the outlines' colour, `light` the halo's ("r, g, b" both); in
// still dark both are the cyan. `glow` scales the halos, 0–1.
//
// The outline is drawn heavier than the stylesheets' 1px border. A 1px line
// of colour on black reads as a wireframe, not as a drawn box; so every
// floating surface's halo starts with a solid 1px ring in the line colour,
// laid just outside its own border: 2px of outline with no change to any
// component's box. The controls that do not float glow through their text
// and icons instead (`theme.css`).

interface LitEdges {
  line: string;
  light: string;
  glow: number;
}

type EdgeToken =
  | "--hair"
  | "--hair-firm"
  | "--hair-soft"
  | "--shadow-1"
  | "--shadow-2"
  | "--shadow-3"
  | "--shadow-card"
  | "--shadow-panel"
  | "--shadow-accent";

function litEdges({ line, light, glow }: LitEdges): Record<EdgeToken, string> {
  const ring = `0 0 0 1px rgba(${line}, 0.5)`;
  const halo = (blur: number, spread: number, a: number) =>
    `${ring}, 0 0 ${blur}px ${spread}px rgba(${light}, ${+(a * glow).toFixed(3)})`;
  return {
    // The card edge is the visible line; dividers inside a card are the same
    // light at a lower voice, so a panel reads as one outlined thing.
    "--hair-firm": `rgba(${line}, 0.5)`,
    "--hair": `rgba(${line}, 0.22)`,
    "--hair-soft": `rgba(${line}, 0.1)`,
    "--shadow-1": halo(6, -1, 0.18),
    "--shadow-card": halo(14, -3, 0.2),
    "--shadow-panel": halo(16, -5, 0.16),
    "--shadow-2": halo(20, -4, 0.24),
    "--shadow-3": halo(32, -6, 0.26),
    "--shadow-accent": `0 0 0 1px rgba(${line}, 0.6), ${halo(10, -2, 0.3)}`,
  };
}

const ONCE_DARK: TokenValues = {
  // Under daylight the panes and the bar, on screen the whole time, stand on
  // the panel's barely-there shadow rather than a menu's.
  "--pane-shadow": "var(--shadow-panel)",
  "--bar-shadow": "var(--shadow-panel)",

  "--paper": "#FFFFFF",
  "--paper-raised": "#FFFFFF",
  "--paper-sunk": "#F3F5F6",
  "--field": "#FFFFFF",

  "--ink": "#1D2126",
  "--ink-3": "#636C75",
  "--on-fill": "#FFFFFF",
  "--ink-dim": "rgba(29, 33, 38, 0.34)",

  // Hairlines a step off white, in the slate; the firm one draws a field's
  // or a drawn button's edge.
  "--hair-firm": "#D1D6DB",
  "--hair": "#E4E8EC",
  "--hair-soft": "#F0F2F4",
  // `--shadow-panel` is the faint shadow the editor's standing chrome uses
  // instead of `--shadow-2`.
  "--shadow-1": `0 1px 2px ${SHADE(0.07)}`,
  "--shadow-card": `0 1px 2px ${SHADE(0.07)}`,
  "--shadow-panel": `0 1px 2px ${SHADE(0.05)}, 0 2px 8px ${SHADE(0.04)}`,
  "--shadow-2": `0 6px 20px ${SHADE(0.08)}, 0 1px 2px ${SHADE(0.06)}`,
  "--shadow-3": `0 8px 28px ${SHADE(0.1)}, 0 1px 3px ${SHADE(0.06)}`,
  "--shadow-accent": `0 1px 3px ${SHADE(0.14)}`,

  // The accent is the deepest slate: what is on is paint, not light. Its
  // tints are the controls' greys.
  "--accent": "#2A3037",
  "--accent-tint": WASH(0.07),
  "--accent-tint-2": WASH(0.12),
  "--accent-glow": WASH(0.16),
  "--leaf": "#9FEDEE",
  // A field's edge and an unticked box's hold 3:1 on white, as a control's
  // outline must (WCAG 1.4.11); the hairlines are for what is not pressed.
  "--field-edge": "#858E98",
  // A pressed control is marked as the chosen tab is, by a line along its
  // foot: the slate ground alone is too faint to tell on from off.
  "--press-mark": `inset 0 -2px 0 ${TEAL}`,

  // Attention in coral, the one warm colour in the controls.
  "--attention": "#A63E24",
  "--attention-tint": "rgba(232, 110, 76, 0.11)",
  "--attention-glow": "rgba(232, 110, 76, 0.36)",

  // Danger leans raspberry, so it never reads as the coral of attention.
  "--danger": "#A8204A",
  "--danger-tint": "rgba(168, 32, 74, 0.08)",
  "--danger-glow": "rgba(168, 32, 74, 0.32)",

  "--wash-subtle": WASH(0.035),
  "--wash": WASH(0.06),
  "--wash-strong": WASH(0.1),
  "--scrim": "rgba(6, 18, 30, 0.48)",
  "--scrollbar": "#C7CCD1",
  "--scrollbar-hover": "#ABB2BA",

  "--inverse": "rgba(14, 26, 36, 0.96)",
  "--inverse-solid": "#0E1A24",
  "--inverse-ink": "rgba(247, 254, 254, 0.86)",
  "--inverse-ink-strong": "#F7FEFE",
  "--inverse-raised": "rgba(247, 254, 254, 0.12)",
  "--inverse-raised-hover": "rgba(247, 254, 254, 0.22)",

  // The writer's text, selected or held highlighted, is marked in
  // highlighter yellow. Search finds in the night blue; the current match
  // is in coral.
  "--mark-search": "rgba(30, 64, 110, 0.14)",
  "--mark-search-current": "rgba(232, 110, 76, 0.26)",
  "--mark-selection": "rgba(247, 200, 40, 0.32)",
  "--mark-repetition": "rgba(168, 32, 74, 0.65)",
  "--mark-diff-del": "#9A2E48",
  "--mark-diff-add": "#11665A",
  "--mark-diff-wash-del": "rgba(190, 50, 80, 0.12)",
  "--mark-diff-wash-add": "rgba(20, 150, 110, 0.12)",
  "--mark-diff-tag-del": "#EAD8DD",
  "--mark-diff-tag-add": "#D3E5E1",
  "--mark-diff-tag-del-hover": "#DAC8CD",
  "--mark-diff-tag-add-hover": "#C2D5D1",

  "--ground": "none",
  "--glass": "rgba(255, 255, 255, 0.72)",

  "--focus-ring": `1.5px solid ${TEAL}`,

  // The Parts alternate the turquoise and the night blue, at still dark's
  // strength, a Part's own prose in the same ratio to its Sections.
  "--spine-odd": "#16B4BE",
  "--spine-even": "#1F3F6E",
  "--spine-current-odd": "#16B4BE",
  "--spine-current-even": "#1F3F6E",
  "--spine-bar-opacity": "0.85",
  "--spine-own-opacity": "0.45",
  "--mode-from": "#E8714F",
};

const STILL_DARK: TokenValues = {
  // Near-black, and a panel only a breath above it: the outline carries the
  // surface, so the fill stays out of the way.
  "--paper": "#07090D",
  "--paper-raised": "#0B0E13",
  "--paper-sunk": "#030406",
  "--field": "#0B0E13",

  "--ink": "#C3CBD8",
  "--ink-3": "#8592AC",
  "--on-fill": "#0A0F1B",
  "--ink-dim": "rgba(195, 203, 216, 0.34)",

  ...litEdges({ line: CYAN, light: CYAN, glow: 1 }),

  "--accent": "#5ED3DE",
  "--accent-tint": "rgba(94, 211, 222, 0.10)",
  "--accent-tint-2": "rgba(94, 211, 222, 0.18)",
  "--accent-glow": "rgba(94, 211, 222, 0.42)",
  // The cyan at the dark pole, so the written-words cap reads on the bar.
  "--leaf": "#0F4A55",
  // A name's initial is white: every name colour is dark enough to carry
  // it, and the navy ink on a fill is not.
  "--face-ink": "#FFFFFF",

  "--attention": "#F2B46A",
  "--attention-tint": "rgba(242, 180, 106, 0.12)",
  "--attention-glow": "rgba(242, 180, 106, 0.40)",

  // A rose rather than a fire-engine red: on black the warm pink reads as
  // danger without shouting it.
  "--danger": "#F28B96",
  "--danger-tint": "rgba(242, 139, 150, 0.12)",
  "--danger-glow": "rgba(242, 139, 150, 0.40)",

  "--wash-subtle": "rgba(150, 172, 220, 0.04)",
  "--wash": "rgba(150, 172, 220, 0.07)",
  "--wash-strong": "rgba(150, 172, 220, 0.12)",
  "--scrim": "rgba(0, 0, 0, 0.72)",
  "--scrollbar": "rgba(94, 211, 222, 0.38)",
  "--scrollbar-hover": "rgba(94, 211, 222, 0.65)",

  "--inverse": "rgba(195, 203, 216, 0.96)",
  "--inverse-solid": "#C3CBD8",
  "--inverse-ink": "rgba(7, 9, 13, 0.86)",
  "--inverse-ink-strong": "#07090D",
  "--inverse-raised": "rgba(7, 9, 13, 0.10)",
  "--inverse-raised-hover": "rgba(7, 9, 13, 0.20)",

  // Two colours and ink. Search finds in amber and the current match is
  // the coral of the pair; a held passage is the cyan, because the cyan is
  // what is the writer's own and live: the caret, and what the caret has
  // taken hold of.
  "--mark-search": "rgba(242, 180, 106, 0.30)",
  "--mark-search-current": "rgba(243, 139, 120, 0.38)",
  "--mark-selection": "rgba(94, 211, 222, 0.22)",
  "--mark-repetition": "rgba(242, 139, 150, 0.62)",
  "--mark-diff-del": "#E58C93",
  "--mark-diff-add": "#5EC29A",
  "--mark-diff-wash-del": "rgba(229, 108, 120, 0.16)",
  "--mark-diff-wash-add": "rgba(70, 190, 140, 0.15)",
  "--mark-diff-tag-del": "#27161B",
  "--mark-diff-tag-add": "#10211D",
  "--mark-diff-tag-del-hover": "#38272C",
  "--mark-diff-tag-add-hover": "#21322E",

  // The blueprint: a 1px grid every 96px, faint enough to sit under the
  // reading, and nothing else; a pool of light would make the black hazy. No
  // grid in the editor: a page of prose is not a drawing board.
  "--ground":
    "repeating-linear-gradient(0deg, rgba(120, 146, 200, 0.05) 0 1px, transparent 1px 96px), repeating-linear-gradient(90deg, rgba(120, 146, 200, 0.05) 0 1px, transparent 1px 96px)",
  "--glass": "rgba(11, 14, 19, 0.72)",

  "--focus-ring": "1.5px solid var(--accent)",

  // The Parts in the cyan and its complement, and a steady glow. The coral
  // is not `--attention`: a cut on an amber bar would vanish.
  "--spine-odd": "#5ED3DE",
  "--spine-even": "#F38B78",
  "--spine-current-odd": "#5ED3DE",
  "--spine-current-even": "#F38B78",
  "--spine-bar-opacity": "0.85",
  "--spine-own-opacity": "0.45",
  "--mode-from": "#F38B78",
};

// The accent at a share of its strength, scaled by how much the marks glow.
const LIT = (share: number) =>
  `color-mix(in srgb, var(--accent) calc(${share}% * var(--shine-glow)), transparent)`;
const GLOW = (px: number) => `calc(${px}px * var(--shine-glow))`;

/**
 * Shine's own tokens, read by its sheet: the colour of the marks of "here,
 * now", how much they glow, the warm colour of a quotation's rule, the
 * labels' ink, the prose's weight, and the glows themselves. Light glows not
 * at all (`--shine-glow` 0 zeroes every glow below) and keeps the teal in
 * the marks.
 */
function own(scheme: Scheme): TokenValues {
  const light = scheme === "light";
  return {
    "--shine-mark": light ? TEAL : "var(--accent)",
    "--shine-glow": light ? "0" : "0.85",
    "--shine-warm": light ? "#E8714F" : "#F38B78",
    "--shine-label-ink": light ? "var(--ink-3)" : "var(--accent)",
    // The unseated thumb's mark: light's press mark, drawn as a band.
    "--shine-press-line": light ? TEAL : "transparent",
    // The writer's words a little lighter than the face's regular, lighter
    // still in dark, where light ink on a dark ground spreads.
    "--shine-prose-weight": light ? "370" : "340",
    // The glow on both sides of dark's lit edges, and inside a lit box.
    "--shine-edge-glow": light
      ? "transparent"
      : "color-mix(in srgb, var(--accent-glow) 57%, transparent)",
    "--shine-inner-glow": "inset 0 0 14px -5px var(--shine-edge-glow)",
    // The attached panel's edge: light draws it in the titlebar rule's
    // colour; dark draws it as a lit ring (`theme.css`).
    "--shine-panel-edge": light ? "var(--hair-firm)" : "transparent",
    // Spaced capitals: the wordmark's wide tracking, and the closer one of
    // the readings beside a label (the shelf's scope, a tag's key).
    "--shine-wordmark-tracking": "0.2em",
    "--shine-reading-tracking": "0.1em",
    // A lit mark: a tight core and a wide halo, as a shadow, a filter and
    // a text shadow; dim, the faint halo of a control at rest; on a fill,
    // the halo of a primary.
    "--shine-lit": `0 0 ${GLOW(1.5)} ${LIT(90)}, 0 0 ${GLOW(8)} ${LIT(75)}`,
    "--shine-lit-drop": `drop-shadow(0 0 ${GLOW(0.8)} ${LIT(90)}) drop-shadow(0 0 ${GLOW(4)} ${LIT(75)})`,
    "--shine-lit-text": `0 0 ${GLOW(1)} ${LIT(90)}, 0 0 ${GLOW(8)} ${LIT(75)}`,
    "--shine-lit-dim": `0 0 ${GLOW(6)} ${LIT(35)}`,
    "--shine-lit-dim-drop": `drop-shadow(0 0 ${GLOW(1.5)} ${LIT(35)})`,
    "--shine-lit-fill": `0 0 ${GLOW(10)} ${GLOW(-2)} ${LIT(65)}`,
    // Fainter: an unticked box's rim, and the wide ring round the jump
    // button.
    "--shine-lit-faint": `0 0 ${GLOW(5)} ${GLOW(-1)} ${LIT(35)}`,
    "--shine-lit-wide": `0 0 ${GLOW(6)} 6px ${LIT(25)}`,
  };
}

export function palette(scheme: Scheme): TokenValues {
  return { ...(scheme === "light" ? ONCE_DARK : STILL_DARK), ...own(scheme) };
}
