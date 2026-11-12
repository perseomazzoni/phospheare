// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SectionPicker from "./SectionPicker";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

const noop = () => ({
  onPick: vi.fn(),
  onClose: vi.fn(),
});

function renderPicker(
  fileNames: string[] = [],
  overrides: Partial<ReturnType<typeof noop>> = {},
) {
  const props = { ...noop(), ...overrides };
  render(
    <SectionPicker
      group="world"
      fileNames={fileNames}
      onPick={props.onPick}
      onClose={props.onClose}
    />,
  );
  return props;
}

function buttonFor(text: string): HTMLElement {
  const el = screen.getByText(text).closest("button");
  if (!el) throw new Error(`button ${text} not found`);
  return el as HTMLElement;
}

describe("SectionPicker", () => {
  it("draws every missing section, each with its one-line description", () => {
    renderPicker();
    expect(document.querySelectorAll(".ref-picker-row")).toHaveLength(15);
    // Every row opens with the plus that says what a press does.
    expect(document.querySelectorAll(".ref-picker-mark")).toHaveLength(15);
    expect(screen.getByText("reference.section.world.rules")).toBeTruthy();
    expect(screen.getByText("reference.sectionDesc.world.rules")).toBeTruthy();
    expect(screen.getByText("reference.section.world.conflict")).toBeTruthy();
  });

  // A compiled section is not drawn: the card already lists it, and a row
  // that only opens it again is noise.
  it("does not offer a section that already exists", () => {
    renderPicker(["world--economy.md"]);
    expect(document.querySelectorAll(".ref-picker-row")).toHaveLength(14);
    expect(document.querySelectorAll(".ref-picker-mark")).toHaveLength(14);
    expect(screen.queryByText("reference.section.world.economy")).toBeNull();
    expect(screen.getByText("reference.section.world.factions")).toBeTruthy();
  });

  it("creates a missing section with its catalogue id", () => {
    const { onPick } = renderPicker();
    fireEvent.click(buttonFor("reference.section.world.factions"));
    expect(onPick).toHaveBeenCalledWith("factions");
  });

  it("keeps a hand-made file from claiming a section", () => {
    // `world--economy (1).md` is not the Economy section, so Economy is still
    // on offer.
    renderPicker(["world--economy (1).md"]);
    expect(screen.getByText("reference.section.world.economy")).toBeTruthy();
  });

  it("closes from the button", () => {
    const { onClose } = renderPicker();
    fireEvent.click(screen.getByLabelText("reference.pickerClose"));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const { onClose } = renderPicker();
    fireEvent.keyDown(document.querySelector(".ref-picker") as HTMLElement, {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalled();
  });
});
