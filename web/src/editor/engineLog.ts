// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { appLog } from "../log";
import type { DiffFallback } from "./engine";

// The editor core imports nothing outside itself, so what it reports for
// the log is heard here, where the app builds the engine.

/**
 * Logs each kind of comparison fallback `engine` reports, once: a failing
 * comparison fails again at every recompute. Answers the unsubscribe.
 */
export function logEngineFaults(engine: {
  onDiffFallback(listener: (fallback: DiffFallback) => void): () => void;
}): () => void {
  const logged = new Set<string>();
  return engine.onDiffFallback((fallback) => {
    const kind = `${fallback.grain}>${fallback.shown}`;
    if (logged.has(kind)) return;
    logged.add(kind);
    appLog.warn(
      "editor",
      fallback.shown === "none"
        ? "A comparison could not be shown at any grain."
        : "A comparison was shown by paragraph instead.",
      { ...fallback },
    );
  });
}
