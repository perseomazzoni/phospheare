// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

/**
 * A same-origin channel by name, or `null` where `BroadcastChannel` is
 * absent (a few browsers, jsdom without a polyfill) or its constructor
 * throws (a document mid-teardown, an opaque origin). Every caller treats a
 * missing channel as a lost signal, never as an error.
 */
export function openChannel(name: string): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === "function"
      ? new BroadcastChannel(name)
      : null;
  } catch {
    return null;
  }
}
