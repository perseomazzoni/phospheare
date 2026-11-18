// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
// Proves the browser takes over the demo site's prerendered pages without a
// mismatch. The production build drops React's warning for a mismatched
// attribute and keeps the stale value, so only a development render, as
// here, shows one.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router";
import i18n from "i18next";
import { renderPage } from "./prerender";
import { DemoRoot, demoRoutes } from "./App";
import { PRERENDERED_ATTRIBUTE, canHydrate, pageState } from "./pageState";
import { PRODUCT } from "../product";

// This file drives React itself, with no Testing Library to declare `act`
// supported, and every console warning fails a test below.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: Root | null = null;

afterEach(() => {
  act(() => mounted?.unmount());
  mounted = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Hydrates `root` as `main.tsx` does; returns every console warning. */
async function hydrate(root: HTMLElement): Promise<unknown[][]> {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await act(async () => {
    mounted = hydrateRoot(
      root,
      <DemoRoot>
        <RouterProvider router={createBrowserRouter(demoRoutes)} />
      </DemoRoot>,
    );
  });
  return [...error.mock.calls, ...warn.mock.calls];
}

/** A `#root` holding the page the build writes for `path`. */
async function builtRoot(path: string): Promise<HTMLElement> {
  const page = await renderPage(path);
  const root = document.createElement("div");
  root.id = "root";
  root.setAttribute(PRERENDERED_ATTRIBUTE, page.state);
  root.innerHTML = page.body;
  document.body.append(root);
  window.history.replaceState(null, "", path);
  return root;
}

describe("the prerendered pages", () => {
  for (const path of ["/", "/legal", "/privacy"]) {
    it(`hydrates ${path} with no mismatch`, async () => {
      const root = await builtRoot(path);
      const first = root.firstElementChild;
      expect(first).not.toBeNull();
      expect(canHydrate(root)).toBe(true);
      expect(await hydrate(root)).toEqual([]);
      expect(root.firstElementChild).toBe(first);
    });
  }

  // Node has no Custom Highlights and a browser does, so the focus demo's
  // dimming must arrive after hydration, not in its first render. jsdom has
  // none either, so the browser's registry is stood in here.
  it("hydrates the landing where the browser highlights, then dims", async () => {
    const root = await builtRoot("/");
    expect(root.querySelector(".landing-demo-editor.focus-dim")).toBeNull();
    vi.stubGlobal("CSS", { highlights: new Map() });
    vi.stubGlobal("Highlight", class {});
    expect(await hydrate(root)).toEqual([]);
    expect(root.querySelector(".landing-demo-editor.focus-dim")).not.toBeNull();
  });

  it("renders each page's own heading and the landing's links", async () => {
    const landing = await renderPage("/");
    expect(landing.body).toContain("<h1");
    expect(landing.body).toContain('href="/legal"');
    expect(landing.body).toContain('href="/privacy"');
    expect(landing.title).toBe(PRODUCT.name);
    const legal = await renderPage("/legal");
    expect(legal.title).toBe(
      `${i18n.t("legal.notice.title")} — ${PRODUCT.name}`,
    );
  });
});

describe("canHydrate", () => {
  it("refuses a root rendered in another state", async () => {
    const root = await builtRoot("/legal");
    root.setAttribute(PRERENDERED_ATTRIBUTE, pageState().replace("en", "it"));
    expect(canHydrate(root)).toBe(false);
  });

  it("refuses a page for a Mac, whose key labels differ", async () => {
    const root = await builtRoot("/");
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    );
    expect(canHydrate(root)).toBe(false);
  });

  it("refuses a root with no prerendered page", () => {
    const root = document.createElement("div");
    expect(canHydrate(root)).toBe(false);
    root.setAttribute(PRERENDERED_ATTRIBUTE, pageState());
    expect(canHydrate(root)).toBe(false);
  });
});
