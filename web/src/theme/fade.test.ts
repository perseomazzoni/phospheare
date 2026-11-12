// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { applyTheme, fadeToTheme, loadSheet } from "./page";
import { matte } from "./themes/matte";

// The switch's fade and the stillness mark, as `page.ts` puts them on the
// root. jsdom has no view transitions, so the browser's is stood in for: it
// runs the update at once and finishes when told.

function lessMotion(reduce: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduced-motion"),
    media: query,
  }));
}

let finish: () => void = () => {};
const startViewTransition = vi.fn((update: () => void) => {
  update();
  return {
    ready: Promise.resolve(),
    finished: new Promise<void>((done) => (finish = done)),
  };
});

beforeAll(() => loadSheet(matte.light));

beforeEach(() => {
  lessMotion(false);
  startViewTransition.mockClear();
  Object.assign(document, { startViewTransition });
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeSwitching;
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "startViewTransition");
});

describe("a theme switch", () => {
  it("fades from one theme to another, and drops its mark once faded", async () => {
    applyTheme(matte.light);
    const apply = vi.fn(() => applyTheme(matte.dark));
    expect(fadeToTheme(matte.dark.id, apply)).toBe(true);
    expect(apply).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.themeSwitching).toBe("1");
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.documentElement.dataset.themeSwitching).toBeUndefined();
  });

  it("does not fade the first theme on, the same theme, or for less motion", () => {
    expect(fadeToTheme(matte.light.id, () => {})).toBe(false);
    applyTheme(matte.light);
    expect(fadeToTheme(matte.light.id, () => {})).toBe(false);
    lessMotion(true);
    expect(fadeToTheme(matte.dark.id, () => {})).toBe(false);
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it("lets the caller apply at once where the browser cannot fade", () => {
    applyTheme(matte.light);
    Reflect.deleteProperty(document, "startViewTransition");
    expect(fadeToTheme(matte.dark.id, () => {})).toBe(false);
  });

  it("keeps a later switch's mark when an earlier one finishes", async () => {
    applyTheme(matte.light);
    fadeToTheme(matte.dark.id, () => applyTheme(matte.dark));
    const first = finish;
    fadeToTheme(matte.light.id, () => applyTheme(matte.light));
    first();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.documentElement.dataset.themeSwitching).toBe("1");
  });
});
