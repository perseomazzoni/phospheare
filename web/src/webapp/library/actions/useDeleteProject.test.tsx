// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { pair } from "../../../project/sync/pairing";
import { addToLibrary } from "../../../profile/profileSync";
import {
  card,
  driveRef,
  localRef,
  ref,
  renderAction,
  resetShelfFakes,
  shelfDoubles,
  tearDownShelf,
  trashProject,
  uuidOf,
} from "./shelfActions.fixture";
import { useActionError } from "./useActionError";
import { useDeleteProject } from "./useDeleteProject";

vi.mock(
  "react-i18next",
  async () => (await import("./shelfActions.fixture")).mocks.i18n,
);
vi.mock(
  "../../../storage",
  async () => (await import("./shelfActions.fixture")).mocks.storage,
);

function renderActions(synced: Set<string> = new Set()) {
  const doubles = shelfDoubles();
  const hook = renderAction(({ failure }) =>
    useDeleteProject({
      user: { id: "u1" },
      synced,
      drop: doubles.api.drop,
      forget: doubles.api.forget,
      revalidate: doubles.api.revalidate,
      unpair: doubles.api.unpair,
      toasts: doubles.toasts,
      failure,
    }),
  );
  return { hook, ...doubles };
}

beforeEach(resetShelfFakes);
afterEach(tearDownShelf);

describe("confirm", () => {
  it("trashes a Drive-only project and drops its card", async () => {
    const source = card({ ref: driveRef, content: null });
    const { hook, api, toasts } = renderActions();

    await act(async () => {
      await hook.result.current.confirm(source);
    });

    expect(trashProject).toHaveBeenCalledWith(driveRef);
    expect(api.drop).toHaveBeenCalledWith(driveRef);
    expect(api.revalidate).not.toHaveBeenCalled();
    expect(toasts.post).toHaveBeenCalledWith("library.deleted");
  });

  it("still drops the card when the backend has no bin at all", async () => {
    // `trashProject` is optional on the port: a device backend has no
    // bin to send a folder to. `cardActions` withholds Delete on those cards,
    // and the handler still does not throw if reached; the writer asked for
    // the card to go, and the local half of that is still possible.
    const source = card({ ref: ref("local", "no-bin", "Project") });
    const { hook, api } = renderActions();

    await act(async () => {
      await hook.result.current.confirm(source);
    });

    expect(trashProject).not.toHaveBeenCalled();
    expect(api.drop).toHaveBeenCalledWith(source.ref);
  });

  it("on a synced project trashes the paired Drive folder, unpairs, and keeps the local card", async () => {
    await pair("book-local-key", { providerId: "drive", key: "drive-folder" });
    const source = card({
      id: "book-local-key",
      ref: ref("local", "local-key", "Project"),
    });
    const { hook, api, toasts } = renderActions(new Set(["book-local-key"]));

    await act(async () => {
      await hook.result.current.confirm(source);
    });

    expect(trashProject).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "drive",
        key: "drive-folder",
        name: "Project",
      }),
    );
    expect(api.unpair).toHaveBeenCalledWith(source.ref);
    expect(api.revalidate).toHaveBeenCalledWith(source.ref);
    expect(api.drop).not.toHaveBeenCalled();
    expect(toasts.post).toHaveBeenCalledWith("library.deleted");
  });
});

describe("remove", () => {
  it("ends the pairing on a synced project, then forgets with an undo in the toast", async () => {
    const restore = vi.fn();
    // Both halves of this fixture are in the id shape: the synced set
    // names the book, as `pairings.keys()` does, and the mirror row turns the
    // card's address into that id. A set seeded with an address would make
    // the probe always false, and the row would pass while Remove silently
    // kept the pairing.
    addToLibrary(
      "u1",
      { id: uuidOf("book-l1"), provider: "local", key: "l1", name: "Project" },
      undefined,
    );
    const { hook, api, toasts } = renderActions(new Set([uuidOf("book-l1")]));
    api.forget.mockReturnValue(restore);

    hook.result.current.remove(localRef);

    expect(api.unpair).toHaveBeenCalledWith(localRef);
    expect(toasts.post).toHaveBeenCalledWith("library.removed", restore);
  });

  it("plain remove on a Drive-only project leaves Drive untouched", async () => {
    const restore = vi.fn();
    const { hook, api, toasts } = renderActions();
    api.forget.mockReturnValue(restore);

    hook.result.current.remove(driveRef);

    expect(api.unpair).not.toHaveBeenCalled();
    expect(toasts.post).toHaveBeenCalledWith("library.removed", restore);
  });
});

// `remove` depends on the toasts' `post`, not on the `toasts` wrapper, which
// is a fresh literal every render. It then survives a render where only the
// wrapper's identity changed.
describe("callback identity survives a fresh toasts wrapper each render", () => {
  it("remove keeps its identity", () => {
    const post = vi.fn();
    const dismiss = vi.fn();
    const api = {
      drop: vi.fn(),
      forget: vi.fn(() => () => {}),
      revalidate: vi.fn(async () => {}),
      unpair: vi.fn(async () => {}),
    };
    // Stable across the simulated re-render, like the real `user` (from
    // `useAuth()`, unchanged unless auth changes) and `synced` (a `useState`
    // value in `useProjects`, unchanged unless `setSynced` runs); only
    // `toasts` below is a fresh literal each render.
    const user = { id: "u1" };
    const synced = new Set<string>();

    const { result, rerender } = renderHook(() =>
      useDeleteProject({
        user,
        synced,
        ...api,
        // A fresh object every render, like `useToasts()`'s own return value;
        // only `post` is the same reference.
        toasts: { post, dismiss },
        failure: useActionError(),
      }),
    );

    const before = result.current.remove;

    rerender();

    expect(result.current.remove).toBe(before);
  });
});
