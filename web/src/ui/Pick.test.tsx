// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Pick from "./Pick";

// Pins `Pick`, a real radio inside a card.

afterEach(() => {
  cleanup();
});

describe("Pick", () => {
  it("is a real radio in its group, so the browser owns the arrow keys", () => {
    render(
      <>
        <Pick group="g" on name="Word" sub="For agents" onChoose={() => {}} />
        <Pick
          group="g"
          on={false}
          name="PDF"
          sub="Fixed pages"
          onChoose={() => {}}
        />
      </>,
    );
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((radio) => [radio.name, radio.checked])).toEqual([
      ["g", true],
      ["g", false],
    ]);
  });

  it("chooses on change", () => {
    const onChoose = vi.fn();
    render(
      <Pick
        group="g"
        on={false}
        name="PDF"
        sub="Fixed pages"
        onChoose={onChoose}
      />,
    );
    fireEvent.click(screen.getByRole("radio"));
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it("draws no sigil column for a choice that is a word", () => {
    const { container } = render(
      <Pick
        group="g"
        on
        name="Markdown"
        sub="CommonMark"
        onChoose={() => {}}
      />,
    );
    const card = container.querySelector("label") as HTMLLabelElement;
    expect(card.className).toBe("pick pick-plain");
    expect(container.querySelector(".pick-sigil")).toBeNull();
  });

  it("is never on while it is disabled", () => {
    const { container } = render(
      <Pick
        group="g"
        on
        disabled
        icon="disk"
        name="Disk"
        sub="Off"
        onChoose={() => {}}
      />,
    );
    const card = container.querySelector("label") as HTMLLabelElement;
    expect(card.dataset.on).toBe("0");
    expect((screen.getByRole("radio") as HTMLInputElement).checked).toBe(false);
    expect(container.querySelector(".pick-sigil")).not.toBeNull();
  });
});
