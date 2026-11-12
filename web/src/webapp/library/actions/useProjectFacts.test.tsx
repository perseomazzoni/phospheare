// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { addToLibrary, libraryRows } from "../../../profile/profileSync";
import type { ProjectRef } from "../../../storage/types";
import type { ProjectFacts } from "../../../project/facts";
import {
  card,
  disposeStorage,
  driveProviderFake,
  driveRef,
  openProjectStorageMock,
  readProjectFactsMock,
  ref,
  renderAction,
  resetShelfFakes,
  saveProjectFactsMock,
  shelfDoubles,
  tearDownShelf,
  uuidOf,
  workingCopy,
} from "./shelfActions.fixture";
import { useProjectFacts } from "./useProjectFacts";

vi.mock(
  "react-i18next",
  async () => (await import("./shelfActions.fixture")).mocks.i18n,
);
vi.mock(
  "../../../storage",
  async () => (await import("./shelfActions.fixture")).mocks.storage,
);
vi.mock(
  "../../../project/editFacts",
  async () => (await import("./shelfActions.fixture")).mocks.editFacts,
);
vi.mock(
  "../../../project/projectStorage",
  async () => (await import("./shelfActions.fixture")).mocks.projectStorage,
);

function renderActions() {
  const doubles = shelfDoubles();
  const hook = renderAction(({ failure }) =>
    useProjectFacts({
      user: { id: "u1" },
      revalidate: doubles.api.revalidate,
      toasts: doubles.toasts,
      failure,
    }),
  );
  return { hook, ...doubles };
}

beforeEach(resetShelfFakes);
afterEach(tearDownShelf);

// The rename lives in the Properties window: the title is one of the
// book's facts, and the same write carries it. These rows pin that the folder
// follows on Drive, the mirror row moves first, and Undo reverts the whole
// write.
const facts = (title: string): ProjectFacts => ({
  title,
  author: "",
  type: "Novel",
  goal: 80000,
  language: "en",
  structure: null,
  genres: [],
  ageCategory: null,
  tropes: [],
});

describe("the Properties window", () => {
  it("reads the book through its working copy when the window opens", async () => {
    readProjectFactsMock.mockResolvedValueOnce(facts("Old Title"));
    const source = card({ ref: driveRef, id: "doc-1" });
    const { hook } = renderActions();

    await act(async () => {
      await hook.result.current.open(source);
    });

    expect(openProjectStorageMock).toHaveBeenCalledWith(driveRef, "doc-1");
    expect(readProjectFactsMock).toHaveBeenCalledWith(workingCopy, driveRef);
    expect(hook.result.current.editing).toEqual({
      card: source,
      facts: facts("Old Title"),
      failed: false,
      saving: false,
      error: null,
    });
    expect(disposeStorage).toHaveBeenCalled();
  });

  it("says the window could not read a book whose file is unreadable", async () => {
    readProjectFactsMock.mockRejectedValueOnce(new Error("facts-unreadable"));
    const source = card({ ref: driveRef, id: "doc-1" });
    const { hook } = renderActions();

    await act(async () => {
      await hook.result.current.open(source);
    });

    expect(hook.result.current.editing).toEqual({
      card: source,
      facts: null,
      failed: true,
      saving: false,
      error: null,
    });
    expect(disposeStorage).toHaveBeenCalled();
  });

  it("says the same when there is no storage to read the book through", async () => {
    openProjectStorageMock.mockRejectedValueOnce(new Error("no cache"));
    const { hook } = renderActions();

    await act(async () => {
      await hook.result.current.open(card({ ref: driveRef, id: "doc-1" }));
    });

    expect(readProjectFactsMock).not.toHaveBeenCalled();
    expect(hook.result.current.editing?.failed).toBe(true);
  });

  it("cannot read a card the shelf has no id for", async () => {
    const { hook } = renderActions();

    await act(async () => {
      await hook.result.current.open(card({ ref: driveRef, id: null }));
    });

    expect(openProjectStorageMock).not.toHaveBeenCalled();
    expect(hook.result.current.editing?.failed).toBe(true);
  });

  // A read that answers after its window closed, or moved to another card,
  // does not paint its book's facts into what is open now.
  it("drops a read that answers after the window moved on", async () => {
    let answerA: (value: ProjectFacts) => void = () => {};
    readProjectFactsMock
      .mockImplementationOnce(
        () => new Promise<ProjectFacts>((resolve) => (answerA = resolve)),
      )
      .mockResolvedValueOnce(facts("Book B"));
    const a = card({ ref: driveRef, id: "doc-a" });
    const b = card({ ref: driveRef, id: "doc-b" });
    const { hook } = renderActions();

    let readingA: Promise<void> = Promise.resolve();
    await act(async () => {
      readingA = hook.result.current.open(a);
      await hook.result.current.open(b);
    });
    await act(async () => {
      answerA(facts("Book A"));
      await readingA;
    });

    expect(hook.result.current.editing?.card).toBe(b);
    expect(hook.result.current.editing?.facts).toEqual(facts("Book B"));
  });

  it("stays closed when a read answers after the window was closed", async () => {
    let answer: (value: ProjectFacts) => void = () => {};
    readProjectFactsMock.mockImplementationOnce(
      () => new Promise<ProjectFacts>((resolve) => (answer = resolve)),
    );
    const { hook } = renderActions();

    let reading: Promise<void> = Promise.resolve();
    await act(async () => {
      reading = hook.result.current.open(card({ ref: driveRef, id: "doc-1" }));
      hook.result.current.close();
    });
    await act(async () => {
      answer(facts("Late"));
      await reading;
    });

    expect(hook.result.current.editing).toBeNull();
  });

  it("writes nothing when the window is saved unchanged", async () => {
    const source = card({ ref: driveRef, id: "doc-1" });
    const { hook, toasts } = renderActions();

    await act(async () => {
      await hook.result.current.save(
        source,
        facts("Old Title"),
        facts("Old Title"),
      );
    });

    expect(saveProjectFactsMock).not.toHaveBeenCalled();
    expect(toasts.post).not.toHaveBeenCalled();
    expect(hook.result.current.editing).toBeNull();
  });

  it("saves through the working copy, revalidates, and offers undo of the whole thing", async () => {
    const renamed = ref("drive", "d1", "New Title");
    const back = ref("drive", "d1", "Old Title");
    saveProjectFactsMock
      .mockResolvedValueOnce(renamed)
      .mockResolvedValueOnce(back);
    const source = card({
      ref: driveRef,
      id: "doc-1",
      content: {
        id: "doc-1",
        title: "Old Title",
        type: "novel",
        words: 100,
        parts: 1,
        sections: 1,
        goal: null,
        perNode: [],
        structure: { version: 1, children: [] },
        updatedAt: "2026-07-28T10:00:00.000Z",
        cachedAt: "2026-07-28T10:00:00.000Z",
      },
    });
    const { hook, api, toasts } = renderActions();

    await act(async () => {
      await hook.result.current.save(
        source,
        facts("Old Title"),
        facts("New Title"),
      );
    });

    // Through the working copy for the file, the bare provider for the folder.
    expect(saveProjectFactsMock).toHaveBeenNthCalledWith(
      1,
      workingCopy,
      driveProviderFake,
      driveRef,
      facts("New Title"),
      "Old Title",
    );
    expect(api.revalidate).toHaveBeenCalledWith(renamed, workingCopy);
    expect(hook.result.current.editing).toBeNull();
    expect(disposeStorage).toHaveBeenCalled();
    expect(toasts.post.mock.calls[0][0]).toBe("library.propertiesSaved");
    const undo = toasts.post.mock.calls[0][1] as () => void;
    expect(typeof undo).toBe("function");

    act(() => undo());
    await waitFor(() =>
      expect(api.revalidate).toHaveBeenLastCalledWith(back, workingCopy),
    );
    expect(saveProjectFactsMock).toHaveBeenNthCalledWith(
      2,
      workingCopy,
      driveProviderFake,
      renamed,
      facts("Old Title"),
      "New Title",
    );

    // Once it has put the facts back, the toast's Undo has nothing of its own
    // left to undo.
    act(() => undo());
    await act(async () => {});
    expect(saveProjectFactsMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the window open, busy, until the write lands", async () => {
    readProjectFactsMock.mockResolvedValueOnce(facts("Old Title"));
    let land: (value: ProjectRef) => void = () => {};
    saveProjectFactsMock.mockImplementationOnce(
      () => new Promise<ProjectRef>((resolve) => (land = resolve)),
    );
    const source = card({ ref: driveRef, id: "doc-1" });
    const { hook, toasts } = renderActions();
    await act(async () => {
      await hook.result.current.open(source);
    });

    let saving: Promise<void> = Promise.resolve();
    await act(async () => {
      saving = hook.result.current.save(
        source,
        facts("Old Title"),
        facts("New Title"),
      );
    });
    expect(hook.result.current.editing?.saving).toBe(true);
    expect(toasts.post).not.toHaveBeenCalled();

    await act(async () => {
      land(driveRef);
      await saving;
    });
    expect(hook.result.current.editing).toBeNull();
    expect(toasts.post).toHaveBeenCalledOnce();
  });

  it("says a failed save inside the window, and posts nothing", async () => {
    readProjectFactsMock.mockResolvedValueOnce(facts("Old Title"));
    saveProjectFactsMock.mockRejectedValueOnce(new Error("drive said no"));
    const source = card({ ref: driveRef, id: "doc-1" });
    const { hook, toasts } = renderActions();
    await act(async () => {
      await hook.result.current.open(source);
    });

    await act(async () => {
      await hook.result.current.save(
        source,
        facts("Old Title"),
        facts("New Title"),
      );
    });

    const open = hook.result.current.editing;
    expect(open?.card).toBe(source);
    expect(open?.facts).toEqual(facts("Old Title"));
    expect(open?.saving).toBe(false);
    expect(open?.error).toBe("library.openFailed");
    expect(toasts.post).not.toHaveBeenCalled();
    // The storage it opened to write through is released all the same.
    expect(disposeStorage).toHaveBeenCalled();
  });

  it("says so when there is no storage to write through", async () => {
    const source = card({ ref: driveRef, id: null });
    const { hook, toasts } = renderActions();
    await act(async () => {
      await hook.result.current.open(source);
    });

    await act(async () => {
      await hook.result.current.save(
        source,
        facts("Old Title"),
        facts("New Title"),
      );
    });

    expect(saveProjectFactsMock).not.toHaveBeenCalled();
    expect(hook.result.current.editing?.error).toBe("library.openFailed");
    expect(toasts.post).not.toHaveBeenCalled();
  });

  it("an Undo that fails says so", async () => {
    saveProjectFactsMock
      .mockResolvedValueOnce(driveRef)
      .mockRejectedValueOnce(new Error("drive said no"));
    const source = card({ ref: driveRef, id: "doc-1" });
    const { hook, toasts } = renderActions();

    await act(async () => {
      await hook.result.current.save(
        source,
        facts("Old Title"),
        facts("New Title"),
      );
    });
    const undo = toasts.post.mock.calls[0][1] as () => void;
    act(() => undo());

    await waitFor(() =>
      expect(hook.result.current.shelfError).toBe("library.openFailed"),
    );
  });

  // Two saves of one book, two toasts. The older toast's Undo would put back
  // facts from two writes ago, at a ref that may not name the folder now.
  it("an older toast's Undo does nothing once the book was saved again", async () => {
    saveProjectFactsMock.mockResolvedValue(driveRef);
    const source = card({ ref: driveRef, id: "doc-1" });
    const { hook, toasts } = renderActions();

    await act(async () => {
      await hook.result.current.save(source, facts("First"), facts("Second"));
    });
    await act(async () => {
      await hook.result.current.save(source, facts("Second"), facts("Third"));
    });
    // The older toast is taken down, so no Undo that does nothing stays on
    // screen; a press that races the dismissal still writes nothing.
    expect(toasts.dismiss).toHaveBeenCalledWith(1);
    const firstUndo = toasts.post.mock.calls[0][1] as () => void;
    act(() => firstUndo());
    await act(async () => {});

    expect(saveProjectFactsMock).toHaveBeenCalledTimes(2);
  });

  it("takes down no other book's toast", async () => {
    saveProjectFactsMock.mockResolvedValue(driveRef);
    const { hook, toasts } = renderActions();

    await act(async () => {
      await hook.result.current.save(
        card({ ref: driveRef, id: "doc-a" }),
        facts("A"),
        facts("A2"),
      );
    });
    await act(async () => {
      await hook.result.current.save(
        card({ ref: driveRef, id: "doc-b" }),
        facts("B"),
        facts("B2"),
      );
    });

    expect(toasts.dismiss).not.toHaveBeenCalled();
  });

  // A window reopened on the book holds the facts the Undo replaces, and its
  // next Save would write them back silently. The Undo closes it.
  it("an Undo closes a window reopened on the same book", async () => {
    saveProjectFactsMock.mockResolvedValue(driveRef);
    readProjectFactsMock.mockResolvedValue(facts("New Title"));
    const source = card({ ref: driveRef, id: "doc-1" });
    const { hook, toasts } = renderActions();

    await act(async () => {
      await hook.result.current.save(
        source,
        facts("Old Title"),
        facts("New Title"),
      );
    });
    await act(async () => {
      await hook.result.current.open(source);
    });
    expect(hook.result.current.editing?.facts).toEqual(facts("New Title"));

    const undo = toasts.post.mock.calls[0][1] as () => void;
    act(() => undo());

    expect(hook.result.current.editing).toBeNull();
  });

  it("an Undo leaves another book's window open", async () => {
    saveProjectFactsMock.mockResolvedValue(driveRef);
    readProjectFactsMock.mockResolvedValue(facts("Other"));
    const { hook, toasts } = renderActions();

    await act(async () => {
      await hook.result.current.save(
        card({ ref: driveRef, id: "doc-1" }),
        facts("Old Title"),
        facts("New Title"),
      );
    });
    await act(async () => {
      await hook.result.current.open(card({ ref: driveRef, id: "doc-2" }));
    });

    const undo = toasts.post.mock.calls[0][1] as () => void;
    act(() => undo());

    expect(hook.result.current.editing?.facts).toEqual(facts("Other"));
  });

  it("a Drive rename updates the row's name before the content push", async () => {
    // A row describing the old folder name.
    addToLibrary("u1", {
      id: uuidOf("doc-1"),
      provider: "drive",
      key: "d1",
      name: "New Project",
    });
    const renamed = ref("drive", "d1", "Renamed Folder");
    saveProjectFactsMock.mockResolvedValueOnce(renamed);
    const source = card({
      ref: driveRef,
      id: "doc-1",
      content: {
        id: "doc-1",
        title: "Old Title",
        type: "novel",
        words: 100,
        parts: 1,
        sections: 1,
        goal: null,
        perNode: [],
        structure: { version: 1, children: [] },
        updatedAt: "2026-07-28T10:00:00.000Z",
        cachedAt: "2026-07-28T10:00:00.000Z",
      },
    });
    const { hook } = renderActions();

    await act(async () => {
      await hook.result.current.save(
        source,
        facts("Old Title"),
        facts("New Title"),
      );
    });

    // The row carries the new folder name, so the revalidate's content push,
    // which reads the row, carries it too.
    expect(libraryRows("u1")[0].name).toBe("Renamed Folder");
  });
});
