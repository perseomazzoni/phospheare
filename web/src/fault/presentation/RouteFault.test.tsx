// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Suspense, lazy } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import RouteFault from "./RouteFault";
import { FaultHomeProvider } from "./faultHome";

// Pins the route tree's boundary: a render failure and a rejected chunk end
// on the writer's page, never on the router's own, which prints the message
// and the stack; a stale build reloads once by itself.

const { page, held } = vi.hoisted(() => ({
  page: { reload: vi.fn(), online: () => true, path: () => "/", now: () => 1 },
  held: { at: null as number | null, stores: true },
}));

vi.mock("../compose", async () => {
  const { createFaultHandling } = await import("../application/handleFault");
  const { createUpdateReady } = await import("../application/updateReady");
  return {
    faults: createFaultHandling({
      reporter: { report: () => {} },
      memory: {
        last: () => held.at,
        mark: (at: number) => {
          if (held.stores) held.at = at;
          return held.stores;
        },
      },
      page,
    }),
    updateReady: createUpdateReady(),
  };
});

// The session as the app root reads it for the way back.
const auth = { status: "authenticated" };
const home = () => (auth.status === "authenticated" ? "library" : "landing");

beforeEach(() => {
  page.reload.mockClear();
  held.at = null;
  held.stores = true;
  auth.status = "authenticated";
  // React logs each caught error through the root's hooks; the console is
  // not what these tests read.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Throws(): never {
  throw new Error("Cannot read properties of undefined (reading 'title')");
}

function mount(element: React.ReactNode) {
  const router = createMemoryRouter(
    [{ ErrorBoundary: RouteFault, children: [{ path: "/", element }] }],
    { initialEntries: ["/"] },
  );
  return render(
    <FaultHomeProvider value={home}>
      <RouterProvider router={router} />
    </FaultHomeProvider>,
  );
}

const pageText = () => document.body.textContent ?? "";

describe("the route fault boundary", () => {
  it("renders a failing screen as the writer's page, without its message or stack", () => {
    mount(<Throws />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Something went wrong",
    );
    expect(pageText()).not.toMatch(/Unexpected Application Error/);
    expect(pageText()).not.toMatch(/Cannot read properties/);
    expect(pageText()).not.toMatch(/\bat \w+ \(/);
    expect(page.reload).not.toHaveBeenCalled();
  });

  it("leads a signed-in writer back to the Library", () => {
    mount(<Throws />);
    expect(
      screen
        .getByRole("link", { name: "Back to the Library" })
        .getAttribute("href"),
    ).toBe("/app");
  });

  it("leads a visitor back to the home page", () => {
    auth.status = "anonymous";
    mount(<Throws />);
    expect(
      screen.getByRole("link", { name: "Back to the homepage" }),
    ).toBeTruthy();
  });

  it("reloads once for a chunk a deploy removed, then shows the update page", async () => {
    const Stale = lazy(() =>
      Promise.reject(
        new TypeError(
          "Failed to fetch dynamically imported module: /assets/editor-1a2b.js",
        ),
      ),
    );

    await act(async () => {
      mount(
        <Suspense fallback={null}>
          <Stale />
        </Suspense>,
      );
    });

    expect(page.reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toBeTruthy();

    cleanup();
    const Again = lazy(() =>
      Promise.reject(new TypeError("Importing a module script failed.")),
    );
    await act(async () => {
      mount(
        <Suspense fallback={null}>
          <Again />
        </Suspense>,
      );
    });

    expect(page.reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "A newer version is ready",
    );
  });

  it("shows the update page without reloading when the reload cannot be remembered", async () => {
    held.stores = false;
    const Stale = lazy(() =>
      Promise.reject(new TypeError("Importing a module script failed.")),
    );

    await act(async () => {
      mount(
        <Suspense fallback={null}>
          <Stale />
        </Suspense>,
      );
    });

    expect(page.reload).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "A newer version is ready",
    );
  });
});
