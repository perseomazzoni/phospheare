// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { GoogleIdentity, Platform } from "../platform/types";
import { PlatformError } from "../platform/types";

// The platform is a stand-in: these rows pin who the provider says is signed
// in, not the identity service's popup flow (`identityPlatform.test.ts`).
const platform = vi.hoisted(() => ({
  signInWithGoogle: vi.fn<() => Promise<GoogleIdentity>>(),
  openSession: vi.fn(async () => {}),
  closeSession: vi.fn(async () => {}),
  vaultDelete: vi.fn(async () => {}),
  reachable: vi.fn(async () => true),
}));
vi.mock("../platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform")>()),
  currentPlatform: () =>
    ({
      credentialProtection: "sealed",
      reachable: platform.reachable,
      signInWithGoogle: platform.signInWithGoogle,
      openSession: platform.openSession,
      closeSession: platform.closeSession,
      vault: {
        get: async () => null,
        set: async () => {},
        delete: platform.vaultDelete,
      },
    }) as unknown as Platform,
}));

// The purge clears this device's copies of the account (IndexedDB, OPFS),
// which jsdom does not carry; `forgetAccount.test.ts` pins it.
const purgeLocalData = vi.fn<(id: string) => Promise<void>>(async () => {});
vi.mock("../profile/forgetAccount", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../profile/forgetAccount")>()),
  purgeLocalData: (id: string) => purgeLocalData(id),
}));

// The profile copy's pending changes, drained before the purge.
const flushProfile = vi.fn(async () => {});
vi.mock("../profile/profileSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../profile/profileSync")>()),
  flushProfile: () => flushProfile(),
}));

const refreshRemoteProviders = vi.fn(async () => {});
vi.mock("../ai/host/openrouterConnection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ai/host/openrouterConnection")>()),
  refreshRemoteProviders: () => refreshRemoteProviders(),
}));

const { AuthProvider, useAuth } = await import("./AuthContext");
const { getCurrentUserId } = await import("./currentUser");
const { holdOpenWork } = await import("./openWork");
const registry = await import("../writers/registry");
const { newWriter, newWriterId } = await import("../writers/domain/writer");

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

const identity = (sub: string): GoogleIdentity => ({
  iss: "https://accounts.google.com",
  sub,
  email: `${sub}@example.test`,
  emailVerified: true,
  name: sub,
  picture: null,
});

/** An account this browser already knows, signed in. */
function seedSignedIn(sub = "g-ada") {
  const writer = newWriter(newWriterId(), identity(sub), new Date());
  registry.saveWriter(writer);
  registry.setSignedIn(writer.id);
  return writer;
}

/**
 * Same-origin channels for one test process: a message reaches every other
 * channel of the same name, never the one that posted it.
 */
class FakeChannel {
  static open: FakeChannel[] = [];

  private listeners = new Set<(event: MessageEvent) => void>();

  constructor(readonly name: string) {
    FakeChannel.open.push(this);
  }

  postMessage(data: unknown): void {
    for (const other of [...FakeChannel.open]) {
      if (other === this || other.name !== this.name) continue;
      for (const listen of other.listeners)
        listen({ data } as unknown as MessageEvent);
    }
  }

  addEventListener(_: string, handler: (event: MessageEvent) => void): void {
    this.listeners.add(handler);
  }

  removeEventListener(_: string, handler: (event: MessageEvent) => void): void {
    this.listeners.delete(handler);
  }

  close(): void {
    FakeChannel.open = FakeChannel.open.filter((one) => one !== this);
  }
}

/** What another tab posts: a separate channel object, as a tab would hold. */
function fromAnotherTab(name: string, data: unknown) {
  act(() => new FakeChannel(name).postMessage(data));
}

/** A stand-in for another tab's listener, recording what it hears. */
function anotherTabListening(): unknown[] {
  const heard: unknown[] = [];
  new FakeChannel("session").addEventListener("message", (event) =>
    heard.push(event.data),
  );
  return heard;
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  registry.resetRegistryForTests();
  vi.clearAllMocks();
  FakeChannel.open = [];
  vi.stubGlobal("BroadcastChannel", FakeChannel);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("AuthProvider — who is signed in at boot", () => {
  it("is known from the first render, with nothing to wait for", () => {
    const ada = seedSignedIn();
    const hook = renderHook(() => useAuth(), { wrapper });
    expect(hook.result.current.status).toBe("authenticated");
    expect(hook.result.current.user).toMatchObject({
      id: ada.id,
      email: "g-ada@example.test",
    });
    expect(getCurrentUserId()).toBe(ada.id);
  });

  it("is no one without the signed-in mark, though accounts are stored", () => {
    seedSignedIn();
    registry.setSignedIn(null);
    const hook = renderHook(() => useAuth(), { wrapper });
    expect(hook.result.current.status).toBe("anonymous");
    expect(hook.result.current.user).toBeNull();
    expect(getCurrentUserId()).toBeNull();
  });

  it("binds the identity service's session to the account", async () => {
    const ada = seedSignedIn();
    renderHook(() => useAuth(), { wrapper });
    await waitFor(() =>
      expect(platform.openSession).toHaveBeenCalledWith(ada.id),
    );
  });
});

describe("AuthProvider — whether Google sign-in can be offered", () => {
  it("asks the identity service once while signed out, and is unknown until it answers", async () => {
    let answer!: (reachable: boolean) => void;
    platform.reachable.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (answer = resolve)),
    );
    const hook = renderHook(() => useAuth(), { wrapper });
    expect(hook.result.current.signInReachable).toBeNull();

    await act(async () => answer(true));

    expect(hook.result.current.signInReachable).toBe(true);
    hook.rerender();
    expect(platform.reachable).toHaveBeenCalledTimes(1);
  });

  it("says so when the identity service does not answer", async () => {
    platform.reachable.mockResolvedValueOnce(false);
    const hook = renderHook(() => useAuth(), { wrapper });
    await waitFor(() =>
      expect(hook.result.current.signInReachable).toBe(false),
    );
  });

  it("does not ask while signed in", async () => {
    seedSignedIn();
    const hook = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(platform.openSession).toHaveBeenCalled());
    expect(platform.reachable).not.toHaveBeenCalled();
    expect(hook.result.current.signInReachable).toBeNull();
  });

  it("keeps its first answer through a sign-in and a sign-out", async () => {
    const hook = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(hook.result.current.signInReachable).toBe(true));

    act(() => hook.result.current.enterWithoutAccount());
    await act(() => hook.result.current.signOut("leave"));

    expect(hook.result.current.status).toBe("anonymous");
    expect(hook.result.current.signInReachable).toBe(true);
    expect(platform.reachable).toHaveBeenCalledTimes(1);
  });
});

describe("AuthProvider — signing in", () => {
  it("adopts the account the sign-in returns and marks it signed in", async () => {
    platform.signInWithGoogle.mockResolvedValue(identity("g-ada"));
    const heard = anotherTabListening();
    const hook = renderHook(() => useAuth(), { wrapper });

    await act(() => hook.result.current.logIn());

    expect(hook.result.current.status).toBe("authenticated");
    const id = hook.result.current.user?.id;
    expect(registry.signedInWriter()?.id).toBe(id);
    expect(getCurrentUserId()).toBe(id);
    expect(heard).toEqual([{ kind: "signed-in", userId: id }]);
  });

  it("stays signed out, and says why, when the sign-in does not finish", async () => {
    platform.signInWithGoogle.mockRejectedValue(
      new PlatformError("popup-blocked"),
    );
    const hook = renderHook(() => useAuth(), { wrapper });

    await act(() =>
      expect(hook.result.current.logIn()).rejects.toThrow("popup-blocked"),
    );

    expect(hook.result.current.status).toBe("anonymous");
    expect(registry.signedInWriter()).toBeNull();
  });
});

describe("AuthProvider — signing out", () => {
  it("cleans while the account is still current, then removes it", async () => {
    const ada = seedSignedIn();
    const hook = renderHook(() => useAuth(), { wrapper });
    let currentDuringPurge: string | null = null;
    purgeLocalData.mockImplementationOnce(async () => {
      currentDuringPurge = getCurrentUserId();
    });

    await act(() => hook.result.current.signOut("clean"));

    expect(currentDuringPurge).toBe(ada.id);
    expect(purgeLocalData).toHaveBeenCalledWith(ada.id);
    expect(platform.vaultDelete).toHaveBeenCalledWith("openrouter.key");
    expect(platform.closeSession).toHaveBeenCalled();
    expect(hook.result.current.status).toBe("anonymous");
    expect(getCurrentUserId()).toBeNull();
    expect(registry.signedInWriter()).toBeNull();
    // A cleaned account leaves no record: the next sweep treats anything
    // still under its id as a leftover.
    expect(registry.findWriter(ada.id)).toBeNull();
  });

  it("leaves a Google account's things and record on a leaving sign-out", async () => {
    const ada = seedSignedIn();
    const heard = anotherTabListening();
    const hook = renderHook(() => useAuth(), { wrapper });

    await act(() => hook.result.current.signOut("leave"));

    expect(hook.result.current.status).toBe("anonymous");
    expect(purgeLocalData).not.toHaveBeenCalled();
    expect(platform.vaultDelete).not.toHaveBeenCalled();
    expect(registry.findWriter(ada.id)).not.toBeNull();
    expect(heard).toEqual([{ kind: "left", userId: ada.id }]);
  });

  it("writes the open editor's work before the purge", async () => {
    seedSignedIn();
    const order: string[] = [];
    const release = holdOpenWork(async () => {
      order.push("write");
    });
    purgeLocalData.mockImplementationOnce(async () => {
      order.push("purge");
    });
    const hook = renderHook(() => useAuth(), { wrapper });

    await act(() => hook.result.current.signOut("clean"));

    expect(order).toEqual(["write", "purge"]);
    release();
  });

  it("stops, still signed in, when the open work cannot be written", async () => {
    const ada = seedSignedIn();
    const heard = anotherTabListening();
    const release = holdOpenWork(async () => false);
    const hook = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(() => hook.result.current.signOut("clean")),
    ).rejects.toThrow();

    expect(hook.result.current.status).toBe("authenticated");
    expect(getCurrentUserId()).toBe(ada.id);
    expect(purgeLocalData).not.toHaveBeenCalled();
    expect(heard).toEqual([]);
    release();
  });

  it("tells the other tabs before its own purge, and does not hear itself", async () => {
    const ada = seedSignedIn();
    const heard = anotherTabListening();
    const hook = renderHook(() => useAuth(), { wrapper });
    purgeLocalData.mockImplementationOnce(async () => {
      expect(heard).toHaveLength(1);
    });

    await act(() => hook.result.current.signOut("clean"));

    expect(heard).toEqual([{ kind: "signed-out", userId: ada.id }]);
    expect(purgeLocalData).toHaveBeenCalledTimes(1);
  });

  it("signs out within ten seconds when the pending changes never drain", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const ada = seedSignedIn();
      flushProfile.mockImplementationOnce(() => new Promise(() => {}));
      const hook = renderHook(() => useAuth(), { wrapper });

      const done = hook.result.current.signOut("clean");
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      await act(() => done);

      expect(purgeLocalData).toHaveBeenCalledWith(ada.id);
      expect(hook.result.current.status).toBe("anonymous");
    } finally {
      vi.useRealTimers();
    }
  });

  it("forgets the remembered key on a cleaning sign-out", async () => {
    seedSignedIn();
    const hook = renderHook(() => useAuth(), { wrapper });

    await act(() => hook.result.current.signOut("clean"));

    expect(platform.vaultDelete).toHaveBeenCalledWith("openrouter.key");
  });
});

describe("AuthProvider — without Google", () => {
  it("enters as the one account without Google", () => {
    const hook = renderHook(() => useAuth(), { wrapper });

    act(() => hook.result.current.enterWithoutAccount());

    const user = hook.result.current.user;
    expect(hook.result.current.status).toBe("authenticated");
    expect(user?.withGoogle).toBe(false);
    expect(user?.email).toBe("");
    expect(registry.accountWithoutGoogle()?.id).toBe(user?.id);
    expect(platform.signInWithGoogle).not.toHaveBeenCalled();
  });

  it("keeps the shelf on a leaving sign-out, and the next entry finds it", async () => {
    const heard = anotherTabListening();
    const hook = renderHook(() => useAuth(), { wrapper });
    act(() => hook.result.current.enterWithoutAccount());
    const id = hook.result.current.user?.id;

    await act(() => hook.result.current.signOut("leave"));

    expect(hook.result.current.status).toBe("anonymous");
    expect(purgeLocalData).not.toHaveBeenCalled();
    expect(heard).toContainEqual({ kind: "left", userId: id });
    act(() => hook.result.current.enterWithoutAccount());
    expect(hook.result.current.user?.id).toBe(id);
  });

  it("keeps the remembered key on a leaving sign-out", async () => {
    const hook = renderHook(() => useAuth(), { wrapper });
    act(() => hook.result.current.enterWithoutAccount());

    await act(() => hook.result.current.signOut("leave"));

    expect(platform.vaultDelete).not.toHaveBeenCalled();
  });

  it("removes the account on a cleaning sign-out, so the next entry is new", async () => {
    const hook = renderHook(() => useAuth(), { wrapper });
    act(() => hook.result.current.enterWithoutAccount());
    const id = hook.result.current.user?.id;

    await act(() => hook.result.current.signOut("clean"));

    expect(purgeLocalData).toHaveBeenCalledWith(id);
    expect(registry.accountWithoutGoogle()).toBeNull();
  });

  it("lets go, clearing nothing, when another tab signs out leaving the shelf", async () => {
    const hook = renderHook(() => useAuth(), { wrapper });
    act(() => hook.result.current.enterWithoutAccount());
    const id = hook.result.current.user?.id;

    // The sender clears the shared signed-in mark before it announces.
    registry.setSignedIn(null);
    fromAnotherTab("session", { kind: "left", userId: id });

    await waitFor(() => expect(hook.result.current.status).toBe("anonymous"));
    expect(purgeLocalData).not.toHaveBeenCalled();
    expect(registry.accountWithoutGoogle()?.id).toBe(id);
  });
});

describe("AuthProvider — another tab signed out or in", () => {
  it("clears this tab the way the other one cleared itself", async () => {
    const ada = seedSignedIn();
    const hook = renderHook(() => useAuth(), { wrapper });

    // The sender clears the shared signed-in mark before it announces.
    registry.setSignedIn(null);
    fromAnotherTab("session", { kind: "signed-out", userId: ada.id });

    await waitFor(() => expect(hook.result.current.status).toBe("anonymous"));
    // Its own purge, not trust in the sender's: the latch that refuses late
    // cache writes is per tab.
    expect(purgeLocalData).toHaveBeenCalledWith(ada.id);
    expect(getCurrentUserId()).toBeNull();
  });

  it("keeps trying to write the open text, and clears only once it is written", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ada = seedSignedIn();
    let attempts = 0;
    const release = holdOpenWork(async () => ++attempts > 1);
    const hook = renderHook(() => useAuth(), { wrapper });

    registry.setSignedIn(null);
    fromAnotherTab("session", { kind: "signed-out", userId: ada.id });
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(attempts).toBe(1);
    expect(purgeLocalData).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    await waitFor(() => expect(hook.result.current.status).toBe("anonymous"));
    expect(attempts).toBe(2);
    expect(purgeLocalData).toHaveBeenCalledWith(ada.id);
    release();
    vi.useRealTimers();
  });

  it("leaves the next account's session alone and follows it when another account signed in before the clear", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const ada = seedSignedIn();
      let attempts = 0;
      const release = holdOpenWork(async () => ++attempts > 1);
      const assign = vi.fn();
      vi.stubGlobal("location", { ...window.location, assign });
      const hook = renderHook(() => useAuth(), { wrapper });

      registry.setSignedIn(null);
      fromAnotherTab("session", { kind: "signed-out", userId: ada.id });
      await act(() => vi.advanceTimersByTimeAsync(10));
      // Another tab signs in as someone else while this one is still
      // writing its open work; its announcement arrives while this tab is
      // ending and goes unheard.
      const bob = newWriter(newWriterId(), identity("g-bob"), new Date());
      registry.saveWriter(bob);
      registry.setSignedIn(bob.id);
      fromAnotherTab("session", { kind: "signed-in", userId: bob.id });
      await act(() => vi.advanceTimersByTimeAsync(3_000));

      await waitFor(() => expect(hook.result.current.status).toBe("anonymous"));
      expect(platform.closeSession).toHaveBeenCalledWith({ server: false });
      await waitFor(() => expect(assign).toHaveBeenCalledWith("/app"));
      release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends the service's session when no one else is signed in", async () => {
    seedSignedIn();
    const hook = renderHook(() => useAuth(), { wrapper });

    await act(() => hook.result.current.signOut("clean"));

    expect(platform.closeSession).toHaveBeenCalledWith({ server: true });
  });

  it("keeps the account when it signs in again before the clear runs", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const ada = seedSignedIn();
      let attempts = 0;
      const release = holdOpenWork(async () => ++attempts > 1);
      const hook = renderHook(() => useAuth(), { wrapper });

      registry.setSignedIn(null);
      fromAnotherTab("session", { kind: "signed-out", userId: ada.id });
      await act(() => vi.advanceTimersByTimeAsync(10));
      registry.setSignedIn(ada.id);
      await act(() => vi.advanceTimersByTimeAsync(3_000));

      expect(attempts).toBe(2);
      expect(purgeLocalData).not.toHaveBeenCalled();
      expect(hook.result.current.status).toBe("authenticated");
      expect(getCurrentUserId()).toBe(ada.id);

      // The tab stopped ending, so a later sign-out still clears it.
      registry.setSignedIn(null);
      fromAnotherTab("session", { kind: "signed-out", userId: ada.id });
      await waitFor(() => expect(hook.result.current.status).toBe("anonymous"));
      release();
    } finally {
      vi.useRealTimers();
    }
  });

  function restoreFromCache() {
    const restored = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(restored, "persisted", { value: true });
    window.dispatchEvent(restored);
  }

  it("lets go of a page restored from the back-forward cache after a leaving sign-out", async () => {
    const ada = seedSignedIn();
    const hook = renderHook(() => useAuth(), { wrapper });

    localStorage.removeItem("signedIn");
    restoreFromCache();

    await waitFor(() => expect(hook.result.current.status).toBe("anonymous"));
    expect(purgeLocalData).not.toHaveBeenCalled();
    expect(registry.findWriter(ada.id)).not.toBeNull();
  });

  it("cleans a page restored from the back-forward cache after a cleaning sign-out", async () => {
    const ada = seedSignedIn();
    const hook = renderHook(() => useAuth(), { wrapper });

    registry.removeWriter(ada.id);
    restoreFromCache();

    await waitFor(() => expect(hook.result.current.status).toBe("anonymous"));
    expect(purgeLocalData).toHaveBeenCalledWith(ada.id);
  });

  it("ignores a sign-out of an account it does not hold", async () => {
    seedSignedIn();
    const hook = renderHook(() => useAuth(), { wrapper });

    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });

    fromAnotherTab("session", {
      kind: "signed-out",
      userId: "someone-else-entirely",
    });
    // A later sign-in elsewhere still reloads the tab. A tab that had taken
    // the sign-out as its own would be leaving, and would not hear it.
    fromAnotherTab("session", { kind: "signed-in", userId: "another-one" });

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/app"));
    expect(hook.result.current.status).toBe("authenticated");
    expect(purgeLocalData).not.toHaveBeenCalled();
  });

  it("reloads when another account signs in elsewhere, adopting nothing", async () => {
    const ada = seedSignedIn();
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const hook = renderHook(() => useAuth(), { wrapper });

    fromAnotherTab("session", { kind: "signed-in", userId: "another-one" });

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/app"));
    expect(hook.result.current.user?.id).toBe(ada.id);
    expect(getCurrentUserId()).toBe(ada.id);
  });

  it("reloads a signed-out tab into an account that signs in elsewhere", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    renderHook(() => useAuth(), { wrapper });

    fromAnotherTab("session", { kind: "signed-in", userId: "another-one" });

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/app"));
  });

  it("does not reload a signed-out tab for its own sign-in", async () => {
    platform.signInWithGoogle.mockResolvedValue(identity("g-ada"));
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const hook = renderHook(() => useAuth(), { wrapper });
    // The tab's own listener, as a second channel object hears the first.
    await act(() => hook.result.current.logIn());
    // Another account's sign-in, heard after the tab's own, reloads once: a
    // reload for the tab's own sign-in would have come first and made two.
    fromAnotherTab("session", { kind: "signed-in", userId: "another-one" });

    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(assign).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe("authenticated");
  });

  it("does nothing when its own account signs in elsewhere", async () => {
    const ada = seedSignedIn();
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    renderHook(() => useAuth(), { wrapper });

    fromAnotherTab("session", { kind: "signed-in", userId: ada.id });
    // Another account's sign-in, heard next, reloads once: a reload for the
    // tab's own account would have come first and made two.
    fromAnotherTab("session", { kind: "signed-in", userId: "another-one" });

    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(assign).toHaveBeenCalledTimes(1);
  });
});

describe("AuthProvider — re-reading the key's verdict", () => {
  function setVisibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => state,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  afterEach(() => {
    Reflect.deleteProperty(document, "visibilityState");
  });

  async function signedIn() {
    seedSignedIn();
    const hook = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(refreshRemoteProviders).toHaveBeenCalled());
    refreshRemoteProviders.mockClear();
    return hook;
  }

  it("re-reads when a connection finishes in another tab", async () => {
    await signedIn();
    fromAnotherTab("provider-connections", {
      providerId: "openrouter",
      ok: true,
    });
    await waitFor(() => expect(refreshRemoteProviders).toHaveBeenCalled());
  });

  it("does not re-read on a connection that failed", async () => {
    await signedIn();
    fromAnotherTab("provider-connections", {
      providerId: "openrouter",
      ok: false,
    });
    // A success heard next re-reads once: a re-read for the failure would
    // have come first and made two.
    fromAnotherTab("provider-connections", {
      providerId: "openrouter",
      ok: true,
    });
    await waitFor(() => expect(refreshRemoteProviders).toHaveBeenCalled());
    expect(refreshRemoteProviders).toHaveBeenCalledTimes(1);
  });

  it("re-reads when the writer returns to the tab, at most once a minute", async () => {
    await signedIn();
    const now = vi.spyOn(Date, "now");
    const start = Date.now();

    now.mockReturnValue(start + 30_000);
    setVisibility("visible");
    expect(refreshRemoteProviders).not.toHaveBeenCalled();

    now.mockReturnValue(start + 61_000);
    setVisibility("hidden");
    setVisibility("visible");
    await waitFor(() =>
      expect(refreshRemoteProviders).toHaveBeenCalledTimes(1),
    );
    now.mockRestore();
  });
});
