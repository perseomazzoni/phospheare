// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useState } from "react";

/**
 * Whether the browser believes it can reach the network.
 *
 * `navigator.onLine` is a weak signal, trusted anyway: it is false only when
 * the browser knows there is no connection, which is the case worth
 * announcing (a train entering a tunnel). It can be true on a connection that
 * goes nowhere (a captive portal, a dead uplink), so it is never proof that a
 * request will succeed. Nothing here gates a write; it decides whether to say
 * something.
 *
 * The `offline` and `online` events fire on the transition, with no polling,
 * so the notice appears the moment the connection drops and clears itself the
 * moment it returns, with nothing to dismiss.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    // `navigator.onLine` is universally supported, but the shell imports this
    // module and its tests run without a DOM, where a bare read at first
    // render would throw.
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    // The state can have changed between the initial render and this effect
    // (a reconnect during hydration), and neither event would fire for it.
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  return online;
}
