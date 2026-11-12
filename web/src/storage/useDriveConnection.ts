// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext";
import { getCurrentUserId } from "../auth/currentUser";
import { signInProblemKey, type ProblemWording } from "../auth/signInProblem";
import { isPlatformError, currentPlatform } from "../platform";
import { VENDORS } from "../legal/domain/facts";
import { findWriter, updateWriter } from "../writers/registry";
import { forgetDriveToken } from "./driveToken";
import { noteDriveAccepted, resetDriveGrant } from "./driveGrant";
import type {
  ConnectionVerbs,
  DisconnectOptions,
  ProviderConnection,
} from "./connections";
import { driveProvider } from "./driveProvider";
import type { ProjectRef } from "./types";

// The Remote Storage connection of the open writer. A writer connects Remote
// Storage only after signing in with Google, and only with that same account:
// the platform checks the subject Google returns with the grant and refuses
// any other before keeping anything. Disconnecting drops this installation's
// credential; revoking also asks Google to end the grant.

// A Remote Storage connect says an unreachable service and a generic failure
// in Remote Storage's terms; every other shared code reads as the sign-in
// says it. The account and scope refusals belong to Remote Storage alone.
const DRIVE_WORDING: ProblemWording = {
  unavailable: "library.identityUnavailable",
  failed: "library.driveFailed",
};

export function driveConnectionVerbs(): ConnectionVerbs {
  return {
    id: driveProvider.id,
    label: driveProvider.label,
    icon: driveProvider.icon,
    reconnect: async (ref) =>
      (await driveProvider.reopenProject(ref)) ? "granted" : "unavailable",
  };
}

/**
 * Drops the open writer's Remote Storage grant here and at Google. Resolves
 * `false` when Google did not confirm the revocation; the grant is gone from
 * this installation either way. A surface outside the Library root uses this
 * rather than a second `useDriveConnection`.
 */
export async function revokeDriveGrant(): Promise<boolean> {
  const id = getCurrentUserId();
  const record = id ? findWriter(id) : null;
  const platform = currentPlatform();
  if (!id || !record?.drive) return true;
  const answer = await platform.disconnectDrive({
    connectionId: record.drive.connectionId,
    revoke: true,
  });
  // Keep the identifier until the platform confirms local deletion, so an
  // unreachable helper does not strand a credential without a retry path.
  // The account's settings and Library stay in Remote Storage unless the
  // caller removed them first and says so (`disconnect`).
  updateWriter(id, (w) => ({ ...w, drive: null, remoteCopiesKept: true }));
  forgetDriveToken();
  resetDriveGrant();
  return answer.revokedAtGoogle;
}

/**
 * Drops the open writer's Remote Storage connection in this browser only:
 * Google is not asked to revoke, so every other browser and phone of the
 * account stays connected. The settings and Library copies stay in Remote
 * Storage.
 */
export async function dropDriveConnection(): Promise<void> {
  const id = getCurrentUserId();
  const record = id ? findWriter(id) : null;
  const platform = currentPlatform();
  if (!id || !record?.drive) return;
  await platform.disconnectDrive({
    connectionId: record.drive.connectionId,
    revoke: false,
  });
  updateWriter(id, (w) => ({ ...w, drive: null, remoteCopiesKept: true }));
  forgetDriveToken();
  resetDriveGrant();
}

export function useDriveConnection(): ProviderConnection {
  const verbs = driveConnectionVerbs();
  const { t } = useTranslation();
  const { user, refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setError(null);
    const id = getCurrentUserId();
    const platform = currentPlatform();
    const record = id ? findWriter(id) : null;
    if (!id || !record) return false;
    const google = record.google;
    // Remote Storage is a Google Drive grant, and an account without Google
    // never gains one; the writer is told so where they asked.
    if (!google) {
      setError(t("library.driveNeedsGoogle", { identity: VENDORS.identity }));
      return false;
    }
    try {
      // Called before any await, so the platform opens Google's window inside
      // the writer's click.
      const { grant } = await platform.connectDrive({
        writerId: id,
        expectedSub: google.sub,
      });
      // A grant that lands after the writer left is not theirs to keep here.
      if (getCurrentUserId() !== id) return false;
      updateWriter(id, (w) => ({
        ...w,
        drive: { ...grant, connectedAt: new Date().toISOString() },
      }));
      forgetDriveToken();
      noteDriveAccepted();
      await refresh();
      return true;
    } catch (err) {
      if (isPlatformError(err, "account-mismatch"))
        setError(
          t("library.driveAccountMismatch", { loginEmail: google.email }),
        );
      else if (isPlatformError(err, "scope-missing"))
        setError(t("library.driveScopeMissing"));
      else {
        const key = signInProblemKey(err, DRIVE_WORDING);
        setError(key ? t(key, { identity: VENDORS.identity }) : null);
      }
      return false;
    }
  }, [refresh, t]);

  const reconnect = useCallback(
    async (ref: ProjectRef) =>
      (await driveProvider.reopenProject(ref)) ? "granted" : "unavailable",
    [],
  );

  const refreshState = useCallback(
    async () => (user?.driveConnected ? "connected" : "unset"),
    [user?.driveConnected],
  );

  const disconnect = useCallback(
    async (
      options: DisconnectOptions = { everywhere: true, keptCopies: true },
    ) => {
      // A failure rejects: the disconnect dialog shows it, so the connection
      // error stays clear rather than saying it a second time.
      setError(null);
      if (!options.everywhere) {
        await dropDriveConnection();
        await refresh();
        return;
      }
      const confirmed = await revokeDriveGrant();
      const id = getCurrentUserId();
      if (id && findWriter(id))
        updateWriter(id, (w) => ({
          ...w,
          remoteCopiesKept: options.keptCopies,
        }));
      await refresh();
      if (!confirmed)
        setError(
          t("library.driveRevokePending", { identity: VENDORS.identity }),
        );
    },
    [refresh, t],
  );

  return {
    ...verbs,
    state: user?.driveConnected ? "connected" : "unset",
    // The writer records answer on the first render.
    resolved: true,
    error,
    where: user?.driveConnected ? (user.driveEmail ?? user.email) : null,
    connect,
    disconnect,
    reconnect,
    refresh: refreshState,
  };
}
