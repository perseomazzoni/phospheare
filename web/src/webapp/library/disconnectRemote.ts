// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { getCurrentUserId } from "../../auth/currentUser";
import { deleteAllProfileCopies } from "../../profile/portableDrive";
import { withMergesHeld } from "../../profile/profileStore";
import type { DisconnectOptions, ProviderConnection } from "../../storage";
import { appLog } from "../../log";

/** The settings and Library could not be removed; nothing was disconnected. */
export class CopiesNotDeleted extends Error {
  constructor() {
    super("The settings and Library could not be removed.");
  }
}

/**
 * Disconnects Remote Storage from this browser or from every device. Only a
 * disconnect from every device can remove the account's settings and Library
 * from it: every device still connected writes its own copy back at its next
 * sync. The copies are reachable only while the access exists, so a failure
 * to remove them rejects with `CopiesNotDeleted` and Remote Storage still
 * connected. A failure to disconnect rejects with the connection's own error.
 *
 * Removing the copies holds the account's merges until the disconnect has
 * settled, so no upload under way writes a copy back in between.
 */
export async function disconnectRemote(
  drive: Pick<ProviderConnection, "disconnect">,
  options: DisconnectOptions,
): Promise<void> {
  if (!options.everywhere || options.keptCopies) {
    await drive.disconnect(options);
    return;
  }
  const removeThenDisconnect = async () => {
    await deleteAllProfileCopies().catch(() => {
      throw new CopiesNotDeleted();
    });
    appLog.info(
      "drive",
      "The settings and Library were removed from Remote Storage.",
      { outcome: "removed" },
    );
    await drive.disconnect(options);
  };
  const writerId = getCurrentUserId();
  await (writerId
    ? withMergesHeld(writerId, removeThenDisconnect)
    : removeThenDisconnect());
}
