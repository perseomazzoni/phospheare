// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactNode } from "react";

// Pins the save a hidden tab makes. Autosave defaults off, and a phone
// browser discards a backgrounded tab whenever it wants the memory, so the
// tab going away saves, switch or no switch.
//
// A file of its own, not a `describe` inside `EditorRoute.test.tsx`. These
// tests dispatch a real `pagehide` on `window`, and that event reaches every
// listener alive in the environment. Routes other tests mount and never
// unmount leave stale `pagehide` handlers, and one dispatch runs
// each one's save chain against a torn-down route. Vitest gives every file a
// fresh environment, so a file is the isolation a `describe` cannot provide;
// a test that dispatches a global unload-family event belongs here.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));
vi.mock("./tree/DocumentTree", () => ({ default: () => null }));

import { Workspace } from "./EditorRoute";
import { EditorEngine } from "./views/engine";
import type { ResolvedPrefs } from "./writingPreferences";

// jsdom implements neither client-rect measurement nor scrolling, and the
// writing surface mounts in full for every test here. `EditorRoute.test.tsx`
// carries the same stubs.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () =>
  ({
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
Element.prototype.scrollIntoView = () => {};

// The whole writing surface mounts for every test here and accumulates a
// caret timer per mount, which `await act(...)` then flushes. The raised
// timeout is jsdom mounting a real editor four times, as in
// `EditorRoute.test.tsx`.
vi.setConfig({ testTimeout: 60000 });

const projectRef = {
  providerId: "local" as const,
  key: "proj",
  name: "Proj",
  openedAt: "",
};

const settings: ResolvedPrefs = {
  proseSize: 19,
  typewriter: false,
  focus: "off",
  smoothCaret: false,
  autosave: false,
  autosaveDelay: 30,
  henosis: false,
  henosisAfter: 5,
  henosisFade: 10,
  henosisPause: 10,
};

/** The workspace behind a real data router: `useBlocker` throws outside one. */
function route(element: ReactNode) {
  return createMemoryRouter(
    [
      { path: "/", element },
      { path: "/app", element: <div>The Library</div> },
    ],
    { initialEntries: ["/"] },
  );
}

function make(over: Partial<ResolvedPrefs> = {}) {
  const engine = new EditorEngine();
  engine.open("Hello world");
  const saveActiveFile = vi.fn().mockResolvedValue(true);
  const view = render(
    <RouterProvider
      router={route(
        <Workspace
          engine={engine}
          projectRef={projectRef}
          activeFile="section--hello.md"
          openTitle="hello"
          saveActiveFile={saveActiveFile}
          settings={{ ...settings, ...over }}
        />,
      )}
    />,
  );
  return { engine, saveActiveFile, view };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the tab going away", () => {
  it("saves when the tab is hidden, even with autosave off", async () => {
    const { engine, saveActiveFile } = make({ autosave: false });
    act(() => engine.type("x"));
    expect(saveActiveFile).not.toHaveBeenCalled();

    // jsdom's `visibilityState` is an accessor on `Document.prototype` and
    // there is no other way to move it. Restored in `finally`: a hidden
    // document leaks into every later test, and React's scheduler behaves
    // differently in one, starving a later test into a timeout.
    const original = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "visibilityState",
    );
    try {
      await act(async () => {
        Object.defineProperty(document, "visibilityState", {
          value: "hidden",
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(saveActiveFile).toHaveBeenCalledTimes(1);
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState;
      if (original)
        Object.defineProperty(Document.prototype, "visibilityState", original);
    }
  });

  it("saves on pagehide, which is the event a phone actually gets", async () => {
    // `beforeunload` is the desktop's event: iOS Safari does not fire it, and
    // a phone leaves tabs rather than closing them.
    const { engine, saveActiveFile } = make({ autosave: false });
    act(() => engine.type("x"));
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(saveActiveFile).toHaveBeenCalledTimes(1);
  });

  it("saves on pagehide while a comparison is up", async () => {
    // The comparison defers the bar's saves so the diff's base holds still,
    // but a page going away may never come back to finish it.
    const { engine, saveActiveFile } = make({ autosave: false });
    act(() => engine.type("x"));
    act(() => engine.enterDiff("Another text"));
    expect(engine.isInDiff).toBe(true);
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(saveActiveFile).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the tab hides with nothing to write", () => {
    const { saveActiveFile } = make({ autosave: false });
    // Dispatched bare, with no `act` flush around it. `dispatchEvent` is
    // synchronous: by the time it returns, the handler has either called
    // `saveActiveFile` or not, so a negative claim needs nothing flushed.
    // `await act` waits for the whole writing surface to settle, which under
    // the full suite's parallel load times out.
    window.dispatchEvent(new Event("pagehide"));
    // A hide is not an edit. Writing an unchanged buffer would touch the
    // writer's file, and its modified time, every time they switched apps.
    expect(saveActiveFile).not.toHaveBeenCalled();
  });

  it("a failed hide-save is still failed when the writer comes back", async () => {
    const engine = new EditorEngine();
    engine.open("Hello world");
    const saveActiveFile = vi.fn().mockResolvedValue(false);
    render(
      <RouterProvider
        router={route(
          <Workspace
            engine={engine}
            projectRef={projectRef}
            activeFile="section--hello.md"
            openTitle="hello"
            saveActiveFile={saveActiveFile}
            settings={{ ...settings, autosave: false }}
          />,
        )}
      />,
    );
    act(() => engine.type("x"));

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });

    // The state has to survive the return, and be actionable when it does: a
    // hide-save that failed silently is worse than no hide-save at all.
    //
    // Found by its class rather than its name: the chip's accessible name is
    // its state, and a failed one is named by the reason the write
    // did not land, here whatever the provider threw.
    const button = document.querySelector(".ed-save") as HTMLButtonElement;
    expect(button.getAttribute("data-state")).toBe("failed");
    expect(button.disabled).toBe(false);
  });
});
