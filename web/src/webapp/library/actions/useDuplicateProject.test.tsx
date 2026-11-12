// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import {
  card,
  copyCancelled,
  copyOk,
  createLocalProject,
  disposeStorage,
  driveRef,
  duplicateProjectMock,
  localProviderFake,
  localRef,
  openProjectStorageMock,
  renderAction,
  resetShelfFakes,
  shelfDoubles,
  tearDownShelf,
  workingCopy,
} from "./shelfActions.fixture";
import { useDuplicateProject } from "./useDuplicateProject";

vi.mock(
  "react-i18next",
  async () => (await import("./shelfActions.fixture")).mocks.i18n,
);
vi.mock(
  "../../../storage",
  async () => (await import("./shelfActions.fixture")).mocks.storage,
);
vi.mock(
  "../../../project/projectStorage",
  async () => (await import("./shelfActions.fixture")).mocks.projectStorage,
);
vi.mock(
  "../../../project/duplicate",
  async () => (await import("./shelfActions.fixture")).mocks.duplicate,
);

function renderActions() {
  const doubles = shelfDoubles();
  const hook = renderAction(({ failure, copyJob }) =>
    useDuplicateProject({
      adopt: doubles.api.adopt,
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
  it("a cancelled duplicate puts nothing on the shelf", async () => {
    createLocalProject.mockResolvedValue(localRef);
    duplicateProjectMock.mockResolvedValue(copyCancelled);
    const source = card({ ref: driveRef });
    const { hook, api, toasts } = renderActions();

    await act(async () => {
      await hook.result.current.confirm(source, "Project copy");
    });

    expect(api.adopt).not.toHaveBeenCalled();
    expect(toasts.post).toHaveBeenCalledWith("library.duplicateCancelled");
    expect(hook.result.current.copy).toBeNull();
  });

  it("copies the source through its working copy", async () => {
    createLocalProject.mockResolvedValue(localRef);
    duplicateProjectMock.mockResolvedValue(copyOk);
    const source = card({ ref: driveRef });
    const { hook } = renderActions();

    await act(async () => {
      await hook.result.current.confirm(source, "Project copy");
    });

    expect(openProjectStorageMock).toHaveBeenCalledWith(driveRef, "book-a");
    expect(duplicateProjectMock).toHaveBeenCalledWith(
      { provider: workingCopy, ref: driveRef },
      { provider: localProviderFake, ref: localRef },
      "Project copy",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(disposeStorage).toHaveBeenCalled();
  });

  it("never navigates — the writer stays in the original", async () => {
    createLocalProject.mockResolvedValue(localRef);
    duplicateProjectMock.mockResolvedValue(copyOk);
    const source = card({ ref: driveRef });
    const { hook, api, toasts, navigate } = renderActions();

    await act(async () => {
      await hook.result.current.confirm(source, "Project copy");
    });

    expect(api.adopt).toHaveBeenCalled();
    expect(toasts.post).toHaveBeenCalledWith("library.duplicated");
    expect(navigate).not.toHaveBeenCalled();
  });
});
