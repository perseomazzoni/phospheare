// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, act, waitFor } from "@testing-library/react";

// Mocked at the module boundary: these rows pin the hook's own logic (when it
// queries what, what it exposes), not the picker in `localRoot` or the File
// System Access API, which have their own tests.

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
const forgetLocalRoot = vi.fn();
vi.mock("./localRoot", () => ({
  getLocalRoot: () => getLocalRoot(),
  rootPermission: () => rootPermission(),
  ensureLocalRoot: () => ensureLocalRoot(),
  forgetLocalRoot: () => forgetLocalRoot(),
}));

const { useLocalConnection } = await import("./useLocalConnection");

beforeEach(() => {
  isAvailable.mockReset().mockReturnValue(true);
  getLocalRoot.mockReset().mockResolvedValue({ name: "PhospheareApp" });
  rootPermission.mockReset().mockResolvedValue("granted");
  ensureLocalRoot.mockReset().mockResolvedValue(null);
  forgetLocalRoot.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("state", () => {
  it("unset until the handle store has answered, then settled", async () => {
    getLocalRoot.mockResolvedValue(null);
    const { result } = renderHook(() => useLocalConnection());
    expect(result.current.state).toBe("unset");
    expect(result.current.resolved).toBe(false);
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.state).toBe("unset");
  });

  it("connected when the root is chosen and the grant is live", async () => {
    const { result } = renderHook(() => useLocalConnection());
    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(result.current.resolved).toBe(true);
  });

  // The setup card's done line names the folder the projects live in.
  it("names the chosen folder, and nothing while there is none", async () => {
    const { result } = renderHook(() => useLocalConnection());
    await waitFor(() => expect(result.current.where).toBe("PhospheareApp"));
    getLocalRoot.mockResolvedValue(null);
    await act(async () => void (await result.current.refresh()));
    expect(result.current.where).toBeNull();
  });

  it("needs-gesture when the grant lapsed — never 'unset' for a chosen root", async () => {
    rootPermission.mockResolvedValue("needs-gesture");
    const { result } = renderHook(() => useLocalConnection());
    await waitFor(() => expect(result.current.state).toBe("needs-gesture"));
  });

  it("unavailable on a browser with no File System Access API, and it still resolves", async () => {
    isAvailable.mockReturnValue(false);
    const { result } = renderHook(() => useLocalConnection());
    await waitFor(() => expect(result.current.state).toBe("unavailable"));
    expect(result.current.resolved).toBe(true);
    // The dot must not misread as a connection that could exist.
    expect(getLocalRoot).not.toHaveBeenCalled();
  });

  it("re-settles on refresh — a root chosen since mount flips the state", async () => {
    getLocalRoot.mockResolvedValue(null);
    const { result } = renderHook(() => useLocalConnection());
    await waitFor(() => expect(result.current.state).toBe("unset"));

    getLocalRoot.mockResolvedValue({ name: "PhospheareApp" });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.state).toBe("connected");
  });
});

describe("verbs", () => {
  it("connect is the pick, and reports whether a folder was chosen", async () => {
    const { result } = renderHook(() => useLocalConnection());
    ensureLocalRoot.mockResolvedValue({ key: "root" });
    await act(async () => {
      await expect(result.current.connect()).resolves.toBe(true);
    });
    expect(ensureLocalRoot).toHaveBeenCalledTimes(1);

    ensureLocalRoot.mockResolvedValue(null);
    await act(async () => {
      await expect(result.current.connect()).resolves.toBe(false);
    });
  });

  it("reconnect: granted when picked, cancelled when the picker closed", async () => {
    const { result } = renderHook(() => useLocalConnection());
    const ref = {
      providerId: "local",
      key: "k",
      name: "n",
      openedAt: "",
    } as const;
    ensureLocalRoot.mockResolvedValue({ key: "root" });
    await act(async () => {
      await expect(result.current.reconnect(ref)).resolves.toBe("granted");
    });

    ensureLocalRoot.mockResolvedValue(null);
    await act(async () => {
      await expect(result.current.reconnect(ref)).resolves.toBe("cancelled");
    });
  });

  it("disconnect forgets the root handle", async () => {
    const { result } = renderHook(() => useLocalConnection());
    await act(async () => {
      await result.current.disconnect();
    });
    expect(forgetLocalRoot).toHaveBeenCalledTimes(1);
  });
});

// `connect`, `disconnect`, `reconnect` and `refresh` are all
// `useCallback`-stable. A plain arrow in the returned object
// literal gets a fresh closure every render, which defeats any caller's own
// `useCallback` that depends on it, such as `forget` in
// `useLocalFolder.ts`, which depends on `connections.local.disconnect`.
describe("verb identity stays stable across an unrelated re-render", () => {
  it("connect, disconnect, reconnect, and refresh keep the same identity", async () => {
    const { result, rerender } = renderHook(() => useLocalConnection());
    await waitFor(() => expect(result.current.resolved).toBe(true));

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

describe("static facts", () => {
  it("carries the provider's own id, label and icon", () => {
    const { result } = renderHook(() => useLocalConnection());
    expect(result.current.id).toBe("local");
    expect(result.current.label()).toBe("This device");
    expect(result.current.icon).toBe("local");
  });

  it("has no connection-level error of its own — the pick flows describe theirs", () => {
    const { result } = renderHook(() => useLocalConnection());
    expect(result.current.error).toBeNull();
  });
});
