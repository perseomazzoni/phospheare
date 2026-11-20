// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The landing's address in each language of the site. English is at "/",
// which also serves a visitor whose browser prefers another language. Every
// other language has an address of its own, which fixes the language: a
// search engine then finds the landing in that language at one address, and
// the build links the addresses to each other (`hreflang`).

/** The landing's address for each language, the default one first. */
export const LANDING_PATHS: Readonly<Record<string, string>> = {
  en: "/",
  it: "/it",
};

/**
 * The language an address fixes, or `undefined` for every address where the
 * visitor's own language applies, "/" among them.
 */
export function languageOfPath(path: string): string | undefined {
  const page = path.replace(/\/+$/, "");
  return Object.entries(LANDING_PATHS).find(
    ([, landing]) => landing !== "/" && landing === page,
  )?.[0];
}
