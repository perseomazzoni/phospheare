// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useLayoutEffect, useMemo, useRef } from "react";

// Handlers that keep their identity. The structure panel's rows are memoised,
// and the panel's handlers are written inline or close over state that moves;
// a row that kept an old handler would act on an old panel. So the rows get
// forwarders: one function per handler, made once, that calls whatever the
// panel's newest render supplied.
//
// They are called only from events, after the render that supplied them has
// committed, so the newest set is recorded in a layout effect rather than
// during render, where a render React throws away could leave its handlers
// behind.

type Handler = (...args: never[]) => unknown;

/**
 * Stable stand-ins for `handlers`, one per key, each calling the latest
 * function under that key. The keys are read once, on the first render: the
 * set of handlers a caller passes must not change, only the functions.
 */
export function useForwarders<T extends Record<string, Handler>>(
  handlers: T,
): T {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  return useMemo(() => {
    const forwarders: Record<string, Handler> = {};
    for (const key of Object.keys(latest.current))
      forwarders[key] = (...args: never[]) =>
        (latest.current[key] as (...args: never[]) => unknown)(...args);
    return forwarders as T;
  }, []);
}
