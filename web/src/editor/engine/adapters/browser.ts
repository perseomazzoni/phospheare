// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The browser adapter for the `Platform` port: the OS branch is read once
// from the navigator's user agent, and the labels derive from it.

import type { Platform } from "../ports/platform";

let cached: boolean | null = null;

export const browserPlatform: Platform = {
  isMac(): boolean {
    if (cached !== null) return cached;
    if (typeof navigator !== "undefined") {
      cached = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
    } else {
      cached = false;
    }
    return cached;
  },

  modLabel(): string {
    return browserPlatform.isMac() ? "\u2318" : "Ctrl";
  },

  ctrlLabel(): string {
    return browserPlatform.isMac() ? "\u2303" : "Ctrl";
  },

  shiftLabel(): string {
    return browserPlatform.isMac() ? "\u21E7" : "Shift";
  },

  altLabel(): string {
    return browserPlatform.isMac() ? "\u2325" : "Alt";
  },
};
