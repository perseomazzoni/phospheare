// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A blank file in typewriter mode holds the line at the visual centre and
// keeps it there. The paper feed must not be padding on the absolutely
// positioned `.editor-surface`: that sizes the element to
// `max(inset height, padding sum)`, inflates it, pushes the station below the
// visual centre, and feeds a ResizeObserver loop that keeps pushing it. jsdom
// sees every rect as zero, so this runs where layout is real.
//
// "Caret equals station" holds even while both drift, so the assertion is
// that the station is the visual centre, at once and again once the surface
// has stopped resizing: the defect is a slippage, not a failure to arrive.
// Typewriter is switched on after the file opens, a remount, where
// `settleOnMount` must land.

import { expect, test, type Page } from "@playwright/test";
import { DOCK_BOUND, readoutEventually } from "./probe";

/**
 * Whether the surface kept its size and its feed over three frames. The feed
 * loop resizes the surface once a frame, so a page where it runs is never at
 * rest.
 */
function surfaceAtRest(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const surface = document.querySelector(".editor-surface") as HTMLElement;
    const shape = () =>
      [
        surface.getBoundingClientRect().height,
        surface.scrollHeight,
        surface.style.getPropertyValue("--feed-top"),
      ].join(" ");
    const before = shape();
    for (let frame = 0; frame < 3; frame++)
      await new Promise((done) => requestAnimationFrame(done));
    return shape() === before;
  });
}

test("a blank file in typewriter mode holds the line at the visual centre", async ({
  page,
}) => {
  await page.goto("/app/editor/demo?debug=station");

  // A blank Section, created as the writer does, through the Part's own add
  // label. A locator for a control the tree does not ship only times
  // out.
  await page.getByRole("button", { name: "Add a Section" }).first().click();
  // …name it…
  await page.getByLabel("Section name").fill("blank");
  await page.keyboard.press("Enter");
  // …and open it from the row.
  await page.getByRole("button", { name: "blank", exact: true }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();

  // Typewriter on is a remount: the new view's `settleOnMount` must dock a
  // caret that has never moved (position 0 of an empty paragraph).
  await page.getByRole("button", { name: "Writing preferences" }).click();
  await page.getByRole("checkbox", { name: "Typewriter Mode" }).click();
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-view",
    "typewriter",
  );

  // The readout must say the line is docked at the station…
  await readoutEventually(
    page,
    (r) => Number.isFinite(r.caret) && Math.abs(r.delta) <= DOCK_BOUND,
  );
  const r = await readoutEventually(page);
  expect(Math.abs(r.delta)).toBeLessThanOrEqual(DOCK_BOUND);
  expect(r.clamp).toBe("free");
  // …and the station must be the visual centre, read from the probe's own
  // `visible` readout so the test carries no second formula. A caret that
  // matches a station drifted to the bottom fails here.
  expect(Math.abs(r.station - r.visible)).toBeLessThanOrEqual(2);

  // …and still be so once the surface is at rest: the feed loop pushes the
  // station down as it runs, and a loop that never stops fails here.
  await expect.poll(() => surfaceAtRest(page)).toBe(true);
  const later = await readoutEventually(page);
  expect(Math.abs(later.delta)).toBeLessThanOrEqual(DOCK_BOUND);
  expect(Math.abs(later.station - later.visible)).toBeLessThanOrEqual(2);
});
