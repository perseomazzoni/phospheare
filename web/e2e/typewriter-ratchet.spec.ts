// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The typewriter's wheel ratchet: a notch steps the page one visual line, the
// editor's computed line box; the caret bar stays on the writing line; and
// the next keystroke docks the writing line home. The step is re-measured on
// every event, so a prose-size change applies on the next notch.
//
// jsdom sees every rect as zero, so the step's size is asserted here against
// the real line box. The notch is dispatched in-page as a line-mode event,
// what a physical wheel sends; `page.mouse.wheel` reports pixels and would
// exercise the trackpad path. The prose mixes bold, italic and monospace runs
// on one line, a justified paragraph and a title block, because formatting
// must never change the step.

import { expect, test, type Page } from "@playwright/test";
import {
  DOCK_BOUND,
  barPinned,
  glideSettled,
  readoutEventually,
} from "./probe";

test.beforeEach(async ({ page }) => {
  await page.goto("/app/editor/demo?debug=station");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  await page.locator(".editor p").first().click();
  await page.getByRole("button", { name: "Writing preferences" }).click();
  await page.getByRole("checkbox", { name: "Typewriter Mode" }).click();
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-view",
    "typewriter",
  );
});

/** The line box the step must travel: the editor's computed line-height,
 * measured once the webfonts are in, because the fallback font's line box is
 * smaller than Newsreader's. */
async function lineBox(page: Page): Promise<number> {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() =>
    parseFloat(
      getComputedStyle(document.querySelector(".editor") as HTMLElement)
        .lineHeight,
    ),
  );
}

/** One physical wheel notch, line-mode as a Windows mouse sends it, and the
 * `scrollTop` change it produced. Dispatched in-page so it is exactly one
 * notch.
 *
 * The step arrives as a 300ms glide (`scrollGlide.ts`), so both reads are
 * taken with the page at rest; a fixed wait lands mid-glide under load.
 * A settle-poll on `scrollTop` cannot replace it: Chromium
 * rounds the value to integers and an ease-out's tail moves sub-pixel per
 * frame, so two equal reads can come a frame early with a pixel to travel.
 * The glide is asked directly through `glideSettled`. The first read waits
 * too, because the caller's typing can leave a dock glide in flight. */
async function notch(page: Page): Promise<number> {
  const surface = page.locator(".editor-surface");
  await glideSettled(page);
  const before = await surface.evaluate((el) => el.scrollTop);
  await page.evaluate(() => {
    const surfaceEl = document.querySelector(".editor-surface") as HTMLElement;
    surfaceEl.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 3,
        deltaMode: 1,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await glideSettled(page);
  const after = await surface.evaluate((el) => el.scrollTop);
  return after - before;
}

/** Appends mixed-format prose: bold, italic and monospace runs on one line, a
 * justified paragraph, and a title block. */
async function typeMixedProse(page: Page) {
  await page.locator(".editor p").last().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("The storm ");
  await page.keyboard.press("Control+b");
  await page.keyboard.type("kept coming");
  await page.keyboard.press("Control+b");
  await page.keyboard.type(" without warning, and by four the lane was gone. ");
  await page.keyboard.press("Control+i");
  await page.keyboard.type("She stood");
  await page.keyboard.press("Control+i");
  await page.keyboard.type(" at the window, ");
  await page.keyboard.press("Control+e");
  await page.keyboard.type("counting");
  await page.keyboard.press("Control+e");
  await page.keyboard.type(" the lights on the far shore twice. ");
  await page.keyboard.press("Enter");
  await page.keyboard.type(
    "One of them was moving, and had been moving for some time.",
  );
  await page.keyboard.press("Control+Alt+j");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Once Dark");
  await page.keyboard.press("Control+Alt+1");
}

test("the wheel ratchets one visual line per notch; typing docks home", async ({
  page,
}) => {
  await typeMixedProse(page);

  // The mixed formatting must not change the line box the step travels.
  const lh = await lineBox(page);
  expect(lh).toBeGreaterThan(20);

  // Docked before the wheel.
  const before = await readoutEventually(
    page,
    (c) => Number.isFinite(c.caret) && Math.abs(c.delta) <= DOCK_BOUND,
  );
  expect(before.clamp).toBe("free");

  // One notch is one line box.
  const step1 = await notch(page);
  expect(Math.abs(step1 - lh)).toBeLessThanOrEqual(1.5);

  // Off-station: the writing line is one line above the station, and the bar
  // is on it, never over text it does not belong to.
  let r = await readoutEventually(
    page,
    (c) => Number.isFinite(c.caret) && Math.abs(c.delta) > DOCK_BOUND,
  );
  expect(Math.abs(r.caret - r.station)).toBeGreaterThan(DOCK_BOUND);
  await barPinned(page, r.caret);

  // A second notch is another line box.
  const step2 = await notch(page);
  expect(Math.abs(step2 - lh)).toBeLessThanOrEqual(1.5);

  // The very next keystroke brings the writing line home.
  await page.keyboard.type("x");
  r = await readoutEventually(
    page,
    (c) => Number.isFinite(c.caret) && Math.abs(c.delta) <= DOCK_BOUND,
  );
  expect(r.clamp).toBe("free");
  await barPinned(page, r.station);
});

test("the ratchet step follows the prose size the moment it changes", async ({
  page,
}) => {
  await typeMixedProse(page);
  const lhBefore = await lineBox(page);

  // One notch at the current size.
  const stepBefore = await notch(page);
  expect(Math.abs(stepBefore - lhBefore)).toBeLessThanOrEqual(1.5);

  // After a prose-size change the step matches the new line box. Typing into
  // the prose closes the panel, so it is reopened first.
  await page.getByRole("button", { name: "Writing preferences" }).click();
  await page.getByRole("button", { name: "Large" }).click();
  await expect.poll(async () => (await lineBox(page)) !== lhBefore).toBe(true);
  const lhAfter = await lineBox(page);
  expect(lhAfter).not.toBeCloseTo(lhBefore, 1);

  const stepAfter = await notch(page);
  expect(Math.abs(stepAfter - lhAfter)).toBeLessThanOrEqual(1.5);
});
