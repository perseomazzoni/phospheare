// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { Workspace } from "./EditorRoute";
import { EditorEngine } from "./views/engine";
import { assistantTestStub } from "./assistant/assistantStub.fixture";

// The editor's toast host stays mounted with no Section open, so a toast
// posted from the book's front page, such as the dock's Undo for an edited
// question, is seen. A file of its own because the assistant
// panel is replaced here by a stand-in that posts, and `EditorRoute.test.tsx`
// drives the real panel.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("./tree/DocumentTree", () => ({ default: () => null }));
vi.mock("./assistant/AiPanel", () => ({
  default: ({
    onNotify,
  }: {
    onNotify?: (text: string, undo?: () => void) => void;
  }) => (
    <button type="button" onClick={() => onNotify?.("posted", undo)}>
      post
    </button>
  ),
}));
const undo = vi.fn();

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
Element.prototype.scrollIntoView = () => {};

afterEach(cleanup);

describe("the editor's toasts", () => {
  it("reach the writer with no Section open", () => {
    const engine = new EditorEngine();
    render(
      <RouterProvider
        router={createMemoryRouter([
          {
            path: "/",
            element: (
              <Workspace
                engine={engine}
                projectRef={{
                  providerId: "local",
                  key: "proj",
                  name: "Proj",
                  openedAt: "",
                }}
                activeFile={null}
                saveActiveFile={vi.fn().mockResolvedValue(true)}
                settings={{
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
                }}
                dock={{
                  provider: {
                    listDir: async () => [],
                    readFile: async () => "",
                  } as never,
                  // The Ask tab is this row's way to the panel that posts,
                  // and it exists only with an Assistant.
                  assistant: assistantTestStub(),
                }}
              />
            ),
          },
        ])}
      />,
    );

    // The dock opens on its reference face; the assistant's tab is what a
    // writer on the front page reaches it by.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "dock.ask" }));
    });
    act(() => {
      fireEvent.click(screen.getByText("post"));
    });

    expect(document.querySelector(".ui-toasts")?.textContent).toContain(
      "posted",
    );
    fireEvent.click(screen.getByText("toast.undo"));
    expect(undo).toHaveBeenCalledTimes(1);
  });
});
