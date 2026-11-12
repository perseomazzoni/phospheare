// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useState } from "react";

/** What an action does with the shelf's failure banner. */
export interface ActionFailure {
  /** Called as an action starts: the previous failure is no longer news. */
  clear: () => void;
  fail: (message: string) => void;
}

/**
 * The shelf's one failure banner, shared by every card action. An action
 * clears it as it starts, so a failure stays on screen until the writer
 * tries something else, and the banner never holds two actions' failures.
 * The creation wizard is the exception: its failure shows inside the open
 * dialog, not on a banner behind the scrim.
 */
export function useActionError(): ActionFailure & { error: string | null } {
  const [error, setError] = useState<string | null>(null);
  const clear = useCallback(() => setError(null), []);
  const fail = useCallback((message: string) => setError(message), []);
  return { error, clear, fail };
}
