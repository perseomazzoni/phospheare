// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// On a phone a sheet arrives with the scrim's fade and does not slide.
// `.sheet`, the component behind both the settings sheet and the editor's
// keyboard-shortcuts sheet, arrives on a desk with `sheetIn`: 20px of travel
// along the edge it docks to, beside a shelf that stays visible. Below 720px
// the sheet is `width: 100%` and becomes the page, and a full-screen surface
// sliding in arrives from somewhere the writer was not looking. The editor's
// full-bleed sheets (`.doc-tree-sheet`, `.ed-dock-sheet`) arrive the same way.
//
// The route is the shortcut sheet because `/app/settings` is behind
// `RequireAuth`, and the demo reaches the same `Sheet` component with no
// account.

import { expect, test, type Page } from "@playwright/test";
import { openDemoEditor, paletteCommand } from "./probe-mobile";

async function openShortcutSheet(page: Page) {
  await page.getByRole("button", { name: "Palette" }).click();
  await paletteCommand(page, "Keyboard shortcuts").click();
  await expect(page.locator(".sheet")).toBeVisible();
}

test.describe("the settings sheet's arrival", () => {
  test.beforeEach(async ({ page }) => {
    await openDemoEditor(page);
  });

  test("veils on a phone and docks on anything wider", async ({ page }) => {
    const phone =
      (await page.locator(".editor-shell").getAttribute("data-phone")) === "1";
    await openShortcutSheet(page);

    const name = await page
      .locator(".sheet")
      .evaluate((el) => getComputedStyle(el).animationName);

    if (phone) {
      // No keyframe at all, so a future entrance here is a choice rather
      // than an inheritance.
      expect(name).toBe("none");
    } else {
      // 768 and 1280 are on the desk's side of the one media query.
      expect(name).toBe("sheetIn");
    }
  });

  test("the arrival is still an arrival — the scrim carries it", async ({
    page,
  }) => {
    // A full-screen cut is worse than a slide. The scrim is the sheet's
    // parent, so its opacity animation carries the whole subtree and makes
    // `animation: none` a veil rather than a cut.
    await openShortcutSheet(page);
    const scrim = await page
      .locator(".ui-scrim")
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { name: s.animationName, duration: s.animationDuration };
      });
    expect(scrim.name).toBe("uiScrimIn");
    expect(parseFloat(scrim.duration)).toBeGreaterThan(0);
  });

  test("the back gesture closes the sheet the board handed off to, not the board itself", async ({
    page,
  }) => {
    // The palette closing and the shortcut sheet opening are one handler,
    // batched into one commit. The same-tick handoff in `useBackCloses.ts`
    // offers the board's history entry to the sheet's setup rather than
    // popping it from under the sheet that just opened, which would close
    // that sheet at once.
    const url = page.url();
    await openShortcutSheet(page);

    await page.goBack();

    await expect(page.locator(".sheet")).toHaveCount(0);
    expect(page.url()).toBe(url);
    await expect(page.locator(".editor").first()).toBeVisible();
  });

  test("it fills the screen it arrives on", async ({ page }) => {
    // Below 720px the sheet is the page, which is why it does not slide.
    const phone =
      (await page.locator(".editor-shell").getAttribute("data-phone")) === "1";
    test.skip(!phone, "not the phone plane");

    await openShortcutSheet(page);
    const box = await page.locator(".sheet").boundingBox();
    const win = page.viewportSize();
    if (!box || !win) throw new Error("no sheet or no viewport");
    expect(Math.round(box.width)).toBe(win.width);
    expect(Math.round(box.x)).toBe(0);
  });
});
