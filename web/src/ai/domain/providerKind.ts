// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ProviderKind } from "./types";

// ── A model's side of the port ───────────────────────────────────────────────
//
// `ProviderKind` is what the privacy gate branches on, the same axis the
// storage port uses. No adapter asserts its own value: an
// asserted kind is true only while two files happen to agree, and nothing
// would stop a hosted adapter asserting `device` for a host on the other side
// of the world. The axis is derived from the one fact that
// decides it: where the bytes go.
//
// ── Private network addresses ────────────────────────────────────────────────
//
// A private LAN address is `remote`. `192.168.1.40` may be the writer's own
// desktop seen from their laptop, but it is another machine, and the
// manuscript leaves this one to reach it, over a network, to a process
// nothing here has vetted. `device` means bytes bound to this computer, as on
// the storage port, so anything that travels is `remote` and gets the privacy
// review every remote seam gets. Wrong in this direction costs a needless
// review; wrong in the other costs a manuscript.

/** How the bytes reach a model: the adapter calls `endpoint` itself. */
export type ModelDestination = { via: "direct"; endpoint: string };

/** Hostnames that are this machine, spelled every way a URL may spell them. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Which side of the port a destination puts a model on. */
export function kindForDestination(
  destination: ModelDestination,
): ProviderKind {
  return kindForEndpoint(destination.endpoint);
}

/**
 * Which side of the port an endpoint puts a model on.
 *
 * Unparseable input is `remote`, which fails closed: an endpoint this cannot
 * read is not one it can vouch for, and the caller's own validation rejects
 * it first.
 */
function kindForEndpoint(endpoint: string): ProviderKind {
  let host: string;
  try {
    host = new URL(endpoint.trim()).hostname.toLowerCase();
  } catch {
    return "remote";
  }
  if (LOOPBACK_HOSTS.has(host)) return "device";
  // The whole 127.0.0.0/8 block is loopback, not only 127.0.0.1; a runtime
  // may bind 127.0.0.2.
  if (/^127(\.\d{1,3}){3}$/.test(host)) return "device";
  return "remote";
}
