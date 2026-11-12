// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { IconName } from "../ui/icons";
import type { ProjectRef } from "./types";
import { driveConnectionVerbs } from "./useDriveConnection";
import { localConnectionVerbs } from "./useLocalConnection";
import { useDriveConnection } from "./useDriveConnection";
import { useLocalConnection } from "./useLocalConnection";

// ── The connection seam ──────────────────────────────────────────────────────
//
// The webapp knows only whether a storage is connected, unset or lapsed,
// never how it connects (Drive's OAuth round trip through the platform, the
// local folder picker). Each provider owns its connection
// mechanics; the surfaces report.
//
// One object per provider, reachable two ways:
//
//   `connectionFor(id)`  the context-free verbs: reconnect and static facts.
//                        The editor is a sibling route with no React context,
//                        and this is all it needs.
//   `useConnections()`   the React view: state, error and the settle verbs,
//                        instantiated once at the Library root. A second
//                        instance would run a second copy of Drive's
//                        `?drive=` return-trip effect, racing over the same
//                        URL params.
//
// State is derived, never stored: the facts come from the account
// (`user.driveConnected`, the handle store) and settle through React's render
// cycle. There is no provider-side store and no event emitter.
//
// The state axis reuses the port's `Access` vocabulary instead of a
// "disconnected" umbrella:
//
//   connected       usable now (Remote Storage connected; root chosen and
//                   granted)
//   unset           never chosen: the first-run truth, never presupposed
//   needs-gesture   chosen, but the browser wants a click before reading.
//                   Local's lapsed grant is re-picked with one gesture; as
//                   "unset" it would invite Forget and Choose.
//   unavailable     the runtime cannot support this provider (Firefox)
//
// `resolved` latches once a fact has answered. Before it, "unset" is
// a missing answer, not a truth, so no banner flashes.

export type ConnectionState =
  "connected" | "unset" | "needs-gesture" | "unavailable";

/**
 * What `reconnect` reports; the editor's copy depends on which happened.
 *
 *   granted     the project can be opened now
 *   cancelled   the writer closed the picker: nothing changed, and nothing is
 *               said; the affordance stays
 *   unavailable the project cannot be reached even after trying (a Remote
 *               Storage folder trashed, a real failure)
 */
export type ReconnectOutcome = "granted" | "cancelled" | "unavailable";

/**
 * The context-free part of a connection: static facts and the one verb that
 * runs without React state.
 */
export interface ConnectionVerbs {
  readonly id: string;
  readonly label: () => string;
  readonly icon: IconName;
  /** Re-establishes access to a project; call it from inside a click. */
  reconnect(ref: ProjectRef): Promise<ReconnectOutcome>;
}

/**
 * Where a Remote Storage disconnect reaches: this browser, or every device,
 * with whether the account's settings and Library stay in Remote Storage.
 */
export type DisconnectOptions =
  { everywhere: false } | { everywhere: true; keptCopies: boolean };

/** One provider's connection, as the webapp sees it. */
export interface ProviderConnection extends ConnectionVerbs {
  state: ConnectionState;
  /** True once the verdict has landed; false while nobody knows. */
  resolved: boolean;
  /** A connection-level problem in the writer's language, or `null`. */
  error: string | null;
  /**
   * Where the place is, in the writer's own words: the chosen folder's name
   * for local, the account's address for Remote Storage. `null` until there
   * is one.
   */
  where: string | null;
  /**
   * Establishes the connection: the folder picker for local (needs a click),
   * Google's consent screen for Drive. Resolves false when the writer
   * cancelled, true when the connection exists or is on its way.
   */
  connect(): Promise<boolean>;
  /**
   * Tears the connection down: local forgets the root and ignores the
   * options. Remote Storage ends this browser's connection only, or,
   * `everywhere`, revokes at Google, which disconnects every browser and
   * phone of the account; `keptCopies` then records whether the account's
   * settings and Library were left in it. Without options, Remote Storage
   * disconnects everywhere keeping the copies. Rejects when the connection
   * could not be ended, so the dialog that asked stays open with the reason.
   */
  disconnect(options?: DisconnectOptions): Promise<void>;
  /** Re-settles `state` and resolves the settled verdict. */
  refresh(): Promise<ConnectionState>;
}

export interface Connections {
  drive: ProviderConnection;
  local: ProviderConnection;
}

// ── The verbs registry ───────────────────────────────────────────────────────
// Lookup only, like `getProvider`: the editor resolves a stored ref's
// `providerId` back into its verbs. The demo fixture is absent: it has no
// connection to make, and it must never appear on a connection surface.

const verbsRegistry = new Map<string, ConnectionVerbs>();

export function registerConnectionVerbs(verbs: ConnectionVerbs): void {
  verbsRegistry.set(verbs.id, verbs);
}

export function connectionFor(id: string): ConnectionVerbs | null {
  return verbsRegistry.get(id) ?? null;
}

registerConnectionVerbs(localConnectionVerbs());
registerConnectionVerbs(driveConnectionVerbs());

/**
 * Every provider's connection, for the surfaces that report them. The Library
 * root owns the single instance and passes it down.
 */
export function useConnections(): Connections {
  const drive = useDriveConnection();
  const local = useLocalConnection();
  return { drive, local };
}
