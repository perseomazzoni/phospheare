// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Family } from "../domain/family";
import type { Scheme, Theme, ThemeFamily } from "../domain/types";

// The theme registry: `theme/index.ts` registers each family, and Settings
// reads `allFamilies()`.
//
// What is registered is the variant, the thing put on the page; a theme
// ("family") is the variants that name it, grouped in registration order. So
// there is one list to keep, and a family cannot disagree with its variants.

const themes = new Map<string, Theme>();
const familyLabels = new Map<string, string>();

/** @throws when a variant of that id is registered already. */
export function register(theme: Theme): void {
  if (themes.has(theme.id))
    throw new Error(`${theme.id} is registered twice (theme/index.ts)`);
  themes.set(theme.id, theme);
}

/** Registers a family: its name, and both its variants. */
export function registerFamily(family: Family): void {
  familyLabels.set(family.id, family.name);
  register(family.light);
  register(family.dark);
}

export function getTheme(id: string): Theme | null {
  return themes.get(id) ?? null;
}

/** Every registered variant, in registration order. */
export function allThemes(): Theme[] {
  return [...themes.values()];
}

/** Every theme a writer can choose, in the order its first variant was
 * registered, each with whichever of its two variants exist. */
export function allFamilies(): ThemeFamily[] {
  const families = new Map<string, ThemeFamily>();
  for (const theme of themes.values()) {
    const family = families.get(theme.family) ?? {
      id: theme.family,
      label: familyLabels.get(theme.family) ?? theme.family,
      light: null,
      dark: null,
    };
    family[theme.scheme] ??= theme;
    families.set(theme.family, family);
  }
  return [...families.values()];
}

/**
 * The variant of `family` in `scheme` — or, when that family has no such
 * variant, the one it does have, so a choice never lands on nothing.
 */
export function variantOf(family: string, scheme: Scheme): Theme | null {
  const found = allFamilies().find((one) => one.id === family);
  if (!found) return null;
  return found[scheme] ?? found.light ?? found.dark;
}

/** Only for tests, which need a registry that does not leak between cases. */
export function clearThemes(): void {
  themes.clear();
  familyLabels.clear();
}
