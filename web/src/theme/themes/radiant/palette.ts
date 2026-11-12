// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Scheme } from "../../domain/types";
import type { TokenValues } from "../../domain/family";

// ── Radiant's colours ────────────────────────────────────────────────────────
//
// The page is a sheet on a desk. On paper the desk is a neutral step under the
// white sheet; on the night the desk is the ground and the sheet and the
// raised surfaces are steps above it, so nothing sits below the ground. Four
// inks of one cool grey carry the text, the prose has its own ink, under the
// first on the night, and every hairline and tint is the first ink at a low
// alpha. The light falls from above the desk: each raised surface catches it
// along its top edge and casts a long soft shadow. A pressed tool and the
// chosen row stand on a raised chip; the filled shapes are the action that
// confirms and the one that destroys, lit as the surfaces are. The spark marks the selection and the
// current find; crimson means danger, ember attention.
//
// The day's third ink is a step deeper than the desk alone needs: it is read
// on the tints too (a ticked row, a row or tool under the pointer), and
// holds 4.5:1 on the strongest of them (WCAG 1.4.3).

export type RadiantScheme = "light" | "dark";

export interface RadiantPalette {
  /** The desk the chrome lies on. */
  canvas: string;
  /** The page, and the ground of everything raised off the desk. */
  sheet: string;
  raised: string;
  /** The page's edge, drawn by the panel and the Dock beside it, and the
   * contact shadow. */
  sheetEdge: string;
  contact: string;
  /** The four inks, deepest first, and the prose's own. */
  t1: string;
  t2: string;
  t3: string;
  t4: string;
  prose: string;
  /** The first ink at the alphas Radiant draws lines and tints with. */
  hair: string;
  hairFirm: string;
  wash: string;
  /** The selected row's ground, and a pressed control's. */
  rowSel: string;
  pressed: string;
  /** The label on the filled actions. */
  onPrimary: string;
  /** The spine: the current Part, the others, and the planned room. */
  spineA: string;
  spineB: string;
  spinePlan: string;
  /** The active comment's edge and its lift. */
  cardActive: string;
  lifted: string;
  spark: string;
  selection: string;
  find: string;
  crimson: string;
  ember: string;
  /** The first ink as `r, g, b`, for the alphas the theme derives from it. */
  inkRgb: string;
}

const DAY_INK = "29,33,38";
const NIGHT_INK = "247,248,248";
const day = (x: number) => `rgba(${DAY_INK},${x})`;
const night = (x: number) => `rgba(${NIGHT_INK},${x})`;

const PALETTES: Record<RadiantScheme, RadiantPalette> = {
  light: {
    canvas: "#F5F6F7",
    sheet: "#FFFFFF",
    raised: "#FFFFFF",
    sheetEdge: day(0.09),
    contact: `0 1px 2px ${day(0.04)}`,
    t1: "#1D2126",
    t2: "#3E444C",
    t3: "#5E636B",
    t4: "#868B93",
    prose: "#1D2126",
    hair: day(0.1),
    hairFirm: day(0.16),
    wash: day(0.05),
    rowSel: day(0.07),
    pressed: day(0.09),
    onPrimary: "#FFFFFF",
    spineA: "#3E444C",
    spineB: "#B4B8BE",
    spinePlan: day(0.07),
    cardActive: day(0.3),
    lifted: `0 6px 20px ${day(0.07)}, 0 1px 2px ${day(0.05)}`,
    spark: "#0E6E73",
    selection: "rgba(14,110,115,0.16)",
    find: "rgba(14,110,115,0.26)",
    crimson: "#A8203A",
    ember: "#8F5A14",
    inkRgb: "29, 33, 38",
  },
  dark: {
    canvas: "#08090B",
    sheet: "#0E1013",
    raised: "#16171A",
    sheetEdge: night(0.07),
    contact: "none",
    t1: "#F7F8F8",
    t2: "#D0D6E0",
    t3: "#8A8F98",
    t4: "#62666D",
    // Under the first ink: thin strokes in near-white bloom.
    prose: "#D9DDE3",
    hair: night(0.07),
    hairFirm: night(0.11),
    wash: night(0.04),
    rowSel: night(0.07),
    pressed: night(0.1),
    onPrimary: "#08090B",
    spineA: "#D0D6E0",
    spineB: "#4A4F57",
    spinePlan: night(0.06),
    cardActive: night(0.28),
    lifted: "0 16px 40px rgba(0,0,0,0.5)",
    spark: "#3BE8E5",
    selection: "rgba(59,232,229,0.20)",
    find: "rgba(59,232,229,0.32)",
    crimson: "#E8808A",
    ember: "#D8B36E",
    inkRgb: "247, 248, 248",
  },
};

export function radiantPalette(scheme: RadiantScheme): RadiantPalette {
  return PALETTES[scheme];
}

// ── Radiant's tokens, from its palette ───────────────────────────────────────
//
// Every contract token is a value of Radiant's palette, or, where the palette
// has no tier for it, an extrapolation from the palette's own values. The
// extrapolations are marked.
//
// The accent is the first ink and its tint is the pressed tint, so the kit's
// pressed state (`--accent-tint` under a `--accent` label) is a tint with the
// label in the first ink, and the one ink fill is the primary action's. A
// shadow token is a transparent shadow rather than `none`, because the
// stylesheets compose shadows into lists (`var(--shadow-card),
// var(--glass-edge)`), where `none` would void the whole declaration.

const NO_SHADOW = "0 0 0 0 transparent";

function rgbOf(hex: string): string {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ");
}

function rgba(hex: string, a: number): string {
  return `rgba(${rgbOf(hex)}, ${a})`;
}

const shadow = (value: string) => (value === "none" ? NO_SHADOW : value);

// The comparing mode's red and green are locked for every theme.
const DIFF: Record<Scheme, TokenValues> = {
  light: {
    "--mark-diff-del": "#9A2E48",
    "--mark-diff-add": "#11665A",
    "--mark-diff-wash-del": "rgba(190, 50, 80, 0.12)",
    "--mark-diff-wash-add": "rgba(20, 150, 110, 0.12)",
    "--mark-diff-tag-del": "#EAD8DD",
    "--mark-diff-tag-add": "#D3E5E1",
    "--mark-diff-tag-del-hover": "#DAC8CD",
    "--mark-diff-tag-add-hover": "#C2D5D1",
  },
  dark: {
    "--mark-diff-del": "#E58C93",
    "--mark-diff-add": "#5EC29A",
    "--mark-diff-wash-del": "rgba(229, 108, 120, 0.16)",
    "--mark-diff-wash-add": "rgba(70, 190, 140, 0.15)",
    "--mark-diff-tag-del": "#27161B",
    "--mark-diff-tag-add": "#10211D",
    "--mark-diff-tag-del-hover": "#38272C",
    "--mark-diff-tag-add-hover": "#21322E",
  },
};

const NIGHT_LIT = (a: number) => `rgba(255,255,255,${a})`;
const NIGHT_SHADE = (a: number) => `rgba(0,0,0,${a})`;

/** The lift of a card over the page, its side shadow cast `side` (-1 to
 * the left, 1 to the right), towards the page. */
function cardOver(scheme: Scheme, side: -1 | 1): string {
  return scheme === "light"
    ? `0 1px 2px ${day(0.05)}, ${side * 6}px 0 24px -8px ${day(0.12)}, 0 18px 48px -18px ${day(0.16)}`
    : `inset 0 1px 0 ${NIGHT_LIT(0.07)}, ${side * 8}px 0 28px -8px ${NIGHT_SHADE(0.6)}, 0 24px 60px -20px ${NIGHT_SHADE(0.7)}`;
}

/**
 * Radiant's own tokens, read by its sheet: the light from above the desk,
 * the page's ground and its head (its top edge, and on the night the light
 * that edge catches, drawn on across the gaps the page fills), the shadow
 * the page casts on the panel and the Dock, the page under a Dock that
 * covers it (filling the gaps on its left and at its foot only), the lift of
 * a Dock over the page and of a panel peeking over it, of the cards and of
 * the bar, the chip a pressed tool and the chosen row stand on, and the
 * primary's fill. On the night each raised surface's top edge catches the
 * light; on paper the edges stay crisp and the shadows carry the lift.
 */
function own(scheme: Scheme): TokenValues {
  if (scheme === "light")
    return {
      "--radiant-light": `radial-gradient(ellipse 75% 60% at 50% -12%, ${NIGHT_LIT(0.9)}, transparent 70%)`,
      // The page's edge is the sheet's edge on white, solid, so the sheet,
      // the gaps beside it and the panels draw one line.
      "--radiant-page-edge": "#EBEBEC",
      "--radiant-page-ground":
        "linear-gradient(var(--radiant-page-edge), var(--radiant-page-edge)) top / 100% 1px no-repeat, var(--sheet)",
      "--radiant-page": `0 calc(var(--sheet-gap) + 1px) 0 var(--sheet-gap) var(--sheet), 0 calc(var(--sheet-gap) + 1px) 0 calc(var(--sheet-gap) + 1px) var(--radiant-page-edge)`,
      "--radiant-page-under": `calc(var(--sheet-gap) / -2) calc(var(--sheet-gap) / 2 + 1px) 0 calc(var(--sheet-gap) / 2) var(--sheet), calc(var(--sheet-gap) / -2 - 0.5px) calc(var(--sheet-gap) / 2 + 0.5px) 0 calc(var(--sheet-gap) / 2 + 0.5px) var(--radiant-page-edge)`,
      "--radiant-cast": day(0.08),
      "--radiant-dock-lift": cardOver(scheme, -1),
      "--radiant-panel-lift": cardOver(scheme, 1),
      "--radiant-card-ground": "var(--paper)",
      "--radiant-card-raise": `0 1px 2px ${day(0.04)}, 0 12px 32px -16px ${day(0.14)}`,
      "--radiant-card-lift": `0 2px 4px ${day(0.05)}, 0 18px 40px -16px ${day(0.2)}`,
      "--radiant-bar-ground": "rgba(255,255,255,0.86)",
      "--radiant-float": `inset 0 1px 0 #FFFFFF, 0 10px 28px -10px ${day(0.18)}`,
      "--radiant-chip": "#FFFFFF",
      "--radiant-chip-hover": "#F2F3F4",
      "--radiant-chip-lift": `0 0 0 1px ${day(0.08)}, 0 1px 2px ${day(0.07)}`,
      "--radiant-primary": "linear-gradient(180deg, #2C3139, #1D2126)",
      "--radiant-primary-lift": `inset 0 1px 0 ${NIGHT_LIT(0.16)}, 0 0 0 1px #14171B, 0 4px 12px -4px ${day(0.35)}`,
      "--radiant-tag-ground": "rgba(255,255,255,0.7)",
    };
  return {
    "--radiant-light": `radial-gradient(ellipse 75% 60% at 50% -12%, ${NIGHT_LIT(0.11)}, transparent 70%)`,
    // The page's edge and the lit line under its head are the sheet's edge
    // and the white at 0.08 over the ground's head, solid, so the sheet, the
    // gaps beside it and the panels draw the same lines.
    "--radiant-page-edge": "#232427",
    "--radiant-page-ground":
      "linear-gradient(var(--radiant-page-edge), var(--radiant-page-edge)) top / 100% 1px no-repeat, linear-gradient(#262729, #262729) 0 1px / 100% 1px no-repeat, linear-gradient(180deg, #131417 0, var(--sheet) 260px)",
    "--radiant-page": `0 calc(var(--sheet-gap) + 2px) 0 var(--sheet-gap) var(--sheet), 0 calc(var(--sheet-gap) + 1px) 0 var(--sheet-gap) #262729, 0 calc(var(--sheet-gap) + 1px) 0 calc(var(--sheet-gap) + 1px) var(--radiant-page-edge)`,
    "--radiant-page-under": `calc(var(--sheet-gap) / -2) calc(var(--sheet-gap) / 2 + 2px) 0 calc(var(--sheet-gap) / 2) var(--sheet), calc(var(--sheet-gap) / -2) calc(var(--sheet-gap) / 2 + 1px) 0 calc(var(--sheet-gap) / 2) #262729, calc(var(--sheet-gap) / -2 - 0.5px) calc(var(--sheet-gap) / 2 + 0.5px) 0 calc(var(--sheet-gap) / 2 + 0.5px) var(--radiant-page-edge)`,
    "--radiant-cast": NIGHT_SHADE(0.5),
    "--radiant-dock-lift": cardOver(scheme, -1),
    "--radiant-panel-lift": cardOver(scheme, 1),
    "--radiant-card-ground": "linear-gradient(180deg, #141518, var(--paper))",
    "--radiant-card-raise": `inset 0 1px 0 ${NIGHT_LIT(0.07)}, 0 16px 40px -16px ${NIGHT_SHADE(0.7)}`,
    "--radiant-card-lift": `inset 0 1px 0 ${NIGHT_LIT(0.1)}, 0 20px 48px -16px ${NIGHT_SHADE(0.8)}`,
    "--radiant-bar-ground": "rgba(24,25,28,0.82)",
    "--radiant-float": `inset 0 1px 0 ${NIGHT_LIT(0.09)}, 0 12px 32px -8px ${NIGHT_SHADE(0.7)}`,
    "--radiant-chip": "#1C1D21",
    "--radiant-chip-hover": "#26272B",
    "--radiant-chip-lift": `inset 0 1px 0 ${NIGHT_LIT(0.07)}, 0 0 0 1px ${NIGHT_LIT(0.06)}, 0 1px 3px ${NIGHT_SHADE(0.5)}`,
    "--radiant-primary": "linear-gradient(180deg, #FFFFFF, #D8DBE0)",
    "--radiant-primary-lift": `inset 0 1px 0 #FFFFFF, 0 0 0 1px ${NIGHT_LIT(0.18)}, 0 4px 14px -4px ${NIGHT_SHADE(0.6)}`,
    "--radiant-tag-ground": "transparent",
  };
}

/** What changes between once dark and still dark. */
export function palette(scheme: Scheme): TokenValues {
  const p = radiantPalette(scheme);
  const day = scheme === "light";
  const ink = (a: number) => `rgba(${p.inkRgb}, ${a})`;
  const sheetRgb = rgbOf(p.sheet);
  return {
    "--paper": p.sheet,
    "--paper-raised": p.raised,
    // The desk: the lowest surface on both grounds.
    "--paper-sunk": p.canvas,
    "--field": p.sheet,
    "--canvas": p.canvas,
    "--sheet": p.sheet,
    "--sheet-edge": p.sheetEdge,
    "--ink-2": p.t2,
    "--prose-ink": p.prose,
    "--spark": p.spark,
    "--row-selected": p.rowSel,
    "--card-active": p.cardActive,
    "--spine-current-odd": p.spineA,
    "--spine-current-even": p.spineA,
    "--spine-b": p.spineB,
    "--spine-plan": p.spinePlan,

    "--ink": p.t1,
    "--ink-3": p.t3,
    "--on-fill": p.onPrimary,
    // Focus mode's dimmed text, a disabled control, and text set as a
    // heading in a menu: the third ink, still 4.5:1 on the sheet (WCAG
    // 1.4.3). The fourth stays for placeholders and decoration.
    "--ink-dim": p.t3,

    "--hair": p.hair,
    "--hair-firm": p.hairFirm,
    // Extrapolated: half the hairline.
    "--hair-soft": ink(day ? 0.054 : 0.047),

    "--accent": p.t1,
    "--accent-tint": p.pressed,
    // Extrapolated: a pressed control under the pointer, a step past the
    // pressed tint.
    "--accent-tint-2": ink(day ? 0.14 : 0.15),
    "--accent-glow": p.hairFirm,
    "--leaf": p.spineB,

    "--attention": p.ember,
    "--attention-tint": rgba(p.ember, day ? 0.1 : 0.12),
    "--attention-glow": rgba(p.ember, day ? 0.26 : 0.3),

    "--danger": p.crimson,
    "--danger-tint": rgba(p.crimson, day ? 0.08 : 0.12),
    "--danger-glow": rgba(p.crimson, 0.3),

    // `--wash` is the palette's; its subtle and strong steps are extrapolated.
    "--wash-subtle": ink(day ? 0.03 : 0.025),
    "--wash": p.wash,
    "--wash-strong": ink(day ? 0.1 : 0.11),
    "--scrim": day ? "rgba(7, 9, 13, 0.5)" : "rgba(0, 0, 0, 0.72)",
    "--scrollbar": p.hairFirm,
    "--scrollbar-hover": ink(day ? 0.34 : 0.32),

    // Extrapolated: the inverse chip is the first ink on the sheet turned
    // over.
    "--inverse": ink(0.96),
    "--inverse-solid": p.t1,
    "--inverse-ink": `rgba(${sheetRgb}, 0.86)`,
    "--inverse-ink-strong": p.sheet,
    "--inverse-raised": `rgba(${sheetRgb}, ${day ? 0.12 : 0.1})`,
    "--inverse-raised-hover": `rgba(${sheetRgb}, ${day ? 0.22 : 0.2})`,

    // The other finds are extrapolated as a tint of the ink, so the spark
    // stays on the one that is "here".
    "--mark-search": ink(day ? 0.14 : 0.2),
    "--mark-search-current": p.find,
    "--mark-selection": p.selection,
    // A commented passage is half the selection's tint.
    "--mark-comment":
      "color-mix(in srgb, var(--mark-selection) 50%, transparent)",
    "--mark-repetition": rgba(p.crimson, day ? 0.55 : 0.62),
    ...DIFF[scheme],

    "--shadow-1": shadow(p.contact),
    // The structure panel and the cards lie flat.
    "--shadow-card": NO_SHADOW,
    "--shadow-panel": NO_SHADOW,
    "--shadow-2": p.lifted,
    // Extrapolated: what floats over a dialog lifts as an active card does.
    "--shadow-3": p.lifted,
    "--shadow-accent": `0 0 0 3px ${p.selection}`,

    "--ground": "none",
    "--ground-quiet": "none",
    "--grain": "none",
    "--glass": p.raised,
    "--glass-edge": NO_SHADOW,

    // 2px with its 2px offset (WCAG 2.4.13), in the spark.
    "--focus-ring": `2px solid ${p.spark}`,
    ...own(scheme),
  };
}
