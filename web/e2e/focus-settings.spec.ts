// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Focus mode turned on from the tree's settings panel lights the line at once.
// The panel lives in the tree, so the writer may have the tree's search field
// focused: a real blur, not a chrome click the editor's focus re-claim
// absorbs. The dim is painted from the surviving selection, not held for a
// focused caret move that may never come. jsdom cannot paint the Custom
// Highlight API, so the dim is checked in a real browser.

import { expect, test } from "@playwright/test";
import { litBand } from "./probe";
import { START_MS } from "./start";

test.beforeEach(async ({ page }) => {
  await page.goto("/app/editor/demo");
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-view",
    "scroll",
    { timeout: START_MS },
  );
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
});

test("enabling focus from the settings panel paints the lit line immediately (fixes.md #16)", async ({
  page,
}) => {
  // A caret to light, then a real blur into the tree's search field.
  await page.locator(".editor p").first().click();
  await page.keyboard.type("One. ");
  await page.locator(".dt-find input").focus();

  // With the editor blurred, Line focus paints the dim at once.
  await page.getByRole("button", { name: "Writing preferences" }).click();
  await page.getByRole("button", { name: "Line" }).click();
  await expect
    .poll(async () => (await litBand(page)) !== null, { timeout: 15_000 })
    .toBe(true);
});
