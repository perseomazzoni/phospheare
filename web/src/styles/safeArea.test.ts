// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Pins the safe area in the stylesheet text, because jsdom runs no CSS and
// reports no insets. `e2e/safe-area.mobile.spec.ts` covers the
// layout with non-zero insets; these rows hold that the insets enter the
// application in one place, so a later rule cannot reintroduce the
// untestable form.

import { describe, expect, it } from "vitest";
import BASE from "./base.css?raw";
import { EDITOR_CSS as EDITOR } from "../editor/editorSheets.fixture";
import WEBAPP from "../webapp/webapp.css?raw";
import INDEX from "../../index.html?raw";

const flat = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ");

describe("the safe area", () => {
  it("is declared in the document, or every inset reads zero", () => {
    // `env(safe-area-inset-*)` reports 0 unless the viewport is `cover`, so
    // without it the inset of the phone's command bar is inert and
    // nothing fails.
    expect(INDEX.replace(/\s+/g, " ")).toContain("viewport-fit=cover");
  });

  it("enters the application in exactly one place", () => {
    // `env()` cannot be set: it is whatever the device says, which is 0
    // everywhere this project can run, so a rule calling it directly can be
    // neither broken nor proved. Behind `--safe-*`, a test sets a number and
    // measures. Comments are stripped first, since some name
    // `env(safe-area-inset-bottom, 0px)` verbatim.
    const calls = [BASE, EDITOR, WEBAPP]
      .map(flat)
      .join("\n")
      .match(/env\(\s*safe-area-inset-[a-z]+/g);
    expect(calls).toHaveLength(4);
    for (const half of [EDITOR, WEBAPP]) {
      expect(flat(half)).not.toContain("env(safe-area-inset");
    }
  });

  it("names all four edges, each with a zero fallback", () => {
    // The fallback makes the whole thing a no-op on a device with no cutout,
    // and on every browser without `env()`, where the declaration would
    // otherwise be invalid and dropped.
    for (const edge of ["top", "right", "bottom", "left"]) {
      expect(flat(BASE)).toContain(
        `--safe-${edge}: env(safe-area-inset-${edge}, 0px);`,
      );
    }
  });

  it("pays the inset once for everything in normal flow", () => {
    // Every screen is inside `#root`, so the landing header, the shelf, the
    // settings sheet and the editor's scroller are all covered by one rule
    // and none of them has to know a notch exists.
    expect(flat(BASE)).toContain(
      "#root { height: 100%; box-sizing: border-box; " +
        "padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left); }",
    );
  });

  it("dims to the edges while placing the panel inside them", () => {
    // A scrim that stopped short of the notch would draw a bright band around
    // a darkened page. Two jobs, one element: `inset: 0` for the dim, padding
    // for the panel.
    const scrim = flat(BASE).match(/\.ui-scrim \{[^}]*\}/)?.[0] ?? "";
    expect(scrim).toContain("inset: 0;");
    expect(scrim).toContain(
      "padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);",
    );
  });

  it("lifts the shelf's toast off the swipe strip", () => {
    // Reachable only behind an account, so it is pinned here rather than in
    // the browser. A toast carries an Undo, and inside the home indicator's
    // strip that button competes with a system gesture.
    const toasts = flat(BASE).match(/\.ui-toasts \{[^}]*\}/)?.[0] ?? "";
    expect(toasts).toContain("bottom: calc(16px + var(--safe-bottom));");
  });
});
