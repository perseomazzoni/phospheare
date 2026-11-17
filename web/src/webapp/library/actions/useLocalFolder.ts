// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { Connections } from "../../../storage";
import type { ActionFailure } from "./useActionError";
import {
  actionFailure,
  type LibraryCardsApi,
  type ShelfToasts,
  type ShelfUser,
} from "./shelfActions";
import { appLog } from "../../../log";

export interface LocalFolderInput {
  user: ShelfUser;
  /**
   * Read for its stable `local.connect` and `local.disconnect`:
   * `useConnections()` returns a fresh object every render.
   */
  connections: Connections;
  scanLocal: LibraryCardsApi["scanLocal"];
  rescan: LibraryCardsApi["rescan"];
  toasts: ShelfToasts;
  failure: ActionFailure;
}

/**
 * The local root on this device: choosing it, which brings its books onto
 * the shelf, and forgetting it.
 */
export function useLocalFolder({
  user,
  connections,
  scanLocal,
  rescan,
  toasts,
  failure,
}: LocalFolderInput) {
  const { t } = useTranslation();
  const { post } = toasts;
  const { connect, disconnect } = connections.local;
  const { clear: clearFailure, fail } = failure;

  /**
   * Chooses the local root on this device: the connection's `connect` runs
   * the picker inside the click, reusing the stored root when the same folder
   * comes back and scaffolding nothing. `scanLocal` then imports the root's
   * books, because a plain reload imports nothing.
   */
  const choose = useCallback(async () => {
    if (!user) return;
    clearFailure();
    try {
      const picked = await connect();
      if (!picked) return;
      post(t("library.localFolderChosen"));
      // Sweep before the rescan: the sweep caches the discovered books, and
      // the gather then paints them from the cache. In the reverse order the
      // gather races the sweep's adoption and wipes the just-added card.
      const added = await scanLocal();
      appLog.info("library", "A local folder was chosen.", { added });
      if (added > 0) post(t("library.findLocalDone", { count: added }));
      rescan();
    } catch (err) {
      fail(actionFailure(err, t, "choose-folder"));
    }
  }, [user, post, t, scanLocal, rescan, connect, clearFailure, fail]);

  /**
   * Forgets the mapped local root, the twin of Remote Storage's disconnect and
   * silent like it: the shelf's local cards go blocked and the row returns to
   * "Choose local folder". The books stay on disk; a remap is Forget, then
   * Choose.
   *
   * The gather does not react to a connection change, so the explicit
   * `rescan()` is what updates the shelf.
   */
  const forget = useCallback(async () => {
    if (!user) return;
    clearFailure();
    try {
      await disconnect();
      appLog.info("library", "The local folder was forgotten.");
      rescan();
    } catch (err) {
      fail(actionFailure(err, t, "forget-folder"));
    }
  }, [user, disconnect, t, rescan, clearFailure, fail]);

  return { choose, forget };
}
