// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { EditorEngine } from "./engine";
import { dispatchShortcutKey } from "./shortcutDispatch";
import { browserPlatform } from "../engine";

// Pins the dispatch layer that turns a keydown on the editor into an engine
// call. `shortcuts.test.ts` pins the match logic; this suite pins the
// routing: which shortcut lands on which engine method, and that a consumed
// shortcut prevents the default so the keystroke never reaches the editable.

function ev(over: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...over,
  } as unknown as KeyboardEvent;
}

function mockEngine(): EditorEngine {
  return {
    toggleBold: vi.fn(),
    toggleItalic: vi.fn(),
    toggleMonospace: vi.fn(),
    setNormalText: vi.fn(),
    toggleCase: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    insertPageBreak: vi.fn(),
    type: vi.fn(),
    updateSelection: vi.fn(),
    selectAll: vi.fn(),
    selection: {
      anchor: { para: 0, offset: 0 },
      focus: { para: 0, offset: 0 },
    },
  } as unknown as EditorEngine;
}

describe("dispatchShortcutKey", () => {
  const primary = browserPlatform.isMac() ? "metaKey" : "ctrlKey";

  it("routes formatting shortcuts to the engine and prevents the default", () => {
    const engine = mockEngine();
    const e = ev({ key: "b", [primary]: true });

    expect(dispatchShortcutKey({} as HTMLElement, engine, e)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(engine.toggleBold).toHaveBeenCalled();
  });

  it("routes the page-break shortcut to the engine and prevents the default", () => {
    // Ctrl+Enter reaches this routing once the matcher folds case.
    const engine = mockEngine();
    const e = ev({ key: "Enter", [primary]: true });

    expect(dispatchShortcutKey({} as HTMLElement, engine, e)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(engine.insertPageBreak).toHaveBeenCalled();
  });

  it("ignores a bare keystroke (no modifier)", () => {
    const engine = mockEngine();
    const e = ev({ key: "b" });

    expect(dispatchShortcutKey({} as HTMLElement, engine, e)).toBe(false);
    expect(engine.toggleBold).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("routes a typographic shortcut to engine.type with its character", () => {
    const engine = mockEngine();
    const e = ev({ key: "-", [primary]: true });

    expect(dispatchShortcutKey({} as HTMLElement, engine, e)).toBe(true);
    expect(engine.type).toHaveBeenCalledWith("—");
  });

  it("does not fire a format shortcut on a typographic-character keypress", () => {
    // Mod+1 is the left guillemet; Mod+Alt+1 is "set title". The exact-match
    // rule keeps Mod+1 from also reaching a title binding.
    const engine = mockEngine();
    const e = ev({ key: "1", [primary]: true });

    expect(dispatchShortcutKey({} as HTMLElement, engine, e)).toBe(true);
    expect(engine.type).toHaveBeenCalledWith("«");
  });

  it("routes select-all to the engine and prevents the page-wide default", () => {
    const engine = mockEngine();
    const e = ev({ key: "a", [primary]: true });

    expect(dispatchShortcutKey(document.createElement("div"), engine, e)).toBe(
      true,
    );
    expect(e.preventDefault).toHaveBeenCalled();
    expect(engine.selectAll).toHaveBeenCalled();
  });
});
