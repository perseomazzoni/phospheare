// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import SignOutConfirmDialog from "./SignOutConfirmDialog";
import type { SignOutFlow } from "./useSignOutFlow";
import { __resetOverlays } from "../../ui/overlay/useOverlay";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: { count?: number }) =>
      vars?.count === undefined ? key : `${key}:${vars.count}`,
  }),
}));

afterEach(() => {
  cleanup();
  __resetOverlays();
});

// The dialog asks one question for both kinds of account, as two choices and
// one button: leave everything here, chosen on open, or clean everything
// away. Choosing never signs out. When the queue holds work, the clean
// destroys the only copy of it, and the title, the clean's list and the
// button say so.

function flowOf(over: Partial<SignOutFlow> = {}): SignOutFlow {
  return {
    confirming: true,
    driveConnected: false,
    remoteCopiesKept: false,
    heldFiles: 0,
    failure: null,
    profileUnsaved: false,
    requestSignOut: vi.fn(),
    leave: vi.fn(),
    clean: vi.fn(),
    cancelSignOut: vi.fn(),
    ...over,
  };
}

function dialog(over: Partial<SignOutFlow> = {}) {
  const flow = flowOf(over);
  const view = render(<SignOutConfirmDialog {...flow} />);
  return { flow, view };
}

const labels = () =>
  screen.getAllByRole("button").map((b) => b.textContent?.trim());
const confirm = () => {
  const buttons = screen.getAllByRole("button");
  return buttons[buttons.length - 1];
};
const radios = () => screen.getAllByRole("radio");

/** One choice as read: its lead, then each list item, then each sentence. */
const choiceText = (index: number) => {
  const label = radios()[index].closest("label") as HTMLLabelElement;
  return [...label.querySelectorAll(".ui-alert-body p, .ui-alert-body li")].map(
    (e) => e.textContent,
  );
};

const chooseClean = () => fireEvent.click(radios()[1]);

describe("the sign-out dialog with nothing held", () => {
  it("opens on leaving, with a quiet way out and a plain sign-out", () => {
    const { flow } = dialog();
    expect(screen.getByText("library.signOutTitle")).toBeTruthy();
    expect(labels()).toEqual(["library.signOutDismiss", "library.signOut"]);
    expect(confirm().className).toContain("ui-btn-primary");
    expect((radios()[0] as HTMLInputElement).checked).toBe(true);
    expect(choiceText(0)).toEqual(["library.signOutLeaveSub"]);

    fireEvent.click(confirm());
    expect(flow.leave).toHaveBeenCalledOnce();
    expect(flow.clean).not.toHaveBeenCalled();
  });

  it("signs out only on the button, and warns only while the clean is chosen", () => {
    const { flow } = dialog();
    chooseClean();
    expect(flow.clean).not.toHaveBeenCalled();
    expect(confirm().textContent).toBe("library.signOutClean");
    expect(confirm().className).toContain("ui-btn-danger");

    fireEvent.click(confirm());
    expect(flow.clean).toHaveBeenCalledOnce();
  });

  it("lists what the clean deletes, and says there is no copy elsewhere", () => {
    dialog();
    expect(choiceText(1)).toEqual([
      "library.signOutLead",
      "accountData.settings",
      "accountData.library",
      "library.signOutAfter",
    ]);
    expect(screen.getByText("accountData.projectsUntouched")).toBeTruthy();
  });

  it("lists the connection and says Remote Storage keeps the rest when it is connected", () => {
    dialog({ driveConnected: true });
    expect(choiceText(1)).toEqual([
      "library.signOutLeadConnected",
      "accountData.settings",
      "accountData.library",
      "accountData.connection",
      "library.signOutAfterConnected",
    ]);
  });

  it("does not call the copy lost when one was left in Remote Storage", () => {
    dialog({ remoteCopiesKept: true });
    expect(choiceText(1)).toContain("library.signOutAfterKept");
    expect(choiceText(1)).not.toContain("library.signOutAfter");
  });

  it("closes on the way out and opens on leaving again", () => {
    const { flow, view } = dialog();
    chooseClean();
    fireEvent.click(screen.getByText("library.signOutDismiss"));
    expect(flow.cancelSignOut).toHaveBeenCalledOnce();
    view.rerender(<SignOutConfirmDialog {...flowOf()} />);
    expect(confirm().textContent).toBe("library.signOut");
  });

  it("reopens on the same choice with the reason the last attempt failed", () => {
    const { view } = dialog();
    chooseClean();
    view.rerender(
      <SignOutConfirmDialog {...flowOf({ failure: "sign-out" })} />,
    );
    expect(screen.getByRole("alert").textContent).toBe("library.signOutFailed");
    expect(confirm().textContent).toBe("library.signOutClean");
  });

  it("says Remote Storage could not be disconnected, and nothing changed", () => {
    dialog({ failure: "disconnect", driveConnected: true });
    expect(screen.getByRole("alert").textContent).toBe(
      "library.signOutDisconnectFailed",
    );
  });

  it("states no problem on an ordinary first ask", () => {
    dialog();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens focus on the chosen, safe choice", async () => {
    // Choosing never acts, so a stray Enter or arrow key destroys nothing.
    // `useOverlay` moves focus on a zero timer, so the row waits for it.
    dialog();
    await waitFor(() => expect(document.activeElement).toBe(radios()[0]));
  });
});

describe("the sign-out dialog with work the remote never got", () => {
  it("puts the count in the title and at the head of the clean's list", () => {
    dialog({ heldFiles: 3, driveConnected: true });
    expect(screen.getByText("library.signOutHeldTitle:3")).toBeTruthy();
    expect(choiceText(0)).toEqual(["library.signOutHeldLeave"]);
    expect(choiceText(1)).toEqual([
      "library.signOutLeadConnected",
      "library.signOutHeldItem:3",
      "accountData.settings",
      "accountData.library",
      "accountData.connection",
      "library.signOutHeldLost library.signOutAfterConnected",
    ]);
  });

  it("names the loss in the button while the clean is chosen", () => {
    dialog({ heldFiles: 1, driveConnected: true });
    chooseClean();
    expect(confirm().textContent).toBe("library.signOutHeldConfirm");
    expect(confirm().className).toContain("ui-btn-danger");
  });

  it("does not promise a sync that cannot happen once Drive is disconnected", () => {
    // A sign-out that failed after the drop leaves held work with no
    // connection to drain through.
    dialog({
      heldFiles: 2,
      driveConnected: true,
      failure: "sign-out-disconnected",
    });
    expect(choiceText(0)).toEqual(["library.signOutHeldLeaveDisconnected"]);
    expect(choiceText(1)).not.toContain("accountData.connection");
    expect(screen.getByRole("alert").textContent).toBe(
      "library.signOutFailedDisconnected",
    );
  });
});

describe("the sign-out dialog with a profile not in Remote Storage", () => {
  it("says the copy there lacks the latest changes", () => {
    dialog({ driveConnected: true, profileUnsaved: true });
    expect(choiceText(1)).toContain("library.signOutProfileUnsaved");
  });

  it("says it beside the held files too", () => {
    dialog({ driveConnected: true, heldFiles: 2, profileUnsaved: true });
    expect(choiceText(1)).toContain(
      "library.signOutHeldLost library.signOutProfileUnsaved",
    );
  });

  it("says nothing of it when the upload landed", () => {
    dialog({ driveConnected: true });
    expect(choiceText(1)).not.toContain("library.signOutProfileUnsaved");
  });
});
