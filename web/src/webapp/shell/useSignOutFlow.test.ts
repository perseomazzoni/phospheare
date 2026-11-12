// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ProviderConnection } from "../../storage";
import type { RemoteQueueRecord } from "../../project/sync/remoteQueueStore";
import type { SignOutChoice } from "../../auth/AuthContext";
import { holdOpenWork } from "../../auth/openWork";

// The purge runs inside `signOut`, after the signed-in mark is cleared;
// `AuthContext.test.tsx` pins it. The flow decides which answer
// to pass.
const signOut = vi.fn<(choice: SignOutChoice) => Promise<void>>(async () => {});
// A clean drops this browser's Drive connection and never revokes at Google.
const dropDriveConnection = vi.fn(async () => {});
const revokeDriveGrant = vi.fn(async () => true);
const refresh = vi.fn(async () => {});
const drainAll = vi.fn(async () => {});

vi.mock("../../storage", () => ({
  dropDriveConnection: () => dropDriveConnection(),
  revokeDriveGrant: () => revokeDriveGrant(),
}));

// The profile upload a clean makes while Drive is connected;
// `forgetAccount.test.ts` pins how it decides.
const uploadProfile = vi.fn<(userId: string) => Promise<boolean>>(
  async () => true,
);
vi.mock("../../profile/forgetAccount", () => ({
  uploadProfile: (userId: string) => uploadProfile(userId),
}));

// The queue, at its two exported seams. Sign-out is when the app asks whether
// anything is still only here, so these rows can answer yes.
let records: RemoteQueueRecord[] = [];
const listeners = new Set<() => void>();

vi.mock("../../project/sync/remoteQueue", () => ({
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  pendingRecords: () => records,
  drainAll: () => drainAll(),
}));

// The preflight read before anything is cleared: the same rows, or a throw
// when the queue cannot be read.
const pendingOpsOrThrow = vi.fn(async () => records);
vi.mock("../../project/sync/remoteQueueStore", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  pendingOpsOrThrow: () => pendingOpsOrThrow(),
}));

/** Replace the snapshot the way the queue does: a new array only on change. */
function publish(next: RemoteQueueRecord[]) {
  act(() => {
    records = next;
    for (const listener of listeners) listener();
  });
}

let nextId = 1;
const held = (path: string): RemoteQueueRecord => ({
  id: nextId++,
  userId: "7",
  ref: { id: "book-1", providerId: "drive", key: "book" },
  op: { kind: "put", path },
});

let user = { id: "7", withGoogle: true };
vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ user, signOut, refresh }),
}));

const { useSignOutFlow } = await import("./useSignOutFlow");

const conn = (state: string): ProviderConnection =>
  ({ state }) as unknown as ProviderConnection;

beforeEach(() => {
  vi.clearAllMocks();
  records = [];
  user = { id: "7", withGoogle: true };
  listeners.clear();
  nextId = 1;
});
afterEach(() => cleanup());

const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

describe("the sign-out question", () => {
  it.each([true, false])(
    "leaves everything, Drive included, for an account with Google: %s",
    async (withGoogle) => {
      user = { id: "7", withGoogle };
      const { result } = renderHook(() => useSignOutFlow(conn("connected")));
      act(() => result.current.leave());
      await flush();
      expect(signOut).toHaveBeenCalledWith("leave");
      expect(uploadProfile).not.toHaveBeenCalled();
      expect(dropDriveConnection).not.toHaveBeenCalled();
      expect(revokeDriveGrant).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "cleans everything for an account with Google: %s",
    async (withGoogle) => {
      user = { id: "7", withGoogle };
      const { result } = renderHook(() => useSignOutFlow(conn("unset")));
      act(() => result.current.clean());
      await flush();
      expect(signOut).toHaveBeenCalledWith("clean");
    },
  );

  it("drops Drive in this browser only before cleaning, never revoking at Google", async () => {
    const order: string[] = [];
    dropDriveConnection.mockImplementationOnce(async () => {
      order.push("drop");
    });
    signOut.mockImplementationOnce(async () => {
      order.push("sign-out");
    });
    const { result } = renderHook(() => useSignOutFlow(conn("connected")));
    act(() => result.current.clean());
    await flush();
    expect(order).toEqual(["drop", "sign-out"]);
    expect(revokeDriveGrant).not.toHaveBeenCalled();
  });

  it("stops before signing out when Drive could not be dropped", async () => {
    dropDriveConnection.mockRejectedValueOnce(new Error("502"));
    const { result } = renderHook(() => useSignOutFlow(conn("connected")));
    act(() => result.current.clean());
    await flush();
    expect(signOut).not.toHaveBeenCalled();
    expect(result.current.confirming).toBe(true);
    expect(result.current.failure).toBe("disconnect");
  });

  it("says Drive is already disconnected when the sign-out after it failed", async () => {
    // A sign-out that fails after the drop leaves the writer signed in with
    // Drive gone here, and queued work waiting for a reconnect. The account
    // is re-read so the dialog asks the disconnected question next.
    signOut.mockRejectedValueOnce(new Error("no answer"));
    const { result } = renderHook(() => useSignOutFlow(conn("connected")));
    act(() => result.current.clean());
    await flush();
    expect(dropDriveConnection).toHaveBeenCalledOnce();
    expect(result.current.confirming).toBe(true);
    expect(result.current.failure).toBe("sign-out-disconnected");
    expect(refresh).toHaveBeenCalled();
  });

  it("does nothing at all when the writer cancels", async () => {
    const { result } = renderHook(() => useSignOutFlow(conn("disconnected")));
    await act(async () => result.current.requestSignOut());
    expect(result.current.confirming).toBe(true);
    act(() => result.current.cancelSignOut());
    await flush();
    expect(result.current.confirming).toBe(false);
    expect(signOut).not.toHaveBeenCalled();
  });
});

// ── A sign-out that fails ────────────────────────────────────────────────────
//
// When `signOut` throws, the dialog reopens on the reason. A failure that
// reached only a rejected promise would leave the writer believing they were
// out.

describe("a sign-out that did not take", () => {
  it("reopens the dialog with the reason when leaving fails", async () => {
    signOut.mockRejectedValueOnce(new Error("503"));
    const { result } = renderHook(() => useSignOutFlow(conn("disconnected")));
    await act(async () => result.current.requestSignOut());
    act(() => result.current.leave());
    await flush();
    expect(result.current.confirming).toBe(true);
    expect(result.current.failure).toBe("sign-out");
  });

  it("reopens it for the clean too", async () => {
    signOut.mockRejectedValueOnce(new Error("no answer"));
    const { result } = renderHook(() => useSignOutFlow(conn("disconnected")));
    act(() => result.current.clean());
    await flush();
    expect(result.current.confirming).toBe(true);
    expect(result.current.failure).toBe("sign-out");
  });

  it("clears the reason when the writer tries again, or stays", async () => {
    signOut.mockRejectedValueOnce(new Error("503"));
    const { result } = renderHook(() => useSignOutFlow(conn("disconnected")));
    act(() => result.current.leave());
    await flush();
    expect(result.current.failure).toBe("sign-out");

    // The retry succeeds, and the dialog closes with nothing to report.
    act(() => result.current.leave());
    await flush();
    expect(result.current.failure).toBeNull();
    expect(result.current.confirming).toBe(false);

    signOut.mockRejectedValueOnce(new Error("503"));
    act(() => result.current.leave());
    await flush();
    act(() => result.current.cancelSignOut());
    expect(result.current.failure).toBeNull();
  });

  it("does not report a failure when sign-out succeeds", async () => {
    const { result } = renderHook(() => useSignOutFlow(conn("disconnected")));
    act(() => result.current.clean());
    await flush();
    expect(result.current.confirming).toBe(false);
    expect(result.current.failure).toBeNull();
  });
});

// ── Work the queue still holds ───────────────────────────────────────────────
//
// Leaving keeps the queue and the working copy, so held work survives it.
// Cleaning destroys the only copy, and the dialog says so.

describe("work the queue still holds", () => {
  const flow = () => renderHook(() => useSignOutFlow(conn("disconnected")));

  it("says nothing is held when the queue is empty", async () => {
    const { result } = flow();
    expect(result.current.heldFiles).toBe(0);
  });

  it("counts the files the queue is still holding, live", async () => {
    // Live rather than sampled when the dialog opened. A count read once needs
    // a timeout to decide when to read it, which would guess how long a person
    // leaving a building has.
    const { result } = flow();
    await act(async () => result.current.requestSignOut());
    publish([
      held("/document/section--a.00.md"),
      held("/document/part--b.00.md"),
    ]);
    expect(result.current.heldFiles).toBe(2);

    // It falls as the drain lands, without the dialog being reopened.
    publish([held("/document/section--a.00.md")]);
    expect(result.current.heldFiles).toBe(1);
    publish([]);
    expect(result.current.heldFiles).toBe(0);
  });

  it("attempts one more drain the moment the writer reaches for sign-out", async () => {
    const { result } = flow();
    expect(drainAll).not.toHaveBeenCalled();
    await act(async () => result.current.requestSignOut());
    expect(drainAll).toHaveBeenCalledOnce();
    expect(result.current.confirming).toBe(true);
  });

  it("opens the dialog without waiting for that attempt to finish", async () => {
    let settle = () => {};
    drainAll.mockImplementationOnce(
      () => new Promise<void>((resolve) => (settle = resolve)),
    );
    const { result } = flow();
    await act(async () => result.current.requestSignOut());
    expect(result.current.confirming).toBe(true);
    act(() => settle());
  });

  it("survives a failed drain attempt rather than surfacing it", async () => {
    drainAll.mockRejectedValueOnce(new Error("no route to host"));
    const { result } = flow();
    await act(async () => result.current.requestSignOut());
    await flush();
    expect(result.current.confirming).toBe(true);
  });

  it("leaves while work is held, keeping it", async () => {
    const { result } = flow();
    await act(async () => result.current.requestSignOut());
    publish([held("/document/section--a.00.md")]);

    act(() => result.current.leave());
    await flush();

    expect(signOut).toHaveBeenCalledWith("leave");
  });

  it("still lets the writer clean it away deliberately", async () => {
    // A writer who must leave a borrowed machine and cannot wait has this way
    // to stop a stranger reading their work; the dialog names what it costs.
    const { result } = flow();
    await act(async () => result.current.requestSignOut());
    publish([held("/document/section--a.00.md")]);

    act(() => result.current.clean());
    await flush();

    expect(signOut).toHaveBeenCalledWith("clean");
  });

  it("writes the open work before the question opens", async () => {
    // Written first, the save's op is in the queue the live count reads.
    let open = true;
    const { result } = flow();
    const release = holdOpenWork(async () => {
      open = result.current.confirming;
    });
    await act(async () => result.current.requestSignOut());
    await flush();

    expect(open).toBe(false);
    expect(result.current.confirming).toBe(true);
    expect(result.current.failure).toBeNull();
    release();
  });

  it("opens with the failure when the open work cannot be written", async () => {
    const release = holdOpenWork(async () => false);
    const { result } = flow();
    await act(async () => result.current.requestSignOut());
    await flush();

    expect(result.current.confirming).toBe(true);
    expect(result.current.failure).toBe("sign-out");
    release();
  });

  it("does not treat an unreadable queue as no pending work", async () => {
    // The live count reads an unreadable queue as empty, so the clean reads
    // it again and stops rather than clear what may be the only copy.
    const { result } = flow();
    await act(async () => result.current.requestSignOut());
    pendingOpsOrThrow.mockRejectedValueOnce(new Error("unreadable"));

    act(() => result.current.clean());
    await flush();

    expect(signOut).not.toHaveBeenCalled();
    expect(result.current.confirming).toBe(true);
    expect(result.current.failure).toBe("sign-out");
  });
});

// ── The profile before a clean ───────────────────────────────────────────────
//
// With Drive connected, the profile goes to Remote Storage before the drop or
// the purge, and the open work is written before either.

describe("the profile and the open work before a clean", () => {
  it("writes the open work before it drops Drive", async () => {
    const order: string[] = [];
    const release = holdOpenWork(async () => {
      order.push("write");
    });
    dropDriveConnection.mockImplementationOnce(async () => {
      order.push("drop");
    });
    const { result } = renderHook(() => useSignOutFlow(conn("connected")));
    act(() => result.current.clean());
    await flush();
    expect(order.slice(0, 2)).toEqual(["write", "drop"]);
    release();
  });

  it("drops nothing when the open work cannot be written", async () => {
    const release = holdOpenWork(async () => false);
    const { result } = renderHook(() => useSignOutFlow(conn("connected")));
    act(() => result.current.clean());
    await flush();
    expect(dropDriveConnection).not.toHaveBeenCalled();
    expect(uploadProfile).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(result.current.confirming).toBe(true);
    expect(result.current.failure).toBe("sign-out");
    release();
  });

  it("uploads the profile before it drops Drive", async () => {
    const order: string[] = [];
    uploadProfile.mockImplementationOnce(async () => {
      order.push("upload");
      return true;
    });
    dropDriveConnection.mockImplementationOnce(async () => {
      order.push("drop");
    });
    const { result } = renderHook(() => useSignOutFlow(conn("connected")));
    act(() => result.current.clean());
    await flush();
    expect(uploadProfile).toHaveBeenCalledWith("7");
    expect(order).toEqual(["upload", "drop"]);
    expect(result.current.profileUnsaved).toBe(false);
  });

  it("asks again, saying so, when the profile did not reach Remote Storage", async () => {
    uploadProfile.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useSignOutFlow(conn("connected")));
    act(() => result.current.clean());
    await flush();
    expect(dropDriveConnection).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(result.current.confirming).toBe(true);
    expect(result.current.profileUnsaved).toBe(true);
    expect(result.current.failure).toBeNull();

    // The writer still chooses, and the answer is taken without a second wait.
    act(() => result.current.clean());
    await flush();
    expect(uploadProfile).toHaveBeenCalledOnce();
    expect(dropDriveConnection).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledWith("clean");
  });

  it("forgets the unsaved profile when the writer stays", async () => {
    uploadProfile.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useSignOutFlow(conn("connected")));
    act(() => result.current.clean());
    await flush();
    expect(result.current.profileUnsaved).toBe(true);
    act(() => result.current.cancelSignOut());
    expect(result.current.profileUnsaved).toBe(false);
  });

  it("uploads nothing without Drive", async () => {
    const { result } = renderHook(() => useSignOutFlow(conn("disconnected")));
    act(() => result.current.clean());
    await flush();
    expect(uploadProfile).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledWith("clean");
  });
});
