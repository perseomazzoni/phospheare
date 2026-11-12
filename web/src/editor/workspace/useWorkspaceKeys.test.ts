// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorEngine } from "../views/engine";
import { useWorkspaceKeys } from "./useWorkspaceKeys";

function mount() {
  const engine = { setBlockType: vi.fn(), align: vi.fn() };
  const on = {
    runSave: vi.fn(async () => true),
    toggleSnapshot: vi.fn(),
    toggleFind: vi.fn(),
    openSheet: vi.fn(),
    openPalette: vi.fn(),
  };
  renderHook(() =>
    useWorkspaceKeys({
      engine: engine as unknown as EditorEngine,
      ...on,
    }),
  );
  return { engine, ...on };
}

const press = (init: KeyboardEventInit, target: EventTarget = window) => {
  const e = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(e);
  return e;
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("the workspace's keys", () => {
  it("saves on Mod+S and keeps the browser's save dialog shut", () => {
    const k = mount();
    const e = press({ key: "s", ctrlKey: true });
    expect(k.runSave).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("toggles the find panel", () => {
    const k = mount();
    const e = press({ key: "f", ctrlKey: true });
    expect(k.toggleFind).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("opens the palette's field on Mod+K, once per press", () => {
    const k = mount();
    press({ key: "k", ctrlKey: true });
    press({ key: "k", ctrlKey: true, repeat: true });
    expect(k.openPalette).toHaveBeenCalledTimes(1);
    expect(k.openPalette).toHaveBeenCalledWith("field");
  });

  it("opens the sheet on ? outside a text field, and types it inside one", () => {
    const k = mount();
    press({ key: "?" });
    expect(k.openSheet).toHaveBeenCalledTimes(1);

    const field = document.body.appendChild(document.createElement("input"));
    press({ key: "?" }, field);
    const prose = document.body.appendChild(document.createElement("div"));
    prose.setAttribute("contenteditable", "true");
    const line = prose.appendChild(document.createElement("p"));
    press({ key: "?" }, line);
    expect(k.openSheet).toHaveBeenCalledTimes(1);
  });

  it("leaves a plain key alone", () => {
    const k = mount();
    const e = press({ key: "s" });
    expect(e.defaultPrevented).toBe(false);
    expect(k.runSave).not.toHaveBeenCalled();
    expect(k.engine.setBlockType).not.toHaveBeenCalled();
  });
});
