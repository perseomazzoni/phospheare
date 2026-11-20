// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { registerFamily } from "./application/registry";
import { choices } from "./compose";
import { matte } from "./themes/matte";
import { shine } from "./themes/shine";
import { vision } from "./themes/vision";
import { radiant } from "./themes/radiant";

// The registered themes. A writer chooses a theme (Matte, Shine, Vision or
// Radiant) and then its variant: "once dark", the light one, or "still
// dark", the dark one. Every theme is a folder in `./themes` of the same
// three files, written against the framework alone (`domain/family.ts`);
// adding one is writing its folder and registering it here. Settings builds
// its picker from `allFamilies()`, so nothing else needs to know.
//
// Order matters in one way only: the first family is what a writer with no
// stored choice gets, in still dark. That is the
// app's choice, not the framework's: no theme is drawn from another.
//
// The family names are proper nouns, so they are not translated.

registerFamily(matte);
registerFamily(shine);
registerFamily(vision);
registerFamily(radiant);

export { allThemes } from "./application/registry";
export const { applyStoredTheme, prefetchSheets, firstChoice, resolveChoice } =
  choices;
export { ThemeProvider, useTheme } from "./ThemeContext";
export { themeMarkup, type ThemeMarkup } from "./compose";
export type { Theme, ThemeFamily, SchemeChoice } from "./domain/types";
