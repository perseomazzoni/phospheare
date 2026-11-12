// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Preferences } from "./types";

// The demo site's `compose.ts`: `build:demo` resolves every import of
// `compose.ts` to this file (`build/demoBuild.ts`, `DEMO_TWINS`). The site
// has no accounts, so its visitors' preferences are the only ones.

export type { Preferences } from "./types";

/**
 * A visitor's preferences: nobody is signed in, every preference reads its
 * fallback and a write is dropped, as the synced profile answers with no
 * writer. The theme keeps a visitor's choice in this browser through its own
 * device storage (`theme/device.ts`).
 */
export const preferences: Preferences = {
  userId: () => null,
  onUserChange: () => () => undefined,
  getPref: (_key, fallback) => fallback,
  setPref: () => undefined,
};
