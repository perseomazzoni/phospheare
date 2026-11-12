// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The project search on the phone plane. `project-search.spec.ts` pins that
// the chain runs; these rows pin what the phone does with the answer.
//
// On this plane the structure panel is a modal cover over the manuscript,
// not a column beside it, so a search hit closes it: the editor
// lands on the words and marks them, and a sheet left up would hide them.
//
// The panel lists every occurrence as a quotation. A control placed
// at the desk's panel offset lands off the right edge of a 375px screen, so
// the quotations stay inside the sheet, where the panel's own width applies.

import { expect, test, type Page } from "@playwright/test";
import { openDemoEditor, openStructurePanel } from "./probe-mobile";

const sheet = (page: Page) => page.locator(".doc-tree-sheet");

async function search(page: Page, query: string) {
  const field = page.getByPlaceholder("Find a name or a phrase…");
  await field.click();
  await field.fill(query);
}

test.describe("the project search on the phone", () => {
  test.beforeEach(async ({ page }) => {
    await openDemoEditor(page);
    test.skip(
      (await page.locator(".editor-shell").getAttribute("data-phone")) !== "1",
      "not the phone plane",
    );
    await openStructurePanel(page);
  });

  test("a hit in the prose uncovers the words it landed on", async ({
    page,
  }) => {
    await search(page, "school");
    const quote = page.locator(".dt-search-occurrence").first();
    await expect(quote).toBeVisible();
    await quote.click();

    // The sheet is gone, not merely behind something.
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator(".ui-scrim")).toHaveCount(0);
    await expect(page.locator("mark.hl-search-current").first()).toBeVisible();
  });

  test("a quotation is reachable on a 375px screen", async ({ page }) => {
    // On this plane a control that begins at the desk's panel offset lands off
    // the right edge and cannot be pressed. The occurrences sit inside
    // the sheet, where the panel's own width applies.
    await search(page, "school");
    const quote = page.locator(".dt-search-occurrence").first();
    await expect(quote).toBeVisible();
    const box = await quote.boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    if (!box) throw new Error("nothing to measure");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  });

  test("a reference hit does not stack a second sheet on the first", async ({
    page,
  }) => {
    // The two sheets are never open together. A reference hit opens
    // the dock from inside the structure sheet, which closes, leaving one
    // scrim.
    await search(page, "sentient");
    const row = page
      .locator(".dt-search-row")
      .filter({ hasText: "other-sentient-beings" });
    await expect(row).toBeVisible();
    await row.click();

    await expect(page.locator(".ed-dock-sheet")).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator(".ui-scrim")).toHaveCount(1);
  });
});
