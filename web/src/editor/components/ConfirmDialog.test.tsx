// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import ConfirmDialog from "./ConfirmDialog";
import { __resetOverlays } from "../../ui/overlay/useOverlay";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  // The overlay stack is module state shared by every layer in the app; a
  // test that leaves a layer registered makes the next test's Escape go to a
  // dialog that has gone.
  __resetOverlays();
});

/** The shared overlay moves focus on a macrotask, so the layer is painted
 * before it is reached into. */
const settled = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe("ConfirmDialog", () => {
  it("renders title and body, with the default labels, portalled to the body", () => {
    render(
      <ConfirmDialog
        title="Remove Act One?"
        body="Its two sections go too."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const dialog = screen.getByRole("alertdialog", { name: "Remove Act One?" });
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("Remove Act One?")).toBeTruthy();
    expect(screen.getByText("Its two sections go too.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "confirm.cancel" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "confirm.continue" }),
    ).toBeTruthy();
    expect(dialog.closest("body")).toBeTruthy();
  });

  it("uses the given confirm label and draws a warning confirm", () => {
    render(
      <ConfirmDialog
        title="Title"
        confirmLabel="tree.remove"
        danger
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const confirm = screen.getByRole("button", { name: "tree.remove" });
    expect(confirm).toBeTruthy();
    expect(confirm.classList.contains("ui-btn-danger")).toBe(true);
  });

  it("focuses the confirm button on open", async () => {
    // Not Cancel. `AlertDialog` opens on Cancel because its acts cannot be
    // taken back; this dialog stands in front of ordinary work, and the
    // writer who opened it usually means to continue.
    render(
      <ConfirmDialog
        title="Title"
        confirmLabel="Go"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    await settled();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Go" }),
    );
  });

  it("confirm calls through", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog title="Title" onConfirm={onConfirm} onCancel={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "confirm.continue" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("cancel and the scrim both call cancel, and the dialog itself does not", () => {
    // The dialog sits on the app's shared `.ui-scrim`, which closes on
    // mousedown against the backdrop.
    const onCancel = vi.fn();
    render(
      <ConfirmDialog title="Title" onConfirm={() => {}} onCancel={onCancel} />,
    );
    fireEvent.mouseDown(screen.getByRole("alertdialog"));
    expect(onCancel).not.toHaveBeenCalled();
    const scrim = document.querySelector(".ui-scrim");
    if (scrim === null)
      throw new Error("The scrim should be rendered behind the dialog");
    fireEvent.mouseDown(scrim);
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "confirm.cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("Escape cancels, through the app's one overlay stack", () => {
    // The shared stack answers Escape for the top layer only, so a dialog
    // over a dialog closes one of them, not both.
    const onCancel = vi.fn();
    render(
      <ConfirmDialog title="Title" onConfirm={() => {}} onCancel={onCancel} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("leaves no Escape listener behind when it unmounts", () => {
    const onCancel = vi.fn();
    const view = render(
      <ConfirmDialog title="Title" onConfirm={() => {}} onCancel={onCancel} />,
    );
    view.unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
