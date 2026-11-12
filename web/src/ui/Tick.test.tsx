// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Tick from "./Tick";

// Pins `Tick`, the kit's tick row.

afterEach(() => {
  cleanup();
});

describe("Tick", () => {
  it("says all three of its states in the platform's own words", () => {
    render(
      <>
        <Tick checked onToggle={() => {}}>
          On
        </Tick>
        <Tick checked={false} onToggle={() => {}}>
          Off
        </Tick>
        <Tick checked="mixed" onToggle={() => {}}>
          Some
        </Tick>
      </>,
    );
    expect(
      screen
        .getAllByRole("checkbox")
        .map((row) => row.getAttribute("aria-checked")),
    ).toEqual(["true", "false", "mixed"]);
  });

  it("toggles when pressed, and carries its note", () => {
    const onToggle = vi.fn();
    render(
      <Tick checked={false} note="3 of 5" onToggle={onToggle}>
        Notes
      </Tick>,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(screen.getByText("3 of 5")).toBeTruthy();
  });

  // Locked is not disabled: a disabled row leaves the tab order and takes its
  // reason with it. A locked one stays reachable and does nothing.
  it("stays reachable when locked, and ignores the press", () => {
    const onToggle = vi.fn();
    render(
      <Tick checked locked note="An EPUB always has one" onToggle={onToggle}>
        Contents
      </Tick>,
    );
    const row = screen.getByRole("checkbox") as HTMLButtonElement;
    expect(row.disabled).toBe(false);
    expect(row.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(row);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("is inert when there is nothing behind it", () => {
    const onToggle = vi.fn();
    render(
      <Tick checked={false} disabled onToggle={onToggle}>
        Notes
      </Tick>,
    );
    const row = screen.getByRole("checkbox") as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    fireEvent.click(row);
    expect(onToggle).not.toHaveBeenCalled();
  });

  // A writing preference the phone does not honour is locked, and a press
  // says why instead of doing nothing. The editor's dim keys on the
  // attribute, so a plain locked row must not carry it.
  it("says why when a locked row is pressed, if it has a way to", () => {
    const onToggle = vi.fn();
    const onLockedPress = vi.fn();
    render(
      <>
        <Tick
          checked={false}
          locked
          onLockedPress={onLockedPress}
          onToggle={onToggle}
        >
          Typewriter
        </Tick>
        <Tick checked locked onToggle={onToggle}>
          Contents
        </Tick>
      </>,
    );
    const [said, quiet] = screen.getAllByRole("checkbox");
    fireEvent.click(said as HTMLElement);
    expect(onLockedPress).toHaveBeenCalledOnce();
    expect(onToggle).not.toHaveBeenCalled();
    expect(said?.getAttribute("aria-disabled")).toBe("true");
    expect(said?.getAttribute("data-unavailable")).toBe("1");
    expect(quiet?.hasAttribute("data-unavailable")).toBe(false);
  });

  // A search row's box has no text of its own: its words are the field beside
  // it, and its name comes from the label it is given.
  it("draws a bare box named by its label, with no text span", () => {
    render(
      <Tick
        checked
        className="ui-tick-bare"
        aria-label="Porta Pia"
        onToggle={() => {}}
      />,
    );
    const row = screen.getByRole("checkbox", { name: "Porta Pia" });
    expect(row.querySelector(".ui-row-text")).toBeNull();
    expect(row.className).toBe("ui-tick ui-tick-bare");
  });
});
