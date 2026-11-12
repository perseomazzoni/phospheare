// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useRef, useState } from "react";

// The tooltip group delay. A tooltip waits before it appears, because the
// pointer is usually passing through. The wait is paid once per group: the
// first tip earns it, and the rest of the row is instant until the pointer has
// been away long enough that the next visit is a new question.
//
// Both numbers are chosen against the tip's own delay: `TIP_WARM_AFTER` is
// just past `--d-tip` (460ms), so the group turns warm about when the first
// tip finishes appearing, and `TIP_COOL_AFTER` is long enough to cross a gap
// between two segments without going cold.

/** Long enough that the first tip has appeared. */
export const TIP_WARM_AFTER = 500;
/** Long enough to reach for a second control without paying again. */
export const TIP_COOL_AFTER = 900;

/**
 * Whether the bar's tips are warm, and the two handlers that decide it.
 * Returned as props rather than taking a ref, so the caller decides which
 * element the group is.
 */
export function useTipWarmth() {
  const [warm, setWarm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // A bar unmounted while the pointer is over it (the editor's find opening
  // over it, a route change) must not warm or cool anything afterwards.
  useEffect(() => stop, [stop]);

  const onPointerEnter = useCallback(() => {
    stop();
    timer.current = setTimeout(() => setWarm(true), TIP_WARM_AFTER);
  }, [stop]);

  // The next enter cancels cooling, so crossing the hairline between two
  // segments does not reset the group.
  const onPointerLeave = useCallback(() => {
    stop();
    timer.current = setTimeout(() => setWarm(false), TIP_COOL_AFTER);
  }, [stop]);

  return { warm, onPointerEnter, onPointerLeave };
}
