// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef } from "react";

// The deferred disposal the editor's assistant depends on. StrictMode mounts,
// cleans up and mounts again in development; disposing on the first cleanup
// kills the instance the second mount still renders, and every later publish
// is a no-op. So disposal waits one macrotask, and an effect run
// with the same value, which is what StrictMode's re-run is, cancels it.
//
// A different value is not a remount: the editor rebuilt its dependencies and
// the previous instance is gone, so the next effect run must not swallow its
// disposal.

export function useDeferredDispose<T extends { dispose(): void } | null>(
  value: T,
): void {
  const timer = useRef<number | null>(null);
  const scheduled = useRef<T | null>(null);
  useEffect(() => {
    if (scheduled.current === value && timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
      scheduled.current = null;
    }
    return () => {
      scheduled.current = value;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        scheduled.current = null;
        value?.dispose();
      }, 0);
    };
  }, [value]);
}
