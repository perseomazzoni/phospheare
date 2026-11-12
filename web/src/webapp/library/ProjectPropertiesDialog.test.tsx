// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ProjectPropertiesDialog from "./ProjectPropertiesDialog";
import type { ProjectFacts } from "../../project/facts";
import { OTHER_DOCUMENT_TYPE } from "../../project/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The Properties window shows every fact the wizard asked, on one page,
// filled from the book. It holds the answers until Save, and Cancel
// writes nothing. Save receives the facts as the file stores them: the custom
// text for Other, never the word; null for "No structure". The goal never
// follows the type here, because the stored goal is already the writer's.

const stored: ProjectFacts = {
  title: "Once Dark",
  author: "M. Rossi",
  type: "Novel",
  goal: 80000,
  language: "en",
  structure: "threeact",
  genres: ["horror"],
  ageCategory: "adult",
  tropes: ["found family"],
};

const setup = (
  over: Partial<Parameters<typeof ProjectPropertiesDialog>[0]> = {},
) => {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <ProjectPropertiesDialog
      facts={stored}
      failed={false}
      saving={false}
      saveError={null}
      folderFollowsTitle={false}
      folder="once-dark"
      taken={new Set()}
      onSave={onSave}
      onCancel={onCancel}
      {...over}
    />,
  );
  return { onSave, onCancel, view };
};

const field = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement & HTMLSelectElement;
const save = () =>
  screen.getByText("library.propertiesSave") as HTMLButtonElement;

describe("the Properties window", () => {
  it("opens on what the book says", () => {
    setup();
    expect(field("library.titleLabel").value).toBe("Once Dark");
    expect(field("create.authorLabel").value).toBe("M. Rossi");
    expect(field("create.typeLabel").value).toBe("Novel");
    expect(field("create.goalLabel").value).toBe("80000");
    expect(field("create.languageLabel").value).toBe("en");
    expect(field("create.structureLabel").value).toBe("threeact");
    expect(field("genre.label").value).toBe("horror");
    expect(field("genre.ageLabel").value).toBe("adult");
    expect(field("genre.tropesLabel").value).toBe("found family");
  });

  it("says it is reading, and offers no Save, until the facts arrive", () => {
    const { view, onSave } = setup({ facts: null });
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe(
      "library.propertiesReading",
    );
    expect(save().disabled).toBe(true);
    fireEvent.click(save());
    expect(onSave).not.toHaveBeenCalled();

    // The facts land after the window opened: the fields take them then.
    view.rerender(
      <ProjectPropertiesDialog
        facts={stored}
        failed={false}
        saving={false}
        saveError={null}
        folderFollowsTitle={false}
        folder="once-dark"
        taken={new Set()}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    expect(field("library.titleLabel").value).toBe("Once Dark");
  });

  it("says when the book could not be read, and offers only Close", () => {
    const { onCancel } = setup({ facts: null, failed: true });
    expect(screen.getByRole("alert").textContent).toBe("library.unreadable");
    // Nothing to save and nothing to cancel: one button, the way out.
    expect(screen.queryByText("library.propertiesSave")).toBeNull();
    expect(screen.queryByText("confirm.cancel")).toBeNull();
    fireEvent.click(screen.getByText("library.propertiesClose"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("hands Save every answer, as the file will store it", () => {
    const { onSave } = setup();
    fireEvent.change(field("library.titleLabel"), {
      target: { value: "  Salt and Iron  " },
    });
    fireEvent.change(field("create.authorLabel"), {
      target: { value: "A. Bianchi" },
    });
    fireEvent.change(field("create.typeLabel"), {
      target: { value: OTHER_DOCUMENT_TYPE },
    });
    fireEvent.change(field("create.customTypeLabel"), {
      target: { value: "Screenplay" },
    });
    fireEvent.change(field("create.languageLabel"), {
      target: { value: "it" },
    });
    fireEvent.change(field("create.structureLabel"), {
      target: { value: "empty" },
    });
    fireEvent.change(field("genre.label"), { target: { value: "" } });
    fireEvent.click(save());

    expect(onSave).toHaveBeenCalledWith({
      // As typed: `withFacts` trims on the way into the file.
      title: "  Salt and Iron  ",
      author: "A. Bianchi",
      type: "Screenplay",
      // The type changed and the goal stayed: it is the writer's.
      goal: 80000,
      language: "it",
      structure: null,
      genres: [],
      ageCategory: "adult",
      tropes: ["found family"],
    });
  });

  it("offers a stored custom type back in Other's own field", () => {
    setup({ facts: { ...stored, type: "Screenplay" } });
    expect(field("create.typeLabel").value).toBe(OTHER_DOCUMENT_TYPE);
    expect(field("create.customTypeLabel").value).toBe("Screenplay");
  });

  it("refuses to save without a title or a goal", () => {
    const { onSave } = setup();
    fireEvent.change(field("create.goalLabel"), { target: { value: "" } });
    expect(save().disabled).toBe(true);
    fireEvent.change(field("create.goalLabel"), { target: { value: "500" } });
    fireEvent.change(field("library.titleLabel"), { target: { value: " " } });
    expect(save().disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("names the folder a renaming backend will give the book", () => {
    setup({ folderFollowsTitle: true });
    fireEvent.change(field("library.titleLabel"), {
      target: { value: "Salt and Iron" },
    });
    expect(screen.getByText("salt-and-iron/")).toBeTruthy();
    expect(screen.getByText(/library\.folderBecomes/)).toBeTruthy();
  });

  it("says the folder keeps its name while the title is unchanged", () => {
    setup({ folderFollowsTitle: true });
    expect(screen.getByText("once-dark/")).toBeTruthy();
    expect(screen.getByText(/library.folderKeeps/)).toBeTruthy();
  });

  it("names no folder for a title that makes none", () => {
    setup({ folderFollowsTitle: true });
    fireEvent.change(field("library.titleLabel"), { target: { value: "???" } });
    expect(screen.getByText("name.noFolderName")).toBeTruthy();
    expect(save().disabled).toBe(true);
    // An emptied field is still being filled: no problem yet, and the line
    // under it names no folder rather than a slash.
    fireEvent.change(field("library.titleLabel"), { target: { value: "" } });
    expect(screen.getByText("create.folderStub")).toBeTruthy();
    expect(save().disabled).toBe(true);
  });

  it("says a device folder keeps its name", () => {
    setup({ folderFollowsTitle: false });
    fireEvent.change(field("library.titleLabel"), {
      target: { value: "Salt and Iron" },
    });
    expect(screen.getByText("once-dark/")).toBeTruthy();
    expect(screen.getByText(/library\.folderKeeps/)).toBeTruthy();
  });

  // `TitleField` holds a title only to what it is about to do. A book whose
  // title spells another book's folder can still have its genre changed; a
  // device book's new title is only a title, so no folder clash blocks it; a
  // Drive book's new title renames a folder, so a clash does.
  it("does not hold an unchanged title to folder rules", () => {
    const { onSave } = setup({
      folderFollowsTitle: true,
      taken: new Set(["once-dark"]),
    });
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("holds a device book's new title to title rules only", () => {
    setup({ folderFollowsTitle: false, taken: new Set(["salt-and-iron"]) });
    fireEvent.change(field("library.titleLabel"), {
      target: { value: "Salt and Iron" },
    });
    expect(save().disabled).toBe(false);
    fireEvent.change(field("library.titleLabel"), {
      target: { value: "Salt" },
    });
    expect(screen.getByText("name.controlChars")).toBeTruthy();
    expect(save().disabled).toBe(true);
  });

  it("holds a Drive book's new title to folder rules", () => {
    setup({ folderFollowsTitle: true, taken: new Set(["salt-and-iron"]) });
    fireEvent.change(field("library.titleLabel"), {
      target: { value: "Salt and Iron" },
    });
    expect(screen.getByText("name.folderTaken")).toBeTruthy();
    expect(save().disabled).toBe(true);
  });

  it("lets a book stored without a goal stay without one", () => {
    const { onSave } = setup({ facts: { ...stored, goal: null } });
    expect(field("create.goalLabel").value).toBe("");
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ goal: null }),
    );
  });

  it("puts the writer on the title once the book has been read", () => {
    const { view } = setup({ facts: null });
    view.rerender(
      <ProjectPropertiesDialog
        facts={stored}
        failed={false}
        saving={false}
        saveError={null}
        folderFollowsTitle={false}
        folder="once-dark"
        taken={new Set()}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(document.activeElement).toBe(field("library.titleLabel"));
  });

  it("waits, busy, while a save is written, and cannot be left", () => {
    const { onSave, onCancel } = setup({ saving: true });
    expect(save().closest("button")?.getAttribute("aria-busy")).toBe("true");
    expect(save().closest("button")?.disabled).toBe(true);
    const cancel = screen.getByText("confirm.cancel") as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    fireEvent.click(cancel);
    fireEvent.submit(field("library.titleLabel").form as HTMLFormElement);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("says a failed save inside the window, every answer kept", () => {
    setup({ saveError: "Drive said no" });
    expect(screen.getByRole("alert").textContent).toBe("Drive said no");
    expect(field("library.titleLabel").value).toBe("Once Dark");
  });

  it("offers a stored language the list does not have as itself", () => {
    setup({ facts: { ...stored, language: "tlh" } });
    expect(field("create.languageLabel").value).toBe("tlh");
  });

  it("writes nothing on Cancel", () => {
    const { onSave, onCancel } = setup();
    fireEvent.change(field("library.titleLabel"), {
      target: { value: "Changed" },
    });
    fireEvent.click(screen.getByText("confirm.cancel"));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("answers a gated Enter with the reason and the field", () => {
    const { onSave } = setup();
    fireEvent.change(field("create.typeLabel"), {
      target: { value: OTHER_DOCUMENT_TYPE },
    });
    fireEvent.submit(field("library.titleLabel").form as HTMLFormElement);
    expect(onSave).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field("create.customTypeLabel"));
    expect(screen.getByText("create.customTypeRequired")).toBeTruthy();

    fireEvent.change(field("create.typeLabel"), { target: { value: "Novel" } });
    fireEvent.change(field("create.goalLabel"), { target: { value: "" } });
    fireEvent.submit(field("library.titleLabel").form as HTMLFormElement);
    expect(document.activeElement).toBe(field("create.goalLabel"));

    fireEvent.change(field("create.goalLabel"), { target: { value: "500" } });
    fireEvent.change(field("library.titleLabel"), { target: { value: "" } });
    fireEvent.submit(field("library.titleLabel").form as HTMLFormElement);
    expect(document.activeElement).toBe(field("library.titleLabel"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves on Enter, through the same gate as the button", () => {
    const { onSave } = setup();
    fireEvent.submit(field("library.titleLabel").form as HTMLFormElement);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
