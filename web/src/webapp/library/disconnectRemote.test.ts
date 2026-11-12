// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteAllProfileCopies = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../profile/portableDrive", () => ({
  deleteAllProfileCopies,
}));

import { CopiesNotDeleted, disconnectRemote } from "./disconnectRemote";

// Every disconnect path removes the copies the same way: before the revoke,
// only for a disconnect from every device, and not at all when the writer
// keeps them.

const order: string[] = [];
const drive = {
  disconnect: vi.fn(async () => {
    order.push("disconnect");
  }),
};

beforeEach(() => {
  order.length = 0;
  drive.disconnect.mockClear();
  deleteAllProfileCopies.mockReset().mockImplementation(async () => {
    order.push("delete");
  });
});

describe("disconnectRemote", () => {
  it("removes settings and Library before disconnecting, when asked", async () => {
    await disconnectRemote(drive, { everywhere: true, keptCopies: false });
    expect(order).toEqual(["delete", "disconnect"]);
    expect(drive.disconnect).toHaveBeenCalledWith({
      everywhere: true,
      keptCopies: false,
    });
  });

  it("leaves them in place when the writer keeps them", async () => {
    await disconnectRemote(drive, { everywhere: true, keptCopies: true });
    expect(order).toEqual(["disconnect"]);
    expect(drive.disconnect).toHaveBeenCalledWith({
      everywhere: true,
      keptCopies: true,
    });
  });

  it("stays connected when they could not be removed", async () => {
    deleteAllProfileCopies.mockRejectedValueOnce(new Error("offline"));
    await expect(
      disconnectRemote(drive, { everywhere: true, keptCopies: false }),
    ).rejects.toBeInstanceOf(CopiesNotDeleted);
    expect(drive.disconnect).not.toHaveBeenCalled();
  });

  it("passes a failed disconnect on as it is", async () => {
    const failure = new Error("unreachable");
    drive.disconnect.mockRejectedValueOnce(failure);
    await expect(
      disconnectRemote(drive, { everywhere: true, keptCopies: false }),
    ).rejects.toBe(failure);
  });

  it("removes nothing when disconnecting this browser only", async () => {
    await disconnectRemote(drive, { everywhere: false });
    expect(order).toEqual(["disconnect"]);
    expect(drive.disconnect).toHaveBeenCalledWith({ everywhere: false });
  });
});
