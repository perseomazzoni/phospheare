// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Platform } from "../../platform";
import { useConnectProvider } from "./useConnectProvider";

const refresh = vi.fn();
let listener: ((signal: { providerId: string; ok: boolean }) => void) | null =
  null;
let ready: Platform;
let settle: ((outcome: string) => void) | null;
const connectOpenRouter = vi.fn();

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ refresh }),
}));

vi.mock("../../platform", () => ({
  currentPlatform: () => ready,
}));

vi.mock("../../ai/host/openrouterConnection", () => ({
  OPENROUTER_ID: "openrouter",
  keyLabelForApp: () => "Phospheare (localhost)",
  connectOpenRouter: (...args: unknown[]) => connectOpenRouter(...args),
}));

vi.mock("../../ai/host/connectChannel", () => ({
  onConnect: (
    listen: (signal: { providerId: string; ok: boolean }) => void,
  ) => {
    listener = listen;

    return () => {
      listener = null;
    };
  },
}));

beforeEach(() => {
  refresh.mockReset();
  listener = null;
  ready = { credentialProtection: "sealed" } as Platform;
  settle = null;
  connectOpenRouter.mockReset();
  connectOpenRouter.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        settle = resolve;
      }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the opener's half of a connection", () => {
  it("starts the approval synchronously from the click", () => {
    const { result } = renderHook(() => useConnectProvider());

    act(() => result.current.connect("openrouter"));

    // A popup opens only inside a user gesture, and an `await` before
    // `window.open` breaks the chain, so Safari and Firefox block it.
    expect(connectOpenRouter).toHaveBeenCalledTimes(1);
    expect(connectOpenRouter).toHaveBeenCalledWith(
      ready,
      "Phospheare (localhost)",
    );
    expect(result.current.pending).toBe("openrouter");
  });

  it("does nothing for a provider it does not connect", () => {
    const { result } = renderHook(() => useConnectProvider());

    act(() => result.current.connect("a-provider"));

    expect(connectOpenRouter).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
  });

  it("reads the platform at each click", () => {
    const { result } = renderHook(() => useConnectProvider());
    const first = ready;

    act(() => result.current.connect("openrouter"));
    ready = { credentialProtection: "unavailable" } as Platform;
    act(() => result.current.connect("openrouter"));

    expect(connectOpenRouter.mock.calls.map((call) => call[0])).toEqual([
      first,
      ready,
    ]);
  });

  it("reports a blocked window instead of navigating this one", async () => {
    connectOpenRouter.mockResolvedValue("blocked");
    const { result } = renderHook(() => useConnectProvider());

    act(() => result.current.connect("openrouter"));

    // No top-level navigation as a fallback: this tab may be an editor holding
    // unsaved prose, which outweighs the connection.
    await waitFor(() => expect(result.current.blocked).toBe(true));
    expect(result.current.pending).toBeNull();
    expect(window.location.pathname).not.toContain("connect");
  });

  it("clears a blocked notice on the next attempt and on dismiss", async () => {
    connectOpenRouter.mockResolvedValueOnce("blocked");
    const { result } = renderHook(() => useConnectProvider());

    act(() => result.current.connect("openrouter"));
    await waitFor(() => expect(result.current.blocked).toBe(true));

    act(() => result.current.connect("openrouter"));
    expect(result.current.blocked).toBe(false);

    act(() => result.current.dismissBlocked());
    expect(result.current.blocked).toBe(false);
  });

  it.each(["connected", "cancelled", "superseded", "no-limit"])(
    "stays pending until the flow ends, then drops the spinner (%s)",
    async (outcome) => {
      const { result } = renderHook(() => useConnectProvider());

      act(() => result.current.connect("openrouter"));
      expect(result.current.pending).toBe("openrouter");

      await act(async () => settle?.(outcome));

      expect(result.current.pending).toBeNull();
      expect(result.current.blocked).toBe(false);
    },
  );

  it("stays pending while a second flow is open, when the first ends as cancelled", async () => {
    const ends: Array<(outcome: string) => void> = [];
    connectOpenRouter.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          ends.push(resolve);
        }),
    );
    const { result } = renderHook(() => useConnectProvider());

    act(() => result.current.connect("openrouter"));
    act(() => result.current.connect("openrouter"));
    // Starting the second flow cancels the first.
    await act(async () => ends[0]?.("cancelled"));

    expect(result.current.pending).toBe("openrouter");

    await act(async () => ends[1]?.("connected"));
    expect(result.current.pending).toBeNull();
  });

  it("drops the spinner when the flow rejects", async () => {
    let fail: (error: Error) => void = () => {};
    connectOpenRouter.mockImplementation(
      () =>
        new Promise<string>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const { result } = renderHook(() => useConnectProvider());

    act(() => result.current.connect("openrouter"));
    await act(async () => fail(new Error("vault refused")));

    expect(result.current.pending).toBeNull();
    expect(result.current.blocked).toBe(false);
  });

  it("re-reads the account when another tab reports a change", async () => {
    renderHook(() => useConnectProvider());

    act(() => listener?.({ providerId: "openrouter", ok: true }));

    // The ping is only a prompt to look again; the status comes from the
    // vault and the vendor.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("re-reads nothing on a failure signal", () => {
    renderHook(() => useConnectProvider());

    act(() => listener?.({ providerId: "openrouter", ok: false }));

    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops listening when it goes away", () => {
    const { unmount } = renderHook(() => useConnectProvider());

    expect(listener).not.toBeNull();
    unmount();
    expect(listener).toBeNull();
  });
});
