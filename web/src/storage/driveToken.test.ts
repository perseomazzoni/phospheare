// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessToken, Platform } from "../platform";

// The Drive access token is minted by the platform for the open writer's
// connection, and belongs to that writer only while they are open. The
// registry and the grant latch are mocked at the module boundary, so a row
// can tell "the grant is gone" from "Drive did not answer".
const { mint, refused, accepted, connections } = vi.hoisted(() => ({
  mint: vi.fn<(request: { connectionId: string }) => Promise<AccessToken>>(),
  refused: vi.fn(),
  accepted: vi.fn(),
  connections: new Map<string, string>(),
}));

vi.mock("./driveGrant", () => ({
  noteDriveRefused: refused,
  noteDriveAccepted: accepted,
}));
vi.mock("../writers/registry", () => ({
  findWriter: (id: string) => {
    const connectionId = connections.get(id);
    return connectionId ? { id, drive: { connectionId } } : null;
  },
}));

async function load(userId: string | null) {
  vi.resetModules();
  const currentUser = await import("../auth/currentUser");
  currentUser.setCurrentUserId(userId);
  const { PlatformError, setPlatformForTests } = await import("../platform");
  setPlatformForTests({ driveAccessToken: mint } as unknown as Platform);
  const { driveAccessToken } = await import("./driveToken");
  return {
    PlatformError,
    driveAccessToken,
    setCurrentUserId: currentUser.setCurrentUserId,
  };
}

/** A mint the test finishes by hand, so a teardown can land before it. */
function deferredMint() {
  let finish!: (value: AccessToken) => void;
  let fail!: (err: unknown) => void;
  mint.mockReturnValueOnce(
    new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    }),
  );
  return { finish, fail };
}

const token = (accessToken: string): AccessToken => ({
  accessToken,
  expiresIn: 3600,
});

beforeEach(() => {
  mint.mockReset();
  refused.mockReset();
  accepted.mockReset();
  connections.clear();
  connections.set("writer-a", "conn-a");
  connections.set("writer-b", "conn-b");
});

describe("the Drive access token", () => {
  it("asks the platform for the open writer's own connection", async () => {
    const { driveAccessToken } = await load("writer-a");
    mint.mockResolvedValue(token("t"));

    await expect(driveAccessToken()).resolves.toBe("t");

    expect(mint).toHaveBeenCalledWith({ connectionId: "conn-a" });
    expect(accepted).toHaveBeenCalledTimes(1);
  });

  it("serves the cached token without a second mint", async () => {
    const { driveAccessToken } = await load("writer-a");
    mint.mockResolvedValue(token("t"));

    await driveAccessToken();
    await expect(driveAccessToken()).resolves.toBe("t");
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("shares one mint between concurrent callers", async () => {
    const { driveAccessToken } = await load("writer-a");
    const { finish } = deferredMint();
    const both = Promise.all([driveAccessToken(), driveAccessToken()]);
    finish(token("t"));
    await expect(both).resolves.toEqual(["t", "t"]);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("asks for nothing while no writer is open", async () => {
    const { driveAccessToken } = await load(null);

    await expect(driveAccessToken()).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(mint).not.toHaveBeenCalled();
  });

  it("reads a writer with no Drive connection as disconnected", async () => {
    connections.delete("writer-a");
    const { driveAccessToken } = await load("writer-a");

    await expect(driveAccessToken()).rejects.toMatchObject({
      code: "permission",
    });
    expect(mint).not.toHaveBeenCalled();
  });

  it("reads a writer with no Drive connection as disconnected, asking nothing", async () => {
    const { driveAccessToken } = await load("writer-without-drive");

    await expect(driveAccessToken()).rejects.toMatchObject({
      code: "permission",
    });
    expect(mint).not.toHaveBeenCalled();
  });

  it.each(["grant-invalid", "no-connection", "google-refused"] as const)(
    "reads %s as the grant being gone",
    async (code) => {
      const { PlatformError, driveAccessToken } = await load("writer-a");
      mint.mockRejectedValue(new PlatformError(code));

      await expect(driveAccessToken()).rejects.toMatchObject({
        code: "permission",
      });
      expect(refused).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["google-unreachable", "unavailable", "writer-mismatch"] as const)(
    "reads %s as unreachable, never as a lost grant",
    async (code) => {
      // Raising the reconnect notice would send the writer through consent
      // for a grant that is fine.
      const { PlatformError, driveAccessToken } = await load("writer-a");
      mint.mockRejectedValue(new PlatformError(code));

      await expect(driveAccessToken()).rejects.toMatchObject({
        code: "unavailable",
      });
      expect(refused).not.toHaveBeenCalled();
    },
  );

  // A token belongs to its writer only while that writer is open: a
  // mint that lands after the teardown is refused and never cached, whatever
  // the tab still does with Drive.
  describe("a mint that lands after its writer is closed", () => {
    it("is refused at sign-out and leaves no token behind", async () => {
      const { driveAccessToken, setCurrentUserId } = await load("writer-a");
      const { finish } = deferredMint();
      const pending = driveAccessToken();
      setCurrentUserId(null);
      finish(token("a"));

      await expect(pending).rejects.toMatchObject({ code: "unavailable" });
      await expect(driveAccessToken()).rejects.toMatchObject({
        code: "unavailable",
      });
      expect(mint).toHaveBeenCalledTimes(1);
      expect(accepted).not.toHaveBeenCalled();
    });

    it("is refused on a switch, and the next writer mints with their own connection", async () => {
      const { driveAccessToken, setCurrentUserId } = await load("writer-a");
      const { finish } = deferredMint();
      const pending = driveAccessToken();
      setCurrentUserId("writer-b");
      finish(token("a"));
      await expect(pending).rejects.toMatchObject({ code: "unavailable" });

      mint.mockResolvedValueOnce(token("b"));
      await expect(driveAccessToken()).resolves.toBe("b");
      expect(mint.mock.calls[1][0]).toEqual({ connectionId: "conn-b" });
    });

    it("does not clear the next writer's token when it fails late", async () => {
      const { PlatformError, driveAccessToken, setCurrentUserId } =
        await load("writer-a");
      const { fail } = deferredMint();
      const pending = driveAccessToken();
      setCurrentUserId("writer-b");
      mint.mockResolvedValueOnce(token("b"));
      await expect(driveAccessToken()).resolves.toBe("b");

      fail(new PlatformError("grant-invalid"));
      await expect(pending).rejects.toMatchObject({ code: "unavailable" });
      // The failure was the previous writer's: the latch is untouched and
      // the cached token is served without another mint.
      expect(refused).not.toHaveBeenCalled();
      await expect(driveAccessToken()).resolves.toBe("b");
      expect(mint).toHaveBeenCalledTimes(2);
    });

    it("is refused while a closed tab still holds the cache", async () => {
      const { driveAccessToken, setCurrentUserId } = await load("writer-a");
      mint.mockResolvedValueOnce(token("a"));
      await expect(driveAccessToken()).resolves.toBe("a");

      setCurrentUserId(null);
      await expect(driveAccessToken()).rejects.toMatchObject({
        code: "unavailable",
      });
      expect(mint).toHaveBeenCalledTimes(1);
    });
  });

  it("serves a mint overtaken by a force to its caller, and caches the newer one", async () => {
    const { driveAccessToken } = await load("writer-a");
    const first = deferredMint();
    const pending = driveAccessToken();
    const second = deferredMint();
    const forced = driveAccessToken({ force: true });

    first.finish(token("old"));
    await expect(pending).resolves.toBe("old");
    second.finish(token("new"));
    await expect(forced).resolves.toBe("new");

    await expect(driveAccessToken()).resolves.toBe("new");
    expect(mint).toHaveBeenCalledTimes(2);
  });
});
