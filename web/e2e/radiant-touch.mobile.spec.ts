// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, test, type Page } from "@playwright/test";
import { openVisionProject } from "./visionProject";

// Radiant on a touch screen. A row's trailing marks arrive with the pointer on
// a desk; a touch screen has no hover to bring them, so every row keeps its
// count, its comments, its § and its ⋮, and a Section's row its page glyph.

// The book is seeded through OPFS, which Playwright's WebKit does not offer,
// so every project runs this on Chromium at its own size and touch.
test.use({ timezoneId: "UTC", locale: "en-US", browserName: "chromium" });

async function openPanel(page: Page) {
  await openVisionProject(page, {
    variant: "light",
    text: "section",
    family: "radiant",
  });
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor")).toBeVisible({ timeout: 15_000 });
  const shell = page.locator(".editor-shell");
  if ((await shell.getAttribute("data-phone")) === "1") {
    await page.getByRole("button", { name: "Project structure" }).click();
    await expect(page.locator(".doc-tree-sheet")).toBeVisible();
  } else if ((await shell.getAttribute("data-rail")) === "1") {
    await page.getByRole("button", { name: "Widen the panel" }).first().click();
    await expect(shell).toHaveAttribute("data-rail", "0");
  }
}

test("every row keeps its marks where there is no hover", async ({ page }) => {
  await openPanel(page);
  expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(
    false,
  );
  const row = page.locator(".dt-row.dt-section:not(.active)").first();
  await expect(row).toBeVisible();
  for (const mark of [".dt-words", ".dt-summary", ".dt-more"])
    await expect(row.locator(mark)).toBeVisible();
});

test("a Section's row keeps its page glyph on a touch screen", async ({
  page,
}) => {
  // A theme restyles a row's marks but hides none of them.
  await openPanel(page);
  await expect(
    page.locator(".dt-row.dt-section .dt-file-icon").first(),
  ).toBeVisible();
});
