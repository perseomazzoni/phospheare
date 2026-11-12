// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useState } from "react";
import type { CopyProgress } from "../../../project/transfer";

/**
 * A copy in flight, held here rather than in the dialog so Cancel outlives it.
 */
export interface CopyState {
  name: string;
  done: number;
  total: number | null;
  path: string | null;
  control: AbortController;
  /** Which text the progress dialog shows; sync adds a pairing step. */
  kind: "sync" | "duplicate" | "move";
}

/** What a copying action does with the shelf's progress window. */
export interface CopyJob {
  /** Puts the window up and answers the signal its Cancel aborts. */
  start: (name: string, kind: CopyState["kind"]) => AbortSignal;
  progress: (progress: CopyProgress) => void;
  finish: () => void;
}

/**
 * The shelf's one progress window for a whole-book copy, shared by Sync to
 * Remote Storage, both moves and Duplicate.
 */
export function useCopyJob(): CopyJob & {
  copy: CopyState | null;
  cancel: () => void;
} {
  const [copy, setCopy] = useState<CopyState | null>(null);

  const start = useCallback((name: string, kind: CopyState["kind"]) => {
    const control = new AbortController();
    setCopy({ name, done: 0, total: null, path: null, control, kind });
    return control.signal;
  }, []);

  // Reports a running copy's progress without restoring a copy that was
  // already cancelled.
  const progress = useCallback((progress: CopyProgress) => {
    setCopy((now) => (now ? { ...now, ...progress } : now));
  }, []);

  const finish = useCallback(() => setCopy(null), []);

  const cancel = useCallback(() => copy?.control.abort(), [copy]);

  return { copy, start, progress, finish, cancel };
}
