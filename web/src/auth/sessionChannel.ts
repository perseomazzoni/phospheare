// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Tells the other tabs that the account signed out or another signed in. A
// writer with the library in one tab and the editor in another signs out in
// the first. Without this the second would show the account, keep its
// in-memory caches, and could write a working-copy file the first tab's
// purge just deleted, because the latch refusing such writes is per tab.
//
// The message is a ping, not a credential: an account id the receiver
// already holds, and a verdict. A receiver acts on `signed-out` only when the
// id is its current account, so a forged message can at worst sign out a tab
// whose account already signed out. `signed-in` decides nothing beyond a
// reload of a tab holding another account. `BroadcastChannel` is same-origin
// and reaches every tab.

// Neutral, like everything the browser keeps.
const CHANNEL = "session";

export type SessionSignal =
  /** The account signed out cleaning its things away, so every tab cleans. */
  | { kind: "signed-out"; userId: string }
  /**
   * The account signed out leaving its things here, so every tab lets go of
   * it and clears nothing.
   */
  | { kind: "left"; userId: string }
  /** A tab finished signing in, perhaps as another account. */
  | { kind: "signed-in"; userId: string };

/**
 * A fresh channel, or `null` where `BroadcastChannel` is absent (a few
 * browsers, jsdom without a stub). A missing channel is never an error: each
 * tab still finds out from the signed-in mark.
 */
function channel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === "function"
      ? new BroadcastChannel(CHANNEL)
      : null;
  } catch {
    return null;
  }
}

export function announceSession(signal: SessionSignal): void {
  const bus = channel();
  if (!bus) return;

  try {
    bus.postMessage(signal);
  } catch {
    // A window mid-teardown can refuse to post; the other tabs then learn
    // from the signed-in mark at their next load.
  } finally {
    bus.close();
  }
}

/** Shape-checks one message: another tab may be running another build. */
function read(data: unknown): SessionSignal | null {
  if (!data || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  if (typeof message.userId !== "string" || message.userId === "") return null;

  if (
    message.kind === "signed-out" ||
    message.kind === "signed-in" ||
    message.kind === "left"
  ) {
    return { kind: message.kind, userId: message.userId };
  }
  return null;
}

/** Subscribes; returns the unsubscribe. */
export function onSession(listen: (signal: SessionSignal) => void): () => void {
  const bus = channel();
  if (!bus) return () => {};

  const handle = (event: MessageEvent) => {
    const signal = read(event.data);
    if (signal) listen(signal);
  };

  bus.addEventListener("message", handle);

  return () => {
    bus.removeEventListener("message", handle);
    bus.close();
  };
}
