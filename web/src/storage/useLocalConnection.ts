// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useState } from "react";
import type {
  ConnectionState,
  ConnectionVerbs,
  ProviderConnection,
} from "./connections";
import { localProvider } from "./localProvider";
import {
  ensureLocalRoot,
  forgetLocalRoot,
  getLocalRoot,
  rootPermission,
} from "./localRoot";
import { appLog, describeError } from "../log";

// The local connection is a device fact, not an account one: the root folder
// the writer chose once, in `localRoot.ts`. A fresh pick is the grant, so
// connect and reconnect run straight out of a click, and cancelling changes
// nothing. `state` is refined by one `rootPermission` probe, which queries and
// never requests.

export function localConnectionVerbs(): ConnectionVerbs {
  return {
    id: localProvider.id,
    label: localProvider.label,
    icon: localProvider.icon,
    reconnect: async () =>
      (await ensureLocalRoot()) !== null ? "granted" : "cancelled",
  };
}

export function useLocalConnection(): ProviderConnection {
  const verbs = localConnectionVerbs();
  const [state, setState] = useState<ConnectionState>("unset");
  /** Latches true once the handle store has answered. */
  const [resolved, setResolved] = useState(false);
  const [where, setWhere] = useState<string | null>(null);

  const settle = useCallback(async (): Promise<ConnectionState> => {
    let next: ConnectionState;
    let name: string | null = null;
    if (!localProvider.isAvailable()) {
      // Firefox and Safari: nothing to choose, and no dot to misread as a
      // possible connection.
      next = "unavailable";
    } else {
      const root = await getLocalRoot().catch((err: unknown) => {
        appLog.warn("storage", "The local folder could not be looked up.", {
          ...describeError(err),
        });
        return null;
      });
      name = root?.name ?? null;
      if (!root) {
        next = "unset";
      } else {
        const access = await rootPermission();
        if (access === "granted") next = "connected";
        else if (access === "needs-gesture") next = "needs-gesture";
        else next = "unset"; // the browser will not answer about it: re-pick
      }
    }
    setState(next);
    setWhere(next === "unset" ? null : name);
    setResolved(true);
    return next;
  }, []);

  useEffect(() => {
    void settle();
  }, [settle]);

  // Every verb settles state when it lands, so a flow that follows a pick sees
  // the fresh verdict without a second round trip.
  const pick = useCallback(async (): Promise<boolean> => {
    const chosen = (await ensureLocalRoot()) !== null;
    await settle();
    return chosen;
  }, [settle]);

  // Stable, so a caller's own `useCallback` can depend on these verbs without
  // rebuilding every render.
  const disconnect = useCallback(async () => {
    await forgetLocalRoot();
    await settle();
  }, [settle]);

  const reconnect = useCallback(async () => {
    const outcome =
      (await ensureLocalRoot()) !== null ? "granted" : "cancelled";
    await settle();
    return outcome;
  }, [settle]);

  return {
    ...verbs,
    state,
    resolved,
    error: null, // the pick and forget flows describe their own failures
    where,
    connect: pick,
    disconnect,
    reconnect,
    refresh: settle,
  };
}
