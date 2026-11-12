// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The command bar's block-type and alignment folds open under a finger. They
// rest as their current value and grow into a row under the pointer; the row
// is `pointer-events: none` until `:hover`, `:focus-within` or `data-open`,
// and the keyboard fallback is a modifier shortcut a soft keyboard cannot
// produce, so a tap must open them.
//
// The phone bar carries neither fold (they are in the palette). These rows
// cover coarse-pointer planes at 720px and above, run on the touch-and-wide
// profiles, and skip wherever the bar has no folds.

import { expect, test, type Page } from "@playwright/test";
import { openDemoEditor } from "./probe-mobile";

const block = (page: Page) => page.locator('[data-fold="block"]');
const align = (page: Page) => page.locator('[data-fold="align"]');

/**
 * Asserts that an attribute holds for the whole window, in milliseconds. The
 * failure is time-based, a `pointerleave` close, so the window is watched
 * throughout rather than slept through: a flip back partway fails here
 * instead of being masked by the state at the end of a blind wait.
 */
async function staysAttribute(
  locator: import("@playwright/test").Locator,
  attr: string,
  value: string,
  windowMs: number,
) {
  const deadline = Date.now() + windowMs;
  do {
    await expect(locator).toHaveAttribute(attr, value);
    await locator.page().waitForTimeout(40);
  } while (Date.now() < deadline);
}

test.describe("the bar's folds under a finger", () => {
  test.beforeEach(async ({ page }) => {
    await openDemoEditor(page);
    test.skip(
      (await block(page).count()) === 0,
      "no folds in the bar on this plane",
    );
  });

  test("a tap opens the fold, and it stays open when the finger lifts", async ({
    page,
  }) => {
    // The finger lifting is a `pointerleave`, which must not close a fold the
    // tap opened.
    await expect(block(page)).toHaveAttribute("data-open", "0");
    await block(page).tap();
    await expect(block(page)).toHaveAttribute("data-open", "1");
    await staysAttribute(block(page), "data-open", "1", 500);
  });

  test("the row it opens can actually be pressed", async ({ page }) => {
    // The cells are `pointer-events: none` while folded, so the tap must open
    // the fold before a cell can be pressed.
    await block(page).tap();
    // The full label: Playwright's default name match is a case-insensitive
    // substring, so "Title" alone also finds "Subtitle (H2)".
    const cell = block(page).getByRole("button", {
      name: "Title (H1)",
      exact: true,
    });
    await expect(cell).toBeVisible();
    await cell.tap();
    // The change applies, and the fold closes like an answered menu.
    await expect(page.locator(".editor h1").first()).toBeVisible();
    await expect(block(page)).toHaveAttribute("data-open", "0");
  });

  test("one fold at a time", async ({ page }) => {
    // A tap opens one fold at a time. Hovering two folds on a desk still opens
    // both through the latch.
    await block(page).tap();
    await align(page).tap();
    await expect(align(page)).toHaveAttribute("data-open", "1");
    await expect(block(page)).toHaveAttribute("data-open", "0");
  });

  test("a second tap on the same fold closes it", async ({ page }) => {
    await block(page).tap();
    await block(page).tap();
    await expect(block(page)).toHaveAttribute("data-open", "0");
  });

  test("a press on the prose closes it", async ({ page }) => {
    // The exit a desk gets from the pointer leaving the bar, which a finger
    // never does.
    await block(page).tap();
    await expect(block(page)).toHaveAttribute("data-open", "1");
    // The dismissal listens from the task after the fold opens, so it never
    // hears the tap that opened it; a press sent within that task goes
    // unheard, so the press is repeated until it lands after.
    await expect(async () => {
      await page.locator(".editor p").first().tap();
      await expect(block(page)).toHaveAttribute("data-open", "0", {
        timeout: 500,
      });
    }).toPass({ timeout: 5_000 });
  });

  test("the bar stays lifted while a tapped fold is open", async ({ page }) => {
    // A fold expanded under the structure panel cannot be reached. The lift
    // keeps the chrome over the panels, carried on the shell as
    // `data-fold-engaged`, and it survives the finger lifting as `data-open`
    // does.
    await block(page).tap();
    await staysAttribute(
      page.locator(".editor-shell"),
      "data-fold-engaged",
      "1",
      500,
    );
  });
});
