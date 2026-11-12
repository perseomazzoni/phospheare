// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import type { ProjectRef } from "../storage";

// Pins the editor's entry point when the address behind it is nothing. A file
// of its own because `EditorRoute.test.tsx` mounts `Workspace` directly and
// would have to mock auth for every one of its rows.
//
// No row reaches the success path: a resolved project mounts the whole
// editor, which is that suite's subject. These rows cover the two answers the
// address itself can produce.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

const ref = vi.fn<() => ProjectRef | null | undefined>(() => null);
vi.mock("./useProjectRef", () => ({ useProjectRef: () => ref() }));
// `undefined`, not `null`: with no ref there is nothing to look
// a destination up for, so the real hook never answers and holds at "not
// looked up yet". A double that said `null` would let a dead link pass a
// route that, in a browser, holds at the skeleton for the session.
vi.mock("./useProjectStore", () => ({ useProjectStore: () => undefined }));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, status: "authenticated" }),
}));

const EditorRoute = (await import("./ProjectRoute")).default;

/** The route under test, and the shelf it can send the writer back to. */
function router(id = "id-1") {
  return createMemoryRouter(
    [
      { path: "/app/project/:projectId", element: <EditorRoute /> },
      {
        path: "/app",
        element: <ShelfProbe />,
      },
    ],
    { initialEntries: [`/app/project/${id}`] },
  );
}

let landedState: unknown = null;
function ShelfProbe() {
  // A memory router keeps its state on the location, never on `history`.
  landedState = useLocation().state;
  return <div>The Library</div>;
}

afterEach(() => {
  cleanup();
  landedState = null;
  ref.mockReset();
});

describe("the editor's entry point", () => {
  // "Not answered yet" and "no such project" are different answers, and the
  // route never turns the first into the second: a writer whose mirror is
  // being pulled would be sent back to the shelf for a project about to
  // arrive.
  it("holds at the skeleton while the address is still being resolved", () => {
    ref.mockReturnValue(undefined);
    render(<RouterProvider router={router()} />);
    expect(screen.queryByText("The Library")).toBeNull();
    expect(document.querySelector(".ed-skeleton")).toBeTruthy();
  });

  // An id this account has no book for is a dead link, and the writer is told
  // rather than left to wonder what happened to the one they followed.
  it("sends a dead link back to the shelf, saying so", async () => {
    ref.mockReturnValue(null);
    render(<RouterProvider router={router("id-nobody-has")} />);
    await waitFor(() => expect(screen.getByText("The Library")).toBeTruthy());
    expect(landedState).toMatchObject({ unknownProject: true });
  });
});
