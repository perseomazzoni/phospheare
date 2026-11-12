// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import NotesPanel from "./NotesPanel";
import { formatWhen } from "./datetime";
import type { ReferenceEditSession } from "../reference/ReferenceReader";
import type { DirEntry, ProjectRef, StorageProvider } from "../../storage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Three notes, each modified on its own day. */
function datedProvider(): StorageProvider {
  const at: Record<string, string> = {
    "notes--alpha.md": "2026-10-08T08:03:00.000Z",
    "notes--bravo.md": "2026-10-10T21:40:00.000Z",
    "notes--charlie.md": "2026-10-09T10:12:00.000Z",
  };
  return {
    ...providerWith(Object.keys(at)),
    statFile: async (_ref: ProjectRef, path: string) => ({
      updatedAt: at[path.slice("/reference/".length)],
    }),
  } as unknown as StorageProvider;
}

const titles = () =>
  [...document.querySelectorAll(".snap-title")].map((el) => el.textContent);

const REF: ProjectRef = {
  providerId: "memory",
  key: "demo",
  name: "Demo",
  openedAt: "",
};

function providerWith(names: string[]): StorageProvider {
  return {
    listDir: async (): Promise<DirEntry[]> =>
      names.map((name) => ({
        path: `/reference/${name}`,
        name,
        kind: "file" as const,
      })),
    readFile: async () => "# note\n",
    // The write seam probes before it creates.
    exists: async (_ref: ProjectRef, path: string) =>
      names.includes(path.slice("/reference/".length)),
    writeFile: vi.fn(async () => undefined),
    renameFile: vi.fn(async () => undefined),
  } as unknown as StorageProvider;
}

const baseProps = {
  projectRef: REF,
  reference: null,
  editing: null,
  onStartEdit: vi.fn(),
  onDraft: vi.fn(),
  onCancelEdit: vi.fn(),
  onSaveEdit: vi.fn(async () => true),
  onOpen: vi.fn(),
};

/**
 * The shell owns the edit session; a test that must save through the reader
 * (the row whose date must move after a save) needs the minimal stateful
 * version of that contract.
 */
function NotesHarness({
  provider,
  onSaveEdit,
}: {
  provider: StorageProvider;
  onSaveEdit: () => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<ReferenceEditSession | null>(null);
  return (
    <NotesPanel
      provider={provider}
      projectRef={REF}
      reference="notes--alpha.md"
      editing={editing}
      onStartEdit={(fileName, text) =>
        setEditing({ fileName, savedText: text, draft: text })
      }
      onDraft={(draft) => setEditing((e) => (e ? { ...e, draft } : e))}
      onCancelEdit={() => setEditing(null)}
      onSaveEdit={onSaveEdit}
      onOpen={vi.fn()}
      onDeleted={vi.fn()}
    />
  );
}

describe("NotesPanel", () => {
  it("keeps the notes in the order of their names as a table", async () => {
    render(<NotesPanel provider={datedProvider()} {...baseProps} />);
    await waitFor(() =>
      expect(document.querySelectorAll(".snap-when").length).toBe(3),
    );
    expect(titles()).toEqual(["alpha", "bravo", "charlie"]);
    expect(
      (document.querySelector(".snap-table") as HTMLElement).style.height,
    ).toBe("38%");
  });

  it("lists notes and opens one", async () => {
    const onOpen = vi.fn();
    render(
      <NotesPanel
        provider={providerWith(["notes--alpha.md"])}
        {...baseProps}
        onOpen={onOpen}
      />,
    );
    await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());
    fireEvent.click(screen.getByText("alpha"));
    expect(onOpen).toHaveBeenCalledWith("notes--alpha.md");
  });

  it("bars a note from the assistant and lets it back in", async () => {
    // Same control as the reference rows wear, same project-level rule: a
    // note the writer keeps from the assistant stays kept in every chat,
    // including ones opened later. The barred state is lit at rest, because
    // a privacy rule that has to be hovered to be seen is one that is not.
    const onBarSource = vi.fn();
    const { rerender } = render(
      <NotesPanel
        provider={providerWith(["notes--alpha.md"])}
        {...baseProps}
        barredSourceIds={[]}
        onBarSource={onBarSource}
      />,
    );
    const toggle = await waitFor(() => {
      const found = document.querySelector(".ref-row-ai");
      if (!found) throw new Error("no toggle");
      return found as HTMLElement;
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(onBarSource).toHaveBeenCalledWith("reference:notes--alpha.md", true);

    rerender(
      <NotesPanel
        provider={providerWith(["notes--alpha.md"])}
        {...baseProps}
        barredSourceIds={["reference:notes--alpha.md"]}
        onBarSource={onBarSource}
      />,
    );
    await waitFor(() =>
      expect(
        document.querySelector(".ref-row-ai")?.classList.contains("barred"),
      ).toBe(true),
    );
    fireEvent.click(document.querySelector(".ref-row-ai") as HTMLElement);
    expect(onBarSource).toHaveBeenCalledWith(
      "reference:notes--alpha.md",
      false,
    );
  });

  it("renames a note, and the open note follows it", async () => {
    // A note's title is its file name — the folder is the record — so renaming
    // one renames the file. The reader follows, because the name it was
    // showing is gone, and leaving it pointed there would read as a note
    // that vanished.
    const provider = providerWith(["notes--alpha.md"]);
    const onOpen = vi.fn();
    render(
      <NotesPanel
        provider={provider}
        {...baseProps}
        reference="notes--alpha.md"
        onOpen={onOpen}
      />,
    );
    await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("reference.rename"));
    const field = await screen.findByLabelText("reference.namePlaceholder");
    // The field starts from the name it is changing, not blank: a rename that
    // asked the writer to retype the whole title would not be a rename.
    expect((field as HTMLInputElement).value).toBe("alpha");
    fireEvent.change(field, { target: { value: "beta" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() =>
      expect(provider.renameFile).toHaveBeenCalledWith(
        REF,
        "/reference/notes--alpha.md",
        "notes--beta.md",
      ),
    );
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("notes--beta.md"));
  });

  it("says so when a rename is refused, instead of closing on nothing", async () => {
    const provider = providerWith(["notes--alpha.md", "notes--beta.md"]);
    render(<NotesPanel provider={provider} {...baseProps} />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());
    fireEvent.click(screen.getAllByLabelText("reference.rename")[0]);
    const field = await screen.findByLabelText("reference.namePlaceholder");
    // A name already taken is refused by the field itself, before the port is
    // ever asked — the taken set spans the whole reference folder.
    fireEvent.change(field, { target: { value: "beta" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(provider.renameFile).not.toHaveBeenCalled();
    expect(screen.getByLabelText("reference.namePlaceholder")).toBeTruthy();
  });

  // The edit session holds the draft under the note's name. A rename or a
  // delete under it leaves the save writing to the old name, which forks the
  // note, so neither is offered until the edit ends.
  it("offers no rename or delete on the note being edited", async () => {
    render(
      <NotesPanel
        provider={providerWith(["notes--alpha.md", "notes--bravo.md"])}
        {...baseProps}
        reference="notes--alpha.md"
        editing={{
          fileName: "notes--alpha.md",
          savedText: "a",
          draft: "b",
        }}
      />,
    );
    await waitFor(() => expect(titles()).toEqual(["alpha", "bravo"]));
    // Only bravo's row carries the two verbs.
    expect(screen.getAllByLabelText("reference.rename")).toHaveLength(1);
    expect(screen.getAllByLabelText("reference.delete")).toHaveLength(1);
    const alphaRow = [...document.querySelectorAll(".snap-title")]
      .find((el) => el.textContent === "alpha")
      ?.closest(".snap-row");
    expect(alphaRow).toBeTruthy();
    expect(
      alphaRow?.querySelector('[aria-label="reference.rename"]'),
    ).toBeNull();
    expect(
      alphaRow?.querySelector('[aria-label="reference.delete"]'),
    ).toBeNull();
  });

  it("adds a note", async () => {
    const writeFile = vi.fn(async () => undefined);
    const provider = {
      listDir: async (): Promise<DirEntry[]> => [],
      readFile: async () => "# note\n",
      exists: async () => false,
      writeFile,
    } as unknown as StorageProvider;
    render(<NotesPanel provider={provider} {...baseProps} />);
    await waitFor(() =>
      expect(screen.getByLabelText("reference.addNewNote")).toBeTruthy(),
    );
    const addBtn = screen.getByLabelText("reference.addNewNote");
    fireEvent.click(addBtn);
    const input = screen.getByLabelText("reference.namePlaceholder");
    fireEvent.change(input, { target: { value: "new note" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(writeFile).toHaveBeenCalled());
  });

  // A failed note creation keeps the field open for the retry and speaks the
  // failure, and the retry works: this row presses Enter a second time and
  // asserts the write lands.
  it("keeps the field open on failure, speaks, and lands on the retry", async () => {
    const writeFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);
    const provider = {
      listDir: async (): Promise<DirEntry[]> => [],
      readFile: async () => "# note\n",
      exists: async () => false,
      writeFile,
    } as unknown as StorageProvider;
    render(<NotesPanel provider={provider} {...baseProps} />);
    await waitFor(() =>
      expect(screen.getByLabelText("reference.addNewNote")).toBeTruthy(),
    );
    fireEvent.click(screen.getByLabelText("reference.addNewNote"));
    const input = screen.getByLabelText("reference.namePlaceholder");
    fireEvent.change(input, { target: { value: "new note" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByText("reference.createFailed")).toBeTruthy(),
    );
    // The field is still there to try again in — and the retry commits.
    fireEvent.keyDown(screen.getByLabelText("reference.namePlaceholder"), {
      key: "Enter",
    });
    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(2));
    // Success closes the field; the session opens on the created note.
    await waitFor(() =>
      expect(screen.queryByLabelText("reference.namePlaceholder")).toBeNull(),
    );
    expect(baseProps.onStartEdit).toHaveBeenCalledWith(
      "notes--new note.md",
      "",
    );
  });

  // The failure line belongs to the field, not to the panel: Escape takes
  // both away.
  it("dismisses the failure with the field on Escape", async () => {
    const provider = {
      listDir: async (): Promise<DirEntry[]> => [],
      readFile: async () => "# note\n",
      exists: async () => false,
      writeFile: vi.fn(async () => {
        throw new Error("disk full");
      }),
    } as unknown as StorageProvider;
    render(<NotesPanel provider={provider} {...baseProps} />);
    await waitFor(() =>
      expect(screen.getByLabelText("reference.addNewNote")).toBeTruthy(),
    );
    fireEvent.click(screen.getByLabelText("reference.addNewNote"));
    const input = screen.getByLabelText("reference.namePlaceholder");
    fireEvent.change(input, { target: { value: "new note" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByText("reference.createFailed")).toBeTruthy(),
    );
    fireEvent.keyDown(screen.getByLabelText("reference.namePlaceholder"), {
      key: "Escape",
    });
    expect(screen.queryByText("reference.createFailed")).toBeNull();
    expect(screen.queryByLabelText("reference.namePlaceholder")).toBeNull();
  });

  it("an empty notes list says so — never 'nothing here matches'", async () => {
    render(<NotesPanel provider={providerWith([])} {...baseProps} />);
    await waitFor(() =>
      expect(screen.getByText("reference.emptyNotes")).toBeTruthy(),
    );
    // The notes face has its own empty statement; it must not borrow the
    // search's or a card's.
    expect(screen.queryByText("tree.findCount_zero")).toBeNull();
    expect(screen.queryByText("reference.emptyGroup")).toBeNull();
  });

  it("a name that already exists under any group is refused, with the folder-wide duplicate copy", async () => {
    const writeFile = vi.fn(async () => undefined);
    const provider = {
      listDir: async (): Promise<DirEntry[]> => [
        {
          path: "/reference/notes--alpha.md",
          name: "notes--alpha.md",
          kind: "file" as const,
        },
      ],
      readFile: async () => "# note\n",
      writeFile,
    } as unknown as StorageProvider;
    render(<NotesPanel provider={provider} {...baseProps} />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("reference.addNewNote"));
    const input = screen.getByLabelText("reference.namePlaceholder");
    fireEvent.change(input, { target: { value: "alpha" } });
    await waitFor(() =>
      expect(
        screen.getByText("reference.duplicate", {
          exact: false,
        }),
      ).toBeTruthy(),
    );
    // The duplicate is about the file, not the group — the plural-group
    // template must not be used here.
    expect(screen.queryByText("name.duplicate")).toBeNull();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("bins a note after the confirm and reports the deletion up", async () => {
    // A note is the writer's own work, so it goes to the recycle bin rather
    // than being removed — the same net a removed chapter has. The one bin:
    // `/recyclebin`, beside the manuscript files already there.
    const moveFile = vi.fn(async () => undefined);
    const onDeleted = vi.fn();
    const provider = {
      listDir: async (): Promise<DirEntry[]> => [
        {
          path: "/reference/notes--alpha.md",
          name: "notes--alpha.md",
          kind: "file" as const,
        },
      ],
      readFile: async () => "# note\n",
      writeFile: vi.fn(async () => undefined),
      removeFile: vi.fn(async () => undefined),
      moveFile,
    } as unknown as StorageProvider;
    render(
      <NotesPanel
        provider={provider}
        {...baseProps}
        reference="notes--alpha.md"
        onDeleted={onDeleted}
      />,
    );
    await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("reference.delete"));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(confirm.querySelector("button:last-child") as HTMLElement);
    await waitFor(() =>
      expect(moveFile).toHaveBeenCalledWith(
        REF,
        "/reference/notes--alpha.md",
        "/recyclebin",
      ),
    );
    await waitFor(() =>
      expect(onDeleted).toHaveBeenCalledWith("notes--alpha.md"),
    );
  });

  it("says so when the delete is refused, instead of swallowing it", async () => {
    // A refused delete is said, never swallowed: on a project whose bytes
    // commit over the network, a note left in the list with nothing said
    // leaves the writer guessing whether the delete happened.
    const onDeleted = vi.fn();
    const provider = {
      listDir: async (): Promise<DirEntry[]> => [
        {
          path: "/reference/notes--alpha.md",
          name: "notes--alpha.md",
          kind: "file" as const,
        },
      ],
      readFile: async () => "# note\n",
      writeFile: vi.fn(async () => undefined),
      removeFile: vi.fn(async () => undefined),
      moveFile: vi.fn(async () => {
        throw new Error("offline");
      }),
    } as unknown as StorageProvider;
    render(
      <NotesPanel
        provider={provider}
        {...baseProps}
        reference="notes--alpha.md"
        onDeleted={onDeleted}
      />,
    );
    await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("reference.delete"));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(confirm.querySelector("button:last-child") as HTMLElement);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "reference.deleteFailed",
      ),
    );
    // And the note is still there, because it is: reporting it gone would
    // mislead in the other direction.
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("the divider steps with the keyboard, clamped to the contract's bounds", async () => {
    render(
      <NotesPanel
        provider={providerWith(["notes--alpha.md"])}
        {...baseProps}
      />,
    );
    await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());
    const divider = screen.getByRole("separator");
    expect(divider).toBeTruthy();
    // The top panel's height is the split fraction in percent — Home floors
    // at 20%, End caps at 60%.
    fireEvent.keyDown(divider, { key: "Home" });
    expect(
      (
        divider
          .closest(".dock-face")
          ?.querySelector(".snap-table") as HTMLElement
      ).style.height,
    ).toBe("20%");
    fireEvent.keyDown(divider, { key: "End" });
    expect(
      (
        divider
          .closest(".dock-face")
          ?.querySelector(".snap-table") as HTMLElement
      ).style.height,
    ).toBe("60%");
    // ArrowUp shrinks the top by one key step.
    fireEvent.keyDown(divider, { key: "ArrowUp" });
    expect(
      (
        divider
          .closest(".dock-face")
          ?.querySelector(".snap-table") as HTMLElement
      ).style.height,
    ).toBe("56%");
  });

  it("renders the note's datetime from provider.statFile when it is available", async () => {
    // The formatter's output must not depend on the ambient locale or
    // timezone (a Swedish-locale machine renders dates with dashes). A fixed
    // shape keeps the pin locale-proof.
    vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (
      this: Date,
    ) {
      return this.toISOString().slice(0, 10);
    });
    const provider = {
      listDir: async (): Promise<DirEntry[]> => [
        {
          path: "/reference/notes--alpha.md",
          name: "notes--alpha.md",
          kind: "file" as const,
        },
      ],
      readFile: async () => "# note\n",
      writeFile: vi.fn(async () => undefined),
      statFile: async () => ({
        updatedAt: "2026-01-02T03:04:00.000Z",
      }),
    } as unknown as StorageProvider;
    render(<NotesPanel provider={provider} {...baseProps} />);
    // The when-cell renders the note's date as the list writes it, never
    // the raw ISO string.
    await waitFor(() =>
      expect(document.querySelector(".snap-when")?.textContent).toBe(
        formatWhen("2026-01-02T03:04:00.000Z", "en"),
      ),
    );
  });

  it("refetches a note's datetime after a successful save", async () => {
    vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (
      this: Date,
    ) {
      return this.toISOString().slice(0, 10);
    });
    let updatedAt = "2026-01-02T03:04:00.000Z";
    const statFile = vi.fn(async () => ({ updatedAt }));
    const provider = {
      listDir: async (): Promise<DirEntry[]> => [
        {
          path: "/reference/notes--alpha.md",
          name: "notes--alpha.md",
          kind: "file" as const,
        },
      ],
      readFile: async () => "# note\n",
      writeFile: vi.fn(async () => undefined),
      statFile,
    } as unknown as StorageProvider;
    // The save rewrites the file: `updatedAt` moves, and the list itself is
    // unchanged, so only a refetch keeps the row from going stale.
    const onSaveEdit = vi.fn(async () => {
      updatedAt = "2026-01-03T04:05:00.000Z";
      return true;
    });
    render(<NotesHarness provider={provider} onSaveEdit={onSaveEdit} />);
    await waitFor(() =>
      expect(document.querySelector(".snap-when")?.textContent).toBe(
        formatWhen("2026-01-02T03:04:00.000Z", "en"),
      ),
    );
    fireEvent.click(screen.getByText("dock.edit"));
    fireEvent.click(screen.getByText("dock.save"));
    await waitFor(() => expect(onSaveEdit).toHaveBeenCalled());
    // The row's stamp follows the edit — the successful save bumped the tick
    // that refetches the stat map.
    await waitFor(() =>
      expect(document.querySelector(".snap-when")?.textContent).toBe(
        formatWhen("2026-01-03T04:05:00.000Z", "en"),
      ),
    );
  });
});
