// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { projectPath } from "../../../editor/path";
import { addToLibrary } from "../../../profile/profileSync";
import { appendOp, dropOps } from "../../../project/sync/remoteQueueStore";
import {
  card,
  copyOk,
  copyProjectMock,
  createLocalProject,
  disposeStorage,
  drainAllMock,
  driveRef,
  idFor,
  localProviderFake,
  localRef,
  openProjectStorageMock,
  renderAction,
  resetShelfFakes,
  retryNowMock,
  settledMock,
  shelfDoubles,
  tearDownShelf,
  trashProject,
  uuidOf,
  workingCopy,
} from "./shelfActions.fixture";
import { useMoveToLocal } from "./useMoveToLocal";

vi.mock(
  "react-i18next",
  async () => (await import("./shelfActions.fixture")).mocks.i18n,
);
vi.mock(
  "../../../storage",
  async () => (await import("./shelfActions.fixture")).mocks.storage,
);
vi.mock(
  "../../../project/transfer",
  async () => (await import("./shelfActions.fixture")).mocks.transfer,
);
vi.mock(
  "../../../project/projectStorage",
  async () => (await import("./shelfActions.fixture")).mocks.projectStorage,
);
vi.mock(
  "../../../project/sync/remoteQueue",
  async () => (await import("./shelfActions.fixture")).mocks.remoteQueue,
);

function renderActions() {
  const doubles = shelfDoubles();
  const hook = renderAction(({ failure, copyJob }) =>
    useMoveToLocal({
      user: { id: "u1" },
      navigate: doubles.navigate,
      relocate: doubles.api.relocate,
      toasts: doubles.toasts,
      failure,
      copyJob,
    }),
  );
  return { hook, ...doubles };
}

beforeEach(resetShelfFakes);
// The database connection outlives the fake IndexedDB swapped in above, so a
// row a test queued is cleared before the next one.
beforeEach(async () => {
  await dropOps({ providerId: "drive", key: "d1" });
});
afterEach(tearDownShelf);

describe("confirm", () => {
  it("leaves the Drive original alone when the copy cannot be read", async () => {
    // A relocate that refuses changes nothing: the card and the row still
    // name Drive, and the folder they name is still there.
    createLocalProject.mockResolvedValue(localRef);
    copyProjectMock.mockResolvedValue(copyOk);
    const source = card({ ref: driveRef });
    const { hook, api, toasts } = renderActions();
    api.relocate.mockResolvedValueOnce(false);

    await act(async () => {
      await hook.result.current.confirm(source);
    });

    expect(trashProject).not.toHaveBeenCalled();
    expect(api.drop).not.toHaveBeenCalled();
    expect(toasts.post).not.toHaveBeenCalledWith("library.movedToLocal");
    expect(hook.result.current.shelfError).toBe("library.openFailed");
  });

  it("proves the local copy readable before the Drive original is trashed", async () => {
    createLocalProject.mockResolvedValue(localRef);
    copyProjectMock.mockResolvedValue(copyOk);
    const source = card({ ref: driveRef });
    const { hook, api, toasts, navigate } = renderActions();

    await act(async () => {
      await hook.result.current.confirm(source);
    });

    // The Drive original may only die once the copy has proven readable, and
    // `relocate` is what proves it: it reads the copy before it moves the card
    // or the row, and answers false without touching either when it cannot.
    const relocateOrder = api.relocate.mock.invocationCallOrder[0];
    const trashOrder = trashProject.mock.invocationCallOrder[0];
    expect(relocateOrder).toBeLessThan(trashOrder);
    expect(trashProject).toHaveBeenCalledWith(driveRef);
    expect(api.drop).not.toHaveBeenCalled();
    expect(toasts.post).toHaveBeenCalledWith("library.movedToLocal");
    // The URL names the book, so it survives the move.
    expect(navigate).toHaveBeenCalledWith(projectPath(idFor(driveRef)));
  });

  // The working copy holds saves the queue has not carried to Drive yet. A
  // copy of the bare Drive folder would leave them behind, and the bin would
  // then take the only remote trace of them.
  it("copies the book through its working copy, not the bare Drive folder", async () => {
    createLocalProject.mockResolvedValue(localRef);
    copyProjectMock.mockResolvedValue(copyOk);
    const source = card({ ref: driveRef });
    const { hook } = renderActions();

    await act(async () => {
      await hook.result.current.confirm(source);
    });

    expect(openProjectStorageMock).toHaveBeenCalledWith(driveRef, "book-a");
    expect(copyProjectMock).toHaveBeenCalledWith(
      { provider: workingCopy, ref: driveRef },
      { provider: localProviderFake, ref: localRef },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(disposeStorage).toHaveBeenCalled();
  });

  it("drains the queue first, and keeps the book in Drive while work is still owed", async () => {
    createLocalProject.mockResolvedValue(localRef);
    copyProjectMock.mockResolvedValue(copyOk);
    await appendOp(
      { id: "book-a", providerId: "drive", key: "d1" },
      { kind: "put", path: "/document/one.md" },
    );
    const source = card({ ref: driveRef });
    const { hook, api } = renderActions();

    await act(async () => {
      await hook.result.current.confirm(source);
    });

    expect(retryNowMock).toHaveBeenCalledWith({
      id: "book-a",
      providerId: "drive",
      key: "d1",
    });
    expect(copyProjectMock).not.toHaveBeenCalled();
    expect(api.relocate).not.toHaveBeenCalled();
    expect(trashProject).not.toHaveBeenCalled();
    expect(hook.result.current.shelfError).toBe("library.moveToLocalOwed");
  });

  it("drains only this book's queue, never every book's stopped work", async () => {
    // Clearing every stopped op in the account would spend another attempt
    // for each capped or refused project the move has nothing to do with.
    createLocalProject.mockResolvedValue(localRef);
    copyProjectMock.mockResolvedValue(copyOk);
    const source = card({ ref: driveRef });
    const { hook } = renderActions();

    await act(async () => {
      await hook.result.current.confirm(source);
    });

    expect(drainAllMock).not.toHaveBeenCalled();
    expect(retryNowMock).toHaveBeenCalledTimes(1);
    expect(retryNowMock).toHaveBeenCalledWith({
      id: "book-a",
      providerId: "drive",
      key: "d1",
    });
    expect(retryNowMock.mock.invocationCallOrder[0]).toBeLessThan(
      settledMock.mock.invocationCallOrder[0],
    );
  });

  it("keeps the Drive original when a save reaches the queue during the copy", async () => {
    createLocalProject.mockResolvedValue(localRef);
    copyProjectMock.mockImplementation(async () => {
      await appendOp(
        { id: "book-a", providerId: "drive", key: "d1" },
        { kind: "put", path: "/document/one.md" },
      );
      return copyOk;
    });
    const source = card({ ref: driveRef });
    const { hook, api } = renderActions();

    await act(async () => {
      await hook.result.current.confirm(source);
    });

    expect(api.relocate).not.toHaveBeenCalled();
    expect(trashProject).not.toHaveBeenCalled();
    expect(hook.result.current.shelfError).toBe("library.moveToLocalOwed");
  });

  it("refuses a folder name another book on the shelf already has", async () => {
    addToLibrary("u1", {
      id: uuidOf("book-other"),
      provider: "local",
      key: "new-project",
      name: "new-project",
    });
    createLocalProject.mockResolvedValue(localRef);
    copyProjectMock.mockResolvedValue(copyOk);
    const source = card({ ref: driveRef });
    const { hook } = renderActions();

    await act(async () => {
      await hook.result.current.confirm(source);
    });

    expect(createLocalProject).not.toHaveBeenCalled();
    expect(trashProject).not.toHaveBeenCalled();
    expect(hook.result.current.shelfError).toBe("name.folderTaken");
  });

  it("does not refuse the book its own name", async () => {
    addToLibrary("u1", {
      id: uuidOf("book-a"),
      provider: "drive",
      key: "d1",
      name: "New Project",
    });
    createLocalProject.mockResolvedValue(localRef);
    copyProjectMock.mockResolvedValue(copyOk);
    const source = card({ ref: driveRef });
    const { hook } = renderActions();

    await act(async () => {
      await hook.result.current.confirm(source);
    });

    expect(createLocalProject).toHaveBeenCalledWith("new-project");
    expect(hook.result.current.shelfError).toBeNull();
  });
});
