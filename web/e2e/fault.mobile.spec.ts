// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, test } from "@playwright/test";

// Pins the fault page on phones: its words and its way back fit the screen,
// with no sideways scroll, on every mobile project.

test("the not-found page fits a phone's width", async ({ page }) => {
  await page.goto("/no/such/page");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Page not found",
  );
  const link = page.getByRole("link", { name: "Back to the homepage" });
  await expect(link).toBeInViewport();

  const overflow = await page.evaluate(() => {
    const scroller = document.querySelector(".page") ?? document.body;
    return scroller.scrollWidth - scroller.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
});
