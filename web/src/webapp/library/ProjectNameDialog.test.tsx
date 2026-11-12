// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ProjectNameDialog from "./ProjectNameDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

afterEach(() => {
  cleanup();
});

describe("the duplicate's name", () => {
  const mount = (taken = new Set<string>()) => {
    const onConfirm = vi.fn();
    render(
      <ProjectNameDialog
        open
        title="library.duplicateTitle"
        confirmLabel="library.duplicate"
        initialValue="Once Dark copy"
        taken={taken}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const field = screen.getByLabelText("create.nameLabel") as HTMLInputElement;
    const confirm = screen.getByText("library.duplicate") as HTMLButtonElement;
    return { onConfirm, field, confirm };
  };

  // A duplicate is always a new folder, so its title is always a folder.
  it("holds the title to folder rules and names the folder to be made", () => {
    const { field, confirm } = mount(new Set(["once-dark-copy"]));
    expect(field.value).toBe("Once Dark copy");
    expect(screen.getByText("name.folderTaken")).toBeTruthy();
    expect(confirm.disabled).toBe(true);

    fireEvent.change(field, { target: { value: "Salt and Iron" } });
    expect(screen.getByText("salt-and-iron/")).toBeTruthy();
    expect(screen.getByText(/library\.folderBecomes/)).toBeTruthy();
    expect(confirm.disabled).toBe(false);
  });

  it("hands over the title trimmed", () => {
    const { onConfirm, field, confirm } = mount();
    fireEvent.change(field, { target: { value: "  Salt and Iron  " } });
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith("Salt and Iron");
  });
});
