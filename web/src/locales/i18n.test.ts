// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `setPref` pushes in the background once a user exists; nothing here is
// about Drive.
vi.mock("../storage/driveProvider", () => ({
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

/**
 * A fresh module graph per case: `i18n.ts` registers its `onUserChange`
 * listener at import time and `initI18n` can only run once per instance.
 */
async function load() {
  const currentUser = await import("../auth/currentUser");
  const profileSync = await import("../profile/profileSync");
  const i18nModule = await import("./i18n");
  const { default: i18n } = await import("i18next");
  return { ...currentUser, ...profileSync, ...i18nModule, i18n };
}

async function boot(browserLanguage = "en-GB") {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("navigator", { language: browserLanguage });
  return load();
}

/**
 * A second visit on the same browser: storage survives, modules do not.
 *
 * It is the only way to reach "auth has not answered yet" a second time:
 * `currentUser.ts` holds that in module state, because a real page gets one
 * boot and one answer.
 */
async function reload() {
  vi.resetModules();
  return load();
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  // jsdom keeps one document for the whole file.
  document.cookie = "signed_in=; Max-Age=0; path=/";
});

describe("initI18n — which language a page opens in", () => {
  it("follows the browser for a visitor who has never signed in", async () => {
    const app = await boot("it-IT");
    await app.initI18n();
    expect(app.i18n.language).toBe("it");
  });

  it("falls back to English for a language Phospheare does not ship", async () => {
    const app = await boot("ja-JP");
    await app.initI18n();
    expect(app.i18n.language).toBe("en");
  });

  // `index.html` ships `<html lang="en">` statically. A screen reader
  // announces in that language, so an Italian writer's page must declare `it`
  // once i18n resolves; left at "en", every control is voiced in English.
  it("— writes the resolved language onto the document element", async () => {
    const app = await boot("it-IT");
    await app.initI18n();
    expect(document.documentElement.lang).toBe("it");
  });

  it("ignores a stored preference belonging to nobody currently signed in", async () => {
    const app = await boot("en-GB");
    app.setCurrentUserId("user-a");
    app.setPref("language", "it");
    app.setCurrentUserId(null);

    await app.initI18n();

    // The snapshot is in storage and says Italian. It is not this visitor's.
    expect(app.i18n.language).toBe("en");
  });

  // `getPref` has no pre-auth fast path. The public pages
  // that call `initI18n` are not behind `SessionGate`, so this window is real,
  // and it behaves like the "ignores a stored preference belonging to nobody"
  // case: the browser's own preference, corrected when the sign-in resolves.
  it("falls back to the browser's language while a sign-in is still resolving, then corrects itself", async () => {
    const first = await boot("en-GB");
    first.setCurrentUserId("user-a");
    first.setPref("language", "it");

    // Come back later, still signed in, before the account resolves. A
    // readable `signed_in` cookie is present and has no say.
    document.cookie = "signed_in=1; path=/";
    const app = await reload();
    await app.initI18n();

    expect(app.i18n.language).toBe("en");

    // The sign-in resolves: the real account's stored preference takes over.
    app.setCurrentUserId("user-a");
    await vi.waitFor(() => expect(app.i18n.language).toBe("it"));
  });

  // The session hint is untouched here: an unresolved sign-in must
  // not sign a writer out, and language detection has no say over it.
  it("an unresolved sign-in leaves the session hint untouched even though the language falls back", async () => {
    const first = await boot("en-GB");
    first.setCurrentUserId("user-a");
    first.setPref("language", "it");

    document.cookie = "signed_in=1; path=/";
    const app = await reload();
    await app.initI18n();
    expect(app.i18n.language).toBe("en");

    app.setCurrentUserId(null);

    await vi.waitFor(() => expect(app.i18n.language).toBe("en"));
    expect(document.cookie).toContain("signed_in=1");
  });
});

describe("following the account", () => {
  it("switches to the writer’s own language when they sign in", async () => {
    const app = await boot("en-GB");
    app.setCurrentUserId("user-a");
    app.setPref("language", "it");
    app.setCurrentUserId(null);

    await app.initI18n();
    expect(app.i18n.language).toBe("en");

    app.setCurrentUserId("user-a");
    await vi.waitFor(() => expect(app.i18n.language).toBe("it"));
  });

  it("reverts to the browser’s language when they sign out", async () => {
    const app = await boot("en-GB");
    app.setCurrentUserId("user-a");
    app.setPref("language", "it");

    await app.initI18n();
    expect(app.i18n.language).toBe("it");

    app.setCurrentUserId(null);
    await vi.waitFor(() => expect(app.i18n.language).toBe("en"));
  });

  it("swaps one account’s language for another’s on a user switch", async () => {
    const app = await boot("en-GB");
    app.setCurrentUserId("user-a");
    app.setPref("language", "it");
    app.setCurrentUserId("user-b");
    app.setPref("language", "en");

    await app.initI18n();
    expect(app.i18n.language).toBe("en");

    app.setCurrentUserId("user-a");
    await vi.waitFor(() => expect(app.i18n.language).toBe("it"));
  });
});
