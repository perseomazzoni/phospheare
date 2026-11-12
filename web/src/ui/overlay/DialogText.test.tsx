// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AlertDialog from "./AlertDialog";
import DialogText from "./DialogText";
import { __resetOverlays } from "./useOverlay";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  __resetOverlays();
});

describe("DialogText", () => {
  it("reads as the sentence, its list, then the sentences after", () => {
    const { container } = render(
      <DialogText lead="Deleted:" items={["a", "b"]} after={["Gone."]} />,
    );
    expect(
      [...container.querySelectorAll("p, li")].map((e) => e.textContent),
    ).toEqual(["Deleted:", "a", "b", "Gone."]);
  });

  it("draws no empty list", () => {
    const { container } = render(<DialogText lead="Nothing to list." />);
    expect(container.querySelector("ul")).toBeNull();
  });

  it("is the alert dialog's description, list included", () => {
    render(
      <AlertDialog
        open
        title="Delete?"
        body="Deleted:"
        items={["a"]}
        confirmLabel="Delete"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const id = screen.getByRole("alertdialog").getAttribute("aria-describedby");
    expect(document.getElementById(id ?? "")?.textContent).toBe("Deleted:a");
  });
});
