// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Welcome from "./Welcome";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

// The welcome around the places: the first project, locked until
// there is a place for it.

function draw(more: Partial<Parameters<typeof Welcome>[0]> = {}) {
  const props = {
    setup: <section aria-label="setup" />,
    createLocked: false,
    busy: false,
    found: 0,
    onShow: vi.fn(),
    exploreTo: "/app/editor/demo",
    onLockedPress: vi.fn(),
    onNew: vi.fn(),
    onImport: vi.fn(),
    ...more,
  };
  render(
    <MemoryRouter>
      <Welcome {...props} />
    </MemoryRouter>,
  );
  return props;
}

const newProject = () =>
  screen.getByRole("button", { name: "library.newProject" });
const importOne = () => screen.getByRole("button", { name: "import.heading" });

describe("Welcome", () => {
  it("sets the app up first, then starts the project", () => {
    draw();
    const setup = screen.getByRole("region", { name: "setup" });
    const start = screen.getByRole("heading", {
      name: "library.welcome.startTitle",
    });
    expect(
      setup.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("starts or imports once there is a place", () => {
    const { onNew, onImport } = draw();
    fireEvent.click(newProject());
    fireEvent.click(importOne());
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("library.welcome.lockNote")).toBeNull();
  });

  // Locked, not disabled: focusable, the reason tied to it, and
  // a press points at the step that unlocks it.
  it("locks both actions until there is a place, and says why", () => {
    const { onNew, onImport, onLockedPress } = draw({ createLocked: true });
    for (const button of [newProject(), importOne()]) {
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(button.hasAttribute("disabled")).toBe(false);
      // The reason first, then the tile's own line.
      const [reason] = (button.getAttribute("aria-describedby") ?? "").split(
        " ",
      );
      expect(document.getElementById(reason)?.textContent).toBe(
        "library.welcome.lockNote",
      );
      fireEvent.click(button);
    }
    expect(onLockedPress).toHaveBeenCalledTimes(2);
    expect(onNew).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });

  // A place that already holds projects: the library is the way on, and
  // the other place can still be set beside it.
  it("names the projects found and offers the library first", () => {
    const onShow = vi.fn();
    draw({ found: 3, onShow });
    expect(
      screen.getByRole("heading", { name: "library.welcome.foundTitle" }),
    ).toBeTruthy();
    const [first] = screen.getAllByRole("button");
    expect(first.textContent).toBe("library.welcome.show");
    fireEvent.click(first);
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(newProject()).toBeTruthy();
  });

  // The example needs no place: its way in stays open while the rest is
  // locked, and it goes to a page, so it is a link.
  it("links to the example project, locked or not", () => {
    draw({ createLocked: true });
    const explore = screen.getByRole("link", {
      name: "library.welcome.explore",
    });
    expect(explore.getAttribute("href")).toBe("/app/editor/demo");
    expect(explore.hasAttribute("aria-disabled")).toBe(false);
  });

  // One way on leads, and Import stands beside it at the same size.
  it("leads with New project, with Import beside it", () => {
    draw();
    expect(newProject().classList.contains("ui-btn-primary")).toBe(true);
    expect(importOne().classList.contains("ui-btn-outline")).toBe(true);
    expect(importOne().classList.contains("ui-btn-sm")).toBe(false);
  });

  it("hands the lead to the library once projects are found", () => {
    draw({ found: 2 });
    const show = screen.getByRole("button", { name: "library.welcome.show" });
    expect(show.classList.contains("ui-btn-primary")).toBe(true);
    expect(newProject().classList.contains("ui-btn-primary")).toBe(false);
  });

  it("holds both actions while a project is being made", () => {
    draw({ busy: true });
    expect(newProject().hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("library.welcome.lockNote")).toBeNull();
  });
});
