// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { SHORTCUTS, formatShortcut, matchesShortcut } from "./shortcuts";
import { browserPlatform } from "../engine";

// Pins the keyboard layer the views drive from: a shortcut matches when its
// modifiers and key are exactly the event's, with 'mod' meaning the
// platform's primary modifier. Assertions follow the platform branch the test
// machine runs on, as the platform contract suite does.

function ev(over: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...over,
  } as unknown as KeyboardEvent;
}

describe("matchesShortcut", () => {
  it("matches the exact modifier + key", () => {
    const primary = browserPlatform.isMac() ? "metaKey" : "ctrlKey";
    const other = browserPlatform.isMac() ? "ctrlKey" : "metaKey";
    expect(matchesShortcut("bold", ev({ key: "b", [primary]: true }))).toBe(
      true,
    );
    expect(matchesShortcut("bold", ev({ key: "B", [primary]: true }))).toBe(
      true,
    );
    expect(matchesShortcut("bold", ev({ key: "b", [other]: true }))).toBe(
      false,
    );
    expect(matchesShortcut("bold", ev({ key: "b" }))).toBe(false);
  });

  it("matches a multi-character key like Enter case-insensitively", () => {
    // The comparison folds the case of both the event's key and the table's,
    // so the Ctrl+Enter page-break binding matches "Enter".
    const primary = browserPlatform.isMac() ? "metaKey" : "ctrlKey";
    expect(
      matchesShortcut("pageBreak", ev({ key: "Enter", [primary]: true })),
    ).toBe(true);
    expect(
      matchesShortcut("pageBreak", ev({ key: "enter", [primary]: true })),
    ).toBe(true);
  });

  it("requires every listed modifier", () => {
    const primary = browserPlatform.isMac() ? "metaKey" : "ctrlKey";
    expect(
      matchesShortcut(
        "redo",
        ev({ key: "z", [primary]: true, shiftKey: true }),
      ),
    ).toBe(true);
    expect(matchesShortcut("redo", ev({ key: "z", [primary]: true }))).toBe(
      false,
    );
  });

  // Exact in both directions. Tolerating extra modifiers would let Mod+Alt+1
  // also fire Mod+1, with the winner decided by listener order.
  it("rejects modifiers the shortcut does not list", () => {
    const primary = browserPlatform.isMac() ? "metaKey" : "ctrlKey";
    expect(
      matchesShortcut(
        "bold",
        ev({ key: "b", [primary]: true, shiftKey: true }),
      ),
    ).toBe(false);
    expect(
      matchesShortcut("bold", ev({ key: "b", [primary]: true, altKey: true })),
    ).toBe(false);
  });

  it("keeps Mod+Alt clear of the plain Mod binding on the same key", () => {
    const primary = browserPlatform.isMac() ? "metaKey" : "ctrlKey";
    const withAlt = ev({ key: "1", [primary]: true, altKey: true });
    const without = ev({ key: "1", [primary]: true });

    expect(matchesShortcut("setTitle", withAlt)).toBe(true);
    expect(matchesShortcut("leftGuillemet", withAlt)).toBe(false);

    expect(matchesShortcut("leftGuillemet", without)).toBe(true);
    expect(matchesShortcut("setTitle", without)).toBe(false);
  });

  // AltGr on Windows reports as Ctrl+Alt. A writer on an Italian layout
  // pressing it wants their own layout's character, not an en dash.
  it("leaves AltGr to the keyboard layout", () => {
    expect(matchesShortcut("enDash", ev({ key: "-", altKey: true }))).toBe(
      true,
    );
    expect(
      matchesShortcut("enDash", ev({ key: "-", altKey: true, ctrlKey: true })),
    ).toBe(false);
  });

  it("the revision rail needs Mod+Shift and rejects plain Mod", () => {
    const primary = browserPlatform.isMac() ? "metaKey" : "ctrlKey";
    expect(
      matchesShortcut(
        "rail",
        ev({ key: "h", [primary]: true, shiftKey: true }),
      ),
    ).toBe(true);
    expect(matchesShortcut("rail", ev({ key: "h", [primary]: true }))).toBe(
      false,
    );
  });

  it("the snapshot tab needs Mod+Shift and rejects plain Mod", () => {
    const primary = browserPlatform.isMac() ? "metaKey" : "ctrlKey";
    expect(
      matchesShortcut(
        "snapshot",
        ev({ key: "d", [primary]: true, shiftKey: true }),
      ),
    ).toBe(true);
    expect(matchesShortcut("snapshot", ev({ key: "d", [primary]: true }))).toBe(
      false,
    );
  });

  it("binds no two commands to the same keystroke", () => {
    const seen = new Map<string, string>();
    for (const [id, def] of Object.entries(SHORTCUTS)) {
      const stroke = `${[...def.modifiers].sort().join("+")}|${def.key.toLowerCase()}`;
      expect(
        seen.get(stroke),
        `${id} collides with ${seen.get(stroke)}`,
      ).toBeUndefined();
      seen.set(stroke, id);
    }
  });

  it("rejects the opposite platform modifier when mod is pressed", () => {
    if (browserPlatform.isMac()) {
      expect(
        matchesShortcut("bold", ev({ key: "b", metaKey: true, ctrlKey: true })),
      ).toBe(false);
    } else {
      expect(
        matchesShortcut("bold", ev({ key: "b", ctrlKey: true, metaKey: true })),
      ).toBe(false);
    }
  });

  it("matches the key case-insensitively", () => {
    const primary = browserPlatform.isMac() ? "metaKey" : "ctrlKey";
    expect(matchesShortcut("bold", ev({ key: "b", [primary]: true }))).toBe(
      true,
    );
    expect(matchesShortcut("bold", ev({ key: "B", [primary]: true }))).toBe(
      true,
    );
  });
});

describe("formatShortcut", () => {
  it("renders the label with the platform modifier and separator", () => {
    const primary = browserPlatform.isMac() ? "\u2318" : "Ctrl";
    const shift = browserPlatform.shiftLabel();
    const sep = browserPlatform.isMac() ? "" : "+";
    expect(formatShortcut("bold")).toBe(`${primary}${sep}B`);
    expect(formatShortcut("redo")).toBe(`${primary}${sep}${shift}${sep}Z`);
  });

  it("leaves multi-character keys alone", () => {
    expect(formatShortcut("pageBreak")).toContain("Enter");
  });
});
