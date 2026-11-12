// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { projectPath } from "../../../editor/path";
import {
  card,
  copyCancelled,
  copyOk,
  copyProjectMock,
  createDriveProject,
  driveProviderFake,
  driveRef,
  idFor,
  localProviderFake,
  localRef,
  renderAction,
  resetShelfFakes,
  shelfDoubles,
  tearDownShelf,
} from "./shelfActions.fixture";
import { useMoveToRemote } from "./useMoveToRemote";

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

function renderActions() {
  const doubles = shelfDoubles();
  const hook = renderAction(({ failure, copyJob }) =>
    useMoveToRemote({
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
afterEach(tearDownShelf);

describe("confirm", () => {
  it("copies, abandons the local tracking, adopts the Drive project and opens it", async () => {
    createDriveProject.mockResolvedValue(driveRef);
    copyProjectMock.mockResolvedValue(copyOk);
    const source = card({ ref: localRef });
    const { hook, api, toasts, navigate } = renderActions();

    await act(async () => {
      await hook.result.current.confirm(source);
    });

    expect(copyProjectMock).toHaveBeenCalledWith(
      { provider: localProviderFake, ref: localRef },
      { provider: driveProviderFake, ref: driveRef },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    // One row, relocated, never a tombstone and a new one. The local
    // folder is left untouched, and the shelf keeps everything it remembers
    // about the book, `openedAt` included.
    expect(api.drop).not.toHaveBeenCalled();
    expect(api.relocate).toHaveBeenCalledWith(localRef, driveRef);
    expect(toasts.post).toHaveBeenCalledWith("library.movedToDrive");
    // The URL does not change when a book moves: it names the book.
    expect(navigate).toHaveBeenCalledWith(projectPath(idFor(localRef)));
    expect(hook.result.current.copy).toBeNull();
    expect(hook.result.current.pending).toBeNull();
  });

  it("a cancelled copy is honest about what is already in Drive and pairs nothing", async () => {
    createDriveProject.mockResolvedValue(driveRef);
    copyProjectMock.mockResolvedValue(copyCancelled);
    const source = card({ ref: localRef });
    const { hook, api, toasts, navigate } = renderActions();

    await act(async () => {
      await hook.result.current.confirm(source);
    });

    expect(toasts.post).toHaveBeenCalledWith("library.copyCancelled");
    expect(api.drop).not.toHaveBeenCalled();
    expect(api.adopt).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(hook.result.current.copy).toBeNull();
  });
});
