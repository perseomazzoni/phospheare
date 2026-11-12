// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { setCurrentUserId } from "../auth/currentUser";
import {
  PlatformError,
  setPlatformForTests,
  type DriveGrant,
  type GoogleIdentity,
  type Platform,
} from "../platform";
import {
  findWriter,
  resetRegistryForTests,
  saveWriter,
  updateWriter,
} from "../writers/registry";
import { newWriter, newWriterId } from "../writers/domain/writer";

// Pins the hook's own logic: who may connect, what the platform is asked,
// what lands on the writer's record and which copy a refusal shows. The
// platform is a fake behind `setPlatformForTests`; the registry is the real
// one over jsdom's localStorage, so a stored grant is read back, not assumed.

const refresh = vi.fn();
let mockUser: {
  id: string;
  driveConnected: boolean;
  email?: string;
  driveEmail?: string | null;
} | null = null;
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, status: "ready", refresh }),
}));

const forgetDriveToken = vi.fn();
vi.mock("./driveToken", () => ({
  forgetDriveToken: () => forgetDriveToken(),
}));

const accepted = vi.fn();
const resetGrant = vi.fn();
vi.mock("./driveGrant", () => ({
  noteDriveAccepted: () => accepted(),
  resetDriveGrant: () => resetGrant(),
}));

// Hoisted, not a fresh arrow per `useTranslation()` call: the real library
// keeps the identity of `t` stable across renders, and a mock that
// reallocated it every call would invalidate every `useCallback` that
// depends on `t`. It records its interpolation params so the
// mismatch row can read them back.
const tCalls: Array<[string, Record<string, unknown> | undefined]> = [];
const t = (key: string, params?: Record<string, unknown>) => {
  tCalls.push([key, params]);
  return key;
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t }),
}));

const { useDriveConnection } = await import("./useDriveConnection");

const google: GoogleIdentity = {
  iss: "https://accounts.google.com",
  sub: "sub-maren",
  email: "maren@example.com",
  emailVerified: true,
  name: "Maren",
  picture: null,
};

const grant: DriveGrant = {
  connectionId: "conn-1",
  sub: "sub-maren",
  email: "maren@example.com",
  scopes: ["https://www.googleapis.com/auth/drive.file"],
};

const connectDrive = vi.fn<Platform["connectDrive"]>();
const disconnectDrive = vi.fn<Platform["disconnectDrive"]>();

function openWriter(): string {
  const writer = newWriter(newWriterId(), google, new Date());
  saveWriter(writer);
  setCurrentUserId(writer.id);
  return writer.id;
}

function connectedWriter(): string {
  const id = openWriter();
  updateWriter(id, (w) => ({
    ...w,
    drive: { ...grant, connectedAt: "2026-10-01T10:00:00.000Z" },
  }));
  return id;
}

beforeEach(() => {
  localStorage.clear();
  resetRegistryForTests();
  refresh.mockReset();
  forgetDriveToken.mockReset();
  accepted.mockReset();
  resetGrant.mockReset();
  connectDrive.mockReset();
  disconnectDrive.mockReset();
  tCalls.length = 0;
  mockUser = { id: "u1", driveConnected: false };
  setPlatformForTests({ connectDrive, disconnectDrive } as unknown as Platform);
});

afterEach(() => {
  cleanup();
  setCurrentUserId(null);
  setPlatformForTests(null);
});

describe("connected", () => {
  it("reflects user.driveConnected", () => {
    mockUser = { id: "u1", driveConnected: true };
    const { result } = renderHook(() => useDriveConnection());
    expect(result.current.state).toBe("connected");
  });

  it("is unset with no open writer", () => {
    mockUser = null;
    const { result } = renderHook(() => useDriveConnection());
    expect(result.current.state).toBe("unset");
  });

  it("names the connected account, and nothing while disconnected", () => {
    mockUser = {
      id: "u1",
      driveConnected: true,
      email: "maren@example.com",
      driveEmail: "books@example.com",
    };
    const { result, rerender } = renderHook(() => useDriveConnection());
    expect(result.current.where).toBe("books@example.com");
    mockUser = { ...mockUser, driveEmail: null };
    rerender();
    expect(result.current.where).toBe("maren@example.com");
    mockUser = { ...mockUser, driveConnected: false };
    rerender();
    expect(result.current.where).toBeNull();
  });
});

describe("connect", () => {
  it("refuses a missing writer before asking the platform", async () => {
    setCurrentUserId("missing-writer");
    const { result } = renderHook(() => useDriveConnection());
    let started: boolean | undefined;
    await act(async () => {
      started = await result.current.connect();
    });
    expect(started).toBe(false);
    expect(connectDrive).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it("tells the account without Google that Remote Storage needs one", async () => {
    const local = newWriter(newWriterId(), null, new Date());
    saveWriter(local);
    setCurrentUserId(local.id);
    const { result } = renderHook(() => useDriveConnection());
    let started: boolean | undefined;
    await act(async () => {
      started = await result.current.connect();
    });
    expect(started).toBe(false);
    expect(connectDrive).not.toHaveBeenCalled();
    expect(result.current.error).toBe("library.driveNeedsGoogle");
  });

  it("asks the platform for the writer's own account and keeps the grant on the record", async () => {
    const id = openWriter();
    connectDrive.mockResolvedValue({
      grant,
      token: { accessToken: "t", expiresIn: 3600 },
    });
    const { result } = renderHook(() => useDriveConnection());
    let started: boolean | undefined;
    await act(async () => {
      started = await result.current.connect();
    });

    expect(started).toBe(true);
    expect(connectDrive).toHaveBeenCalledWith({
      writerId: id,
      expectedSub: "sub-maren",
    });
    expect(findWriter(id)?.drive).toMatchObject({
      connectionId: "conn-1",
      sub: "sub-maren",
    });
    expect(forgetDriveToken).toHaveBeenCalled();
    expect(accepted).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it("asks the platform inside the click, before any await", () => {
    // The identity platform opens Google's window in that call, and a browser
    // blocks a popup opened after the gesture's task ends.
    openWriter();
    connectDrive.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useDriveConnection());
    act(() => {
      void result.current.connect();
      expect(connectDrive).toHaveBeenCalledTimes(1);
    });
  });

  it("does not keep a grant that lands after the writer left", async () => {
    const id = openWriter();
    let land!: (value: Awaited<ReturnType<Platform["connectDrive"]>>) => void;
    connectDrive.mockReturnValue(new Promise((resolve) => (land = resolve)));
    const { result } = renderHook(() => useDriveConnection());
    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.connect();
    });
    setCurrentUserId(null);
    let started: boolean | undefined;
    await act(async () => {
      land({ grant, token: { accessToken: "t", expiresIn: 3600 } });
      started = await pending;
    });
    expect(started).toBe(false);
    expect(findWriter(id)?.drive).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("names the writer's own account when Google returned another", async () => {
    openWriter();
    connectDrive.mockRejectedValue(new PlatformError("account-mismatch"));
    const { result } = renderHook(() => useDriveConnection());
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.error).toBe("library.driveAccountMismatch");
    const mismatches = tCalls.filter(
      ([key]) => key === "library.driveAccountMismatch",
    );
    const params = mismatches[mismatches.length - 1]?.[1];
    expect(params).toEqual({ loginEmail: "maren@example.com" });
  });

  it.each([
    ["scope-missing", "library.driveScopeMissing"],
    ["popup-blocked", "auth.popupBlocked"],
    ["google-not-configured", "auth.googleNotSetUp"],
    ["unavailable", "library.identityUnavailable"],
    ["flow-failed", "library.driveFailed"],
    ["google-unreachable", "library.driveFailed"],
  ] as const)("shows %s as %s", async (code, copy) => {
    const id = openWriter();
    connectDrive.mockRejectedValue(new PlatformError(code));
    const { result } = renderHook(() => useDriveConnection());
    let started: boolean | undefined;
    await act(async () => {
      started = await result.current.connect();
    });
    expect(started).toBe(false);
    expect(result.current.error).toBe(copy);
    expect(findWriter(id)?.drive).toBeNull();
  });

  it("shows nothing when the writer cancelled the flow", async () => {
    openWriter();
    connectDrive.mockRejectedValue(new PlatformError("flow-cancelled"));
    const { result } = renderHook(() => useDriveConnection());
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.error).toBeNull();
  });

  it("shows the generic failure for an error that is not the platform's", async () => {
    openWriter();
    connectDrive.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useDriveConnection());
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.error).toBe("library.driveFailed");
  });
});

describe("disconnect", () => {
  it("drops the grant here and at Google, and refreshes", async () => {
    const id = connectedWriter();
    disconnectDrive.mockResolvedValue({ revokedAtGoogle: true });
    mockUser = { id, driveConnected: true };
    const { result } = renderHook(() => useDriveConnection());

    await act(async () => {
      await result.current.disconnect();
    });

    expect(disconnectDrive).toHaveBeenCalledWith({
      connectionId: "conn-1",
      revoke: true,
    });
    expect(findWriter(id)?.drive).toBeNull();
    expect(forgetDriveToken).toHaveBeenCalled();
    expect(resetGrant).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it("drops only this browser's connection when asked, leaving the copies", async () => {
    const id = connectedWriter();
    disconnectDrive.mockResolvedValue({ revokedAtGoogle: false });
    mockUser = { id, driveConnected: true };
    const { result } = renderHook(() => useDriveConnection());

    await act(async () => {
      await result.current.disconnect({ everywhere: false });
    });

    expect(disconnectDrive).toHaveBeenCalledWith({
      connectionId: "conn-1",
      revoke: false,
    });
    expect(findWriter(id)?.drive).toBeNull();
    expect(findWriter(id)?.remoteCopiesKept).toBe(true);
    expect(forgetDriveToken).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    // Nothing was asked of Google, so nothing waits on its confirmation.
    expect(result.current.error).toBeNull();
  });

  it("remembers whether settings and library were left in Remote Storage", async () => {
    const id = connectedWriter();
    disconnectDrive.mockResolvedValue({ revokedAtGoogle: true });
    mockUser = { id, driveConnected: true };
    const { result } = renderHook(() => useDriveConnection());

    await act(async () => {
      await result.current.disconnect({ everywhere: true, keptCopies: false });
    });
    expect(findWriter(id)?.remoteCopiesKept).toBe(false);

    const again = connectedWriter();
    mockUser = { id: again, driveConnected: true };
    const second = renderHook(() => useDriveConnection());
    await act(async () => {
      await second.result.current.disconnect({
        everywhere: true,
        keptCopies: true,
      });
    });
    expect(findWriter(again)?.remoteCopiesKept).toBe(true);
  });

  it("says so when Google has not yet confirmed the revocation", async () => {
    const id = connectedWriter();
    disconnectDrive.mockResolvedValue({ revokedAtGoogle: false });
    mockUser = { id, driveConnected: true };
    const { result } = renderHook(() => useDriveConnection());

    await act(async () => {
      await result.current.disconnect();
    });

    expect(findWriter(id)?.drive).toBeNull();
    expect(refresh).toHaveBeenCalled();
    expect(result.current.error).toBe("library.driveRevokePending");
    // The message tells the writer where to remove the access themselves,
    // in the account that granted it.
    expect(tCalls).toContainEqual([
      "library.driveRevokePending",
      { identity: "Google" },
    ]);
  });

  it("keeps the connection identifier for retry and rejects when the platform cannot be reached", async () => {
    const id = connectedWriter();
    disconnectDrive.mockRejectedValue(new PlatformError("unavailable"));
    mockUser = { id, driveConnected: true };
    const { result } = renderHook(() => useDriveConnection());

    await act(async () => {
      await expect(result.current.disconnect()).rejects.toThrow();
    });

    expect(findWriter(id)?.drive?.connectionId).toBe("conn-1");
    expect(forgetDriveToken).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });
});

// All four verbs are `useCallback`-stable. A plain arrow in the
// returned object literal gets a fresh identity every render, which defeats
// any caller's own `useCallback` that depends on it.
describe("verb identity across an unrelated re-render", () => {
  it("connect, disconnect, reconnect and refresh keep the same identity", () => {
    mockUser = { id: "u1", driveConnected: true };
    const { result, rerender } = renderHook(() => useDriveConnection());

    const before = {
      connect: result.current.connect,
      disconnect: result.current.disconnect,
      reconnect: result.current.reconnect,
      refresh: result.current.refresh,
    };

    rerender();

    expect(result.current.connect).toBe(before.connect);
    expect(result.current.disconnect).toBe(before.disconnect);
    expect(result.current.reconnect).toBe(before.reconnect);
    expect(result.current.refresh).toBe(before.refresh);
  });
});
