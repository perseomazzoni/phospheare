// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Opening or closing the dock or the structure panel leaves the page where
// the writer scrolled it. The change moves the prose sideways only and the
// measure never narrows, so no line moves up or down. A layout change
// re-measures the caret while the editor holds focus, which it does because
// the bar's buttons never take it; that re-measure must not glide the page
// back to a caret the writer scrolled away from.
//
// The demo book needs no account.

import { expect, test, type Page } from "@playwright/test";
import { GLIDING_GLOBAL, glideSettled, settleAnimations } from "./probe";

const surface = ".editor-surface";

/** Whether the page is still: no glide in flight, and the same scroll three
 * frames apart. */
const still = (page: Page) =>
  page.locator(surface).evaluate(async (el, global) => {
    const gliding = (
      window as unknown as Record<string, (() => boolean) | undefined>
    )[global];
    const top = el.scrollTop;
    for (let frame = 0; frame < 3; frame++)
      await new Promise((done) => requestAnimationFrame(done));
    return gliding !== undefined && !gliding() && el.scrollTop === top;
  }, GLIDING_GLOBAL);

async function longChapter(page: Page) {
  await page.setViewportSize({ width: 1440, height: 500 });
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  await page.locator(".editor p").first().click();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText(
      `Line ${i} of a longer chapter, enough words to wrap across the measure at least once or twice.`,
    );
  }
  // The caret at the top, the page about to be scrolled far below it, once
  // any glide after the typing or the move has run out.
  await page.keyboard.press("Control+Home");
  await expect.poll(() => still(page)).toBe(true);
}

/** Scrolls from the caret, makes the change, and reads where the page went. */
async function after(page: Page, change: () => Promise<void>) {
  // The page hears the scroll before the change. A page already there
  // fires none.
  await page.locator(surface).evaluate(
    (el) =>
      new Promise((done) => {
        if (el.scrollTop === 1200) return done(null);
        el.addEventListener("scroll", done, { once: true });
        el.scrollTop = 1200;
      }),
  );
  await change();
  // Past the prose's move (`--t`) and the re-measure after it, then any
  // glide the re-measure started.
  await settleAnimations(page);
  await glideSettled(page);
  return page.locator(surface).evaluate((el) => el.scrollTop);
}

test("opening and closing the dock or the panel never scrolls the page", async ({
  page,
}) => {
  await longChapter(page);
  const snapshots = page
    .locator(".bar-stack")
    .getByRole("button", { name: "Snapshots" });
  const fold = page.locator(".dt-collapse");
  // The first dock open after the chapter opens is the one at risk.
  expect(await after(page, () => snapshots.click())).toBe(1200);
  expect(await after(page, () => snapshots.click())).toBe(1200);
  expect(await after(page, () => fold.click())).toBe(1200);
  expect(await after(page, () => fold.click())).toBe(1200);
  expect(await after(page, () => snapshots.click())).toBe(1200);
});
