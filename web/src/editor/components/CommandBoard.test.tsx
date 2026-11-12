// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import CommandBoard, { type BoardCommand } from "./CommandBoard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

// Two things the board gets right, and both are why it is a separate
// component from the Library's palette rather than a variant of it:
//
//   1. It is complete at rest. Every command is on screen with no keystroke,
//      grouped, in a fixed arrangement: that makes it a board rather than a
//      query surface, and it is what a phone needs, since typing is the one
//      affordance a phone cannot supply.
//   2. Which end is live follows the gesture, not the device. Mod+K is a
//      typing gesture, so the field takes focus; the Palette button is a
//      pointing gesture, so the board does and the keyboard stays down.
//
// Cells carry no shortcut letters, so a plain letter only types.

const ran: string[] = [];
const make = (id: string, label: string, group: string): BoardCommand => ({
  id,
  label,
  group,
  icon: "bold",
  run: () => ran.push(id),
});

const commands = [
  make("bold", "Bold", "Formatting"),
  make("italic", "Italic", "Formatting"),
  make("h2", "Subtitle", "Blocks"),
  make("body", "Body", "Blocks"),
  make("snapshots", "Snapshots", "Places"),
  make("reference", "Reference", "Places"),
];

function open(live: "field" | "board" = "board") {
  ran.length = 0;
  const onClose = vi.fn();
  render(
    <CommandBoard open commands={commands} live={live} onClose={onClose} />,
  );
  return { onClose };
}

const board = () => document.querySelector(".board-inner") as HTMLElement;
const filterField = () =>
  document.querySelector(".board-filter") as HTMLInputElement;
const firstCell = () => document.querySelector(".board-cell");
const wellNames = () =>
  [...document.querySelectorAll(".board-well h3")].map((h) => h.textContent);

/** Keys land on the board's own container, which is where the handler lives. */
const press = (key: string, target?: Element) =>
  fireEvent.keyDown(target ?? board(), { key });

describe("the board is complete at rest", () => {
  it("shows every command, grouped, with no keystroke", () => {
    open();
    for (const command of commands) {
      expect(screen.getByRole("button", { name: command.label })).toBeTruthy();
    }
    expect(wellNames()).toEqual(["Formatting", "Blocks", "Places"]);
  });

  it("names each cell by its label alone", () => {
    // A cell carries only its label, so nothing has to be hidden
    // from the accessibility tree to keep the name clean.
    open();
    const bold = screen.getByRole("button", { name: "Bold" });
    expect(bold.textContent).toBe("Bold");
    expect(bold.getAttribute("aria-keyshortcuts")).toBeNull();
  });
});

describe("the filter narrows without reordering", () => {
  it("keeps survivors in their own wells", () => {
    open("field");
    fireEvent.change(filterField(), { target: { value: "bo" } });

    // "bo" matches Bold and Body — one in each of two wells, and each stays
    // where it was. A ranked list would have pulled them together.
    expect(screen.queryByRole("button", { name: "Italic" })).toBeNull();
    expect(screen.getByRole("button", { name: "Bold" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Body" })).toBeTruthy();
    expect(wellNames()).toEqual(["Formatting", "Blocks"]);
  });

  it("drops an empty well rather than leaving a heading over nothing", () => {
    open("field");
    fireEvent.change(filterField(), { target: { value: "italic" } });
    expect(wellNames()).toEqual(["Formatting"]);
  });

  it("says so when nothing matches, in one line and with no result count", () => {
    // "12 results" is search's voice, and this is not a search.
    open("field");
    fireEvent.change(filterField(), { target: { value: "zzzz" } });
    expect(document.querySelector(".board-none")).toBeTruthy();
    expect(document.querySelectorAll(".board-cell").length).toBe(0);
  });
});

describe("running a command", () => {
  it("closes before it runs", () => {
    // A command that opens another layer must not stack on a board that is
    // about to unmount underneath it.
    const order: string[] = [];
    render(
      <CommandBoard
        open
        commands={[
          { ...make("x", "Only", "Group"), run: () => order.push("ran") },
        ]}
        live="board"
        onClose={() => order.push("closed")}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Only" }));
    expect(order).toEqual(["closed", "ran"]);
  });
});

describe("the keyboard", () => {
  it("walks the cells with arrows, clamped at both ends", () => {
    // Arrows are the keyboard route through the board. Clamped rather than
    // wrapping, like the palette's own walk: holding a key should come to rest
    // at the end, not cycle silently.
    open("board");
    const all = [
      ...document.querySelectorAll<HTMLButtonElement>(".board-cell"),
    ];
    all[0].focus();

    press("ArrowRight");
    expect(document.activeElement).toBe(all[1]);
    press("ArrowLeft");
    expect(document.activeElement).toBe(all[0]);
    press("ArrowLeft");
    expect(document.activeElement).toBe(all[0]);
  });

  it("drops into the field on /", () => {
    open("board");
    press("/");
    expect(document.activeElement).toBe(filterField());
  });

  it("goes from the field into the board on ArrowDown", () => {
    open("field");
    press("ArrowDown", filterField());
    expect(document.activeElement).toBe(firstCell());
  });

  it("lets a plain letter reach the field untouched", () => {
    // There are no cell letters for a keystroke to collide with, so typing
    // only types.
    open("field");
    press("p", filterField());
    expect(document.activeElement).not.toBe(firstCell());
    expect(ran).toEqual([]);
  });
});
