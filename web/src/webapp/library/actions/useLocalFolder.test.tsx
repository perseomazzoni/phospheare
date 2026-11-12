// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  renderAction,
  resetShelfFakes,
  shelfDoubles,
  tearDownShelf,
} from "./shelfActions.fixture";
import { StorageError } from "../../../storage/types";
import type { Connections } from "../../../storage";
import { useActionError } from "./useActionError";
import { useLocalFolder } from "./useLocalFolder";

vi.mock(
  "react-i18next",
  async () => (await import("./shelfActions.fixture")).mocks.i18n,
);
vi.mock(
  "../../../storage",
  async () => (await import("./shelfActions.fixture")).mocks.storage,
);

function renderActions() {
  const doubles = shelfDoubles();
  const hook = renderAction(({ failure }) =>
    useLocalFolder({
      user: { id: "u1" },
      connections: doubles.connections,
      scanLocal: doubles.api.scanLocal,
      rescan: doubles.api.rescan,
      toasts: doubles.toasts,
      failure,
    }),
  );
  return { hook, ...doubles };
}

beforeEach(resetShelfFakes);
afterEach(tearDownShelf);

describe("choose", () => {
  it("picks the root, toasts, rescans, and sweeps the fresh root's books", async () => {
    const { hook, toasts, api, localConnect } = renderActions();
    api.scanLocal.mockResolvedValue(2);

    await act(async () => {
      await hook.result.current.choose();
    });

    expect(localConnect).toHaveBeenCalled();
    expect(toasts.post).toHaveBeenCalledWith("library.localFolderChosen");
    expect(toasts.post).toHaveBeenCalledWith("library.findLocalDone");
    expect(api.rescan).toHaveBeenCalled();
    expect(api.scanLocal).toHaveBeenCalled();
    expect(hook.result.current.shelfError).toBeNull();
  });

  it("skips the count toast when the fresh root holds nothing new", async () => {
    const { hook, toasts, api } = renderActions();
    api.scanLocal.mockResolvedValue(0);

    await act(async () => {
      await hook.result.current.choose();
    });

    expect(toasts.post).toHaveBeenCalledWith("library.localFolderChosen");
    expect(toasts.post).not.toHaveBeenCalledWith("library.findLocalDone");
  });

  it("is a no-op when the writer closes the picker", async () => {
    const { hook, toasts, api, localConnect } = renderActions();
    localConnect.mockResolvedValue(false);

    await act(async () => {
      await hook.result.current.choose();
    });

    expect(toasts.post).not.toHaveBeenCalled();
    expect(api.rescan).not.toHaveBeenCalled();
  });

  it("surfaces a real failure without pretending nothing happened", async () => {
    const { hook, api, localConnect } = renderActions();
    localConnect.mockRejectedValue(new StorageError("picker failed", "io"));

    await act(async () => {
      await hook.result.current.choose();
    });

    expect(api.rescan).not.toHaveBeenCalled();
    expect(hook.result.current.shelfError).toBe("storage.io");
  });
});

describe("forget", () => {
  it("forgets the root — the local twin of Drive's disconnect — silently, like it", async () => {
    const { hook, localDisconnect, api } = renderActions();

    await act(async () => {
      await hook.result.current.forget();
    });

    expect(localDisconnect).toHaveBeenCalled();
    expect(hook.result.current.shelfError).toBeNull();
    // The gather does not notice the disconnect on its own; without
    // this rescan the shelf would keep every local card as it was.
    expect(api.rescan).toHaveBeenCalled();
  });

  it("surfaces a real failure, and does not rescan on top of it", async () => {
    const { hook, localDisconnect, api } = renderActions();
    localDisconnect.mockRejectedValue(new StorageError("store gone", "io"));

    await act(async () => {
      await hook.result.current.forget();
    });

    expect(hook.result.current.shelfError).toBe("storage.io");
    expect(api.rescan).not.toHaveBeenCalled();
  });
});

// The hook's callbacks depend on the members they use (`post`,
// `local.connect`, `local.disconnect`), not on the `toasts` and `connections`
// wrappers, which are fresh literals every render. A callback then survives a
// render where only a wrapper's identity changed. The row rebuilds both
// wrappers every render, as the real hooks do, while keeping the member
// functions the same.
describe("callback identity survives a fresh toasts/connections wrapper each render", () => {
  it("choose and forget keep their identity", () => {
    const post = vi.fn();
    const dismiss = vi.fn();
    const scanLocal = vi.fn(async () => 0);
    const rescan = vi.fn();
    const localConnect = vi.fn(async () => true);
    const localDisconnect = vi.fn(async () => {});
    // Stable across the simulated re-render, like the real `user` (from
    // `useAuth()`, unchanged unless auth changes); only `toasts` and
    // `connections` below are fresh literals each render.
    const user = { id: "u1" };

    const { result, rerender } = renderHook(() =>
      useLocalFolder({
        user,
        scanLocal,
        rescan,
        // A fresh object every render, like `useToasts()`'s own return value;
        // only `post` is the same reference.
        toasts: { post, dismiss },
        connections: {
          drive: { state: "unset", resolved: true },
          local: {
            state: "connected",
            resolved: true,
            connect: localConnect,
            disconnect: localDisconnect,
          },
        } as unknown as Connections,
        failure: useActionError(),
      }),
    );

    const before = {
      choose: result.current.choose,
      forget: result.current.forget,
    };

    rerender();

    expect(result.current.choose).toBe(before.choose);
    expect(result.current.forget).toBe(before.forget);
  });
});
