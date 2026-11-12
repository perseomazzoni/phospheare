// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CommandPalette, { type PaletteCommand } from "./CommandPalette";
import { __resetOverlays } from "./overlay/useOverlay";
import { appIcons } from "./appIcons";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// With an IME, Enter commits the candidate being composed. That key belongs
// to the IME, not to the highlighted row.

beforeEach(() => {
  // jsdom lays nothing out, so it has no `scrollIntoView`.
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  __resetOverlays();
});

function mount() {
  const run = vi.fn();
  const onClose = vi.fn();
  const commands: PaletteCommand[] = [
    {
      id: "theme",
      label: "Theme",
      group: "Account",
      icon: appIcons.search,
      run,
    },
  ];
  render(<CommandPalette open commands={commands} onClose={onClose} />);
  return { run, onClose, field: screen.getByRole("combobox") };
}

describe("CommandPalette Enter", () => {
  it("runs the highlighted command", () => {
    const { run, field } = mount();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("leaves the command alone while an IME is composing", () => {
    const { run, onClose, field } = mount();
    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    expect(run).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
