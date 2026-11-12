// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ContextMenu from "./ContextMenu";
import { __resetOverlays } from "../../ui/overlay/useOverlay";

afterEach(() => {
  cleanup();
  __resetOverlays();
});

// The prose context menu: the clipboard verbs at the pointer, on the shared
// `.ui-menu` surface. Pinned here: what renders, what is disabled, where the
// rule sits, and that choosing an item closes the menu before acting.

function menu() {
  const onClose = vi.fn();
  const onCut = vi.fn();
  const onCopy = vi.fn();
  const onSelectAll = vi.fn();
  render(
    <ContextMenu
      open
      point={{ x: 120, y: 90 }}
      label="Selection"
      items={[
        { id: "cut", label: "Cut", shortcut: "Ctrl+X", onSelect: onCut },
        {
          id: "copy",
          label: "Copy",
          shortcut: "Ctrl+C",
          disabled: true,
          onSelect: onCopy,
        },
        {
          id: "selectAll",
          label: "Select all",
          separator: true,
          onSelect: onSelectAll,
        },
      ]}
      onClose={onClose}
    />,
  );
  return { onClose, onCut, onCopy, onSelectAll };
}

describe("ContextMenu", () => {
  it("renders each verb as a menuitem with its key-cap shortcut", () => {
    menu();
    expect(screen.getByText("Cut")).toBeTruthy();
    expect(screen.getByText("Copy")).toBeTruthy();
    expect(screen.getByText("Select all")).toBeTruthy();
    expect(document.querySelector(".ui-kbd")?.textContent).toBe("Ctrl+X");
  });

  it("disables the verbs with no subject", () => {
    menu();
    const copy = screen.getByText("Copy").closest("button");
    expect(copy?.disabled).toBe(true);
  });

  it("rules off the row the separator marks", () => {
    menu();
    expect(document.querySelector(".ui-menu hr")).toBeTruthy();
  });

  it("closes the menu and then runs the chosen verb", () => {
    const { onClose, onCut } = menu();
    fireEvent.click(screen.getByText("Cut"));
    expect(onClose).toHaveBeenCalled();
    expect(onCut).toHaveBeenCalled();
  });
});
