// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearThemes, register } from "./registry";
import { choices } from "../compose";
import { parseChoice } from "../domain/choice";

const {
  currentChoice,
  firstChoice,
  forgetOnDevice,
  keepOnDevice,
  resolveChoice,
  storedChoice,
} = choices;

/** The variant the choice in force puts on the page. */
const currentThemeForUser = () => resolveChoice(currentChoice());
import { setCurrentUserId } from "../../auth/currentUser";
import { setPref } from "../../profile/profileSync";
import { matte } from "../themes/matte";

// `setPref` pushes in the background once a user exists; nothing here is
// about Drive.
vi.mock("../../storage/driveProvider", () => ({
  driveProvider: {
    id: "drive",
    writeFile: () => Promise.resolve(),
    readFile: () => Promise.resolve("{}"),
  },
}));

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, String(value)),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

function prefersDark(dark: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: dark && query.includes("dark"),
    media: query,
  }));
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  clearThemes();
  // Registration order matters to `fallbackThemeId`, and matches
  // `theme/index.ts`.
  register(matte.light);
  register(matte.dark);
});

afterEach(() => {
  setCurrentUserId(null);
  clearThemes();
  vi.unstubAllGlobals();
});

describe("a first-time visitor", () => {
  it("gets the first registered theme in still dark", () => {
    expect(currentChoice()).toBe("matte-dark");
  });

  it("keeps still dark when the system asks for light", () => {
    prefersDark(false);
    expect(currentThemeForUser()?.id).toBe(matte.dark.id);
  });

  it("gets the light variant when the theme has no dark one", () => {
    clearThemes();
    register(matte.light);
    expect(currentChoice()).toBe("matte-light");
    expect(currentThemeForUser()?.id).toBe(matte.light.id);
  });

  it("survives a browser with no matchMedia at all", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(currentThemeForUser()?.id).toBe(matte.dark.id);
  });
});

describe("a choice", () => {
  it("names a theme and a variant, or a theme following the system", () => {
    expect(parseChoice("matte-dark")).toEqual({
      family: "matte",
      mode: "dark",
    });
    expect(parseChoice("matte-system")).toEqual({
      family: "matte",
      mode: "system",
    });
    expect(parseChoice("matte")).toBeNull();
    expect(parseChoice("matte-dusk")).toBeNull();
  });

  it("resolves a fixed variant whatever the system asks for", () => {
    prefersDark(true);
    expect(resolveChoice("matte-light")?.id).toBe(matte.light.id);
  });

  it("resolves a following choice by what the system asks for now", () => {
    prefersDark(true);
    expect(resolveChoice("matte-system")?.id).toBe(matte.dark.id);
    prefersDark(false);
    expect(resolveChoice("matte-system")?.id).toBe(matte.light.id);
  });

  it("resolves nothing for a theme that is not registered", () => {
    expect(resolveChoice("gone-system")).toBeNull();
  });
});

describe("storedChoice — who the stored choice belongs to", () => {
  it("is the signed-in writer’s own choice", () => {
    setCurrentUserId("user-a");
    setPref("theme", matte.dark.id);
    expect(storedChoice()).toBe(matte.dark.id);
  });

  it("is null for an anonymous visitor, however recently someone chose one", () => {
    setCurrentUserId("user-a");
    setPref("theme", matte.dark.id);

    setCurrentUserId(null);

    expect(storedChoice()).toBeNull();
  });

  // The window before an account is signed in belongs to
  // `getPref` and is pinned in `profileSync.test.ts`, where a module reset can
  // reach that state. `storedChoice` is a thin read over it.

  it("is not resurrected by a session hint auth has already given up on", () => {
    setCurrentUserId("user-a");
    setPref("theme", matte.dark.id);

    // A leftover readable `signed_in` cookie is still here once the sign-in
    // has resolved to nobody, and the choice follows the account alone.
    // No `document` in this environment; a stub carries the cookie.
    setCurrentUserId(null);
    vi.stubGlobal("document", { cookie: "signed_in=1" });

    expect(storedChoice()).toBeNull();
  });

  it("ignores a stored id that names no registered theme", () => {
    setCurrentUserId("user-a");
    setPref("theme", "a-theme-that-was-removed");
    expect(storedChoice()).toBeNull();
  });
});

describe("currentThemeForUser", () => {
  it("resolves to the writer’s own theme when signed in", () => {
    prefersDark(false);
    setCurrentUserId("user-a");
    setPref("theme", matte.dark.id);
    expect(currentThemeForUser()?.id).toBe(matte.dark.id);
  });

  it("resolves back to the default the moment they sign out", () => {
    prefersDark(false);
    setCurrentUserId("user-a");
    setPref("theme", matte.light.id);

    setCurrentUserId(null);

    expect(currentThemeForUser()?.id).toBe(matte.dark.id);
  });
});

// The first paint comes before the account is known: it wears the choice
// this browser last wore for a signed-in writer, which the account then
// confirms or replaces.
describe("firstChoice — the first paint's guess", () => {
  it("is the choice this browser last wore for a writer", () => {
    setCurrentUserId("user-a");
    keepOnDevice("matte-dark");
    setCurrentUserId(null);
    expect(firstChoice()).toBe("matte-dark");
  });

  it("is the writer's own when the account is already known", () => {
    localStorage.setItem("theme", "matte-dark");
    setCurrentUserId("user-a");
    setPref("theme", "matte-light");
    expect(firstChoice()).toBe("matte-light");
  });

  it("ignores a guess that names no registered theme", () => {
    localStorage.setItem("theme", "gone-dark");
    expect(firstChoice()).toBe("matte-dark");
  });

  it("notes nothing for a visitor, and forgets on signing out", () => {
    keepOnDevice("matte-light");
    expect(localStorage.getItem("theme")).toBeNull();
    setCurrentUserId("user-a");
    keepOnDevice("matte-light");
    forgetOnDevice();
    expect(firstChoice()).not.toBe("matte-light");
  });
});
