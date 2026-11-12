// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Starting a selection by drag or double-click does not move the page to the
// station. `selectionchange` fires at the press, when a click and the start of
// a drag look the same, so a press defers its dock until release. Only a
// gesture that ends with a collapsed caret, a click, docks; a drag or a word
// select ends selected and releases the station.

import { expect, test } from "@playwright/test";
import { DOCK_BOUND, glideSettled, readoutEventually } from "./probe";

test.beforeEach(async ({ page }) => {
  // The page's timers run on a clock the test can move, so the click dock's
  // deferral can be run out rather than waited out.
  await page.clock.install();
  await page.goto("/app/editor/demo?debug=station");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  await page.getByRole("button", { name: "Writing preferences" }).click();
  await page.getByRole("checkbox", { name: "Typewriter Mode" }).click();
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-view",
    "typewriter",
  );
});

test("selecting text does not yank the page to the station", async ({
  page,
}) => {
  await page.locator(".editor p").first().click();
  await page.keyboard.type("The storm came without warning. It kept coming. ");
  await readoutEventually(
    page,
    (r) => Number.isFinite(r.caret) && Math.abs(r.delta) <= DOCK_BOUND,
  );

  // Two wheel notches take the writing line off-station. Each notch arrives
  // as a 300ms glide, so the drag baseline waits until the page stops moving.
  await page.evaluate(() => {
    const surface = document.querySelector(".editor-surface") as HTMLElement;
    surface.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 3,
        deltaMode: 1,
        bubbles: true,
        cancelable: true,
      }),
    );
    surface.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 3,
        deltaMode: 1,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await readoutEventually(
    page,
    (r) => Number.isFinite(r.caret) && Math.abs(r.delta) > DOCK_BOUND,
  );
  await glideSettled(page);

  const scrollTop = () =>
    page.locator(".editor-surface").evaluate((el) => el.scrollTop);
  const selected = () =>
    page.evaluate(() => (window.getSelection() ?? "").toString());
  // A release arms the click dock 250ms later. One second runs it out, a
  // budget well past it, and the glide a dock would start then ends.
  const pastClickDock = async () => {
    await page.clock.runFor(1_000);
    await glideSettled(page);
  };

  // Click-and-drag: the text must select and the page must not jump.
  const para = page.locator(".editor p").first();
  const box = await para.boundingBox();
  const beforeDrag = await scrollTop();
  await page.mouse.move(box!.x + 30, box!.y + 10);
  await page.mouse.down();
  await page.mouse.move(box!.x + 200, box!.y + 10, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await selected()) !== "").toBe(true);
  await pastClickDock();
  expect(Math.abs((await scrollTop()) - beforeDrag)).toBeLessThanOrEqual(1);
  // A selection releases the station, and the guide opens outward.
  await expect(page.locator(".type-guide")).toHaveAttribute(
    "data-state",
    "released",
  );

  // A double-click on a word: the first press does not dock either.
  const beforeDbl = await scrollTop();
  await page.mouse.dblclick(box!.x + 40, box!.y + 10);
  await expect.poll(async () => (await selected()) !== "").toBe(true);
  await pastClickDock();
  expect(Math.abs((await scrollTop()) - beforeDbl)).toBeLessThanOrEqual(1);
});
