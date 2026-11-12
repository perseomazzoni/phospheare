// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import Dialog from "./Dialog";
import { __resetOverlays } from "./useOverlay";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The workspace has no global test setup, so a suite that renders cleans up
// after itself.
afterEach(() => {
  cleanup();
  __resetOverlays();
});

function mount(confirmBusy: boolean) {
  render(
    <Dialog
      open
      title="Create"
      confirmLabel="Create the folder"
      confirmBusy={confirmBusy}
      onConfirm={() => {}}
      onCancel={() => {}}
    >
      <p>body</p>
    </Dialog>,
  );
}

describe("Dialog confirm", () => {
  // The busy face carries the shared loader class; bare `<i>` elements with
  // no rule styling them draw nothing.
  it("shows the shared loading dots while busy, with the label kept", () => {
    mount(true);
    const button = document.querySelector<HTMLButtonElement>(
      "button[data-loading='1']",
    );
    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(button?.textContent).toContain("Create the folder");
    const dots = button?.querySelector(".ui-btn-load-dots .ui-dots");
    expect(dots).toBeTruthy();
    expect(dots?.querySelectorAll("i").length).toBe(3);
  });

  it("shows no dots when idle", () => {
    mount(false);
    expect(document.querySelector(".ui-dots")).toBeNull();
  });
});

describe("Dialog cancel", () => {
  // An export already writing into the book's homes cannot be called back.
  // Escape, the backdrop and the footer's own button all answer to
  // `dismissible`, so a dialog that ignores the press does not offer it as a
  // way out.
  it("can be shut while a job that cannot be called back runs", () => {
    const onCancel = vi.fn();
    render(
      <Dialog
        open
        title="Export"
        confirmLabel="Export"
        cancelDisabled
        onConfirm={() => {}}
        onCancel={onCancel}
      >
        <p>body</p>
      </Dialog>,
    );
    const cancel = document.querySelector<HTMLButtonElement>(".ui-btn-ghost");
    expect(cancel?.disabled).toBe(true);
    cancel?.click();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("is a way out by default", () => {
    const onCancel = vi.fn();
    render(
      <Dialog
        open
        title="Export"
        confirmLabel="Export"
        onConfirm={() => {}}
        onCancel={onCancel}
      >
        <p>body</p>
      </Dialog>,
    );
    document.querySelector<HTMLButtonElement>(".ui-btn-ghost")?.click();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  // A window with nothing to cancel, such as the Properties window over a
  // book it could not read, offers its one way out and no second
  // button doing the same under another name.
  it("can offer the confirm alone", () => {
    render(
      <Dialog
        open
        title="Properties"
        confirmLabel="Close"
        cancelHidden
        onConfirm={() => {}}
        onCancel={() => {}}
      >
        <p>body</p>
      </Dialog>,
    );
    expect(document.querySelector(".ui-btn-ghost")).toBeNull();
    expect(document.querySelectorAll(".ui-dialog-foot button").length).toBe(1);
  });
});
