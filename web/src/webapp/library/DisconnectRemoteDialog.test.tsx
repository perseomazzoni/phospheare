// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DisconnectOptions } from "../../storage";
import DisconnectRemoteDialog from "./DisconnectRemoteDialog";
import { CopiesNotDeleted } from "./disconnectRemote";
import { __resetOverlays } from "../../ui/overlay/useOverlay";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  __resetOverlays();
});

// One question, three answers, one button: this browser only is chosen on
// open, choosing never disconnects, and the button warns only while the
// deletion is chosen.

function dialog(
  disconnect = vi.fn<(options: DisconnectOptions) => Promise<void>>(
    async () => {},
  ),
) {
  const onClose = vi.fn();
  const view = render(
    <DisconnectRemoteDialog open disconnect={disconnect} onClose={onClose} />,
  );
  return { disconnect, onClose, view };
}

const labels = () =>
  screen.getAllByRole("button").map((b) => b.textContent?.trim());
const confirm = () => {
  const buttons = screen.getAllByRole("button");
  return buttons[buttons.length - 1];
};
const choose = (name: string) =>
  fireEvent.click(screen.getByRole("radio", { name }));
const chosen = () =>
  screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).checked);
const enabled = () =>
  screen.getAllByRole("radio").map((r) => !(r as HTMLInputElement).disabled);

describe("DisconnectRemoteDialog", () => {
  it("opens on this browser only, with a way out and a plain disconnect", () => {
    const { disconnect } = dialog();
    expect(screen.getByText("library.disconnectRemoteTitle")).toBeTruthy();
    expect(chosen()).toEqual([true, false, false]);
    expect(labels()).toEqual([
      "confirm.cancel",
      "library.disconnectRemoteConfirm",
    ]);
    expect(confirm().className).toContain("ui-btn-primary");
    choose("library.disconnectRemoteEverywhereDelete");
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("lists what the deletion removes under its own answer", () => {
    dialog();
    const label = screen
      .getByRole("radio", { name: "library.disconnectRemoteEverywhereDelete" })
      .closest("label") as HTMLLabelElement;
    expect(
      [...label.querySelectorAll("li")].map((item) => item.textContent),
    ).toEqual(["accountData.settings", "accountData.library"]);
  });

  it.each([
    ["library.disconnectRemoteHere", { everywhere: false }],
    [
      "library.disconnectRemoteEverywhere",
      { everywhere: true, keptCopies: true },
    ],
    [
      "library.disconnectRemoteEverywhereDelete",
      { everywhere: true, keptCopies: false },
    ],
  ])("passes the answer %s on", async (answer, options) => {
    const { disconnect, onClose } = dialog();
    choose(answer);
    fireEvent.click(confirm());
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(disconnect).toHaveBeenCalledWith(options);
  });

  it("warns on the button only while the deletion is chosen", () => {
    dialog();
    choose("library.disconnectRemoteEverywhereDelete");
    expect(confirm().textContent).toBe("library.disconnectRemoteConfirmDelete");
    expect(confirm().className).toContain("ui-btn-danger");
    choose("library.disconnectRemoteEverywhere");
    expect(confirm().textContent).toBe("library.disconnectRemoteConfirm");
    expect(confirm().className).toContain("ui-btn-primary");
  });

  it("stays open with the reason when the copies could not be removed", async () => {
    const { onClose } = dialog(
      vi.fn(async () => Promise.reject(new CopiesNotDeleted())),
    );
    choose("library.disconnectRemoteEverywhereDelete");
    fireEvent.click(confirm());
    expect(
      await screen.findByText("library.disconnectRemoteFailed"),
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open with the reason when this browser could not be disconnected", async () => {
    const { onClose } = dialog(vi.fn(async () => Promise.reject(new Error())));
    fireEvent.click(confirm());
    expect(
      await screen.findByText("library.disconnectRemoteDisconnectFailed"),
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops offering to keep copies it already deleted", async () => {
    // The copies went before a disconnect that failed: keeping them, or a
    // disconnect from this browser that records them as kept, would be false.
    dialog(vi.fn(async () => Promise.reject(new Error())));
    choose("library.disconnectRemoteEverywhereDelete");
    fireEvent.click(confirm());
    expect(
      await screen.findByText("library.disconnectRemoteDeletedNotDisconnected"),
    ).toBeTruthy();
    expect(enabled()).toEqual([false, false, true]);
    expect(chosen()).toEqual([false, false, true]);
  });

  it("opens on this browser only again after closing", async () => {
    const { onClose, view } = dialog();
    choose("library.disconnectRemoteEverywhere");
    fireEvent.click(confirm());
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());

    view.rerender(
      <DisconnectRemoteDialog
        open
        disconnect={async () => {}}
        onClose={onClose}
      />,
    );
    expect(chosen()).toEqual([true, false, false]);
  });
});
