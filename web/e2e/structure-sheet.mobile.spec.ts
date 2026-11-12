// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// On the phone the structure panel is a modal sheet. A 248px panel over a
// 375px screen is a cover, not a column beside the prose, so it sits on the
// shared `Scrim` every dialog uses: a scrim, a focus trap, an inert
// background, and four ways out that mean the same thing.
//
// On Android back is the universal dismiss, the only gesture that closes a
// sheet, a menu or a keyboard, so back over an open panel closes the panel
// and does not leave the editor.

import { expect, test } from "@playwright/test";
import { MIN_TAP, openDemoEditor } from "./probe-mobile";

test.describe("the structure sheet", () => {
  const sheet = (page: import("@playwright/test").Page) =>
    page.locator(".doc-tree-sheet");

  test.beforeEach(async ({ page }) => {
    await openDemoEditor(page);
    test.skip(
      (await page.locator(".editor-shell").getAttribute("data-phone")) !== "1",
      "not the phone plane",
    );
  });

  test("is not there until it is asked for", async ({ page }) => {
    // Not a rail, not a folded column: nothing. The phone cannot spare a 52px
    // strip, and a rail covers the bar's leftmost slot.
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator(".doc-tree")).toHaveCount(0);
  });

  test("says it is a cover, and puts the manuscript out of reach", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Project structure" }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(page.locator(".ui-scrim")).toBeVisible();
    // The modal contract: the writer cannot type into the prose behind an
    // open panel.
    await expect(sheet(page)).toHaveAttribute("aria-modal", "true");
    expect(
      await page
        .locator(".editor")
        .first()
        .evaluate(
          (el) => el.closest("[inert]") !== null || (el as HTMLElement).inert,
        ),
    ).toBe(true);
  });

  test("carries the way back the titlebar no longer can", async ({ page }) => {
    // The phone hides the titlebar, which carries the link to the shelf on
    // the desk, so the sheet carries it instead.
    await page.getByRole("button", { name: "Project structure" }).click();
    const back = sheet(page).locator(".dt-back");
    await expect(back).toBeVisible();
    // The row's `--tap` floor in `editor.css` has no other pin: the reach
    // sweep never opens the structure sheet.
    const box = await back.boundingBox();
    if (!box) throw new Error("no back row");
    expect(box.height).toBeGreaterThanOrEqual(MIN_TAP - 1);
  });

  test("closes on the backdrop, on Escape, and on the close", async ({
    page,
  }) => {
    const open = () =>
      page.getByRole("button", { name: "Project structure" }).click();

    await open();
    await page.mouse.click(360, 300);
    await expect(sheet(page)).toHaveCount(0);

    await open();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);

    await open();
    await page.getByRole("button", { name: "Close the panel" }).click();
    await expect(sheet(page)).toHaveCount(0);
  });

  test("the back gesture closes the sheet, not the project", async ({
    page,
  }) => {
    const url = page.url();
    await page.getByRole("button", { name: "Project structure" }).click();
    await expect(sheet(page)).toBeVisible();

    await page.goBack();

    await expect(sheet(page)).toHaveCount(0);
    // Still in the editor.
    expect(page.url()).toBe(url);
    await expect(page.locator(".editor").first()).toBeVisible();
  });

  test("leaves no dead back step behind when it closes another way", async ({
    page,
  }) => {
    // Closing on Escape pops the entry the sheet pushed, or back would visibly
    // do nothing and the writer would press it twice.
    const url = page.url();
    await page.getByRole("button", { name: "Project structure" }).click();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);

    await page.goBack();
    await expect(page.locator(".editor")).toHaveCount(0);
    expect(page.url()).not.toBe(url);
  });

  test("spends Escape on the innermost layer, one press at a time", async ({
    page,
  }) => {
    // The settings sit in the layer stack, so one Escape closes them and not
    // the panel that opened them. On this plane the settings are
    // a bottom sheet on their own scrim, not the desk's `.dt-prefs`
    // popover.
    await page.getByRole("button", { name: "Project structure" }).click();
    await page.getByRole("button", { name: "Writing preferences" }).click();
    await expect(page.locator(".dt-prefs-sheet")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".dt-prefs-sheet")).toHaveCount(0);
    await expect(sheet(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
  });

  test("draws the settings above itself rather than behind", async ({
    page,
  }) => {
    // A card portalled to `<body>` lands behind a scrim at `z-index: 500`:
    // present in the DOM and invisible, which no existence assertion catches.
    // The settings are their own modal on their own scrim, above the
    // sheet as a later layer, so a finger pressing there reaches them.
    await page.getByRole("button", { name: "Project structure" }).click();
    await page.getByRole("button", { name: "Writing preferences" }).click();
    const card = page.locator(".dt-prefs-sheet");
    await expect(card).toBeVisible();
    // The dialog opens from `scale(.97)`, so a rect read mid-entrance is 3%
    // short and a point measured from it lands elsewhere; the wait is on the
    // animation itself.
    await card.evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)).then(
        () => undefined,
      ),
    );
    const box = await card.boundingBox();
    if (!box) throw new Error("no card");
    const onTop = await page.evaluate(
      ([x, y]) =>
        document.elementFromPoint(x, y)?.closest(".dt-prefs-sheet") !== null,
      [box.x + box.width / 2, box.y + 20],
    );
    expect(onTop).toBe(true);
  });
});
