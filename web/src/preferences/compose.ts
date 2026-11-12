// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Preferences } from "./types";
import { getPref, setPref } from "../profile/profileSync";
import { getCurrentUserId, onUserChange } from "../auth/currentUser";

// The preferences the app runs on; a build that supplies other preferences
// changes this file alone.

export type { Preferences } from "./types";

/**
 * The signed-in writer's synced profile (`profile/profileSync.ts`) and
 * the current writer. Each member calls through, so a test that replaces a
 * module function after import still reaches it.
 */
export const preferences: Preferences = {
  userId: () => getCurrentUserId(),
  onUserChange: (listener) => onUserChange(listener),
  getPref: (key, fallback) => getPref(key, fallback),
  setPref: (key, value) => setPref(key, value),
};
