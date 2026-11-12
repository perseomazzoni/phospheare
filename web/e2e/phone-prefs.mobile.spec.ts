// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The phone plane ignores Typewriter and Focus. With a soft keyboard up the
// visible page is a band of a few lines: centring puts half of it above the
// caret and every keystroke re-docks a page with nowhere to go, and dimming
// all but the current line hides the sentence before, the scarcest thing on
// the screen.
//
// The stored values stay as written, since they are in force at the writer's
// desk and one project file serves both machines. The panel shows the choice
// dimmed and says why it is not in effect here, because a control that goes
// quiet reads as a broken switch.

import { expect, test } from "@playwright/test";
import { openDemoEditor } from "./probe-mobile";

test.describe("the writing preferences on a phone", () => {
  test.beforeEach(async ({ page }) => {
    await openDemoEditor(page);
    const shell = page.locator(".editor-shell");
    test.skip(
      (await shell.getAttribute("data-phone")) !== "1",
      "not the phone plane",
    );
    await page.getByRole("button", { name: "Project structure" }).click();
    await page.getByRole("button", { name: "Writing preferences" }).click();
    // On this plane the settings are a bottom sheet, not the desk's
    // `.dt-prefs` popover.
    await expect(page.locator(".dt-prefs-sheet")).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Typewriter" }),
    ).toBeVisible();
  });

  test("offers both, dimmed, and disables neither", async ({ page }) => {
    // Typewriter is a tick (a checkbox); Line is a track button.
    for (const [role, name] of [
      ["checkbox", "Typewriter"],
      ["button", "Line"],
    ] as const) {
      const control = page.getByRole(role, { name });
      // `aria-disabled`, never `disabled`: a disabled button fires no click
      // and takes no focus, so neither a press nor a screen reader would reach
      // the reason. Playwright reads `aria-disabled` as disabled and refuses to
      // click, so every press below is dispatched at the element.
      await expect(control).toHaveAttribute("aria-disabled", "true");
      expect(await control.evaluate((el) => el.hasAttribute("disabled"))).toBe(
        false,
      );
      expect(
        await control.evaluate((el) =>
          parseFloat(getComputedStyle(el).opacity),
        ),
      ).toBeLessThan(0.6);
    }
  });

  test("answers a press with the reason, and changes nothing", async ({
    page,
  }) => {
    await page
      .getByRole("checkbox", { name: "Typewriter" })
      .dispatchEvent("click");
    const toast = page.locator(".dt-toast");
    await expect(toast).toContainText("Needs a wider screen");
    // The refusal, not the "for this project only" toast a real toggle arms,
    // so there is no undo.
    await expect(toast.locator(".dt-toast-undo")).toHaveCount(0);
    await expect(
      page.getByRole("checkbox", { name: "Typewriter" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("says it in full rather than trailing off", async ({ page }) => {
    // The toast is sized for short desk-width messages, and this one must
    // still be readable in full at 375px.
    await page.getByRole("button", { name: "Line" }).dispatchEvent("click");
    const text = page.locator(".dt-toast-text");
    await expect(text).toBeVisible();
    expect(
      await text.evaluate((el) => el.scrollWidth > el.clientWidth + 1),
    ).toBe(false);
  });

  test("stands clear of the bar rather than over it", async ({ page }) => {
    // The toast is `z-index: 700` and wins against the bar, so it must sit
    // above it rather than cover the writer's six controls.
    await page
      .getByRole("checkbox", { name: "Typewriter" })
      .dispatchEvent("click");
    const toast = await page.locator(".dt-toast").boundingBox();
    const bar = await page.locator(".ui-bar").boundingBox();
    if (!toast || !bar) throw new Error("no toast or no bar");
    expect(toast.y + toast.height).toBeLessThanOrEqual(bar.y);
  });

  test("writes in the scroll view whatever the preferences say", async ({
    page,
  }) => {
    // The setting is ignored, not merely unpressable: a project whose stored
    // `ui` asks for typewriter lands in the scroll view too.
    await expect(page.locator(".editor-surface")).toHaveAttribute(
      "data-view",
      "scroll",
    );
  });
});
