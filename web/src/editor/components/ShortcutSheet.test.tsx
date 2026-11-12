// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ShortcutSheet, { SHORTCUT_NAMES } from "./ShortcutSheet";
import { SHORTCUTS, formatShortcut, type ShortcutId } from "../views/shortcuts";
import en from "../../locales/en.json";
import itStrings from "../../locales/it.json";

const lookup = (strings: object, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>(
      (at, part) => (at as Record<string, unknown> | undefined)?.[part],
      strings,
    );

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

// The sheet is generated from the shortcut table, and this is what holds it to
// that promise. A hand-written list of shortcuts drifts, and in the worst
// direction: it promises a binding that does not exist.

const ids = Object.keys(SHORTCUTS) as ShortcutId[];

describe("ShortcutSheet", () => {
  it("lists every binding in the table, without exception", () => {
    render(<ShortcutSheet open onClose={vi.fn()} />);
    const rows = [...document.querySelectorAll(".keys-row")];
    expect(rows).toHaveLength(ids.length);

    const printed = new Set(
      rows.map((row) => row.querySelector(".ui-kbd")?.textContent),
    );
    for (const id of ids) {
      expect(
        printed.has(formatShortcut(id)),
        `${id} — ${formatShortcut(id)}`,
      ).toBe(true);
    }
  });

  it("names every command beside its keys", () => {
    render(<ShortcutSheet open onClose={vi.fn()} />);
    const text = document.querySelector(".keys")?.textContent ?? "";
    for (const id of ids) {
      expect(
        text.includes(SHORTCUT_NAMES[id] ?? SHORTCUTS[id].label),
        `${id}`,
      ).toBe(true);
    }
  });

  // Only the accented capitals go untranslated, because the letter is the
  // name in every language.
  it("names every binding but a lone letter in the writer's language", () => {
    for (const id of ids) {
      const key = SHORTCUT_NAMES[id];
      if (!key) {
        expect([...SHORTCUTS[id].label], `${id}`).toHaveLength(1);
        continue;
      }
      for (const [lang, strings] of Object.entries({ en, it: itStrings })) {
        expect(lookup(strings, key), `${lang}: ${key}`).toBeTypeOf("string");
      }
    }
  });

  it("shows the character an insert produces, since its name is the character", () => {
    render(<ShortcutSheet open onClose={vi.fn()} />);
    const text = document.querySelector(".keys")?.textContent ?? "";
    expect(text).toContain("—");
    expect(text).toContain("«");
  });

  it("files the seven new bindings under blocks and alignment", () => {
    render(<ShortcutSheet open onClose={vi.fn()} />);
    const heads = [...document.querySelectorAll(".keys-group h3")].map(
      (h) => h.textContent,
    );
    expect(heads).toContain("shortcuts.group.block");
    expect(heads).toContain("shortcuts.group.align");
  });

  it("draws no empty group", () => {
    render(<ShortcutSheet open onClose={vi.fn()} />);
    for (const group of document.querySelectorAll(".keys-group")) {
      expect(group.querySelectorAll(".keys-row").length).toBeGreaterThan(0);
    }
  });

  it("stays shut until asked for", () => {
    render(<ShortcutSheet open={false} onClose={vi.fn()} />);
    expect(screen.queryByText("shortcuts.title")).toBeNull();
  });
});
