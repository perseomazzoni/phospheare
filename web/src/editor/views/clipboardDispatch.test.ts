// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { EditorEngine } from "./engine";
import { dispatchCopy, dispatchCut, dispatchPaste } from "./clipboardDispatch";

// Pins the clipboard-event routing: which engine method each
// `ClipboardEvent` lands on, and that the two flavors are written from the
// engine's payload, never from the DOM. The session suite pins the engine's
// own cut, copy and paste.

function mockEngine(over: Partial<EditorEngine> = {}): EditorEngine {
  return {
    copy: vi.fn(() => ({ plain: "plain", html: "<p>html</p>" })),
    cut: vi.fn(() => ({ plain: "plain", html: "<p>html</p>" })),
    paste: vi.fn(),
    pastePlain: vi.fn(),
    updateSelection: vi.fn(),
    ...over,
  } as unknown as EditorEngine;
}

function clipboardEvent(over: { html?: string; plain?: string } = {}) {
  const store: Record<string, string> = {
    "text/html": over.html ?? "",
    "text/plain": over.plain ?? "",
  };
  const clipboardData = {
    getData: vi.fn((t: string) => store[t] ?? ""),
    setData: vi.fn((t: string, v: string) => {
      store[t] = v;
    }),
  };
  const event = {
    preventDefault: vi.fn(),
    clipboardData,
  } as unknown as ClipboardEvent;
  return { event, clipboardData };
}

const el = document.createElement("div");

describe("dispatchCopy", () => {
  it("writes both flavors from the engine and prevents the native copy", () => {
    const engine = mockEngine();
    const { event, clipboardData } = clipboardEvent();
    dispatchCopy(el, engine, event);
    expect(engine.copy).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(clipboardData.setData).toHaveBeenCalledWith("text/plain", "plain");
    expect(clipboardData.setData).toHaveBeenCalledWith(
      "text/html",
      "<p>html</p>",
    );
  });

  it("leaves the native default alone when there is nothing selected", () => {
    const engine = mockEngine({ copy: vi.fn(() => null) });
    const { event, clipboardData } = clipboardEvent();
    dispatchCopy(el, engine, event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(clipboardData.setData).not.toHaveBeenCalled();
  });
});

describe("dispatchCut", () => {
  it("cuts through the engine and writes both flavors", () => {
    const engine = mockEngine();
    const { event, clipboardData } = clipboardEvent();
    dispatchCut(el, engine, event);
    expect(engine.cut).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(clipboardData.setData).toHaveBeenCalledWith("text/plain", "plain");
    expect(clipboardData.setData).toHaveBeenCalledWith(
      "text/html",
      "<p>html</p>",
    );
  });
});

describe("dispatchPaste", () => {
  it("pastes rich by default, handing both flavors to the engine", () => {
    const engine = mockEngine();
    const { event } = clipboardEvent({ html: "<p>h</p>", plain: "p" });
    dispatchPaste(el, engine, event, { plain: false });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(engine.paste).toHaveBeenCalledWith("<p>h</p>", "p");
  });

  it("pastes plain when asked, ignoring the html flavor", () => {
    const engine = mockEngine();
    const { event } = clipboardEvent({ html: "<p>h</p>", plain: "p" });
    dispatchPaste(el, engine, event, { plain: true });
    expect(engine.pastePlain).toHaveBeenCalledWith("p");
    expect(engine.paste).not.toHaveBeenCalled();
  });
});
