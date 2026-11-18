// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useSyncExternalStore } from "react";
import { updateReady } from "./compose";

/** Whether "A newer version is ready" is showing. */
export function useUpdateReady(): boolean {
  // No update is showing in a page rendered at build time (the demo site's
  // prerender), nor while the browser hydrates that page.
  return useSyncExternalStore(
    updateReady.subscribe,
    updateReady.showing,
    () => false,
  );
}
