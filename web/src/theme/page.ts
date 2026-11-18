// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { THEME_TOKENS } from "./domain/tokens";
import type { Scheme, Theme } from "./domain/types";
import type { Page } from "./application/choice";
import { fadesOnSwitch } from "./domain/motion";

// Puts a theme on the page. Tokens go onto the root element as inline custom
// properties, which beat every stylesheet rule with no specificity games, and
// the theme's sheet goes into the theme's layer over the frame's. Geometry
// the viewport overrides must not be applied this way: `editor.css` keeps
// `--editor-width` and its siblings out of the theme.

// Neutral, like everything the browser keeps.
const STYLE_ID = "theme-css";

/** The own tokens the theme on the page wrote, for the next to clear. */
let ownOnPage: string[] = [];

function reducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The switch in flight, so an earlier one's end does not clear a later's mark. */
let switches = 0;

/**
 * Runs `apply`, which puts the theme `to` on the page, behind a crossfade
 * from the page as it was (`domain/motion.ts`), and answers whether it did.
 * When it does not (the cases `domain/motion.ts` names, or a browser without
 * view transitions), the caller applies the theme at once.
 * The browser runs `apply` later, after it has taken the old picture.
 *
 * A view transition rather than transitions on every element: restyling the
 * page takes longer than a frame, and colours transitioning in place would
 * have run most of their course before the first frame was drawn. The
 * browser holds the old picture while `apply` runs, then fades on the
 * compositor from its first frame. The root carries the mark while it does,
 * which the stylesheet reads (`base.css`, `[data-theme-switching]`).
 */
export function fadeToTheme(to: string, apply: () => void): boolean {
  const root = document.documentElement;
  if (
    !fadesOnSwitch(root.dataset.theme, to, reducedMotion()) ||
    typeof document.startViewTransition !== "function"
  )
    return false;
  const mine = ++switches;
  root.dataset.themeSwitching = "1";
  const fade = document.startViewTransition(apply);
  // A fade skipped by the next one rejects `ready`; the switch still lands.
  fade.ready.catch(() => {});
  void fade.finished
    .finally(() => {
      if (mine === switches) delete root.dataset.themeSwitching;
    })
    .catch(() => {});
  return true;
}

/**
 * Each sheet fetched so far, by its loader. A sheet is fetched the first time
 * its theme is in use, or Settings is opened, so the themes a writer never
 * uses are never downloaded.
 */
const sheets = new Map<Theme["sheet"], string>();

/** Whether a theme's sheet is here, so the theme can go on at once. */
export function sheetLoaded(theme: Theme): boolean {
  return sheets.has(theme.sheet);
}

/** Fetches a theme's sheet, once. A fetch that fails is tried again later. */
export async function loadSheet(theme: Theme): Promise<void> {
  if (!sheets.has(theme.sheet))
    sheets.set(theme.sheet, (await theme.sheet()).trim());
}

/** Whether the page is in this variant, its sheet included. */
export function isApplied(theme: Theme): boolean {
  // No page at all in the demo site's prerender, which renders the provider
  // in Node at build time.
  if (typeof document === "undefined") return false;
  return (
    document.documentElement.dataset.theme === theme.id && sheetLoaded(theme)
  );
}

/**
 * Puts a theme on the page.
 *
 * @throws when its sheet is not loaded (`loadSheet`), before writing
 *   anything, so the page never has half a theme.
 */
export function applyTheme(theme: Theme): void {
  const css = sheets.get(theme.sheet);
  if (css === undefined)
    throw new Error(`${theme.id}'s sheet is not loaded (loadSheet)`);
  const root = document.documentElement;

  for (const token of THEME_TOKENS) {
    root.style.setProperty(token, theme.tokens[token]);
  }
  // A theme's own tokens leave with it.
  for (const name of ownOnPage) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(theme.own)) {
    root.style.setProperty(name, value);
  }
  ownOnPage = Object.keys(theme.own);

  // Native controls, form fields and scrollbars follow this rather than staying
  // stubbornly light on a dark page.
  root.style.colorScheme = theme.scheme;
  root.dataset.theme = theme.id;
  // Read by the frame's stylesheets, which lay each option out once, and by
  // the theme's sheet, which paints it.
  const { frame, decorations } = theme;
  root.dataset.comments = frame.comments;
  root.dataset.underBar = frame.underBar;
  root.dataset.dockTabs = frame.dockTabs;
  root.dataset.panel = frame.panel;
  root.dataset.barCentre = frame.barCentre;
  root.dataset.leaves = frame.leaves;
  root.dataset.crop = decorations.pageCorners === "crop" ? "1" : "0";
  root.dataset.marginRule = decorations.marginRule;

  // One element, replaced wholesale: a theme's sheet must not outlive the
  // theme itself. An empty sheet writes no element.
  let style = document.getElementById(STYLE_ID);
  if (!css) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.append(style);
  }
  // The theme's layer sits over the frame's whatever loads after it
  // (`styles/frame.css`). The order is stated here too: whichever statement
  // the browser meets first fixes it, and this sheet can come first.
  style.textContent = `@layer frame, theme;\n@layer theme {\n${css}\n}\n`;
}

/** The scheme alone, so the browser's empty canvas follows the theme early. */
export function applyScheme(theme: Theme): void {
  document.documentElement.style.colorScheme = theme.scheme;
}

function systemScheme(): Scheme {
  return typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** The document, as the theme's page port (`ports/page.ts`). */
export const documentPage: Page = {
  systemScheme,
  sheetLoaded,
  loadSheet,
  isApplied,
  apply: applyTheme,
  applyScheme,
  fade: fadeToTheme,
};
