// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { createContext } from "react";
import type { Connections, ProviderConnection } from "../../storage";
import { driveConnectionVerbs } from "../../storage/useDriveConnection";
import { localConnectionVerbs } from "../../storage/useLocalConnection";

// The Library root owns the one instance of `useConnections()` and hands it
// through this context to the nested Settings route, which react-router
// renders with no props. A second collector in the tree would race the
// `?drive=` return trip, so the collector has one owner. The editor is a
// sibling route and reaches the verbs through `connectionFor`.
//
// Settings mounts only under the Library's provider, so the default value
// never renders; it keeps the type non-nullable. Its verbs are the real
// context-free ones, and its state is "nothing answered".

const dormant: Omit<ProviderConnection, "id" | "label" | "icon" | "reconnect"> =
  {
    state: "unset",
    resolved: false,
    error: null,
    where: null,
    connect: async () => false,
    disconnect: async () => {},
    refresh: async () => "unset",
  };

export interface ConnectionsContextValue {
  connections: Connections;
  /** The local choose flow: pick the folder, import its books, re-gather. */
  chooseLocalFolder: () => void;
  /** The local forget flow: drop the handle, settle, re-gather. */
  forgetLocalFolder: () => void;
}

export const ConnectionsContext = createContext<ConnectionsContextValue>({
  connections: {
    drive: { ...driveConnectionVerbs(), ...dormant },
    local: { ...localConnectionVerbs(), ...dormant },
  },
  chooseLocalFolder: () => {},
  forgetLocalFolder: () => {},
});
