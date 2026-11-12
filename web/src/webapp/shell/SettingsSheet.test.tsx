// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { matte as matteFamily } from "../../theme/themes/matte";
import { shine as shineFamily } from "../../theme/themes/shine";
// `SettingsSheet` is imported dynamically in `mountSheet`: its `profileSync`
// dependency reads module-level auth state, which `vi.resetModules()` must
// re-instantiate before the component's graph is built, and a static import
// would keep the pre-reset instance.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

const authUser = {
  id: "u1",
  email: "writer@example.test",
  driveEmail: null,
  withGoogle: true,
};
vi.mock("../../auth/AuthContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../auth/AuthContext")>()),
  useAuth: () => ({ user: authUser }),
}));

const themeSpies = vi.hoisted(() => ({
  setFamily: vi.fn(),
  setScheme: vi.fn(),
}));

vi.mock("../../theme", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../theme")>();
  const matteLight = (await import("../../theme/themes/matte")).matte.light;
  const matteDark = (await import("../../theme/themes/matte")).matte.dark;
  const shineLight = (await import("../../theme/themes/shine")).shine.light;
  const shineDark = (await import("../../theme/themes/shine")).shine.dark;
  return {
    ...actual,
    useTheme: () => ({
      theme: matteLight,
      mode: "light",
      themes: [matteLight, matteDark],
      families: [
        { id: "matte", label: "Matte", light: matteLight, dark: matteDark },
        { id: "shine", label: "Shine", light: shineLight, dark: shineDark },
      ],
      setTheme: vi.fn(),
      ...themeSpies,
    }),
  };
});

// The global Editor Settings pane's read, render and write path. The pane
// mirrors `profile.<userId>` into local state on mount, and a change writes
// the account's profile through the prefs facade; this suite pins both,
// end to end.

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function mountSheet(path = "/settings") {
  const { setCurrentUserId } = await import("../../auth/currentUser");
  setCurrentUserId("u1");
  localStorage.setItem(
    "profile.u1",
    JSON.stringify({
      doc: {
        v: 1,
        installation: "test-install",
        prefs: {
          typewriter: { value: true, updatedAt: "2026-01-01T00:00:00.000Z" },
        },
        library: {},
      },
    }),
  );
  const { default: SettingsSheet } = await import("./SettingsSheet");
  const router = createMemoryRouter(
    [{ path: "/settings", element: <SettingsSheet /> }],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

/** The preferences the account's profile holds. */
function storedPrefs(): Record<string, { value: unknown } | undefined> {
  return (
    (
      JSON.parse(localStorage.getItem("profile.u1") ?? "{}") as {
        doc?: { prefs?: Record<string, { value: unknown }> };
      }
    ).doc?.prefs ?? {}
  );
}

const editorPane = () =>
  screen.getByRole("button", { name: "settings.paneEditor" });

describe("SettingsSheet — the global Editor Settings pane", () => {
  it("mirrors the user's stored preference into the control on mount", async () => {
    await mountSheet();

    // The pane is not the default: open it first.
    fireEvent.click(editorPane());

    // The seeded store has typewriter on, and the control shows it.
    const group = screen.getByRole("group", { name: "tree.typewriter" });
    const pressed = within(group).getByText("settings.turnedOn");
    expect(pressed.closest("button")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("writes a change through the prefs facade into the profile", async () => {
    await mountSheet();
    fireEvent.click(editorPane());

    // Turn typewriter off.
    const group = screen.getByRole("group", { name: "tree.typewriter" });
    fireEvent.click(within(group).getByText("settings.turnedOff"));

    expect(storedPrefs().typewriter?.value).toBe(false);
  });
});

describe("SettingsSheet — Henosis mode", () => {
  it("is off with its steps hidden, and turning it on shows and writes them", async () => {
    await mountSheet();
    fireEvent.click(editorPane());

    const group = screen.getByRole("group", { name: "tree.henosis" });
    expect(
      within(group)
        .getByText("settings.turnedOff")
        .closest("button")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.queryByRole("combobox", { name: "tree.henosisAfter" }),
    ).toBeNull();

    fireEvent.click(within(group).getByText("settings.turnedOn"));
    const after = screen.getByRole("combobox", {
      name: "tree.henosisAfter",
    }) as HTMLSelectElement;
    const fade = screen.getByRole("combobox", {
      name: "tree.henosisFade",
    }) as HTMLSelectElement;
    expect(after.value).toBe("2");
    expect(fade.value).toBe("3");
    fireEvent.change(after, { target: { value: "3" } });
    fireEvent.change(fade, { target: { value: "0" } });
    const pause = screen.getByRole("combobox", {
      name: "tree.henosisPause",
    }) as HTMLSelectElement;
    expect(pause.value).toBe("10");
    fireEvent.change(pause, { target: { value: "8" } });

    const stored = storedPrefs();
    const wrote = (key: string, value: unknown) => stored[key]?.value === value;
    expect(wrote("henosis", true)).toBe(true);
    expect(wrote("henosisAfter", 3)).toBe(true);
    expect(wrote("henosisFade", 0)).toBe(true);
    expect(wrote("henosisPause", 8)).toBe(true);
  });
});

describe("SettingsSheet — Who you are", () => {
  it("shows the account and the way to sign out", async () => {
    await mountSheet();

    fireEvent.click(screen.getByRole("button", { name: "settings.paneYou" }));

    expect(screen.getByText("writer@example.test")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "library.signOut" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "settings.deleteAccount" }),
    ).toBeTruthy();
  });

  it("says there is no Google account, and that the shelf stays on this device", async () => {
    authUser.withGoogle = false;
    authUser.email = "";
    try {
      await mountSheet();
      fireEvent.click(screen.getByRole("button", { name: "settings.paneYou" }));
      // No name to show: no line stands in for one.
      expect(screen.queryByText("settings.accountWithoutGoogle")).toBeNull();
      expect(document.querySelector(".setting-key")).toBeNull();
      expect(
        screen.getByText("settings.accountNoteWithoutGoogle"),
      ).toBeTruthy();
    } finally {
      authUser.withGoogle = true;
      authUser.email = "writer@example.test";
    }
  });
});

describe("SettingsSheet — where the words go", () => {
  it("shows Remote Storage dimmed with the reason and no control to a writer without Google", async () => {
    authUser.withGoogle = false;
    try {
      await mountSheet();
      fireEvent.click(
        screen.getByRole("button", { name: "settings.paneWords" }),
      );
      expect(screen.getByText("library.driveNeedsAccount")).toBeTruthy();
      expect(screen.queryByText("settings.driveExplainer")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "library.connect" }),
      ).toBeNull();
      const card = screen
        .getByText("library.driveNeedsAccount")
        .closest(".ui-access");
      expect(card?.getAttribute("data-unavailable")).toBe("1");
    } finally {
      authUser.withGoogle = true;
    }
  });

  it("offers Remote Storage to a Google writer", async () => {
    await mountSheet();
    fireEvent.click(screen.getByRole("button", { name: "settings.paneWords" }));
    expect(
      screen.getByRole("button", { name: "library.connect" }),
    ).toBeTruthy();
    expect(screen.queryByText("library.driveNeedsAccount")).toBeNull();
  });
});

describe("SettingsSheet — deleting the account", () => {
  it("offers a Google account its deletion, and asks before anything happens", async () => {
    await mountSheet();
    fireEvent.click(screen.getByRole("button", { name: "settings.paneYou" }));
    fireEvent.click(
      screen.getByRole("button", { name: "settings.deleteAccount" }),
    );
    expect(screen.getByText("settings.deleteAccountTitle")).toBeTruthy();
    expect(screen.getByText("settings.deleteAccountLead")).toBeTruthy();
    expect(screen.getByText("accountData.unsynced")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "settings.deleteAccountCancel" }),
    );
  });

  it("offers no deletion to an account without Google", async () => {
    authUser.withGoogle = false;
    try {
      await mountSheet();
      fireEvent.click(screen.getByRole("button", { name: "settings.paneYou" }));
      expect(
        screen.queryByRole("button", { name: "settings.deleteAccount" }),
      ).toBeNull();
    } finally {
      authUser.withGoogle = true;
    }
  });
});

describe("SettingsSheet — About", () => {
  it("states the license and links to its text, not to the repository", async () => {
    await mountSheet();

    fireEvent.click(screen.getByRole("button", { name: "settings.paneAbout" }));

    expect(screen.getByText("settings.aboutLicense")).toBeTruthy();
    const link = screen.getByRole("link", {
      name: "settings.aboutLicenseLink",
    });
    expect(link.getAttribute("href")).toBe(
      "https://www.gnu.org/licenses/agpl-3.0.html",
    );
    // A new tab that cannot reach back into this one.
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("states the version this build runs", async () => {
    await mountSheet();

    fireEvent.click(screen.getByRole("button", { name: "settings.paneAbout" }));

    expect(screen.getByText("settings.aboutVersion")).toBeTruthy();
  });

  it("links to the source repository in a new tab", async () => {
    await mountSheet();

    fireEvent.click(screen.getByRole("button", { name: "settings.paneAbout" }));

    const link = screen.getByRole("link", {
      name: "settings.aboutSourceLink",
    });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/perseomazzoni/phospheare",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});

// A theme, then its variant: two tiles named for the themes, and a switch
// named for the variants, which are the same pair in every theme.
describe("SettingsSheet — choosing a theme and its variant", () => {
  it("offers the themes by name, then once dark, still dark or the system", async () => {
    themeSpies.setFamily.mockClear();
    themeSpies.setScheme.mockClear();
    await mountSheet();

    const matte = screen.getByRole("button", { name: /Matte/ });
    const shine = screen.getByRole("button", { name: /Shine/ });
    expect(matte.getAttribute("data-on")).toBe("1");
    expect(shine.getAttribute("data-on")).toBe("0");
    fireEvent.click(shine);
    expect(themeSpies.setFamily).toHaveBeenCalledWith("shine");

    const variant = screen.getByRole("group", {
      name: "settings.themeVariant",
    });
    const once = within(variant).getByText("once dark").closest("button");
    const still = within(variant).getByText("still dark").closest("button");
    expect(once?.getAttribute("aria-pressed")).toBe("true");
    expect(still?.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(still as HTMLElement);
    expect(themeSpies.setScheme).toHaveBeenCalledWith("dark");
    const system = within(variant)
      .getByText("settings.themeSystem")
      .closest("button");
    expect(system?.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(system as HTMLElement);
    expect(themeSpies.setScheme).toHaveBeenCalledWith("system");
  });

  // Paper, ink and one accent are close in every theme, so tiles drawn from
  // them alone look alike. A tile is painted by its own variant's tokens,
  // ground, grain and glass included, set on its face, while the button keeps
  // the page's, so the selection ring stays in the page's accent.
  it("paints each tile with its own variant's tokens, the button with the page's", async () => {
    await mountSheet();

    const matte = screen.getByRole("button", { name: /Matte/ });
    const shine = screen.getByRole("button", { name: /Shine/ });
    expect(matte.getAttribute("aria-pressed")).toBe("true");
    expect(shine.getAttribute("aria-pressed")).toBe("false");

    const face = (tile: HTMLElement) => {
      const painted = tile.querySelector<HTMLElement>(".tile-face");
      if (!painted) throw new Error("a tile has no face");
      return painted.style;
    };
    // The page is on matte-light, so each tile shows its theme's light.
    expect(face(matte).getPropertyValue("--paper")).toBe(
      matteFamily.light.tokens["--paper"],
    );
    expect(face(shine).getPropertyValue("--paper")).toBe(
      shineFamily.light.tokens["--paper"],
    );
    expect(face(shine).getPropertyValue("--grain")).toBe("none");
    expect(face(matte).getPropertyValue("--grain")).not.toBe("none");
    expect(shine.style.getPropertyValue("--paper")).toBe("");
  });
});
