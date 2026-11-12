// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CharsPanel from "./CharsPanel";
import { EditorEngine } from "../views/engine";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

// The toolbar panel's six groups, in its order: every character that panel
// types, this one types.

const CHARS = [
  "«",
  "»",
  "“",
  "”",
  "’",
  "—",
  "–",
  "…",
  "À",
  "È",
  "É",
  "Ì",
  "Ò",
  "Ù",
  "Â",
  "Ê",
  "Î",
  "Ô",
  "Û",
  "Ë",
  "Ï",
  "Ü",
];

function panel() {
  const engine = new EditorEngine();
  engine.open("");
  render(<CharsPanel engine={engine} />);
  return engine;
}

describe("CharsPanel", () => {
  it("offers every character the toolbar panel did", () => {
    panel();
    const keys = [...document.querySelectorAll(".char-key")].map(
      (k) => k.firstChild?.textContent,
    );
    expect(keys).toEqual(CHARS);
  });

  it("keeps the six typographic groups rather than one long row", () => {
    panel();
    const groups = [...document.querySelectorAll(".chars-group")].map(
      (g) => g.querySelectorAll(".char-key").length,
    );
    expect(groups).toEqual([2, 2, 1, 3, 6, 8]);
  });

  it("types the character into the engine", () => {
    const engine = panel();
    fireEvent.click(screen.getByLabelText("chars.emDash"));
    expect(engine.commonmark).toContain("—");
  });

  it("types an accented capital, whose name is the character itself", () => {
    const engine = panel();
    fireEvent.click(screen.getByLabelText("É"));
    expect(engine.commonmark).toContain("É");
  });

  // Every one of these is also a shortcut, and the panel exists mostly so a
  // writer finds that out.
  it("shows the shortcut beside each key", () => {
    panel();
    const tips = [...document.querySelectorAll(".char-key .ui-kbd")];
    expect(tips).toHaveLength(CHARS.length);
    expect(tips.every((k) => (k.textContent ?? "").length > 0)).toBe(true);
  });

  it("never takes the caret, so the character lands where the writer was", () => {
    panel();
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    screen.getByLabelText("chars.apostrophe").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("is a group, so the keys are announced as one thing", () => {
    panel();
    expect(
      screen.getByRole("group", { name: "toolbar.specialChars" }),
    ).toBeTruthy();
  });
});
