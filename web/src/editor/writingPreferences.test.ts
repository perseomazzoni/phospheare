// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultProperties } from "../project/properties";
import type { DocumentProperties } from "../project/types";
import {
  DESKTOP_ONLY_PREFS,
  forPlane,
  loadGlobalEditorSettings,
  overrideOf,
  settingsOf,
} from "./writingPreferences";

const project = (
  ui: Partial<DocumentProperties["ui"]>,
): DocumentProperties => ({
  ...defaultProperties("Project"),
  ui: { ...defaultProperties("Project").ui, ...ui },
});

// The settings panel configures the project that is on screen and nothing else,
// so the resolution entry lives against the project's own `ui` block. A
// project with no opinion inherits the writer's global Editor Settings.

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
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => vi.unstubAllGlobals());

describe("settingsOf", () => {
  it("defaults a project that has never been configured, and no project at all", () => {
    expect(settingsOf(null)).toEqual({
      proseSize: 19,
      typewriter: false,
      focus: "off",
      smoothCaret: false,
      autosave: true,
      autosaveDelay: 30,
      henosis: false,
      henosisAfter: 2,
      henosisFade: 3,
      henosisPause: 10,
    });
    expect(
      settingsOf(
        project({
          proseSize: null,
          typewriter: null,
          focus: null,
          smoothCaret: null,
          autosave: null,
          autosaveDelay: null,
          henosis: null,
          henosisAfter: null,
          henosisFade: null,
          henosisPause: null,
        }),
      ),
    ).toEqual({
      proseSize: 19,
      typewriter: false,
      focus: "off",
      smoothCaret: false,
      autosave: true,
      autosaveDelay: 30,
      henosis: false,
      henosisAfter: 2,
      henosisFade: 3,
      henosisPause: 10,
    });
  });

  it("a project with no override inherits the writer's global Editor Settings", () => {
    const globals = {
      proseSize: 21 as const,
      typewriter: true,
      focus: "line" as const,
      smoothCaret: true,
      autosave: true,
      autosaveDelay: 60,
      henosis: false,
      henosisAfter: 2,
      henosisFade: 3,
      henosisPause: 10,
    };
    expect(settingsOf(project({}), globals)).toEqual(globals);
    expect(settingsOf(null, globals)).toEqual(globals);
  });

  it("carries the project's choices through untouched, over the globals", () => {
    expect(
      settingsOf(
        project({
          proseSize: 17,
          typewriter: true,
          focus: "line",
          smoothCaret: true,
          autosave: true,
          autosaveDelay: 120,
          henosis: false,
          henosisAfter: 2,
          henosisFade: 3,
          henosisPause: 10,
        }),
        { typewriter: false, smoothCaret: false, proseSize: 21 },
      ),
    ).toEqual({
      proseSize: 17,
      typewriter: true,
      focus: "line",
      smoothCaret: true,
      autosave: true,
      autosaveDelay: 120,
      henosis: false,
      henosisAfter: 2,
      henosisFade: 3,
      henosisPause: 10,
    });
  });

  it("resolves each field on its own", () => {
    expect(settingsOf(project({ typewriter: true }))).toEqual({
      proseSize: 19,
      typewriter: true,
      focus: "off",
      smoothCaret: false,
      autosave: true,
      autosaveDelay: 30,
      henosis: false,
      henosisAfter: 2,
      henosisFade: 3,
      henosisPause: 10,
    });
    expect(settingsOf(project({ focus: "paragraph" }))).toEqual({
      proseSize: 19,
      typewriter: false,
      focus: "paragraph",
      smoothCaret: false,
      autosave: true,
      autosaveDelay: 30,
      henosis: false,
      henosisAfter: 2,
      henosisFade: 3,
      henosisPause: 10,
    });
    expect(settingsOf(project({ smoothCaret: true }))).toEqual({
      proseSize: 19,
      typewriter: false,
      focus: "off",
      smoothCaret: true,
      autosave: true,
      autosaveDelay: 30,
      henosis: false,
      henosisAfter: 2,
      henosisFade: 3,
      henosisPause: 10,
    });
    expect(settingsOf(project({ proseSize: 17 }))).toEqual({
      proseSize: 17,
      typewriter: false,
      focus: "off",
      smoothCaret: false,
      autosave: true,
      autosaveDelay: 30,
      henosis: false,
      henosisAfter: 2,
      henosisFade: 3,
      henosisPause: 10,
    });
    // Autosave off is the default; the delay resolves even though the master
    // switch is off, because the switch lives in the bar and the delay is set
    // in the panel, and the two never read each other.
    expect(settingsOf(project({ autosave: false }))).toEqual({
      proseSize: 19,
      typewriter: false,
      focus: "off",
      smoothCaret: false,
      autosave: false,
      autosaveDelay: 30,
      henosis: false,
      henosisAfter: 2,
      henosisFade: 3,
      henosisPause: 10,
    });
    expect(settingsOf(project({ autosaveDelay: 120 }))).toEqual({
      proseSize: 19,
      typewriter: false,
      focus: "off",
      smoothCaret: false,
      autosave: true,
      autosaveDelay: 120,
      henosis: false,
      henosisAfter: 2,
      henosisFade: 3,
      henosisPause: 10,
    });
  });
});

describe("overrideOf", () => {
  it("stores the value when it diverges from the resolved default, null when it matches", () => {
    expect(overrideOf(true, undefined, false)).toBe(true);
    expect(overrideOf(true, false, false)).toBe(true);
    expect(overrideOf(true, true, false)).toBeNull();
    expect(overrideOf(21, 21, 19)).toBeNull();
    expect(overrideOf(21, 19, 19)).toBe(21);
  });

  // With no global set, the built-in is the default, so a toggle back to it
  // returns to the default rather than diverging for the project.
  it("normalizes against the built-in when the global is unset", () => {
    expect(overrideOf(false, undefined, false)).toBeNull();
    expect(overrideOf("off", undefined, "off" as const)).toBeNull();
    expect(overrideOf(30, undefined, 30)).toBeNull();
  });
});

describe("loadGlobalEditorSettings", () => {
  it("reads the prefs store, absent globals stay undefined", async () => {
    const { setCurrentUserId } = await import("../auth/currentUser");
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
    expect(loadGlobalEditorSettings()).toEqual({
      typewriter: true,
      focus: undefined,
      smoothCaret: undefined,
      proseSize: undefined,
      autosave: undefined,
      autosaveDelay: undefined,
    });
  });
});

// The phone plane honours neither typewriter nor focus. Typewriter centres
// the writing line in the visible page, and with a soft keyboard up that page
// is a band of a few lines, so half of what is left ends up above the caret.
// Focus dims everything but the current line to remove periphery, which a
// screen showing six lines does not have. Neither is rewritten: the stored
// value is the writer's, it is still in force at their desk, and the project
// file is one file across both machines.

describe("Henosis's settings", () => {
  it("are off, 2s, 3s and a 10s pause when nothing is set", () => {
    const resolved = settingsOf(null);
    expect(resolved.henosis).toBe(false);
    expect(resolved.henosisAfter).toBe(2);
    expect(resolved.henosisFade).toBe(3);
    expect(resolved.henosisPause).toBe(10);
  });

  it("take the project's choice over the writer's, and the writer's over the built-in", () => {
    const globals = { henosis: true, henosisAfter: 10, henosisFade: 30 };
    expect(settingsOf(project({}), globals)).toMatchObject(globals);
    expect(
      settingsOf(project({ henosis: false, henosisAfter: 3 }), globals),
    ).toMatchObject({ henosis: false, henosisAfter: 3, henosisFade: 30 });
  });
});

describe("forPlane", () => {
  const on = settingsOf(
    project({
      typewriter: true,
      focus: "line",
      smoothCaret: true,
      henosis: true,
      henosisAfter: 10,
    }),
  );

  it("changes nothing at all off the phone plane", () => {
    // Identity, not only equality: the memo above this in `EditorRoute`
    // keeps the settings object stable across renders, and a copy on every
    // call would re-render the whole writing surface on every props change.
    expect(forPlane(on, false)).toBe(on);
  });

  it("ignores typewriter, focus and Henosis on the phone plane", () => {
    const phone = forPlane(on, true);
    expect(phone.typewriter).toBe(false);
    expect(phone.focus).toBe("off");
    expect(phone.henosis).toBe(false);
  });

  it("leaves every other preference exactly as it resolved", () => {
    // The phone is not a reduced editor. Prose size, the smooth caret and
    // autosave mean the same thing on a phone as on a desk, autosave more so,
    // since a phone browser discards a backgrounded tab.
    const phone = forPlane(on, true);
    expect(phone.smoothCaret).toBe(on.smoothCaret);
    expect(phone.proseSize).toBe(on.proseSize);
    expect(phone.autosave).toBe(on.autosave);
    expect(phone.autosaveDelay).toBe(on.autosaveDelay);
    // Henosis's steps stay as chosen, for the panel to show.
    expect(phone.henosisAfter).toBe(10);
  });

  it("does not touch what the project stores", () => {
    // The resolved value is filtered, not the stored one: a writer who turns
    // typewriter on at their desk and opens the same project on a phone still
    // finds it on when they go back.
    const props = project({ typewriter: true, focus: "paragraph" });
    forPlane(settingsOf(props), true);
    expect(props.ui?.typewriter).toBe(true);
    expect(props.ui?.focus).toBe("paragraph");
  });

  it("names the three, so the panel and the filter cannot disagree", () => {
    // The tree panel dims these and answers a press on any with the toast;
    // this list says which, in one place.
    expect([...DESKTOP_ONLY_PREFS]).toEqual(["typewriter", "focus", "henosis"]);
  });
});
