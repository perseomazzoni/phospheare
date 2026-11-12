// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ChatTurn } from "../../ai/domain/types";

// The key protocol, as the AI panel reads it. The editor and its AI panel
// never judge a provider's key: they do not parse an expiry, compare a spend
// with a limit, or work out when a window resets, because each would be a
// way to disagree with the request gate about the same key. `keyVerdict` in
// `ai/domain/openrouterKey.ts` judges, from the vendor's own report on the
// key, and the check before each request refuses by the same verdict; the
// panel renders what it is told.
//
// Two inputs and no third: what the account layer says the key can do now
// (this shape), and why the turn failed (`ChatTurn.errorCode`, in the chat
// file). Everything here compares flags and nothing reads a clock. Nothing
// names a vendor: the same fields come back for every remote provider.

/**
 * What the account layer says about a connected provider's key.
 *
 * A structural shape rather than an imported name: the account layer's
 * `OpenRouterStatus` satisfies it, and the editor needs to know nothing else
 * about that status.
 */
export interface KeyVerdict {
  connected: boolean;
  /** Whether it can answer now; `null` only when nothing is connected. */
  state: "ready" | "expired" | "limit-reached" | null;
  /** Worth saying before it stops. Only ever beside `ready`. */
  notice: "expiring-soon" | "limit-mostly-used" | null;
  /**
   * Set only when the limit is spent and the key outlives its reset, when
   * waiting is a real choice. Rendered as a date; never compared with one.
   */
  waitUntil: string | null;
  limitUsd: number | null;
  /** Printed, never compared. */
  spentUsd?: number | null;
  remainingUsd?: number | null;
  /** How much of the limit is spent, 0 to 1: the verdict's division, so the
      bar is drawn from its figure rather than one worked out here. */
  spentShare?: number | null;
  /**
   * When the key stops, at the latest; the credit panel prints its date and
   * time. Whether the key is still good is `state`.
   */
  expiresAtOrBefore?: string | null;
}

/** The one thing a failed turn offers about a key. */
export type KeyRemedy = "retry" | "renew" | "new-key";

/**
 * Which one button a turn that failed over its key offers, or `null` when
 * the failure was not about a key.
 *
 * Try again only when the verdict says the key the account holds now can
 * answer (`ready`): a limit that reset, a new key that works. Otherwise the
 * remedy for what the key is now: a replacement that is itself spent is
 * offered a new key, not a Try again that would fail. A Try again that
 * cannot work is worse than none, so the two are never shown together, and
 * never for a key that cannot answer.
 *
 * The current verdict decides, not whether the key changed: a new key that
 * is already dead is no better than the old one. With no verdict at all
 * (nothing connected) the turn's own remedy is offered, since the connect
 * popup it opens is right in every case.
 */
export function keyRemedy(
  turn: ChatTurn,
  verdict: KeyVerdict | undefined,
): KeyRemedy | null {
  if (turn.errorCode !== "key-expired" && turn.errorCode !== "limit-reached")
    return null;
  if (!verdict?.connected || verdict.state === null)
    return turn.errorCode === "key-expired" ? "renew" : "new-key";
  if (verdict.state === "ready") return "retry";
  return verdict.state === "expired" ? "renew" : "new-key";
}
