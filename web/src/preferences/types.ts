// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

/**
 * The writer's preferences as the app reads them: the theme, the interface
 * language and the editor settings. Whose they are and where they are kept
 * is the adapter's: the full program keeps them in the account's synced
 * profile, so a choice follows the writer to their other devices.
 */
export interface Preferences {
  /** The open writer, or `null` before a session is adopted or when none is. */
  userId(): string | null;
  /** Subscribes to every change of writer, signing out included. */
  onUserChange(listener: (userId: string | null) => void): () => void;
  /** The stored preference, or `fallback` when there is none. */
  getPref<T>(key: string, fallback: T): T;
  setPref<T>(key: string, value: T): void;
}
