// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import {
  deleteAccount,
  DeleteAccountStopped,
  type DeleteAccountPorts,
} from "./deleteAccount";

// The steps outside the device run first, and a failure at any of them
// leaves everything after it undone.

function ports(more: Partial<DeleteAccountPorts> = {}) {
  const order: string[] = [];
  const step =
    <T>(name: string, value: T) =>
    async () => {
      order.push(name);
      return value;
    };
  const p: DeleteAccountPorts = {
    writeOpenWork: step("open-work", true),
    remoteConnected: true,
    deleteRemoteCopies: step("remote", undefined),
    revokeRemote: step("revoke", true),
    holdMerges: async (run) => {
      order.push("hold");
      try {
        return await run();
      } finally {
        order.push("release");
      }
    },
    forget: step("local", undefined),
    ...more,
  };
  return { p, order };
}

const stoppedAt = async (p: DeleteAccountPorts) => {
  const err = await deleteAccount(p).catch((e: unknown) => e);
  return err instanceof DeleteAccountStopped ? err.at : null;
};

describe("deleteAccount", () => {
  it("deletes the remote copies and revokes before clearing the device", async () => {
    const { p, order } = ports();
    await deleteAccount(p);
    expect(order).toEqual([
      "open-work",
      "hold",
      "remote",
      "revoke",
      "release",
      "local",
    ]);
  });

  it("skips the remote steps when Remote Storage is not connected", async () => {
    const { p, order } = ports({ remoteConnected: false });
    await deleteAccount(p);
    expect(order).toEqual(["open-work", "local"]);
  });

  it("holds the profile merges across both remote steps, and lets go on a stop", async () => {
    const { p, order } = ports({
      revokeRemote: () => Promise.reject(new Error("unavailable")),
    });
    expect(await stoppedAt(p)).toBe("revoke");
    expect(order).toEqual(["open-work", "hold", "remote", "release"]);
  });

  it("stops before anything when the open work cannot be written", async () => {
    const forget = vi.fn();
    const { p } = ports({ writeOpenWork: async () => false, forget });
    expect(await stoppedAt(p)).toBe("open-work");
    expect(forget).not.toHaveBeenCalled();
  });

  it("leaves the device as it was when the remote copies cannot be deleted", async () => {
    const forget = vi.fn();
    const revokeRemote = vi.fn();
    const { p } = ports({
      deleteRemoteCopies: () => Promise.reject(new Error("offline")),
      revokeRemote,
      forget,
    });
    expect(await stoppedAt(p)).toBe("remote");
    expect(revokeRemote).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
  });

  it("goes on when Google does not confirm the revocation", async () => {
    // The connection is gone from this browser either way, so a retry could
    // not ask again; the person is told where to remove the access instead.
    const { p, order } = ports({ revokeRemote: async () => false });
    await deleteAccount(p);
    expect(order).toEqual(["open-work", "hold", "remote", "release", "local"]);
  });

  it("stops when the revoke could not be asked for", async () => {
    const forget = vi.fn();
    const { p } = ports({
      revokeRemote: () => Promise.reject(new Error("unavailable")),
      forget,
    });
    expect(await stoppedAt(p)).toBe("revoke");
    expect(forget).not.toHaveBeenCalled();
  });

  it("reports a failure to clear the device", async () => {
    const { p } = ports({ forget: () => Promise.reject(new Error("x")) });
    expect(await stoppedAt(p)).toBe("local");
  });
});
