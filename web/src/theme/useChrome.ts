// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback } from "react";
import { useTheme, useThemeIfAny } from "./ThemeContext";
import type { Decorations } from "./domain/decorations";
import type { FrameOptions } from "./domain/frame";
import { allThemes } from "./application/registry";
import type { Scheme, Theme } from "./domain/types";

// The theme on the page, read as the editor needs it. Outside a
// `ThemeProvider` (a component test, an embedder) each answers the theme a
// first visit gets, the first registered: the app always uses a theme.

function useActiveTheme(): Theme {
  const theme = useThemeIfAny()?.theme ?? allThemes()[0];
  if (!theme) throw new Error("No theme is registered");
  return theme;
}

export function useFrameOptions(): FrameOptions {
  return useActiveTheme().frame;
}

export function useDecorations(): Decorations {
  return useActiveTheme().decorations;
}

/**
 * The variant on the page, by its scheme and its name, and a flip to the
 * theme's other one: all the editor may change about the theme, from the
 * panel's foot.
 */
export function useSchemeFlip(): {
  scheme: Scheme;
  label: string;
  flip: () => void;
} {
  const { theme, setScheme } = useTheme();
  const { scheme, label } = theme;
  const flip = useCallback(
    () => setScheme(scheme === "light" ? "dark" : "light"),
    [scheme, setScheme],
  );
  return { scheme, label, flip };
}
