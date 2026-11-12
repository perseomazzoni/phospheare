// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactNode } from "react";

// Pins the registry and the collector against the real verb modules, with
// their deep dependencies mocked: `connectionFor` resolves a providerId to its
// verbs, and the collector reports both providers. Each provider's internals
// have their own test files.

const isAvailable = vi.fn();
vi.mock("./localProvider", () => ({
  localProvider: {
    id: "local",
    kind: "device" as const,
    label: () => "This device",
    icon: "local",
    isAvailable: () => isAvailable(),
  },
}));

const getLocalRoot = vi.fn();
const rootPermission = vi.fn();
const ensureLocalRoot = vi.fn();
vi.mock("./localRoot", () => ({
  getLocalRoot: () => getLocalRoot(),
  rootPermission: () => rootPermission(),
  ensureLocalRoot: () => ensureLocalRoot(),
  forgetLocalRoot: async () => {},
}));

const reopenProject = vi.fn();
vi.mock("./driveProvider", () => ({
  driveProvider: {
    id: "drive",
    kind: "remote" as const,
    label: () => "Google Drive",
    icon: "drive",
    reopenProject: (...args: unknown[]) => reopenProject(...args),
  },
}));

const refresh = vi.fn();
let mockUser: { id: string; driveConnected: boolean } | null = null;
let mockStatus = "authenticated";
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, refresh, status: mockStatus }),
}));

const { connectionFor, useConnections } = await import("./connections");

function Wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

beforeEach(() => {
  isAvailable.mockReset().mockReturnValue(true);
  getLocalRoot.mockReset().mockResolvedValue({ name: "PhospheareApp" });
  rootPermission.mockReset().mockResolvedValue("granted");
  ensureLocalRoot.mockReset().mockResolvedValue(null);
  reopenProject.mockReset().mockResolvedValue(true);
  mockUser = null;
  mockStatus = "authenticated";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("connectionFor", () => {
  it("resolves the local id to the picker verb — granted when picked, cancelled when the picker closed", async () => {
    ensureLocalRoot.mockResolvedValue({ key: "root" });
    await expect(
      connectionFor("local")?.reconnect({
        providerId: "local",
        key: "k",
        name: "n",
        openedAt: "",
      }),
    ).resolves.toBe("granted");

    ensureLocalRoot.mockResolvedValue(null);
    await expect(
      connectionFor("local")?.reconnect({
        providerId: "local",
        key: "k",
        name: "n",
        openedAt: "",
      }),
    ).resolves.toBe("cancelled");
  });

  it("resolves the drive id to the re-verify verb — unavailable when the folder is gone", async () => {
    reopenProject.mockResolvedValue(false);
    await expect(
      connectionFor("drive")?.reconnect({
        providerId: "drive",
        key: "k",
        name: "n",
        openedAt: "",
      }),
    ).resolves.toBe("unavailable");

    reopenProject.mockResolvedValue(true);
    await expect(
      connectionFor("drive")?.reconnect({
        providerId: "drive",
        key: "k",
        name: "n",
        openedAt: "",
      }),
    ).resolves.toBe("granted");
  });

  it("answers null for a provider that has no connection", () => {
    expect(connectionFor("no-such-provider")).toBeNull();
  });

  it("the demo fixture has no connection to resolve", () => {
    expect(connectionFor("demo")).toBeNull();
  });
});

describe("useConnections", () => {
  it("reports both providers, drive from the account, local from the device", async () => {
    mockUser = { id: "u1", driveConnected: true };
    const { result } = renderHook(() => useConnections(), { wrapper: Wrapper });
    expect(result.current.drive.id).toBe("drive");
    expect(result.current.drive.state).toBe("connected");
    expect(result.current.drive.resolved).toBe(true);
    expect(result.current.local.id).toBe("local");
    // The local verdict lands through the handle-store settle, a tick later.
    await waitFor(() => expect(result.current.local.state).toBe("connected"));
  });

  it("drive is unset and resolved at once while no one is signed in", () => {
    mockStatus = "anonymous";
    mockUser = null;
    const { result } = renderHook(() => useConnections(), { wrapper: Wrapper });
    expect(result.current.drive.state).toBe("unset");
    expect(result.current.drive.resolved).toBe(true);
  });
});
