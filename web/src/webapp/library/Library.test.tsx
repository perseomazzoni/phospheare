// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  createMemoryRouter,
  MemoryRouter,
  Outlet,
  RouterProvider,
} from "react-router";
import type { ProjectCard } from "./useProjects";

// Renders the Library screen with its data hooks mocked, so the composition
// root itself is exercised: the shelf shell, the writer's avatar, and the
// welcome a new writer sees.

// `mockLanguage` is mutable so a test can simulate a language change.
// `useTranslation()` runs on every render, so reading the
// module-level variable picks up a change made before the next render.
let mockLanguage = "en";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // A context names the line's form, so a test can tell which one is read.
    t: (key: string, options?: { context?: string }) =>
      options?.context ? `${key}_${options.context}` : key,
    // `getFixedT`: the import window names made-up chapters in the book's
    // language, through a translator fixed to it.
    i18n: { language: mockLanguage, getFixedT: () => (key: string) => key },
  }),
}));

// A Google writer unless a test sets `mockWithGoogle.value` to false. Only a
// Google account carries a name.
const mockWithGoogle = { value: true };

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "u1",
      email: "maren@phospheare.app",
      name: mockWithGoogle.value ? "Maren" : "",
      avatarUrl: "https://example.com/maren.png",
      driveEmail: null,
      driveConnected: false,
      withGoogle: mockWithGoogle.value,
    },
    // The banners key on the Drive verdict only after auth has answered;
    // the mock answers immediately.
    status: "authenticated",
  }),
}));

// Stable across renders, unlike a fresh `vi.fn()` per `useConnections()`
// call, so a test can assert on the instance the palette or settings action
// invoked. `mockDriveState` lets a test put Drive into "connected" to reach
// the disconnect palette entry rather than the connect one.
let mockDriveState: "unset" | "connected" = "unset";
const driveDisconnect = vi.fn<(options?: unknown) => Promise<void>>(
  async () => {},
);
const deleteAllProfileCopies = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../profile/portableDrive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../profile/portableDrive")>()),
  deleteAllProfileCopies,
}));
const driveConnect = vi.fn(async () => true);

vi.mock("../../storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../storage")>();
  return {
    ...actual,
    useConnections: () => ({
      drive: {
        id: "drive",
        kind: "device" as const,
        label: () => "Google Drive",
        icon: "drive",
        get state() {
          return mockDriveState;
        },
        resolved: true,
        error: null,
        connect: driveConnect,
        disconnect: driveDisconnect,
        reconnect: vi.fn(async () => "granted"),
        refresh: vi.fn(async () => "unset"),
      },
      local: {
        id: "local",
        label: () => "This device",
        icon: "local",
        state: "connected",
        resolved: true,
        error: null,
        connect: vi.fn(async () => true),
        disconnect: vi.fn(async () => {}),
        reconnect: vi.fn(async () => "granted"),
        refresh: vi.fn(async () => "connected"),
      },
    }),
  };
});

// Mutable for the same reason as `mockLanguage`.
let mockThemeId = "matte-light";
const setTheme = vi.fn();
vi.mock("../../theme", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../theme")>();
  return {
    ...actual,
    useTheme: () => ({ theme: { id: mockThemeId }, setTheme }),
  };
});

// The banner rows need a shelf with cards; the mock reads this mutable state.
let mockCards: ProjectCard[] = [];
let mockLocalRootReady = true;
let mockLocalRootResolved = true;
// Stable across renders, unlike a fresh `vi.fn()` per `useProjects()` call,
// so a test can assert on the instance a `Library.tsx` flow (such as
// `disconnectDrive`) called.
const mockRescan = vi.fn();
let mockConflicts = new Map<string, unknown>();
const mockUnpair = vi.fn();

vi.mock("./useProjects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useProjects")>();
  return {
    ...actual,
    useProjects: () => ({
      cards: mockCards,
      listing: false,
      gatherStarts: 0,
      gatherSettles: 0,
      reconnect: vi.fn(),
      revalidate: vi.fn(),
      adopt: vi.fn(),
      drop: vi.fn(),
      forget: vi.fn(),
      synced: new Set(),
      markSynced: vi.fn(),
      conflicts: mockConflicts,
      checkNow: vi.fn(),
      resolve: vi.fn(),
      unpair: mockUnpair,
      scanDrive: vi.fn(),
      scanLocal: vi.fn(),
      localRootReady: mockLocalRootReady,
      localRootResolved: mockLocalRootResolved,
      rescan: mockRescan,
      refreshContent: vi.fn(),
    }),
  };
});

beforeEach(() => {
  mockWithGoogle.value = true;
  sessionStorage.clear();
  mockCards = [];
  mockLocalRootReady = true;
  mockLocalRootResolved = true;
  mockDriveState = "unset";
  driveDisconnect.mockClear();
  deleteAllProfileCopies.mockReset().mockResolvedValue(undefined);
  driveConnect.mockClear();
  mockRescan.mockClear();
  mockConflicts = new Map();
  mockUnpair.mockReset();
  mockLanguage = "en";
  mockThemeId = "matte-light";
  setTheme.mockClear();
  capturedReconcileUI = null;
  reconcileUICalls = 0;
  capturedRevealOptions = null;
  // jsdom has no layout engine, so `scrollIntoView` does not exist, and
  // `CommandPalette` calls it to keep the highlighted row in view.
  Element.prototype.scrollIntoView = vi.fn();
});

// The `reconcileUI` that Library passed on the latest render, through
// `useLibraryReveal`'s options, so a test can check whether it changed.
// `reconcileUICalls` proves the render happened again; without
// it, a rerender that did not propagate would pass the identity assertion.
let capturedReconcileUI: (() => void) | null = null;
let reconcileUICalls = 0;

// `useLibraryReveal`'s own behaviour is pinned in its own test file; here
// only the wiring is. Library hands it the mirror-emptiness
// fact captured at mount, the shelf's gather generation, the real `rescan`
// and `refreshContent`, the reconcile, and the outlet context's
// `reportDataReady`, or the module's stable no-op outside `SessionGate`.
let capturedRevealOptions: {
  userId: string;
  mirrorEmpty: boolean;
  gatherStarts: number;
  gatherSettles: number;
  rescan: unknown;
  refreshContent: unknown;
  reconcileUI: () => void;
  reportDataReady: () => void;
} | null = null;
vi.mock("./useLibraryReveal", () => ({
  useLibraryReveal: (opts: NonNullable<typeof capturedRevealOptions>) => {
    capturedRevealOptions = opts;
    capturedReconcileUI = opts.reconcileUI;
    reconcileUICalls++;
  },
}));

import Library from "./Library";
import { PRODUCT } from "../../product";

afterEach(() => cleanup());

// A minimal local card, enough for the banner rows' `cards.some(...)`.
const localCard: ProjectCard = {
  id: "book-k1",
  ref: { providerId: "local", key: "k1", name: "K1", openedAt: "" },
  state: "gone",
  content: null,
  fresh: false,
  problem: null,
};

// A drive card in the blocked state — the banner rows' other half.
const driveCard = (): ProjectCard => ({
  id: "book-d1",
  ref: { providerId: "drive", key: "d1", name: "D1", openedAt: "" },
  state: "blocked",
  content: null,
  fresh: false,
  problem: null,
});

/**
 * Opens the shelf's storage panel and chooses a store by row, which filters
 * the shelf. Rows are All (0), This device (1), Google Drive (2); the radio
 * name is the storage panel's own, which the mock's `t` cannot alter.
 */
function selectStore(index: number) {
  fireEvent.click(screen.getByRole("button", { name: "library.storageLabel" }));
  const radios = document.querySelectorAll<HTMLInputElement>(
    'input[name="shelf-source"]',
  );
  fireEvent.click(radios[index]);
}

function mount(state?: unknown) {
  const router = createMemoryRouter([{ path: "/", element: <Library /> }], {
    initialEntries: [{ pathname: "/", state }],
  });
  render(<RouterProvider router={router} />);
  return { router };
}

/** Ctrl+K, the shortcut the shelf listens for in the capture phase. */
function openPalette() {
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
}

// The other half of the uuid address in `editor/path.ts`: a link that
// resolves to nothing sends the writer here, and the shelf tells them why.
// `EditorRoute` cannot, because it has unmounted by then.
describe("a project link that led nowhere", () => {
  it("says so, once, and does not say it again on a reload", async () => {
    const { router } = mount({ unknownProject: true });
    expect(await screen.findByText("library.unknownProject")).toBeTruthy();

    // The history entry is cleared on the way, because `location.state` lives
    // in `history.state` and survives a reload of the tab, so a dead link
    // would be re-announced on every refresh. `SessionGate` does the same for
    // `justLoggedIn`.
    await waitFor(() => expect(router.state.location.state).toEqual({}));
  });

  it("says nothing when the writer simply came to the shelf", () => {
    mount();
    expect(screen.queryByText("library.unknownProject")).toBeNull();
  });
});

describe("Library", () => {
  // The gather does not react to `driveConnected` on its own, so
  // `disconnectDrive`, the palette's wrapping of `conns.drive.disconnect`,
  // tells the shelf to repaint. Without the rescan, every Drive card
  // would stay as it was.
  it("disconnecting Drive from the command palette rescans the shelf afterward", async () => {
    mockDriveState = "connected";
    mount();

    openPalette();
    const option = await screen.findByRole("option", {
      name: /library\.disconnectDrive/,
    });
    fireEvent.click(option);
    // The disconnect asks one question: from where, and whether settings
    // and library stay there.
    fireEvent.click(
      await screen.findByRole("radio", {
        name: "library.disconnectRemoteEverywhere",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "library.disconnectRemoteConfirm" }),
    );

    await vi.waitFor(() =>
      expect(driveDisconnect).toHaveBeenCalledWith({
        everywhere: true,
        keptCopies: true,
      }),
    );
    await vi.waitFor(() => expect(mockRescan).toHaveBeenCalled());
    expect(deleteAllProfileCopies).not.toHaveBeenCalled();
  });

  it("disconnects this browser only, leaving the copies, when asked", async () => {
    mockDriveState = "connected";
    mount();

    openPalette();
    fireEvent.click(
      await screen.findByRole("option", { name: /library.disconnectDrive/ }),
    );
    fireEvent.click(
      await screen.findByRole("radio", {
        name: "library.disconnectRemoteHere",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "library.disconnectRemoteConfirm" }),
    );

    await vi.waitFor(() =>
      expect(driveDisconnect).toHaveBeenCalledWith({ everywhere: false }),
    );
    await vi.waitFor(() => expect(mockRescan).toHaveBeenCalled());
    expect(deleteAllProfileCopies).not.toHaveBeenCalled();
  });

  it("removes settings and library from Remote Storage before disconnecting, when asked", async () => {
    mockDriveState = "connected";
    const order: string[] = [];
    deleteAllProfileCopies.mockImplementationOnce(async () => {
      order.push("remove");
    });
    driveDisconnect.mockImplementationOnce(async () => {
      order.push("disconnect");
    });
    mount();

    openPalette();
    fireEvent.click(
      await screen.findByRole("option", { name: /library.disconnectDrive/ }),
    );
    fireEvent.click(
      await screen.findByRole("radio", {
        name: "library.disconnectRemoteEverywhereDelete",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "library.disconnectRemoteConfirmDelete",
      }),
    );

    await vi.waitFor(() => expect(order).toEqual(["remove", "disconnect"]));
  });

  it("stays connected when settings and library could not be removed", async () => {
    mockDriveState = "connected";
    deleteAllProfileCopies.mockRejectedValueOnce(new Error("offline"));
    mount();

    openPalette();
    fireEvent.click(
      await screen.findByRole("option", { name: /library.disconnectDrive/ }),
    );
    fireEvent.click(
      await screen.findByRole("radio", {
        name: "library.disconnectRemoteEverywhereDelete",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "library.disconnectRemoteConfirmDelete",
      }),
    );

    expect(
      await screen.findByText("library.disconnectRemoteFailed"),
    ).toBeTruthy();
    expect(driveDisconnect).not.toHaveBeenCalled();
  });

  // The palette is one of the ways into the import window, fetched on first use
  // through `loadImport`.
  it("opens the import window from the command palette", async () => {
    mockDriveState = "connected";
    mount();

    openPalette();
    fireEvent.click(
      await screen.findByRole("option", { name: /import.heading/ }),
    );

    expect(
      // The window is its own chunk: the first fetch in a busy run is slow.
      await screen.findByRole(
        "heading",
        { name: /import.step.choose/ },
        { timeout: 5000 },
      ),
    ).toBeTruthy();
  });

  it("leaves Remote Storage out of the command palette for a writer without Google", async () => {
    mockWithGoogle.value = false;
    mount();

    openPalette();
    await screen.findByRole("option", { name: /settings.title/ });
    expect(
      screen.queryByRole("option", { name: /library\.connectDrive/ }),
    ).toBeNull();
  });

  // `reconcilePrefsUI` does not depend on `theme.id` or `i18n.language`. It
  // can call `setTheme` or `setLanguage` itself, so a dependency on either
  // would recreate it, an option of `useLibraryReveal`'s settled bridge, and
  // re-run the reconciliation for a change it caused.
  it("reconcilePrefsUI keeps its identity across a theme or language change", () => {
    // A plain `MemoryRouter`, not `mount()`'s `createMemoryRouter` harness:
    // that router's rerender reaches the matched route element only when
    // routing changed, so Library would not re-render and the test would
    // pass vacuously. `useNavigate()` needs only Router context, and the
    // unmatched nested "settings" route renders nothing.
    const { rerender } = render(
      <MemoryRouter>
        <Library />
      </MemoryRouter>,
    );
    const before = capturedReconcileUI;
    const callsAfterMount = reconcileUICalls;
    expect(before).not.toBeNull();
    expect(callsAfterMount).toBeGreaterThan(0);

    mockThemeId = "midnight";
    mockLanguage = "it";
    rerender(
      <MemoryRouter>
        <Library />
      </MemoryRouter>,
    );

    // The rerender reached `useLibraryReveal` again; otherwise the identity
    // assertion below would pass with nothing re-run.
    expect(reconcileUICalls).toBeGreaterThan(callsAfterMount);
    expect(capturedReconcileUI).toBe(before);
  });

  it("renders the shelf shell with the writer's avatar", () => {
    mount();
    expect(screen.getByText(PRODUCT.name)).toBeTruthy();
    // The avatar is drawn from the account's own picture, not the initial.
    const avatar = document.querySelector(".app-avatar") as HTMLImageElement;
    expect(avatar).toBeTruthy();
    expect(avatar.src).toContain("maren.png");
  });

  it("warns with the orange banner when local cards exist but no root is chosen - the local twin of Drive's disconnected banner, same rule", () => {
    mockCards = [localCard];
    mockLocalRootReady = false;
    mount();

    expect(screen.getByText("library.localDisconnectedBanner")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "library.chooseLocalFolder" }),
    ).toBeTruthy();
  });

  it("keeps the local banner away when no local card is on the shelf", () => {
    mockLocalRootReady = false;
    mount();
    expect(screen.queryByText("library.localDisconnectedBanner")).toBeNull();
  });

  it("keeps the local banner away when the root is chosen", () => {
    mockCards = [localCard];
    mount();
    expect(screen.queryByText("library.localDisconnectedBanner")).toBeNull();
  });

  it("holds the local banner while the handle store has not answered yet - no flash on refresh", () => {
    // Cards paint from the cache in the first frame, while `localRootReady`
    // is still false only because the IndexedDB read has not landed. An
    // unresolved "no root" is not a fact, so no banner flashes on refresh.
    mockCards = [localCard];
    mockLocalRootReady = false;
    mockLocalRootResolved = false;
    mount();
    expect(screen.queryByText("library.localDisconnectedBanner")).toBeNull();
  });

  const localCardIn = (state: ProjectCard["state"]): ProjectCard => ({
    ...localCard,
    state,
  });

  // A mapped root whose grant has lapsed settles local cards to blocked, and
  // that fact speaks once, with its own copy and Reconnect, which opens the
  // folder picker.
  it("warns when the root is mapped but its permission has lapsed (blocked cards)", () => {
    mockCards = [localCardIn("blocked")];
    mount();
    // The row pins the banner's action, so the query is scoped inside it.
    const banner = screen
      .getByText("library.localPermissionBanner")
      .closest(".ui-banner");
    expect(banner).toBeTruthy();
    expect(
      within(banner as HTMLElement).getByRole("button", {
        name: "library.reconnect",
      }),
    ).toBeTruthy();
  });

  it("keeps the lapsed-permission banner away while every local card reads fine", () => {
    mockCards = [localCardIn("ready")];
    mount();
    expect(screen.queryByText("library.localPermissionBanner")).toBeNull();
  });

  it("keeps the lapsed-permission banner away while the reads are still running", () => {
    // `loading` is not a verdict, and a banner that appears before the facts
    // settle is a flash.
    mockCards = [localCardIn("loading")];
    mount();
    expect(screen.queryByText("library.localPermissionBanner")).toBeNull();
  });
});

it("shows only the Drive banner when the shelf is filtered to Google Drive, even with local cards present", () => {
  mockCards = [driveCard(), localCard];
  mockLocalRootReady = false;
  mount();
  selectStore(2);
  expect(screen.getByText("library.driveDisconnectedBanner")).toBeTruthy();
  expect(screen.queryByText("library.localDisconnectedBanner")).toBeNull();
});

it("shows only the local banner when the shelf is filtered to This device", () => {
  mockCards = [driveCard(), localCard];
  mockLocalRootReady = false;
  mount();
  selectStore(1);
  expect(screen.getByText("library.localDisconnectedBanner")).toBeTruthy();
  expect(screen.queryByText("library.driveDisconnectedBanner")).toBeNull();
});

it("shows both banners under All when both stores are down", () => {
  mockCards = [driveCard(), localCard];
  mockLocalRootReady = false;
  mount();
  expect(screen.getByText("library.driveDisconnectedBanner")).toBeTruthy();
  expect(screen.getByText("library.localDisconnectedBanner")).toBeTruthy();
});

// A paired project whose Remote Storage copy is gone gets its own banner:
// there is no second version to keep, so the choices are to disable sync or
// to upload the device's copy again.
describe("a gone Remote Storage copy", () => {
  const goneResult = {
    remoteTarget: { providerId: "drive", key: "folder-1" },
    verdict: {
      files: [],
      conflict: true,
      toPull: [],
      toPush: [],
      remoteGone: true,
    },
    localStats: null,
    remoteStats: null,
  };

  it("offers Disable sync and Upload again instead of a side to keep", () => {
    mockCards = [localCard];
    mockConflicts = new Map([["book-k1", goneResult]]);
    mount();

    expect(screen.getByText("sync.goneTitle")).toBeTruthy();
    expect(screen.getByRole("button", { name: "library.unpair" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "sync.uploadAgain" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "sync.keepLocal" })).toBeNull();
  });

  it("Disable sync unpairs the card's project", async () => {
    mockCards = [localCard];
    mockConflicts = new Map([["book-k1", goneResult]]);
    mockUnpair.mockResolvedValue(undefined);
    mount();

    fireEvent.click(screen.getByRole("button", { name: "library.unpair" }));

    await vi.waitFor(() =>
      expect(mockUnpair).toHaveBeenCalledWith(localCard.ref),
    );
  });

  it("Upload again drops the old pairing first", async () => {
    mockCards = [localCard];
    mockConflicts = new Map([["book-k1", goneResult]]);
    // A failed unpair stops it there, before any upload starts.
    mockUnpair.mockRejectedValue(new Error("unpair failed"));
    mount();

    fireEvent.click(screen.getByRole("button", { name: "sync.uploadAgain" }));

    await vi.waitFor(() =>
      expect(mockUnpair).toHaveBeenCalledWith(localCard.ref),
    );
  });
});

// A shelf with no cards is the welcome: where the projects live, and the
// first project, which waits for a place.
describe("the welcome", () => {
  const greeting = () =>
    screen.getByRole("heading", { level: 1 }).getAttribute("aria-label") ?? "";
  const newProject = () =>
    screen.getByRole("button", { name: "library.newProject" });

  it("shows the places and the first project, and no shelf bar", () => {
    mount();
    expect(document.querySelector(".projects")).toBeNull();
    expect(
      screen.getByRole("region", { name: "library.setup.title" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "library.welcome.startTitle" }),
    ).toBeTruthy();
    // The start panel carries New project; a bar above it would repeat it.
    expect(document.querySelector(".shelf-bar-slot")).toBeNull();
  });

  // A writer with no projects is never greeted as a return.
  it("greets a writer with no projects from the first-visit pool", () => {
    mount();
    expect(greeting()).toMatch(/^library\.greetingFirst/);
  });

  it("greets a writer with projects from the returning pool", () => {
    mockCards = [localCard];
    mount();
    expect(greeting()).not.toMatch(/^library\.greetingFirst/);
  });

  it("greets a named writer by the line that carries the name", () => {
    mount();
    expect(greeting()).toMatch(/^library\.greeting[A-Za-z]+$/);
  });

  it("greets a writer without Google, who has no name, by the plain line", () => {
    mockWithGoogle.value = false;
    mount();
    expect(greeting()).toMatch(/^library\.greetingFirst\w+_plain$/);
  });

  // Choosing a folder with projects in it must not take Remote Storage
  // away: the welcome stays until the writer leaves it, across the consent
  // redirect too, so the latch is in the tab's session.
  it("stays open when a place fills the shelf, until Show my projects", () => {
    sessionStorage.setItem("welcomeOpen:u1", "1");
    mockCards = [localCard];
    mount();
    expect(
      screen.getByRole("heading", { name: "library.welcome.foundTitle" }),
    ).toBeTruthy();
    expect(document.querySelector(".shelf-bar-slot")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "library.welcome.show" }),
    );
    expect(document.querySelector(".shelf-bar-slot")).toBeTruthy();
    expect(sessionStorage.getItem("welcomeOpen:u1")).toBeNull();
  });

  it("opens the latch when the welcome is drawn", () => {
    mount();
    expect(sessionStorage.getItem("welcomeOpen:u1")).toBe("1");
  });

  it("goes straight to the library for a writer who never had the welcome open", () => {
    mockCards = [localCard];
    mount();
    expect(
      screen.queryByRole("heading", { name: "library.welcome.foundTitle" }),
    ).toBeNull();
    expect(document.querySelector(".shelf-bar-slot")).toBeTruthy();
  });

  it("lets a project start once a place is ready", () => {
    mount();
    expect(newProject().hasAttribute("aria-disabled")).toBe(false);
    expect(screen.queryByText("library.welcome.lockNote")).toBeNull();
  });

  // Locked, not disabled: a press points at the places.
  it("locks New project until a place is ready, and a press points at the places", () => {
    mockLocalRootReady = false;
    mount();
    expect(newProject().getAttribute("aria-disabled")).toBe("true");
    expect(document.querySelector(".ui-checklist-flash")).toBeNull();
    fireEvent.click(newProject());
    expect(document.querySelectorAll(".ui-checklist-flash")).toHaveLength(2);
  });

  it("shows Remote Storage dimmed with the reason, and nothing to press, to a writer without Google", () => {
    mockWithGoogle.value = false;
    mockLocalRootReady = false;
    mount();
    expect(
      screen.queryByRole("button", { name: /library\.connectDrive/ }),
    ).toBeNull();
    const reason = screen.getByText("library.driveNeedsAccount");
    expect(
      reason.closest(".ui-checklist-step")?.getAttribute("data-unavailable"),
    ).toBe("1");
    // A press on the locked New project points only at the place that can
    // be set up.
    fireEvent.click(newProject());
    expect(document.querySelectorAll(".ui-checklist-flash")).toHaveLength(1);
  });
});

// `Greeting`'s one-shot typing does not play unseen behind `SessionGate`'s
// loading overlay: it holds `text=""` until the gate's `revealed` flag turns
// true, and `Greeting` restarts whenever `text` changes.
describe("the greeting waits for SessionGate's reveal signal", () => {
  function mountUnderGate(revealed: boolean, reportDataReady = () => {}) {
    const router = createMemoryRouter([
      {
        path: "/",
        element: <Outlet context={{ revealed, reportDataReady }} />,
        children: [{ index: true, element: <Library /> }],
      },
    ]);
    render(<RouterProvider router={router} />);
  }

  // Under the overlay an empty shelf may still be waiting for the account's
  // own list; an account with projects has set its places up already, so the
  // welcome is kept open only once it is seen.
  it("keeps the welcome open only once it is revealed", () => {
    mountUnderGate(false);
    expect(sessionStorage.getItem("welcomeOpen:u1")).toBeNull();
    cleanup();
    mountUnderGate(true);
    expect(sessionStorage.getItem("welcomeOpen:u1")).toBe("1");
  });

  it("renders an empty greeting while not yet revealed", () => {
    mountUnderGate(false);
    expect(
      screen.getByRole("heading", { level: 1 }).getAttribute("aria-label"),
    ).toBe("");
  });

  it("renders the real greeting once revealed", () => {
    mountUnderGate(true);
    expect(
      screen.getByRole("heading", { level: 1 }).getAttribute("aria-label"),
    ).not.toBe("");
  });

  it("defaults to revealed (plays immediately) when rendered outside SessionGate — the demo route, direct test renders", () => {
    mount();
    expect(
      screen.getByRole("heading", { level: 1 }).getAttribute("aria-label"),
    ).not.toBe("");
  });
});

// Pins only that `Library` hands `useLibraryReveal` the right facts; the
// hook's own test file covers its behaviour.
describe("useLibraryReveal wiring", () => {
  it("reports the mirror as empty when useProjects starts with no cards", () => {
    mockCards = [];
    mount();
    expect(capturedRevealOptions).not.toBeNull();
    expect(capturedRevealOptions?.mirrorEmpty).toBe(true);
    expect(capturedRevealOptions?.rescan).toBe(mockRescan);
  });

  it("reports the mirror as non-empty when useProjects starts with cards already", () => {
    mockCards = [localCard];
    mount();
    expect(capturedRevealOptions?.mirrorEmpty).toBe(false);
  });

  it("falls back to one no-op reportDataReady across renders outside SessionGate's route", async () => {
    // One function, so the reveal hook's effect never sees a fresh closure.
    const { router } = mount();
    const first = capturedRevealOptions?.reportDataReady;
    // A missing fallback would also compare equal across renders.
    expect(first).toBeTypeOf("function");
    await act(() => router.navigate("/", { state: { again: true } }));
    expect(capturedRevealOptions?.reportDataReady).toBe(first);
    expect(() => (first as () => void)()).not.toThrow();
  });

  it("passes the outlet context's own reportDataReady through when rendered under SessionGate", () => {
    const reportDataReady = vi.fn();
    const router = createMemoryRouter([
      {
        path: "/",
        element: <Outlet context={{ revealed: true, reportDataReady }} />,
        children: [{ index: true, element: <Library /> }],
      },
    ]);
    render(<RouterProvider router={router} />);

    expect(capturedRevealOptions?.reportDataReady).toBe(reportDataReady);
  });
});
