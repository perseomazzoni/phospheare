// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useRef } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useOutletContext,
} from "react-router";
import type { SessionGateContext } from "./SessionGate";

// `SessionGate` is the gate on every `/app` route. Once an id is confirmed,
// every read is scoped to it by construction, so `Library` mounts at once and
// the sweep and sync run in the background. The loading UI is an overlay
// that lifts once both its minimum-hold floor and `Library`'s data verdict
// (`reportDataReady`) are in, because `useLibraryReveal` may need a profile
// pull on an empty cache.
//
// `useAuth` is mocked directly, as in `Library.test.tsx`, because the rows
// test the gate's reaction to status and user transitions;
// `AuthContext.test.tsx` covers the boot sequence. `MemoryRouter` with
// `Routes`, not `RouterProvider`: a declarative router propagates a
// `rerender()` through the tree, while a data router's rerender reaches the
// matched route element only when routing state changed.

let mockStatus: "authenticated" | "anonymous" = "anonymous";
let mockUser: { id: string; email: string; welcomed?: boolean } | null = null;
const markWelcomedMock = vi.fn();

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    status: mockStatus,
    user: mockUser,
    markWelcomed: markWelcomedMock,
  }),
}));

const purgeOtherUsersLocalDataMock = vi.fn();
vi.mock("../../profile/forgetAccount", () => ({
  purgeOtherUsersLocalData: (...ids: string[]) =>
    purgeOtherUsersLocalDataMock(...ids),
}));

const syncProfileMock = vi.fn();
vi.mock("../../profile/profileSync", () => ({
  syncProfile: (id: string) => syncProfileMock(id),
}));

// Keys echo back, with the count appended where one is passed, so a row can
// read the number the writer would see. Hoisted, so `t` keeps one identity
// across renders as the real library's does.
const t = (key: string, options?: { count?: number }) =>
  options?.count === undefined ? key : `${key}:${options.count}`;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t }),
}));

// `LoginSplash`'s choreography is pinned in its own test file. Here only its
// contract matters: it renders, exposes the `dataReady` it was handed, and
// calls `onReveal` then `onFinished` once mounted. The rows test the gate's
// reaction to those callbacks, not when a real splash calls them.
vi.mock("../entry/LoginSplash", () => ({
  default: ({
    onReveal,
    onFinished,
    dataReady,
  }: {
    onReveal: () => void;
    onFinished: () => void;
    dataReady: boolean;
  }) => {
    queueMicrotask(() => {
      onReveal();
      onFinished();
    });
    return <div data-testid="login-splash" data-ready={String(dataReady)} />;
  },
}));

// `AppBoot`'s minimum-hold timing and its `dataReady` gate are pinned in its
// own test file. Here only its contract matters: it renders, exposes the
// `dataReady` it was handed, and calls `onReveal` once mounted.
vi.mock("./AppBoot", () => ({
  default: ({
    onReveal,
    dataReady,
  }: {
    onReveal: () => void;
    dataReady: boolean;
  }) => {
    queueMicrotask(onReveal);
    return <div data-testid="app-boot" data-ready={String(dataReady)} />;
  },
}));

const { default: SessionGate } = await import("./SessionGate");

// Whether the fake Library reports its data verdict on mount. Module-level,
// like `mockStatus` and `mockUser`, because the route tree is built once per
// test by `tree()` or `renderGate()` and takes no per-render props.
let mockReportsDataReady = false;

function FakeLibrary() {
  const ctx = useOutletContext<SessionGateContext | undefined>();
  const reportDataReadyRef = useRef(ctx?.reportDataReady);
  reportDataReadyRef.current = ctx?.reportDataReady;
  useEffect(() => {
    if (mockReportsDataReady) reportDataReadyRef.current?.();
  }, []);
  // Exposed so a row can confirm the gate clears the `justLoggedIn` nav
  // state after mount: `location.state` lives in `history.state`, which
  // survives a reload of the tab and would show the splash again.
  const locationState = useLocation().state as unknown;
  return (
    <div
      data-testid="library"
      data-loc-state={JSON.stringify(locationState ?? null)}
    />
  );
}

function tree() {
  return (
    <MemoryRouter initialEntries={["/app"]}>
      <Routes>
        <Route path="/" element={<div data-testid="public-home" />} />
        <Route path="/app" element={<SessionGate />}>
          <Route index element={<FakeLibrary />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

function renderGate(path = "/app", state?: unknown) {
  return render(gateAt(path, state));
}

// A fresh element each call, so a `rerender` reaches the gate; MemoryRouter
// ignores a changed `initialEntries` after mount, so the route is kept.
function gateAt(path: string, state?: unknown) {
  return (
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/" element={<div data-testid="public-home" />} />
        <Route path="/app" element={<SessionGate />}>
          <Route index element={<FakeLibrary />} />
          {/* The editor route's stand-in reports nothing, as the real one
              cannot: `reportDataReady` is the shelf's verdict about the
              shelf, and the editor half does not know the shell's outlet
              context. */}
          <Route
            path="project/:projectId"
            element={<div data-testid="editor" />}
          />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockStatus = "anonymous";
  mockUser = null;
  mockReportsDataReady = false;
  markWelcomedMock.mockReset();
  purgeOtherUsersLocalDataMock.mockReset().mockResolvedValue(undefined);
  syncProfileMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("SessionGate", () => {
  // `dataReady` is `Library`'s report alone, and the overlay combines it with
  // its own floor before revealing. On a route with no `Library` nothing
  // reports, so off the shelf the gate waits for no shelf verdict; otherwise
  // the overlay would stand forever over an open editor. The
  // editor holds on its own entry.
  it("does not wait for a shelf verdict on a route with no shelf", async () => {
    mockStatus = "authenticated";
    mockUser = { id: "u1", email: "a@b.c" };
    renderGate("/app/project/id-1");

    expect(screen.getByTestId("editor")).toBeTruthy();
    expect(screen.getByTestId("app-boot").getAttribute("data-ready")).toBe(
      "true",
    );
    // The overlay lifts, not merely marked ready.
    await waitFor(() => expect(screen.queryByTestId("app-boot")).toBeNull());
  });

  it("does not wait for one on a case-variant project address either", async () => {
    // The router matches paths case-insensitively, so `/App/Project/<id>`
    // mounts the editor, and the gate must read it as the editor too.
    mockStatus = "authenticated";
    mockUser = { id: "u1", email: "a@b.c" };
    renderGate("/App/Project/id-1");

    expect(screen.getByTestId("editor")).toBeTruthy();
    expect(screen.getByTestId("app-boot").getAttribute("data-ready")).toBe(
      "true",
    );
    await waitFor(() => expect(screen.queryByTestId("app-boot")).toBeNull());
  });

  it("still waits for the shelf's own verdict on the shelf", () => {
    mockStatus = "authenticated";
    mockUser = { id: "u1", email: "a@b.c" };
    mockReportsDataReady = false;
    renderGate();
    expect(screen.getByTestId("app-boot").getAttribute("data-ready")).toBe(
      "false",
    );
  });

  it("redirects to / when auth resolves to nobody", async () => {
    mockStatus = "anonymous";
    renderGate();
    await waitFor(() => expect(screen.getByTestId("public-home")).toBeTruthy());
  });

  it("mounts Library immediately once an id is confirmed, under an AppBoot overlay", () => {
    mockStatus = "authenticated";
    mockUser = { id: "u1", email: "a@b.c" };
    renderGate();

    // Both present at once: the overlay sits over the mounting shelf and does
    // not hold it back.
    expect(screen.getByTestId("library")).toBeTruthy();
    expect(screen.getByTestId("app-boot")).toBeTruthy();
  });

  it("fires the sweep and the sync in the background without blocking the mount", () => {
    mockStatus = "authenticated";
    mockUser = { id: "u1", email: "a@b.c" };
    renderGate();

    expect(purgeOtherUsersLocalDataMock).toHaveBeenCalledWith("u1");
    expect(syncProfileMock).toHaveBeenCalledWith("u1");
    // Library mounted in the same render: neither call was awaited before the
    // outlet appeared.
    expect(screen.getByTestId("library")).toBeTruthy();
  });

  it("spares every account that left its things here", async () => {
    const { saveWriter, resetRegistryForTests } =
      await import("../../writers/registry");
    const { newWriter, newWriterId } =
      await import("../../writers/domain/writer");
    localStorage.clear();
    resetRegistryForTests();
    const current = newWriter(newWriterId(), null, new Date());
    const left = newWriter(
      newWriterId(),
      {
        iss: "https://accounts.google.com",
        sub: "g-ada",
        email: "ada@example.test",
        emailVerified: true,
        name: "Ada",
        picture: null,
      },
      new Date(),
    );
    saveWriter(current);
    saveWriter(left);
    mockStatus = "authenticated";
    mockUser = { id: current.id, email: "" };
    renderGate();

    expect(purgeOtherUsersLocalDataMock).toHaveBeenCalledWith(
      current.id,
      left.id,
    );
    localStorage.clear();
    resetRegistryForTests();
  });

  it("lifts the AppBoot overlay once it reveals", async () => {
    mockStatus = "authenticated";
    mockUser = { id: "u1", email: "a@b.c" };
    renderGate();
    expect(screen.getByTestId("app-boot")).toBeTruthy();

    // The mocked `AppBoot` calls `onReveal` on a microtask after mounting.
    await waitFor(() => expect(screen.queryByTestId("app-boot")).toBeNull());
    expect(screen.getByTestId("library")).toBeTruthy();
  });

  it("shows LoginSplash instead of AppBoot when arriving with justLoggedIn nav state, and dismisses once it finishes", async () => {
    mockStatus = "authenticated";
    mockUser = { id: "u1", email: "a@b.c" };
    renderGate("/app", { justLoggedIn: true });

    expect(screen.getByTestId("login-splash")).toBeTruthy();
    expect(screen.queryByTestId("app-boot")).toBeNull();
    // The shelf is already mounting underneath; only the overlay is gated.
    expect(screen.getByTestId("library")).toBeTruthy();

    // The mocked `LoginSplash` calls `onFinished` on a microtask after
    // mounting.
    await waitFor(() =>
      expect(screen.queryByTestId("login-splash")).toBeNull(),
    );
  });

  it("marks the account welcomed when its splash plays", () => {
    mockStatus = "authenticated";
    mockUser = { id: "u1", email: "a@b.c" };
    renderGate("/app", { justLoggedIn: true });
    expect(markWelcomedMock).toHaveBeenCalledTimes(1);
  });

  // Once per account: a returning account's sign-in boots like a refresh.
  it("boots a welcomed account's sign-in under AppBoot, not the splash", () => {
    mockStatus = "authenticated";
    mockUser = { id: "u1", email: "a@b.c", welcomed: true };
    renderGate("/app", { justLoggedIn: true });

    expect(screen.getByTestId("app-boot")).toBeTruthy();
    expect(screen.queryByTestId("login-splash")).toBeNull();
    expect(markWelcomedMock).not.toHaveBeenCalled();
  });

  it("a plain reload (no nav state) never shows the splash", () => {
    mockStatus = "authenticated";
    mockUser = { id: "u1", email: "a@b.c" };
    renderGate("/app");

    expect(screen.getByTestId("app-boot")).toBeTruthy();
    expect(screen.queryByTestId("login-splash")).toBeNull();
  });

  it("does not replay the sweep when AuthContext.refresh() hands back a new user object on the same id", () => {
    mockStatus = "authenticated";
    mockUser = { id: "u1", email: "a@b.c" };
    const { rerender } = renderGate();

    expect(purgeOtherUsersLocalDataMock).toHaveBeenCalledTimes(1);

    // A fresh object with the same id, as `AuthContext.refresh()` produces.
    mockUser = { id: "u1", email: "a-new-email@b.c" };
    rerender(tree());

    expect(purgeOtherUsersLocalDataMock).toHaveBeenCalledTimes(1);
    expect(syncProfileMock).toHaveBeenCalledTimes(1);
  });

  it("clears the justLoggedIn nav state after mounting, so a reload of this tab does not see it again", async () => {
    mockStatus = "authenticated";
    mockUser = { id: "u1", email: "a@b.c" };
    renderGate("/app", { justLoggedIn: true });

    // The captured decision still shows the splash for this mount,
    expect(screen.getByTestId("login-splash")).toBeTruthy();
    // while the nav state is already cleared, which is what a later reload of
    // this tab sees.
    await waitFor(() =>
      expect(screen.getByTestId("library").getAttribute("data-loc-state")).toBe(
        "{}",
      ),
    );
  });

  it("never touches the nav state on a plain reload (no justLoggedIn to begin with)", () => {
    mockStatus = "authenticated";
    mockUser = { id: "u1", email: "a@b.c" };
    renderGate("/app");

    expect(screen.getByTestId("library").getAttribute("data-loc-state")).toBe(
      "null",
    );
  });

  it("passes dataReady=false to the overlay until Library reports its verdict", () => {
    mockStatus = "authenticated";
    mockUser = { id: "u1", email: "a@b.c" };
    mockReportsDataReady = false;
    renderGate();

    expect(screen.getByTestId("app-boot").getAttribute("data-ready")).toBe(
      "false",
    );
  });

  it("flips dataReady to true once Library calls reportDataReady through the outlet context", async () => {
    mockStatus = "authenticated";
    mockUser = { id: "u1", email: "a@b.c" };
    mockReportsDataReady = true;
    renderGate();

    await waitFor(() =>
      expect(screen.getByTestId("app-boot").getAttribute("data-ready")).toBe(
        "true",
      ),
    );
  });
});
