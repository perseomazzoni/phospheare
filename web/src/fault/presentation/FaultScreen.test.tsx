// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FaultScreen from "./FaultScreen";
import type { Fault, FaultKind } from "../domain/fault";

// Pins the page a failure leaves the writer on: words per kind, a way forward,
// focus on what happened, and nothing of the thrown value. The words
// are the real English copy, since i18n is not started here.

afterEach(() => cleanup());

const fault = (kind: FaultKind): Fault => ({ kind });

describe("the fault page", () => {
  it.each<[FaultKind, string]>([
    ["stale-build", "A newer version is ready"],
    ["unreachable", "can't be reached"],
    ["unexpected", "Something went wrong"],
    ["not-found", "Page not found"],
  ])("titles a %s failure in the writer's words", (kind, title) => {
    render(
      <FaultScreen fault={fault(kind)} home="landing" onReload={() => {}} />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      title,
    );
  });

  it("moves focus to the title", () => {
    render(
      <FaultScreen
        fault={fault("unexpected")}
        home="landing"
        onReload={() => {}}
      />,
    );
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { level: 1 }),
    );
  });

  it("offers a reload and the way back", () => {
    const onReload = vi.fn();
    render(
      <FaultScreen
        fault={fault("unexpected")}
        home="library"
        onReload={onReload}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("link", { name: "Back to the Library" })
        .getAttribute("href"),
    ).toBe("/app");
  });

  it("leads a signed-out visitor to the home page", () => {
    render(
      <FaultScreen
        fault={fault("unexpected")}
        home="landing"
        onReload={() => {}}
      />,
    );
    expect(
      screen
        .getByRole("link", { name: "Back to the homepage" })
        .getAttribute("href"),
    ).toBe("/");
  });

  it("offers no reload for an address that leads nowhere", () => {
    render(
      <FaultScreen
        fault={fault("not-found")}
        home="library"
        onReload={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Back to the Library" })
        .getAttribute("href"),
    ).toBe("/app");
  });

  it.each<[FaultKind, boolean]>([
    ["unexpected", true],
    ["unreachable", true],
    ["stale-build", false],
    ["not-found", false],
  ])("heads a %s page with the figure, its spark out: %s", (kind, out) => {
    const { container } = render(
      <FaultScreen fault={fault(kind)} home="landing" onReload={() => {}} />,
    );
    const mark = container.querySelector(".page-inner > svg.brand-mark");
    expect(mark).not.toBeNull();
    expect(mark?.classList.contains("brand-mark-out")).toBe(out);
  });

  it("tells whoever asked while it is on screen, and when it goes", () => {
    const gone = vi.fn();
    const onShown = vi.fn(() => gone);
    const { unmount } = render(
      <FaultScreen
        fault={fault("unexpected")}
        home="landing"
        onReload={() => {}}
        onShown={onShown}
      />,
    );
    expect(onShown).toHaveBeenCalledTimes(1);
    unmount();
    expect(gone).toHaveBeenCalledTimes(1);
  });
});
