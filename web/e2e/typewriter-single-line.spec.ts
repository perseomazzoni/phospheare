// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A click re-docks a one-line document scrolled to either end of the page.
// The caret already sits at the line's end, so the click does not move it and
// no `selectionchange` fires; the pointer effect's deferred click-dock must
// dock it anyway.

import { expect, test, type Page } from "@playwright/test";
import { DOCK_BOUND, readoutEventually } from "./probe";

/** Create and open a blank Section through the tree, as a writer would. */
async function createBlankSection(page: Page, name: string) {
  // Through the Part's own add label, the always-visible control the phone
  // suite uses too. A locator for a control the tree does not ship only
  // times out, and a suite can sit red and unread that way.
  await page.getByRole("button", { name: "Add a Section" }).first().click();
  await page.getByLabel("Section name").fill(name);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: name, exact: true }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
}

test("a click re-docks the writing line from either end of the page", async ({
  page,
}) => {
  await page.goto("/app/editor/demo?debug=station");
  await createBlankSection(page, "one");
  await page.getByRole("button", { name: "Writing preferences" }).click();
  await page.getByRole("checkbox", { name: "Typewriter Mode" }).click();
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-view",
    "typewriter",
  );

  // One line, one letter: the caret sits at the end, and stays there through
  // every scroll.
  await page.locator(".editor").click();
  await page.keyboard.type("a");
  await readoutEventually(
    page,
    (r) => Number.isFinite(r.caret) && Math.abs(r.delta) <= DOCK_BOUND,
  );

  const para = page.locator(".editor p").first();

  // Absolute top. Clicking far right of the line leaves the caret where it is,
  // and the gesture still brings the line home.
  await page.locator(".editor-surface").evaluate((el) => {
    el.scrollTop = 0;
  });
  let box = await para.boundingBox();
  await page.mouse.click(box!.x + box!.width - 30, box!.y + 10);
  let r = await readoutEventually(page, (c) => Math.abs(c.delta) <= DOCK_BOUND);
  expect(r.clamp).toBe("free");

  // Absolute bottom, the same gesture.
  await page.locator(".editor-surface").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  box = await para.boundingBox();
  await page.mouse.click(box!.x + box!.width - 30, box!.y + 10);
  r = await readoutEventually(page, (c) => Math.abs(c.delta) <= DOCK_BOUND);
  expect(r.clamp).toBe("free");
});
