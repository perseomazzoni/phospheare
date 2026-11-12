// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Scheme } from "../../domain/types";
import type { TokenValues } from "../../domain/family";

// ── Matte's palette ──────────────────────────────────────────────────────────
//
// Once dark: a cool off-white paper rather than cream, a green-biased
// near-black ink, hairline rules, and one green accent drawn as text, marks
// and rings, never as a fill under text.
//
// Still dark: a graphite ground and a pale sky-blue accent, for writers who
// find the green reads as a terminal. Its accent follows the same rule, so the
// theme's identity rests on that rule rather than on the accent's hue.

const ONCE_DARK: TokenValues = {
  "--paper": "#F2F4F0",
  "--paper-raised": "#FBFCFA",
  "--paper-sunk": "#E7EAE5",
  "--field": "#F2F4F0",
  // A field's edge holds 3:1 against the field and both papers it sits on:
  // 3.11:1 on `--paper` and `--field`, 3.34:1 on `--paper-raised`.
  "--field-edge": "#858B92",

  "--ink": "#111614",
  "--ink-3": "#5A6660",
  // The prose a step under the face's regular, for a lighter page.
  "--matte-prose-weight": "370",
  "--on-fill": "#FBFCFA",
  "--ink-dim": "rgba(17, 22, 20, 0.38)",

  "--hair": "rgba(17, 22, 20, 0.13)",
  "--hair-firm": "rgba(17, 22, 20, 0.24)",
  "--hair-soft": "rgba(17, 22, 20, 0.07)",

  "--accent": "#17714A",
  "--accent-tint": "rgba(23, 113, 74, 0.09)",
  "--accent-tint-2": "rgba(23, 113, 74, 0.17)",
  "--accent-glow": "rgba(23, 113, 74, 0.28)",
  "--leaf": "#7FD9A6",

  // Holds 4.5:1 on its own tint over `--paper` and `--paper-raised`.
  "--attention": "#9C4A1B",
  "--attention-tint": "rgba(168, 82, 32, 0.10)",
  "--attention-glow": "rgba(168, 82, 32, 0.24)",

  "--danger": "#A32A22",
  "--danger-tint": "rgba(163, 42, 34, 0.10)",
  "--danger-glow": "rgba(163, 42, 34, 0.26)",

  "--wash-subtle": "rgba(17, 22, 20, 0.04)",
  "--wash": "rgba(17, 22, 20, 0.06)",
  "--wash-strong": "rgba(17, 22, 20, 0.11)",
  "--scrim": "rgba(17, 22, 20, 0.34)",
  "--scrollbar": "rgba(17, 22, 20, 0.16)",
  "--scrollbar-hover": "rgba(17, 22, 20, 0.28)",

  "--inverse": "rgba(17, 22, 20, 0.94)",
  "--inverse-solid": "#1A211E",
  "--inverse-ink": "rgba(242, 244, 240, 0.88)",
  "--inverse-ink-strong": "#F2F4F0",
  "--inverse-raised": "rgba(242, 244, 240, 0.14)",
  "--inverse-raised-hover": "rgba(242, 244, 240, 0.26)",

  "--mark-search": "rgba(168, 82, 32, 0.28)",
  "--mark-search-current": "rgba(23, 113, 74, 0.30)",
  "--mark-selection": "rgba(23, 113, 74, 0.13)",
  "--mark-repetition": "rgba(163, 42, 34, 0.55)",
  // The comparing mode's two voices: text, tag ground and hover all
  // live in the theme's red/green family, so a deletion reads red and an
  // addition green in every state (resting tint, struck text, tag ground,
  // hover), never blue or brown. The text tokens are the reference hues
  // darkened for contrast on paper; the tag grounds are the tints made
  // opaque over the paper, one notch darker; the hovers are the
  // grounds a notch toward the ink, plain hexes so no browser
  // feature gates the highlight.
  "--mark-diff-del": "#8E3931",
  "--mark-diff-add": "#18623E",
  "--mark-diff-wash-del": "rgba(190, 70, 60, 0.14)",
  "--mark-diff-wash-add": "rgba(35, 140, 85, 0.14)",
  "--mark-diff-tag-del": "#D5C8C4",
  "--mark-diff-tag-add": "#C1D0C6",
  "--mark-diff-tag-del-hover": "#C1B6B2",
  "--mark-diff-tag-add-hover": "#AFBDB4",

  "--shadow-1":
    "0 1px 2px rgba(17, 22, 20, 0.06), 0 2px 8px rgba(17, 22, 20, 0.05)",
  "--shadow-2":
    "0 2px 4px rgba(17, 22, 20, 0.07), 0 12px 32px rgba(17, 22, 20, 0.10)",
  "--shadow-3":
    "0 4px 8px rgba(17, 22, 20, 0.08), 0 32px 72px rgba(17, 22, 20, 0.18)",
  "--shadow-card":
    "0 1px 2px rgba(17, 22, 20, 0.06), 0 2px 8px rgba(17, 22, 20, 0.05)",
  "--shadow-panel":
    "0 1px 2px rgba(17, 22, 20, 0.05), 0 2px 10px rgba(17, 22, 20, 0.05)",
  "--shadow-accent": "0 0 0 3px rgba(23, 113, 74, 0.17)",

  // The accent's tint top-left, the attention colour's top-right, faint
  // enough to read as one ground rather than two colours.
  //
  // 0.11 is close to the ceiling: `--ink-3` over the darkest point of this
  // tint measures 4.58:1, and 0.14 would put it at 4.47, under the 4.5:1
  // floor. This variant, dark text on a light ground, has the least room, and
  // a higher alpha is measured against that floor.
  "--ground":
    "radial-gradient(1200px 780px at 10% -10%, rgba(23, 113, 74, 0.11), transparent 64%), radial-gradient(1000px 680px at 98% 2%, rgba(168, 82, 32, 0.075), transparent 60%)",
  // The same tint for the editor, pushed further into the corners at
  // roughly half the alpha. The measure sits in the middle of the window,
  // and prose is read for hours rather than scanned for seconds: a tint that
  // is right behind a shelf of cards is noticed behind a paragraph.
  "--ground-quiet":
    "radial-gradient(1100px 620px at -4% -18%, rgba(23, 113, 74, 0.065), transparent 58%), radial-gradient(900px 540px at 104% -6%, rgba(168, 82, 32, 0.042), transparent 55%)",
  "--grain":
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E\")",
  "--glass": "rgba(251, 252, 250, 0.72)",
  "--glass-edge": "inset 0 1px 0 rgba(255, 255, 255, 0.65)",
};

const STILL_DARK: TokenValues = {
  "--paper": "#1B1E24",
  "--paper-raised": "#23272F",
  "--paper-sunk": "#15181D",
  "--field": "#1B1E24",
  // 3.38:1 on `--paper` and `--field`, 3.03:1 on `--paper-raised`.
  "--field-edge": "#6A717A",

  // A shade under white: the prose is read for hours, and the interface is
  // no brighter than the prose.
  "--ink": "#D2D6DD",
  "--ink-3": "#98A2B3",
  // Light on dark reads heavier than dark on light, so the prose goes a
  // step lighter again.
  "--matte-prose-weight": "340",
  "--on-fill": "#1B1E24",
  // Every name colour is dark enough to carry a light initial, so the
  // avatar's initial keeps once dark's ink rather than `--on-fill`.
  "--face-ink": "#FBFCFA",
  "--ink-dim": "rgba(228, 231, 236, 0.38)",

  "--hair": "rgba(228, 231, 236, 0.13)",
  "--hair-firm": "rgba(228, 231, 236, 0.24)",
  "--hair-soft": "rgba(228, 231, 236, 0.07)",

  "--accent": "#7FA6E8",
  "--accent-tint": "rgba(127, 166, 232, 0.11)",
  "--accent-tint-2": "rgba(127, 166, 232, 0.19)",
  "--accent-glow": "rgba(127, 166, 232, 0.30)",
  // Leaf follows the same value-pole rule as every theme: the accent's own
  // hue, darkened, so the written-words cap reads against the bright bar.
  // Still dark's is a deep navy, not once dark's green.
  "--leaf": "#1B3F7E",

  "--attention": "#E0A458",
  "--attention-tint": "rgba(224, 164, 88, 0.13)",
  "--attention-glow": "rgba(224, 164, 88, 0.28)",

  "--danger": "#EF8074",
  "--danger-tint": "rgba(239, 128, 116, 0.13)",
  "--danger-glow": "rgba(239, 128, 116, 0.30)",

  "--wash-subtle": "rgba(228, 231, 236, 0.04)",
  "--wash": "rgba(228, 231, 236, 0.07)",
  "--wash-strong": "rgba(228, 231, 236, 0.12)",
  "--scrim": "rgba(9, 11, 14, 0.62)",
  "--scrollbar": "rgba(228, 231, 236, 0.16)",
  "--scrollbar-hover": "rgba(228, 231, 236, 0.30)",

  "--inverse": "rgba(228, 231, 236, 0.94)",
  "--inverse-solid": "#E4E7EC",
  "--inverse-ink": "rgba(27, 30, 36, 0.88)",
  "--inverse-ink-strong": "#1B1E24",
  "--inverse-raised": "rgba(27, 30, 36, 0.12)",
  "--inverse-raised-hover": "rgba(27, 30, 36, 0.22)",

  "--mark-search": "rgba(224, 164, 88, 0.32)",
  "--mark-search-current": "rgba(127, 166, 232, 0.34)",
  "--mark-selection": "rgba(127, 166, 232, 0.16)",
  "--mark-repetition": "rgba(239, 128, 116, 0.60)",
  // The comparing mode's two voices, under once dark's rule: the text rides
  // at the reference or a notch brighter; the tag grounds are the tints
  // made opaque over the paper; the hovers go a notch toward the ink.
  "--mark-diff-del": "#E38D86",
  "--mark-diff-add": "#6DB98E",
  "--mark-diff-wash-del": "rgba(214, 96, 86, 0.16)",
  "--mark-diff-wash-add": "rgba(74, 160, 110, 0.16)",
  "--mark-diff-tag-del": "#332528",
  "--mark-diff-tag-add": "#202E2B",
  "--mark-diff-tag-del-hover": "#45383C",
  "--mark-diff-tag-add-hover": "#34413E",

  "--shadow-1": "0 1px 2px rgba(0, 0, 0, 0.38), 0 2px 8px rgba(0, 0, 0, 0.28)",
  "--shadow-2":
    "0 2px 4px rgba(0, 0, 0, 0.42), 0 12px 32px rgba(0, 0, 0, 0.42)",
  "--shadow-3":
    "0 4px 8px rgba(0, 0, 0, 0.48), 0 32px 72px rgba(0, 0, 0, 0.56)",
  "--shadow-card":
    "0 1px 2px rgba(0, 0, 0, 0.38), 0 2px 8px rgba(0, 0, 0, 0.26)",
  "--shadow-panel":
    "0 1px 2px rgba(0, 0, 0, 0.34), 0 2px 10px rgba(0, 0, 0, 0.26)",
  "--shadow-accent": "0 0 0 3px rgba(127, 166, 232, 0.19)",

  // Same ceiling as once dark, in this variant's blue, with room to spare on
  // contrast and held back anyway. The depth comes from a pool of the accent
  // at the corner, not from a tint across the whole ground.
  "--ground":
    "radial-gradient(1150px 740px at 10% -10%, rgba(127, 166, 232, 0.14), transparent 62%), radial-gradient(950px 640px at 98% 2%, rgba(224, 164, 88, 0.09), transparent 58%)",
  // Quieter, for the editor: the same pools, cornered and halved.
  "--ground-quiet":
    "radial-gradient(1050px 600px at -4% -18%, rgba(127, 166, 232, 0.085), transparent 56%), radial-gradient(880px 520px at 104% -6%, rgba(224, 164, 88, 0.05), transparent 54%)",
  "--grain":
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E\")",
  "--glass": "rgba(35, 39, 47, 0.72)",
  "--glass-edge": "inset 0 1px 0 rgba(228, 231, 236, 0.10)",
};

export function palette(scheme: Scheme): TokenValues {
  return scheme === "light" ? ONCE_DARK : STILL_DARK;
}
