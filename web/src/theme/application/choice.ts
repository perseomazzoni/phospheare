// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Scheme, Theme } from "../domain/types";
import { choiceKey, parseChoice } from "../domain/choice";
import { allFamilies, getTheme, variantOf } from "./registry";

// Which theme a writer has chosen, and the first paint. The choice is kept
// in the writer's synced preferences, so it follows them to their next
// device. A first-time visitor gets the first registered theme in still
// dark, whatever the system asks for.

/** The page a theme is put on, and the sheets it fetches for it. */
export interface Page {
  /** The scheme the system asks for now. */
  systemScheme(): Scheme;
  /** Whether a theme's sheet is here, so the theme can go on at once. */
  sheetLoaded(theme: Theme): boolean;
  /** Fetches a theme's sheet, once; a fetch that fails is tried again later. */
  loadSheet(theme: Theme): Promise<void>;
  /**
   * Whether the page is in this variant: its classes are on the root and
   * its sheet is loaded.
   */
  isApplied(theme: Theme): boolean;
  /** Puts a theme whose sheet is here on the page, or throws before writing. */
  apply(theme: Theme): void;
  /** The scheme alone, so the browser's empty canvas follows the theme early. */
  applyScheme(theme: Theme): void;
  /**
   * Runs `apply` behind a crossfade to the theme `to`, later, once the
   * browser has its picture; answers `false` when it does not fade, and the
   * caller applies at once.
   */
  fade(to: string, apply: () => void): boolean;
}

/**
 * The writer's account as the theme needs it: whose choice is being read,
 * and the synced preferences that keep it, so the choice follows the writer
 * to their next device.
 */
export interface Account {
  /** The open writer, or `null` before a session is adopted or when none is. */
  userId(): string | null;
  /** Subscribes to every change of writer, signing out included. */
  onUserChange(listener: (userId: string | null) => void): () => void;
  /** The signed-in writer's preference, or `fallback` when there is none. */
  getPref<T>(key: string, fallback: T): T;
  setPref<T>(key: string, value: T): void;
}

/**
 * What this browser keeps for the first paint: the choice it last wore for a
 * signed-in writer, before the account is known.
 */
export interface Device {
  lastChoice(): string | null;
  /** Keeps a choice for the next first paint, or `null` to forget it. */
  keepChoice(choice: string | null): void;
}

export interface ChoicePorts {
  page: Page;
  account: Account;
  device: Device;
}

export type Choices = ReturnType<typeof createChoices>;

export function createChoices({ page, account, device }: ChoicePorts) {
  /** The variant a choice puts on the page now, or `null` when it names none. */
  function resolveChoice(choice: string): Theme | null {
    const parsed = parseChoice(choice);
    if (!parsed) return null;
    if (parsed.mode !== "system") return getTheme(choice);
    return variantOf(parsed.family, page.systemScheme());
  }

  function fallbackChoice(): string {
    const first = allFamilies()[0];
    if (!first) throw new Error("no theme is registered (theme/index.ts)");
    return choiceKey({ family: first.id, mode: first.dark ? "dark" : "light" });
  }

  /**
   * The signed-in writer's stored choice, if it still names a theme that
   * exists. A value written under an earlier set of names names nothing and
   * falls back, and nothing migrates it.
   */
  function storedChoice(): string | null {
    const saved = account.getPref<string | null>("theme", null);
    return saved && resolveChoice(saved) ? saved : null;
  }

  /** The choice in force: the writer's own, or a first-time visitor's. */
  function currentChoice(): string {
    return storedChoice() ?? fallbackChoice();
  }

  /**
   * The choice for the first paint, before the account is known: the one
   * this browser last wore for a signed-in writer, which the account then
   * confirms or replaces.
   */
  function firstChoice(): string {
    const last = device.lastChoice();
    return (
      storedChoice() ?? (last && resolveChoice(last) ? last : fallbackChoice())
    );
  }

  function rememberChoice(choice: string): void {
    account.setPref("theme", choice);
  }

  /**
   * Notes the choice the page now uses for the next first paint, while a
   * writer is signed in. Signing out forgets it (`forgetOnDevice`).
   */
  function keepOnDevice(choice: string): void {
    if (account.userId()) device.keepChoice(choice);
  }

  function forgetOnDevice(): void {
    device.keepChoice(null);
  }

  /**
   * Puts the first choice on the page. Awaited before React renders so the
   * first paint is already the right theme rather than a flash of another.
   * The scheme goes on at once, so the browser's empty canvas is already
   * dark under a dark theme while its sheet is fetched.
   */
  async function applyStoredTheme(): Promise<Theme | null> {
    const theme = resolveChoice(firstChoice());
    if (!theme) return null;
    page.applyScheme(theme);
    await page.loadSheet(theme);
    page.apply(theme);
    return theme;
  }

  /**
   * Fetches every theme's sheet ahead of a switch, for the place a writer
   * chooses one (Settings). A fetch that fails is tried again when the
   * theme is chosen.
   */
  function prefetchSheets(): void {
    for (const family of allFamilies()) {
      const theme = family.light ?? family.dark;
      if (theme) page.loadSheet(theme).catch(() => undefined);
    }
  }

  return {
    resolveChoice,
    storedChoice,
    currentChoice,
    firstChoice,
    rememberChoice,
    keepOnDevice,
    forgetOnDevice,
    applyStoredTheme,
    prefetchSheets,
  };
}
