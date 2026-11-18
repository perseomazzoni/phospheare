// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The demo site's pages are rendered at build time in English, in the theme
// a first visit gets, with motion on (`prerender.tsx`). React can take over
// that HTML only when the visitor's first render is the same markup. These
// are the inputs that change the markup: the language, the theme choice and
// the variant it resolves to, reduced motion, which pauses the landing, and
// a Mac, whose key labels differ.

import i18n from "i18next";
import { firstChoice, resolveChoice } from "../theme";
import { motionIsStill } from "../ui/motion";
import { isMac } from "../webapp/entry/landing/keys";

/** The attribute on `#root` that holds the state a page was rendered in. */
export const PRERENDERED_ATTRIBUTE = "data-prerendered";

/** The render inputs, as one string to write at build time and compare. */
export function pageState(): string {
  const choice = firstChoice();
  const theme = resolveChoice(choice)?.id ?? "";
  return [
    i18n.language,
    choice,
    theme,
    motionIsStill() ? "still" : "moving",
    isMac() ? "mac" : "pc",
  ].join(" ");
}

/**
 * Whether `root` holds a page rendered in the visitor's own state, so React
 * hydrates it. Otherwise the client renders from nothing, as without a
 * prerender: an Italian visitor, a stored theme, reduced motion or a Mac.
 */
export function canHydrate(root: Element): boolean {
  const rendered = root.getAttribute(PRERENDERED_ATTRIBUTE);
  return rendered !== null && root.hasChildNodes() && rendered === pageState();
}
