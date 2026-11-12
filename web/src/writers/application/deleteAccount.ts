// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Deleting a Google account from this browser. The steps outside the device
// run first and each stops the rest on failure, so nothing on this device
// changes before Remote Storage has let go of the account. Documents are never
// deleted.
//
// A revoke Google does not confirm is not a failure: the connection is gone
// from this browser either way, so a retry could not ask again, and the
// person is told where to remove the access themselves.

/** The steps the use case orders; each rejects when it did not happen. */
export interface DeleteAccountPorts {
  /** Writes the work open in an editor; false when it could not. */
  writeOpenWork(): Promise<boolean>;
  /** Whether Remote Storage is connected, so its steps can run. */
  remoteConnected: boolean;
  /** Deletes every installation's copy of settings and Library. */
  deleteRemoteCopies(): Promise<void>;
  /**
   * Disconnects Remote Storage everywhere; false when Google did not
   * confirm, which does not stop the deletion.
   */
  revokeRemote(): Promise<boolean>;
  /**
   * Runs the Remote Storage steps with the account's profile merges held,
   * so no upload under way writes a copy back after it was deleted.
   */
  holdMerges<T>(run: () => Promise<T>): Promise<T>;
  /** Ends the session, clears the device and removes the account record. */
  forget(): Promise<void>;
}

/** Where a deletion stopped; nothing after that step ran. */
export type DeleteAccountFailure = "open-work" | "remote" | "revoke" | "local";

export class DeleteAccountStopped extends Error {
  constructor(readonly at: DeleteAccountFailure) {
    super(`The account deletion stopped at ${at}.`);
  }
}

/** Runs the deletion; rejects with `DeleteAccountStopped`. */
export async function deleteAccount(ports: DeleteAccountPorts): Promise<void> {
  const step = async (
    at: DeleteAccountFailure,
    run: () => Promise<unknown>,
  ) => {
    let ok: unknown;
    try {
      ok = await run();
    } catch {
      throw new DeleteAccountStopped(at);
    }
    if (ok === false) throw new DeleteAccountStopped(at);
  };
  await step("open-work", ports.writeOpenWork);
  if (ports.remoteConnected) {
    await ports.holdMerges(async () => {
      await step("remote", ports.deleteRemoteCopies);
      await step("revoke", async () => {
        await ports.revokeRemote();
      });
    });
  }
  await step("local", ports.forget);
}
