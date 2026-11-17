// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useState, useSyncExternalStore } from "react";
import { useAuth } from "../../auth/AuthContext";
import { dropDriveConnection, type ProviderConnection } from "../../storage";
import {
  drainAll,
  pendingRecords,
  subscribe,
} from "../../project/sync/remoteQueue";
import { uncommittedFiles } from "../../project/sync/deviceWork";
import { pendingOpsOrThrow } from "../../project/sync/remoteQueueStore";
import { writeOpenWork } from "../../auth/openWork";
import { uploadProfile } from "../../profile/forgetAccount";
import { appLog, describeError } from "../../log";

// Sign-out, with one question for both kinds of account: leave everything
// here for the next entry, or clean everything of the account away from this
// browser, as before its first entry.
//
// It lives here rather than in `AuthContext` because the clean needs the
// Remote Storage connection's drop, whose module imports `useAuth`;
// `AuthContext` importing it back would be a cycle. `AuthContext.signOut`
// stays the low-level "end the session" primitive: everything below decides
// what else happens first, then calls it last with the writer's answer.
//
// `signOut` throws when the session did not end, and then has changed
// nothing local. The dialog has closed by then, so it opens
// again with the reason, and the same buttons are the retry. A sign-out that
// fails silently is worse than one that never ran: the writer walks away
// from a shared computer believing it is safe.
//
// A clean drops this browser's Remote Storage connection and never revokes
// at Google: revoking ends the grant for every browser and phone of the
// account, which only deleting the account or disconnecting everywhere does.
// The drop throws, so one that fails stops the clean before anything on this
// device changes. It runs before the sign-out, and a sign-out that fails
// after it leaves the writer signed in with Remote Storage disconnected
// here: queued work then waits for a reconnect, and the reopened dialog says
// so instead of claiming nothing changed.
//
// It takes `drive` as a parameter rather than calling `useConnections()`: a
// second collector instance in the tree would run a second
// `?drive=connected` return-trip effect racing over the same URL params.
//
// Leaving keeps the queue and the working copy, so work the queue still holds
// survives it and Leave is always offered. Cleaning destroys that work, so
// while files are held the clean says so in its title and its button.
// The count is live, not sampled: `requestSignOut` fires `drainAll()` and
// opens the dialog at once, and the count falls as the drain lands, so the
// dialog and the queue never disagree and nothing guesses a timeout.
//
// Every choice writes the open work first. With Remote Storage connected, a
// clean then writes the profile there, both before the drop or the purge
// touch anything. A profile upload that fails or runs out of time
// stops the clean once and reopens the question with that fact; the next
// answer is taken as given, because the upload already had its chance.

/**
 * Why the last attempt did not end the session: the Remote Storage drop
 * failed and nothing changed, the sign-out failed and nothing changed, or
 * the sign-out failed after Remote Storage was disconnected here.
 */
export type SignOutFailure =
  "disconnect" | "sign-out" | "sign-out-disconnected";

/** A failed attempt that knows which step it stopped at. */
class StoppedAt extends Error {
  constructor(readonly failure: SignOutFailure) {
    super(failure);
  }
}

/**
 * Reads the queue once more before anything is cleared. The live count
 * reads an unreadable queue as empty; here that stops the clean, because
 * its rows may be the only copy of the work.
 */
async function queueReadable(): Promise<void> {
  try {
    await pendingOpsOrThrow();
  } catch {
    throw new StoppedAt("sign-out");
  }
}

export interface SignOutFlow {
  /** True while the confirmation dialog should be open. */
  confirming: boolean;
  /** Whether Remote Storage is connected, for the body's copy. */
  driveConnected: boolean;
  /**
   * Settings and Library were left in Remote Storage when it was last
   * disconnected, so a clean while disconnected does not lose them.
   */
  remoteCopiesKept: boolean;
  /**
   * How many files the queue is still holding for this account, live. Above
   * zero, cleaning destroys work that exists nowhere else.
   */
  heldFiles: number;
  /**
   * Why the last attempt did not end the session, or `null`. The writer is
   * still signed in, and the reopened dialog says so.
   */
  failure: SignOutFailure | null;
  /**
   * True once a profile upload before a clean failed or ran out of time: the
   * latest shelf and settings changes are not in Remote Storage, and the
   * reopened dialog says so.
   */
  profileUnsaved: boolean;
  /** Opens the confirmation dialog instead of signing out immediately. */
  requestSignOut: () => void;
  /** Signs out leaving everything here for the account's next entry. */
  leave: () => void;
  /** Signs out cleaning everything of the account away from this browser. */
  clean: () => void;
  /** Dismisses the dialog without signing out. */
  cancelSignOut: () => void;
}

export function useSignOutFlow(
  drive: Pick<ProviderConnection, "state">,
): SignOutFlow {
  const auth = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<SignOutFailure | null>(null);
  const [profileUnsaved, setProfileUnsaved] = useState(false);

  // Runs one choice to the end, or back to the dialog with the reason.
  const attempt = useCallback((work: () => Promise<void>) => {
    setConfirming(false);
    setFailure(null);
    void work().catch((err: unknown) => {
      appLog.error("account", "Sign-out stopped.", {
        step: err instanceof StoppedAt ? err.failure : "sign-out",
        ...describeError(err),
      });
      setFailure(err instanceof StoppedAt ? err.failure : "sign-out");
      setConfirming(true);
    });
  }, []);

  // The queue's rows, live. `pendingRecords` returns a stable array, replaced
  // only when the rows differ, which makes it safe as a `getSnapshot`; one
  // that allocates compares unequal to itself every render and loops for ever.
  const records = useSyncExternalStore(
    subscribe,
    pendingRecords,
    pendingRecords,
  );
  const heldFiles = uncommittedFiles(records).files;

  const requestSignOut = useCallback(() => {
    setFailure(null);
    setProfileUnsaved(false);
    // The open work is written before the question opens, so the save's op
    // is in the queue the count reads. Work that cannot be written opens the
    // question with the failure, and every button refuses until it is.
    void writeOpenWork().then((preserved) => {
      setConfirming(true);
      if (!preserved) setFailure("sign-out");
    });
    // One last attempt, the same act a cold boot performs: re-read the store,
    // clear every stopped op, kick every project. A stopped op is often
    // stopped for a reason that has since gone away. Its progress reaches the
    // dialog through the queue's notify, and a rejection is a failure to try,
    // which the held count states anyway.
    void drainAll().catch(() => {});
  }, []);

  // What a clean needs before anything changes. False stops it with the
  // question open again; a step that failed throws its `StoppedAt`.
  const readyToClean = useCallback(
    async (userId: string): Promise<boolean> => {
      if (!(await writeOpenWork())) throw new StoppedAt("sign-out");
      await queueReadable();
      if (drive.state !== "connected" || profileUnsaved) return true;
      if (await uploadProfile(userId)) return true;
      setProfileUnsaved(true);
      setConfirming(true);
      return false;
    },
    [drive, profileUnsaved],
  );

  const clean = useCallback(() => {
    attempt(async () => {
      if (!auth.user) return;
      if (!(await readyToClean(auth.user.id))) return;
      // The purge itself runs inside `signOut`.
      if (drive.state !== "connected") {
        await auth.signOut("clean");
        return;
      }
      try {
        await dropDriveConnection();
      } catch {
        throw new StoppedAt("disconnect");
      }
      try {
        await auth.signOut("clean");
      } catch {
        // Re-read, so the reopened dialog asks the disconnected question.
        void auth.refresh();
        throw new StoppedAt("sign-out-disconnected");
      }
    });
  }, [attempt, auth, drive, readyToClean]);

  const leave = useCallback(() => {
    attempt(async () => {
      if (!auth.user) return;
      // `signOut` writes the open work and stops when it cannot.
      await auth.signOut("leave");
    });
  }, [attempt, auth]);

  const cancelSignOut = useCallback(() => {
    setConfirming(false);
    setFailure(null);
    setProfileUnsaved(false);
  }, []);

  return {
    confirming,
    driveConnected: drive.state === "connected",
    remoteCopiesKept: auth.user?.remoteCopiesKept === true,
    heldFiles,
    failure,
    profileUnsaved,
    requestSignOut,
    leave,
    clean,
    cancelSignOut,
  };
}
