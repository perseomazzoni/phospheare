// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { applyTheme, loadSheet, sheetLoaded, themeMarkup } from "./page";
import { matte } from "./themes/matte";
import { shine } from "./themes/shine";
import { vision } from "./themes/vision";
import type { Theme } from "./domain/types";

// What `applyTheme` writes besides the tokens: the frame's layouts and the
// decorations on the root, and the theme's own sheet in the theme's layer.

const sheet = () => document.getElementById("theme-css");

/** The theme wearing `css` for its sheet, fetched. */
async function withCss(theme: Theme, css: string): Promise<Theme> {
  const dressed = { ...theme, sheet: () => Promise.resolve(css) };
  await loadSheet(dressed);
  return dressed;
}

beforeAll(() =>
  Promise.all([matte.light, vision.light, shine.light].map(loadSheet)),
);

describe("applyTheme", () => {
  it("writes on the page exactly what themeMarkup gives the demo site's build", async () => {
    const theme = await withCss(matte.dark, "a { color: red }");
    applyTheme(theme);
    const markup = themeMarkup(theme, "a { color: red }");
    const root = document.documentElement;
    for (const [name, value] of markup.style)
      expect(root.style.getPropertyValue(name), name).toBe(value);
    expect({ ...root.dataset }).toMatchObject(markup.dataset);
    expect(markup.sheetId).toBe("theme-css");
    expect(sheet()?.textContent).toBe(markup.sheet);
    expect(markup.style).toContainEqual(["color-scheme", "dark"]);
  });

  it("names the frame's layouts the theme picks on the root", () => {
    const root = document.documentElement.dataset;
    applyTheme(vision.light);
    expect([root.comments, root.underBar, root.dockTabs]).toEqual([
      "notes",
      "cut",
      "words",
    ]);
    expect([root.panel, root.barCentre]).toEqual(["attached", "paper"]);
    applyTheme(matte.light);
    expect([root.comments, root.underBar, root.dockTabs]).toEqual([
      "cards",
      "slide",
      "track",
    ]);
    expect(root.panel).toBe("float");
    expect(root.barCentre).toBe("prose");
    applyTheme(shine.light);
    expect(root.panel).toBe("attached");
  });

  it("writes the theme's sheet into the layer over the frame's", async () => {
    applyTheme(await withCss(vision.light, ".x { color: red; }"));
    applyTheme(await withCss(vision.light, ".y { color: blue; }"));
    expect(document.querySelectorAll("#theme-css")).toHaveLength(1);
    expect(sheet()?.textContent).toBe(
      "@layer frame, theme;\n@layer theme {\n.y { color: blue; }\n}\n",
    );
  });

  it("leaves no sheet behind for a theme with none", async () => {
    applyTheme(await withCss(vision.light, ".x { color: red; }"));
    applyTheme(await withCss(matte.light, ""));
    expect(sheet()).toBeNull();
  });

  it("fetches a theme's sheet once, and puts on no theme whose sheet is not here", async () => {
    const sheet = vi.fn(() => Promise.resolve(".x { color: red; }"));
    const fresh = { ...vision.light, sheet };
    expect(sheetLoaded(fresh)).toBe(false);
    expect(() => applyTheme(fresh)).toThrow(/not loaded/);
    await loadSheet(fresh);
    await loadSheet({ ...vision.dark, sheet });
    expect(sheet).toHaveBeenCalledOnce();
    expect(sheetLoaded(fresh)).toBe(true);
  });

  it("carries no look on the root", () => {
    applyTheme(vision.light);
    const root = document.documentElement.dataset;
    for (const look of [
      "rows",
      "press",
      "slips",
      "fields",
      "caret",
      "panes",
      "chrome",
      "lit",
    ])
      expect(root[look], look).toBeUndefined();
  });
});
