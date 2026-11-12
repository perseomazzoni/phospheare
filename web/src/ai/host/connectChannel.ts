// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Tells the other tabs to re-read a provider's status. The popup finishes the
// exchange itself, so the code never travels back to the opener. The message
// carries a provider id and whether the exchange worked, and nothing else: no
// code, no key, no account.
//
// The channel is not a trust boundary. The opener learns nothing from the
// message, only from re-reading the provider's status afterwards, so a forged
// message can at worst cause an extra read.
//
// `BroadcastChannel` rather than `postMessage`: it is same-origin by
// construction, so there is no `targetOrigin` to get wrong on send and no
// `event.origin` to forget on receive. It also reaches every tab, so a writer
// with two editors open sees the change in both.

import { openChannel } from "../../platform/channel";

export { openChannel };

// Neutral, like every name the browser keeps.
const CHANNEL = "provider-connections";

export interface ConnectSignal {
  providerId: string;
  /** Whether the exchange succeeded. A failure drops the opener's spinner. */
  ok: boolean;
}

/**
 * The status channel. Missing, the popup still stores the credential, and the
 * opener learns of it on its next read of the provider's status.
 */
function channel(): BroadcastChannel | null {
  return openChannel(CHANNEL);
}

export function announceConnect(signal: ConnectSignal): void {
  const bus = channel();
  if (!bus) return;

  try {
    bus.postMessage(signal);
  } catch {
    // A window mid-teardown can refuse to post. The credential is already
    // stored either way; only the immediacy of the refresh is lost.
  } finally {
    bus.close();
  }
}

export function onConnect(listen: (signal: ConnectSignal) => void): () => void {
  const bus = channel();
  if (!bus) return () => {};

  const handle = (event: MessageEvent) => {
    const data = event.data as Partial<ConnectSignal> | null;

    // Shape-checked although the channel is same-origin: another tab can run
    // a different version of the app, and a stale shape is ignored rather
    // than turned into an undefined provider id.
    if (!data || typeof data.providerId !== "string") return;
    if (typeof data.ok !== "boolean") return;

    listen({ providerId: data.providerId, ok: data.ok });
  };

  bus.addEventListener("message", handle);

  return () => {
    bus.removeEventListener("message", handle);
    bus.close();
  };
}
