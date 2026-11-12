// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The rail foot keeps its two icons at their own size when the structure
// panel is folded to its 52px rail. The foot's wide-state padding and gaps
// (10px each side, 7px between items) leave 32px of content for a 13px and a
// 20px icon, so flexbox shrinks the storage icon unless the rail drops them.
// jsdom measures every rect as zero, so this reads the rendered width.

import { expect, test } from "@playwright/test";
import { START_MS } from "./start";

test.beforeEach(async ({ page }) => {
  await page.goto("/app/editor/demo");
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-view",
    "scroll",
    { timeout: START_MS },
  );
  // Open a section so the panel has a book to show, then fold it to its rail.
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  await page.getByLabel("Narrow the panel").click();
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-rail", "1");
});

test("the storage icon keeps its 13px width when the panel is railed", async ({
  page,
}) => {
  // The foot's first icon is the storage icon (the book's home); the gear is
  // the last control. Both must keep their natural size in the 52px rail.
  const storageW = await page
    .locator(".dt-foot > svg")
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(storageW).toBeGreaterThanOrEqual(12);

  const gearW = await page
    .locator(".dt-foot .dt-foot-act")
    .last()
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(gearW).toBeGreaterThanOrEqual(19);
});

// The settings open from the gear while the structure panel is folded, and
// the two stay independent: the card floats over the prose as its own
// surface, the panel is never widened to host it, and the card is wide enough
// for the longest localized labels.
test("the settings card opens over the prose while the panel stays railed", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Writing preferences" }).click();
  const card = page.locator(".dt-prefs");
  await expect(card).toHaveAttribute("data-open", "1");

  // The structure panel was not widened to make room — it is still folded.
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-rail", "1");

  // The card is a sibling of the panel, not a descendant, so the panel's
  // `overflow: hidden` cannot clip it.
  const insidePanel = await page.evaluate(() =>
    document
      .querySelector(".doc-tree")
      ?.contains(document.querySelector(".dt-prefs")),
  );
  expect(insidePanel).toBe(false);

  // The card is wider than the rail it floats beside, and fully on screen.
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(52);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
