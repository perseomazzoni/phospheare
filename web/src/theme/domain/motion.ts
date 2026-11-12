// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── A theme switch ───────────────────────────────────────────────────────────
//
// Changing theme fades the page from the old theme to the new rather than
// cutting, over 220ms on the curve the house eases out on (`base.css`,
// `[data-theme-switching]`). The first theme a page puts on does not fade,
// since there is nothing to fade from, and neither does a switch to the theme
// already on, or one for a writer who asked for less motion.

export function fadesOnSwitch(
  from: string | undefined,
  to: string,
  reducedMotion: boolean,
): boolean {
  return from !== undefined && from !== to && !reducedMotion;
}
