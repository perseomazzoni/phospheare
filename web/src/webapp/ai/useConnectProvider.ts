// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { currentPlatform } from "../../platform";
import { onConnect } from "../../ai/host/connectChannel";
import {
  OPENROUTER_ID,
  connectOpenRouter,
  keyLabelForApp,
  type ConnectOutcome,
} from "../../ai/host/openrouterConnection";

/**
 * The settings pane's half of the approval: start it from a click, show it
 * pending until it ends, and say when the browser blocked its window.
 *
 * A first connection and a renewal share this one flow; only the word on the
 * button differs. No work runs before the window opens: a popup opens only
 * inside a user gesture, and an `await` first breaks the chain, which Safari
 * and Firefox block. Why a key was refused is on the provider's row.
 */
export function useConnectProvider(): {
  connect: (providerId: string) => void;
  /** The window was blocked, so the writer needs somewhere to click again. */
  blocked: boolean;
  /** An approval is open and has not ended yet. */
  pending: string | null;
  dismissBlocked: () => void;
} {
  const { refresh } = useAuth();
  const [blocked, setBlocked] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  // Another tab connected or disconnected: the vault may hold a new answer.
  useEffect(
    () =>
      onConnect((signal) => {
        if (signal.ok) void refresh();
      }),
    [refresh],
  );

  // The flow this pane started last. A second click cancels the first flow,
  // whose "cancelled" then arrives while the second is still open, so an
  // outcome ends the pending state only when it is the current flow's.
  const current = useRef<Promise<ConnectOutcome> | null>(null);

  const connect = useCallback((providerId: string) => {
    const platform = currentPlatform();
    if (providerId !== OPENROUTER_ID) return;
    setBlocked(false);
    const outcome = connectOpenRouter(platform, keyLabelForApp());
    current.current = outcome;
    setPending(providerId);
    const ended = (result: ConnectOutcome | null) => {
      if (current.current !== outcome) return;
      current.current = null;
      setPending(null);
      if (result === "blocked") setBlocked(true);
    };
    void outcome.then(ended).catch(() => ended(null));
  }, []);

  return {
    connect,
    blocked,
    pending,
    dismissBlocked: useCallback(() => setBlocked(false), []),
  };
}
