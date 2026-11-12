// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Scheme } from "../../domain/types";
import type { TokenValues } from "../../domain/family";
import { hex, oklchToRgb } from "../../domain/oklch";

// ── Vision's colours ─────────────────────────────────────────────────────────
//
// Vision's colours come from one generator with three inputs (contrast,
// tint and hue), held at one point, 55 / 2 / 95; the writer is offered no
// dials. The generator is kept whole rather than its output pasted in, so the
// formula is the one place that says why each tier sits where it does, and
// the values the tests pin are its results.
//
// The formula walks lightness in `oklch` along one hue with a whisper of chroma:
// the paper is a plaster white, the inks its own near-neutral grey at four
// depths, and every hairline is the first ink at a low alpha, so the two
// variants read as one family. The gold, the green, the marks that mean
// "here, now" (the selection, the current find) and the two hues that mean
// something (danger, attention) are fixed values, not generated. The gold
// sits on its own hue, neither brass nor amber, on the fine details; the
// green is a verdigris kept for the few things that are live; the attention
// is a copper, so it never reads as gold.

export type VisionScheme = "light" | "dark";

/** The generator's inputs: contrast 55, tint 2, hue 95. */
export const VISION_DIALS = { contrast: 0.55, tint: 0.002, hue: 95 } as const;

export interface VisionPalette {
  /** The page and every surface on it: Vision has one. */
  sheet: string;
  /** The four inks, deepest first. */
  t1: string;
  t2: string;
  t3: string;
  t4: string;
  prose: string;
  /** The first ink at the three alphas Vision draws lines and tints with. */
  hair: string;
  hairFirm: string;
  wash: string;
  /** The spine's pale tone, the cap on an ink bar. */
  spineB: string;
  /** The gold of the fine details: rules, marks and ornaments, never text. */
  gilt: string;
  /** The verdigris of what is live, seen at 4.5:1. */
  spark: string;
  selection: string;
  find: string;
  crimson: string;
  ember: string;
  /** The weight a chosen word is lifted to: 500 on paper, a step lighter
   *  on the night. */
  lift: string;
  /** The first ink as `r, g, b`, for the alphas the theme derives from it. */
  inkRgb: string;
}

/**
 * The generator. `k` is contrast 0..1; the top fifth of the dial
 * walks into "Total", where the tint goes to zero and the night reaches true
 * black. `tint` is the chroma, `hue` its angle.
 */
export function generate(
  scheme: VisionScheme,
  k: number,
  tint: number,
  hue: number,
): VisionPalette {
  const toTotal = Math.max(0, (k - 0.8) / 0.2);
  const chroma = tint * (1 - toTotal);
  const clampL = (L: number) => Math.max(0, Math.min(1, L));
  const rgb = (L: number) => oklchToRgb(clampL(L), chroma, hue);
  const col = (L: number) => hex(rgb(L));
  const alpha = (L: number) => (x: number) =>
    `rgba(${rgb(L).join(",")},${x.toFixed(3)})`;

  if (scheme === "light") {
    const t1L = 0.3 - 0.12 * k - 0.06 * toTotal;
    const a = alpha(t1L);
    return {
      sheet: col(0.978),
      t1: col(t1L),
      t2: col(0.42 - 0.13 * k),
      t3: col(0.555 - 0.09 * k),
      t4: col(0.67 - 0.07 * k),
      prose: col(t1L),
      hair: a(0.09 + 0.06 * k),
      hairFirm: a(0.16 + 0.1 * k),
      wash: a(0.035 + 0.02 * k),
      spineB: col(0.8 - 0.1 * k),
      gilt: "#D3AC41",
      spark: "#107C73",
      selection: "rgba(211,172,65,0.22)",
      find: "rgba(211,172,65,0.36)",
      crimson: "#A8203A",
      ember: "#A4481B",
      lift: "500",
      inkRgb: rgb(t1L).join(", "),
    };
  }
  const canvasL = k <= 0.8 ? 0.23 - 0.06 * (k / 0.8) : 0.182 * (1 - toTotal);
  const t1L = Math.min(1, 0.9 + 0.085 * k + 0.03 * toTotal);
  const a = alpha(t1L);
  return {
    sheet: col(canvasL),
    t1: col(t1L),
    t2: col(0.8 + 0.08 * k),
    t3: col(0.635 + 0.08 * k),
    t4: col(0.5 + 0.08 * k),
    prose: col(Math.min(0.94, 0.835 + 0.125 * k)),
    hair: a(0.08 + 0.06 * k),
    hairFirm: a(0.14 + 0.1 * k),
    wash: a(0.035 + 0.02 * k),
    spineB: col(0.36 + 0.06 * k),
    gilt: "#E1B850",
    spark: "#7FCFC4",
    selection: "rgba(225,184,80,0.20)",
    find: "rgba(225,184,80,0.34)",
    crimson: "#E8808A",
    ember: "#E5925E",
    lift: "460",
    inkRgb: rgb(t1L).join(", "),
  };
}

/** Vision's palette for `scheme`, at `VISION_DIALS`. */
export function visionPalette(scheme: VisionScheme): VisionPalette {
  return generate(
    scheme,
    VISION_DIALS.contrast,
    VISION_DIALS.tint,
    VISION_DIALS.hue,
  );
}

/**
 * Lightness in the palette's own hue and chroma, for the few surfaces the
 * generator has no tier for (the sunk well, the inverse chip): an
 * extrapolation along the same line rather than a colour from elsewhere.
 */
export function visionTone(L: number): string {
  const chroma =
    VISION_DIALS.tint * (1 - Math.max(0, (VISION_DIALS.contrast - 0.8) / 0.2));
  return hex(oklchToRgb(Math.max(0, Math.min(1, L)), chroma, VISION_DIALS.hue));
}

// ── Vision's tokens, from its palette ─────────────────────────────────────────
//
// Every contract token is a value of Vision's palette, or, where the palette
// has no tier for it, an extrapolation along the palette's own line. The
// extrapolations are marked; each is the nearest palette value moved by a
// small fixed step, so nothing on the page reads as a colour from another
// family.
//
// Vision has one surface and square corners, and its shadow tokens cast
// nothing: the one shade it draws, a leaf's, is its own (`--vision-shade`).
// A shadow token is a transparent shadow rather than `none`, because the
// stylesheets compose shadows into lists
// (`var(--shadow-card), var(--glass-edge)`), where `none` would void the
// whole declaration.

const NO_SHADOW = "0 0 0 0 transparent";

function rgbOf(hex: string): string {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ");
}

function rgba(hex: string, a: number): string {
  return `rgba(${rgbOf(hex)}, ${a})`;
}

// The comparing mode's red and green are locked for every theme, so
// both variants keep the values Vision already had, which sit on white and
// on this black.
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

/** Vision's own tokens: its fourth ink, its gilt, the flat shade a leaf
 *  laid on the page casts and the weight a chosen word is lifted to. */
function own(scheme: Scheme): TokenValues {
  const p = visionPalette(scheme);
  return {
    "--vision-ink-4": p.t4,
    "--vision-gilt": p.gilt,
    "--vision-shade":
      scheme === "light" ? `rgba(${p.inkRgb}, 0.08)` : "rgba(0, 0, 0, 0.5)",
    "--vision-lift": p.lift,
  };
}

/** The weights above the regular, as set on paper. */
const WEIGHTS: Record<string, number> = {
  "--strong-weight": 500,
  "--name-weight": 500,
  "--link-weight": 500,
  "--heading-weight": 500,
  "--medium-weight": 500,
  "--head-weight": 550,
  "--bold-weight": 600,
  "--label-weight": 620,
};

/** How much lighter the night sets each weight: light ink on a dark ground
 *  spreads, and reads heavier than the same weight on paper. */
const NIGHT_STEP = 40;

/** The weights by scheme. None falls under the regular, the face's
 *  lightest. */
function weights(scheme: Scheme): TokenValues {
  const step = scheme === "light" ? 0 : NIGHT_STEP;
  return Object.fromEntries(
    Object.entries(WEIGHTS).map(([name, w]) => [
      name,
      String(Math.max(400, w - step)),
    ]),
  );
}

export function palette(scheme: Scheme): TokenValues {
  const p = visionPalette(scheme);
  const day = scheme === "light";
  const ink = (a: number) => `rgba(${p.inkRgb}, ${a})`;
  const sheetRgb = rgbOf(p.sheet);
  return {
    "--paper": p.sheet,
    "--paper-raised": p.sheet,
    // Extrapolated: the one well, a step below the sheet
    // on the palette's own line.
    "--paper-sunk": day ? visionTone(0.955) : visionTone(0.16),
    "--field": p.sheet,
    // One surface: the desk is the sheet, and the frame's sheet is unpainted.
    "--canvas": p.sheet,
    "--ink-2": p.t2,
    "--prose-ink": p.prose,
    "--spark": p.spark,
    "--ink": p.t1,
    "--ink-3": p.t3,
    "--on-fill": p.sheet,
    // The dimmed text of focus mode and the history walk, and a disabled
    // control: the third ink, still 4.5:1 on the sheet.
    "--ink-dim": p.t3,

    "--hair": p.hair,
    "--hair-firm": p.hairFirm,
    // Extrapolated: half the hairline.
    "--hair-soft": ink(day ? 0.06 : 0.055),

    // The accent is the ink: what is on is paint, not light. The
    // tints are extrapolated at the old Vision's alphas on the new ink.
    "--accent": p.t1,
    "--accent-tint": ink(day ? 0.07 : 0.08),
    "--accent-tint-2": ink(day ? 0.12 : 0.14),
    "--accent-glow": ink(day ? 0.16 : 0.2),
    // The written-words cap on an ink bar: the spine's pale tone.
    "--leaf": p.spineB,

    "--attention": p.ember,
    "--attention-tint": rgba(p.ember, day ? 0.1 : 0.12),
    "--attention-glow": rgba(p.ember, day ? 0.26 : 0.3),

    "--danger": p.crimson,
    "--danger-tint": rgba(p.crimson, day ? 0.08 : 0.12),
    "--danger-glow": rgba(p.crimson, 0.3),

    // `--wash` is the palette's; its subtle and strong steps are extrapolated.
    "--wash-subtle": ink(0.028),
    "--wash": p.wash,
    "--wash-strong": ink(0.08),
    "--scrim": day ? "rgba(7, 9, 13, 0.5)" : "rgba(0, 0, 0, 0.72)",
    "--scrollbar": p.hairFirm,
    "--scrollbar-hover": ink(day ? 0.34 : 0.32),

    // Extrapolated: the inverse chip is the ink on the sheet turned over.
    "--inverse-solid": p.t1,
    "--inverse-ink": `rgba(${sheetRgb}, 0.86)`,
    "--inverse-ink-strong": p.sheet,
    "--inverse-raised": `rgba(${sheetRgb}, ${day ? 0.12 : 0.1})`,

    // The current find and the selection are tints of the gilt; the other
    // finds are extrapolated as a tint of the ink, so the gold stays on the
    // one that is "here".
    "--mark-search": ink(day ? 0.14 : 0.2),
    "--mark-search-current": p.find,
    "--mark-selection": p.selection,
    // A commented passage is half the selection's tint.
    "--mark-comment":
      "color-mix(in srgb, var(--mark-selection) 50%, transparent)",
    "--mark-repetition": rgba(p.crimson, day ? 0.55 : 0.62),
    ...DIFF[scheme],

    "--shadow-1": NO_SHADOW,
    "--shadow-card": NO_SHADOW,
    "--shadow-panel": NO_SHADOW,
    "--shadow-2": NO_SHADOW,
    "--shadow-3": NO_SHADOW,
    "--shadow-accent": NO_SHADOW,

    "--ground": "none",
    "--ground-quiet": "none",
    "--grain": "none",
    // No glass: a pane is the sheet itself.
    "--glass": p.sheet,
    "--glass-edge": NO_SHADOW,

    // The focus ring is the spark: a mark of "here, now", not paint.
    "--focus-ring": `1.5px solid ${p.spark}`,
    ...weights(scheme),
    ...own(scheme),
  };
}
