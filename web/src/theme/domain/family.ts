// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { THEME_TOKENS, type ThemeToken } from "./tokens";
import type { Scheme, Theme } from "./types";
import type { Decorations } from "./decorations";
import type { FrameOptions } from "./frame";

// ── A theme family ───────────────────────────────────────────────────────────
//
// Every theme is written the same way, against the frame alone: its tokens,
// the frame's layouts it picks, what it draws in the page's slots and the
// sheet that paints the app. No theme is drawn from another, and nothing
// fills a token in for it.
//
// A family states every contract token (`THEME_TOKENS`), none of them blank,
// or does not build.
// Every other token it states is its own: its sheet reads it, and no other
// theme knows its name.
//
// A family is two variants, once dark and still dark, which share everything
// but what the palette answers for each.

/** Token values by name, the contract's and the family's own alike. */
export type TokenValues = Record<`--${string}`, string>;

export interface FamilyDress {
  /** The family's id, and the first half of each variant's. */
  id: string;
  /** What Settings calls it. */
  name: string;
  /** What changes between once dark and still dark: the colours, mostly. */
  palette: (scheme: Scheme) => TokenValues;
  /** What stays the same in both. The palette's answer wins over it. */
  shared: TokenValues;
  frame: FrameOptions;
  decorations: Decorations;
  /** Fetches the sheet that paints the app, the same in both variants. */
  sheet: () => Promise<string>;
}

export interface Family {
  id: string;
  name: string;
  light: Theme;
  dark: Theme;
}

/** The variant's name, the same in every family. */
const LABEL: Record<Scheme, string> = {
  light: "once dark",
  dark: "still dark",
};

const CONTRACT = new Set<string>(THEME_TOKENS);

function variant(dress: FamilyDress, scheme: Scheme): Theme {
  const values: Record<string, string> = {
    ...dress.shared,
    ...dress.palette(scheme),
  };
  const missing = THEME_TOKENS.filter((token) => !values[token]?.trim());
  if (missing.length > 0)
    throw new Error(`${dress.id}-${scheme} states no ${missing.join(", ")}`);
  const tokens = {} as Record<ThemeToken, string>;
  const own: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (CONTRACT.has(name)) tokens[name as ThemeToken] = value;
    else own[name] = value;
  }
  return {
    id: `${dress.id}-${scheme}`,
    family: dress.id,
    label: LABEL[scheme],
    scheme,
    tokens,
    own,
    frame: dress.frame,
    decorations: dress.decorations,
    sheet: dress.sheet,
  };
}

/** A family's two variants, each whole, from its dress. */
export function defineFamily(dress: FamilyDress): Family {
  return {
    id: dress.id,
    name: dress.name,
    light: variant(dress, "light"),
    dark: variant(dress, "dark"),
  };
}
