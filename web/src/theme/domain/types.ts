// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Decorations } from "./decorations";
import type { FrameOptions } from "./frame";
import type { ThemeToken } from "./tokens";

export type Scheme = "light" | "dark";

/** A variant, or `system` for whichever variant the system asks for. */
export type SchemeChoice = Scheme | "system";

export interface Theme {
  /**
   * `<family>-<scheme>`, which is also what the account stores: one key,
   * written whole, so a family and its variant can never be merged from two
   * devices into a pair neither of them chose.
   */
  id: string;
  /**
   * The theme this is a variant of: what Settings offers a writer, who picks
   * a theme and then its light or its dark. `registry.ts` groups the variants
   * by it.
   */
  family: string;
  /**
   * The variant's name, the same in every theme: "once dark" for the light,
   * "still dark" for the dark. A proper noun the way the product's name is,
   * so it is not translated, and written in lower case.
   */
  label: string;
  /**
   * Which variant this is. Also drives `color-scheme`, so native controls,
   * form fields and scrollbars follow the theme instead of staying light.
   */
  scheme: Scheme;
  /** Every value of the contract (`THEME_TOKENS`). */
  tokens: Record<ThemeToken, string>;
  /**
   * The theme's own tokens: every token it states outside the contract,
   * read by its sheet alone.
   */
  own: Record<string, string>;
  /** The frame's layouts this theme picks. */
  frame: FrameOptions;
  /** What this theme draws in the frame's slots. */
  decorations: Decorations;
  /**
   * Fetches the theme's sheet: all the paint the app uses under it, written
   * into the theme's layer while the theme is on (`themes/<family>/theme.css`).
   * Only the sheet a writer uses is fetched (`loadSheet` in
   * `adapters/page.ts`).
   */
  sheet: () => Promise<string>;
}

/** A theme as a writer chooses it: a name, and its two variants. */
export interface ThemeFamily {
  id: string;
  label: string;
  light: Theme | null;
  dark: Theme | null;
}
