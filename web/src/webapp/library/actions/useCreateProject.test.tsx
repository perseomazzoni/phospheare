// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import {
  createDriveProject,
  createLocalProject,
  driveProviderFake,
  driveRef,
  idFor,
  localProviderFake,
  localRef,
  renderAction,
  resetShelfFakes,
  scaffoldProjectMock,
  shelfDoubles,
  tearDownShelf,
} from "./shelfActions.fixture";
import { StorageError } from "../../../storage/types";
import { startingShape } from "../../../project/startingShape";
import { createStepIndex } from "../../../project/createSteps";
import { projectPath } from "../../../editor/path";
import type { CreateRequest } from "../../../projectSetup/CreateProjectDialog";
import { useCreateProject } from "./useCreateProject";

vi.mock(
  "react-i18next",
  async () => (await import("./shelfActions.fixture")).mocks.i18n,
);
vi.mock(
  "../../../storage",
  async () => (await import("./shelfActions.fixture")).mocks.storage,
);
vi.mock(
  "../../../project/scaffold",
  async () => (await import("./shelfActions.fixture")).mocks.scaffold,
);

function renderActions() {
  const doubles = shelfDoubles();
  const hook = renderAction(({ failure }) =>
    useCreateProject({
      user: { id: "u1" },
      navigate: doubles.navigate,
      adopt: doubles.api.adopt,
      failure,
    }),
  );
  return { hook, ...doubles };
}

beforeEach(resetShelfFakes);
afterEach(tearDownShelf);

const empty = startingShape([]);
const three = startingShape(["One", "Two", "Three"]);

describe("create", () => {
  it("makes a Drive project, scaffolds, adopts and opens it", async () => {
    createDriveProject.mockResolvedValue(driveRef);
    const { hook, api, navigate } = renderActions();

    await act(async () => {
      await hook.result.current.create({
        title: "New Project",
        destination: "drive",
        folderName: "New Project",
        shape: three,
        structureId: "threeact",
        type: "Novel",
        language: "en",
        goal: 50000,
        genres: ["thriller", "romance"],
        ageCategory: "adult",
        tropes: [],
      });
    });

    expect(createDriveProject).toHaveBeenCalledWith(
      "New Project",
      "projects-root",
    );
    expect(scaffoldProjectMock).toHaveBeenCalledWith(
      driveProviderFake,
      driveRef,
      {
        shape: three,
        document: {
          title: "New Project",
          type: "Novel",
          language: "en",
          goal: 50000,
          genres: ["thriller", "romance"],
          ageCategory: "adult",
          tropes: [],
          structure: "threeact",
        },
      },
      // The create flow threads the job's step reporter, from the catalogue
      // the wizard's bar is drawn from, and the per-file counter.
      expect.any(Function),
      expect.any(Function),
    );
    expect(api.adopt).toHaveBeenCalledWith(driveRef);
    expect(navigate).toHaveBeenCalledWith(projectPath(idFor(driveRef)));
    expect(hook.result.current.creating).toBe(false);
    expect(hook.result.current.progress).toBeNull();
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.busy).toBeNull();
  });

  it("makes a local project into the mapped root, then opens it", async () => {
    createLocalProject.mockResolvedValue(localRef);
    const { hook, api, navigate } = renderActions();

    await act(async () => {
      await hook.result.current.create({
        title: "Project",
        destination: "local",
        folderName: "Project",
        shape: empty,
        structureId: "empty",
        type: "Novel",
        language: "en",
        goal: 50000,
        genres: [],
        ageCategory: null,
        tropes: [],
      });
    });

    expect(createLocalProject).toHaveBeenCalledWith("Project");
    // "empty" persists as null: no structure was chosen.
    expect(scaffoldProjectMock).toHaveBeenCalledWith(
      localProviderFake,
      localRef,
      {
        shape: empty,
        document: {
          title: "Project",
          type: "Novel",
          language: "en",
          goal: 50000,
          genres: [],
          ageCategory: null,
          tropes: [],
          structure: null,
        },
      },
      expect.any(Function),
      expect.any(Function),
    );
    expect(api.adopt).toHaveBeenCalledWith(localRef);
    expect(navigate).toHaveBeenCalledWith(projectPath(idFor(localRef)));
  });

  // The folder is a slug of the title, so the scaffold takes the title
  // itself to name the book, not the folder.
  it("hands the scaffold the title the writer typed, not the folder's name", async () => {
    createLocalProject.mockResolvedValue(localRef);
    const { hook } = renderActions();

    await act(async () => {
      await hook.result.current.create({
        title: "  Once Dark  ",
        destination: "local",
        folderName: "once-dark",
        shape: empty,
        structureId: "empty",
        type: "Novel",
        language: "en",
        goal: 50000,
        genres: [],
        ageCategory: null,
        tropes: [],
      });
    });

    const init = scaffoldProjectMock.mock.calls[0][2] as {
      document: { title: string };
    };
    expect(init.document.title).toBe("Once Dark");
  });

  it("makes a project from a prepared seed, and says whether it did", async () => {
    createDriveProject.mockResolvedValue(driveRef);
    const { hook, api } = renderActions();
    const seed = {
      destination: "drive" as const,
      folderName: "salt",
      init: { shape: three, document: { title: "Salt: A Novel" } },
    };

    let made: boolean | undefined;
    await act(async () => {
      made = await hook.result.current.createFrom(seed);
    });

    expect(made).toBe(true);
    expect(createDriveProject).toHaveBeenCalledWith("salt", "projects-root");
    expect(scaffoldProjectMock.mock.calls[0][2]).toBe(seed.init);
    expect(api.adopt).toHaveBeenCalledWith(driveRef);

    createDriveProject.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      made = await hook.result.current.createFrom(seed);
    });
    expect(made).toBe(false);
    expect(hook.result.current.error).not.toBeNull();
  });

  it("counts the documents written while that segment runs", async () => {
    createLocalProject.mockResolvedValue(localRef);
    let release!: () => void;
    scaffoldProjectMock.mockImplementation(
      async (
        _p,
        _r,
        _init,
        _onStep,
        onFile?: (done: number, total: number) => void,
      ) => {
        onFile?.(3, 80);
        await new Promise<void>((r) => {
          release = r;
        });
      },
    );
    const { hook } = renderActions();
    let flight!: Promise<boolean>;
    act(() => {
      flight = hook.result.current.createFrom({
        destination: "local",
        folderName: "book",
        init: {},
      });
    });
    await waitFor(() =>
      expect(hook.result.current.progress?.detail).toEqual({
        done: 3,
        total: 80,
      }),
    );
    await act(async () => {
      release();
      await flight;
    });
  });

  it("reports the creation step by step through the catalogue", async () => {
    createLocalProject.mockResolvedValue(localRef);
    // The scaffold names its segments after their writes; the work then
    // waits so the test can inspect the face mid-flight.
    let release!: () => void;
    let finish!: () => void;
    scaffoldProjectMock.mockImplementation(
      async (_p, _r, _init, onStep?: (id: string) => void) => {
        onStep?.("documents");
        onStep?.("structure");
        await new Promise<void>((r) => {
          release = r;
        });
        onStep?.("workspace");
        await new Promise<void>((r) => {
          finish = r;
        });
      },
    );
    const { hook } = renderActions();

    // The Library shows the wizard while the dialog-open flag is set; the
    // hook's own `create()` never clears it, because the Library owns the
    // mount.
    await act(async () => {
      hook.result.current.request();
    });
    let finished: Promise<void> | null = null;
    await act(async () => {
      void hook.result.current
        .create({
          title: "Project",
          destination: "local",
          folderName: "Project",
          shape: empty,
          structureId: "empty",
          type: "Novel",
          language: "en",
          goal: 50000,
          genres: [],
          ageCategory: null,
          tropes: [],
        })
        .then(() => {
          finished = Promise.resolve();
        });
      await Promise.resolve();
    });
    // The dialog's face is the catalogue's own progress, mid-job.
    expect(hook.result.current.progress?.index).toBe(
      createStepIndex("structure"),
    );
    expect(hook.result.current.creating).toBe(true);

    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(hook.result.current.progress?.index).toBe(
      createStepIndex("workspace"),
    );

    await act(async () => {
      finish();
      await finished;
    });
    expect(hook.result.current.progress).toBeNull();
    expect(hook.result.current.creating).toBe(false);
  });

  it("refuses a second create while one is in flight — the dialog's held-open double-press guard", async () => {
    createLocalProject.mockResolvedValue(localRef);
    let release!: () => void;
    scaffoldProjectMock.mockImplementation(
      async () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    const { hook, api, navigate } = renderActions();
    const request: CreateRequest = {
      title: "Project",
      destination: "local",
      folderName: "Project",
      shape: empty,
      structureId: "empty",
      type: "Novel",
      language: "en",
      goal: 50000,
      genres: [],
      ageCategory: null,
      tropes: [],
    };

    await act(async () => {
      hook.result.current.request();
    });

    let first: Promise<void> | null = null;
    await act(async () => {
      void hook.result.current.create(request).then(() => {
        first = Promise.resolve();
      });
      await Promise.resolve();
    });
    // A second press while the first job is still working is refused.
    await act(async () => {
      await hook.result.current.create(request);
    });
    expect(scaffoldProjectMock).toHaveBeenCalledTimes(1);
    expect(hook.result.current.progress?.index).toBe(
      createStepIndex("documents"),
    );

    await act(async () => {
      release();
      await first;
    });
    expect(api.adopt).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("surfaces the no-root error when no local folder is mapped", async () => {
    createLocalProject.mockRejectedValue(
      new StorageError("no root", "not-found", "storage.localRootRequired"),
    );
    const { hook, api, navigate } = renderActions();

    await act(async () => {
      hook.result.current.request();
    });
    await act(async () => {
      await hook.result.current.create({
        title: "Project",
        destination: "local",
        folderName: "Project",
        shape: empty,
        structureId: "empty",
        type: "Novel",
        language: "en",
        goal: 50000,
        genres: [],
        ageCategory: null,
        tropes: [],
      });
    });

    expect(scaffoldProjectMock).not.toHaveBeenCalled();
    expect(api.adopt).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    // The wizard stays open and the error shows in the dialog's own line,
    // not in the shelf banner behind the open modal.
    expect(hook.result.current.progress).toBeNull();
    expect(hook.result.current.creating).toBe(true);
    expect(hook.result.current.error).toBe("storage.localRootRequired");
    expect(hook.result.current.shelfError).toBeNull();
  });

  it("surfaces a StorageError instead of failing obscurely", async () => {
    createDriveProject.mockRejectedValue(new StorageError("quota gone", "io"));
    const { hook, api, navigate } = renderActions();

    await act(async () => {
      hook.result.current.request();
    });
    await act(async () => {
      await hook.result.current.create({
        title: "New Project",
        destination: "drive",
        folderName: "New Project",
        shape: empty,
        structureId: "empty",
        type: "Novel",
        language: "en",
        goal: 50000,
        genres: [],
        ageCategory: null,
        tropes: [],
      });
    });

    expect(hook.result.current.error).toBe("storage.io");
    expect(hook.result.current.creating).toBe(true);
    expect(api.adopt).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("answers with the create voice for a non-storage failure", async () => {
    createDriveProject.mockRejectedValue(new TypeError("quota gone"));
    const { hook } = renderActions();

    await act(async () => {
      await hook.result.current.create({
        title: "New Project",
        destination: "drive",
        folderName: "New Project",
        shape: empty,
        structureId: "empty",
        type: "Novel",
        language: "en",
        goal: 50000,
        genres: [],
        ageCategory: null,
        tropes: [],
      });
    });

    // The fallback is creation copy, never the library's "could not be
    // opened".
    expect(hook.result.current.error).toBe("create.failed");
  });
});
