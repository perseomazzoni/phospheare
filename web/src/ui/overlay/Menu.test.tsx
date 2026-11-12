// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Menu, { type MenuItem } from "./Menu";

// The workspace has no global test setup, so a suite that renders cleans up
// after itself.
afterEach(() => cleanup());

function open(items: MenuItem[]) {
  const anchor = document.createElement("button");
  document.body.append(anchor);
  render(
    <Menu
      open
      onClose={() => {}}
      anchor={anchor}
      label="Models"
      items={items}
    />,
  );
  return anchor;
}

function item(id: string, extra: Partial<MenuItem> = {}): MenuItem {
  return { id, label: id, onSelect: () => {}, ...extra };
}

/** What an item draws: the visible label, not its announced name. */
function label(index: number) {
  return document.querySelectorAll(
    ".ui-menu button > span:not(.ui-visually-hidden)",
  )[index]?.textContent;
}

/** The headings, in document order. */
function headings() {
  return [...document.querySelectorAll(".ui-menu-group")].map(
    (node) => node.textContent,
  );
}

describe("grouped menus", () => {
  it("draws a heading where the group changes and nowhere else", () => {
    open([
      item("a", { group: "Here" }),
      item("b", { group: "Here" }),
      item("c", { group: "Elsewhere" }),
    ]);

    expect(headings()).toEqual(["Here", "Elsewhere"]);
  });

  it("draws nothing for items that carry no group", () => {
    // The group marker sits on the member rather than making the array a list
    // of sections, so a caller with no groups renders as an ungrouped menu.
    open([item("a"), item("b")]);

    expect(headings()).toEqual([]);
  });

  it("draws the same heading twice when a caller interleaves groups", () => {
    // Defined behaviour: the comparison is against the previous item, so a
    // list that leaves a group and comes back draws the heading again. A
    // caller wanting one heading sorts its rows.
    open([
      item("a", { group: "Here" }),
      item("b", { group: "Elsewhere" }),
      item("c", { group: "Here" }),
    ]);

    expect(headings()).toEqual(["Here", "Elsewhere", "Here"]);
  });

  it("leaves the arrow keys walking every item, headings included", () => {
    // The keyboard handler traverses `querySelectorAll("button")`, so a
    // heading that is not a button is invisible to it, and grouping costs the
    // keyboard nothing.
    open([
      item("a", { group: "Here" }),
      item("b", { group: "Elsewhere" }),
      item("c", { group: "Elsewhere" }),
    ]);
    const panel = document.querySelector(".ui-menu") as HTMLElement;
    const buttons = [...panel.querySelectorAll("button")];
    expect(buttons).toHaveLength(3);

    buttons[0].focus();
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(panel, { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[0]);
    // End lands on the last item, not on a heading later in the DOM.
    fireEvent.keyDown(panel, { key: "End" });
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("says the group in each item's own name, since the heading cannot", () => {
    // The heading is presentational, so a screen reader never announces it,
    // and the model menu's groups say where a writer's words travel. Each
    // item's accessible name carries its group, so a reader who cannot see
    // the heading still learns it.
    open([
      item("llama3:latest", { group: "On this device" }),
      item("a/big-model", { group: "Through Phospheare" }),
    ]);

    // The comma lives in the string: two adjacent inline spans concatenate
    // with no separator, so without it the name and the group run together.
    expect(
      screen.getByRole("menuitem", { name: "llama3:latest, On this device" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "a/big-model, Through Phospheare" }),
    ).toBeTruthy();
    // Announced, never drawn: the row still reads as just the model.
    expect(label(0)).toBe("llama3:latest");
  });

  it("adds nothing to the name of an item with no group", () => {
    open([item("Rename"), item("Delete", { danger: true })]);

    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(
      document.querySelectorAll(".ui-menu .ui-visually-hidden"),
    ).toHaveLength(0);
  });

  it("keeps a heading out of the accessibility tree", () => {
    // A grouped menu's roles want `role="group"` with a labelled wrapper,
    // while `role="menu"` wants menuitems as its own children. The heading is
    // presentational, and the group reaches a screen reader through each
    // button's own accessible name.
    open([item("a", { group: "Here" })]);

    expect(document.querySelector(".ui-menu-group")?.getAttribute("role")).toBe(
      "presentation",
    );
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("draws the group's glyph, and nothing when it has none", () => {
    open([item("a", { group: "Here", groupIcon: "disk" }), item("b")]);

    expect(document.querySelectorAll(".ui-menu-group svg")).toHaveLength(1);
  });

  it("still rules off before the first destructive item", () => {
    // Groups and the danger rule are two separate dividers; neither replaces
    // the other.
    const onSelect = vi.fn();
    open([
      item("a", { group: "Here" }),
      item("b", { group: "Here", danger: true, onSelect }),
    ]);

    expect(document.querySelectorAll(".ui-menu hr")).toHaveLength(1);
    fireEvent.click(screen.getByText("b"));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  // A command's note is always drawn under it and announced as a
  // description; the item's name stays the command alone.
  it("draws a note under the label and announces it as a description", () => {
    open([
      item("/where", { description: "Find a moment by describing it" }),
      item("/canon"),
    ]);
    const where = screen.getByRole("menuitem", { name: "/where" });
    expect(where.textContent).toContain("Find a moment by describing it");
    const describedBy = where.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe(
      "Find a moment by describing it",
    );
    expect(
      screen
        .getByRole("menuitem", { name: "/canon" })
        .hasAttribute("aria-describedby"),
    ).toBe(false);
  });
});

// A menu longer than the window scrolls inside itself. The cap is the room
// between the trigger and the edge on the side the menu opens to.
describe("a menu taller than the room it has", () => {
  const at = (top: number, bottom: number) =>
    ({
      top,
      bottom,
      left: 20,
      right: 120,
      width: 100,
      height: bottom - top,
      x: 20,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;

  it("is capped at the room above a trigger it opens over", () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(at(300, 330));
    render(
      <Menu
        open
        onClose={() => {}}
        anchor={anchor}
        placement="above-start"
        label="Commands"
        items={[item("a"), item("b")]}
      />,
    );
    // 300 above the trigger, less the 4px gap and the 8px edge.
    expect(
      (document.querySelector(".ui-menu") as HTMLElement).style.maxHeight,
    ).toBe("288px");
  });

  it("is capped at the room below a trigger it hangs from", () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(at(100, 130));
    render(
      <Menu
        open
        onClose={() => {}}
        anchor={anchor}
        label="Models"
        items={[item("a")]}
      />,
    );
    const menu = document.querySelector(".ui-menu") as HTMLElement;
    // Top at 134; the rest of the window, less the edge.
    expect(menu.style.top).toBe("134px");
    expect(menu.style.maxHeight).toBe(`${window.innerHeight - 134 - 8}px`);
  });
});

// The menu grows in from 95%, so on the frame it is placed its drawn box is
// the animation's. It is placed by the size it settles at.
describe("a menu placed while it grows in", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lines its right edge up with the trigger's at its full width", () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 130,
      left: 560,
      right: 600,
      width: 40,
      height: 30,
      x: 560,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);
    // Laid out at 200 × 100, drawn at the animation's first 95%.
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 95,
      left: 0,
      right: 190,
      width: 190,
      height: 95,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    render(
      <Menu
        open
        onClose={() => {}}
        anchor={anchor}
        label="Actions"
        items={[item("a")]}
      />,
    );
    const menu = document.querySelector(".ui-menu") as HTMLElement;
    expect(menu.style.left).toBe("400px");
  });
});
