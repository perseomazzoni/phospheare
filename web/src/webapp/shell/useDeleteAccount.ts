// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { clearFarewell, leaveFarewell } from "../../auth/farewell";
import { writeOpenWork } from "../../auth/openWork";
import { getCurrentUserId } from "../../auth/currentUser";
import { deleteAllProfileCopies } from "../../profile/portableDrive";
import { withMergesHeld } from "../../profile/profileStore";
import { revokeDriveGrant, type ProviderConnection } from "../../storage";
import {
  deleteAccount,
  DeleteAccountStopped,
  type DeleteAccountFailure,
} from "../../writers/application/deleteAccount";
import { appLog, describeError } from "../../log";

// "Delete your account", wired to this installation. It lives beside
// `useSignOutFlow` for the same reason: the Remote Storage revoke imports
// `useAuth`, so `AuthContext` cannot hold it.

export interface DeleteAccountFlow {
  confirming: boolean;
  busy: boolean;
  /** Where the last attempt stopped, while the dialog shows it. */
  failure: DeleteAccountFailure | null;
  /**
   * Remote Storage was emptied and disconnected before the step that failed,
   * so the reason does not claim nothing changed.
   */
  remoteCleared: boolean;
  request: () => void;
  cancel: () => void;
  confirm: () => void;
}

export function useDeleteAccount(
  drive: Pick<ProviderConnection, "state">,
): DeleteAccountFlow {
  const auth = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<DeleteAccountFailure | null>(null);
  const [remoteCleared, setRemoteCleared] = useState(false);

  const confirm = useCallback(() => {
    setBusy(true);
    setFailure(null);
    const remoteConnected = drive.state === "connected";
    deleteAccount({
      writeOpenWork,
      remoteConnected,
      deleteRemoteCopies: deleteAllProfileCopies,
      revokeRemote: async () => {
        // Left before the sign-out, which takes the page to the landing.
        const confirmed = await revokeDriveGrant();
        if (!confirmed) leaveFarewell("auth.farewellRevokePending");
        return confirmed;
      },
      holdMerges: (run) => {
        const id = getCurrentUserId();
        return id ? withMergesHeld(id, run) : run();
      },
      forget: () => auth.signOut("clean"),
    }).catch((err: unknown) => {
      clearFarewell();
      const at = err instanceof DeleteAccountStopped ? err.at : "local";
      appLog.error("account", "The account deletion stopped.", {
        step: at,
        ...describeError(err),
      });
      // A retry starts disconnected, so a cleared Remote Storage stays known.
      if (at === "local" && remoteConnected) setRemoteCleared(true);
      setFailure(at);
      setBusy(false);
    });
  }, [auth, drive.state]);

  return {
    confirming,
    busy,
    failure,
    remoteCleared,
    request: () => {
      setFailure(null);
      setConfirming(true);
    },
    cancel: () => {
      if (busy) return;
      setConfirming(false);
      setFailure(null);
    },
    confirm,
  };
}
