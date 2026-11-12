// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The autosave switch is reachable by a press, and only by a press. It sits in
// the writing preferences beside the delay it governs, where a finger reaches
// both: a control revealed by resting a pointer is absent on a phone,
// and a phone browser discards a backgrounded tab whenever it wants the
// memory. A panel that opens nothing by itself keeps a hover from flipping
// the setting. `DocumentTree.test.tsx` pins what the switch writes; this file
// pins that a real browser shows it.

import { expect, test } from "@playwright/test";
import { settleAnimations } from "./probe";
import { START_MS } from "./start";

test.beforeEach(async ({ page }) => {
  // The page's timers run on a clock the test can move, so a rest on the
  // save box can be made as long as needed without waiting it out.
  await page.clock.install();
  await page.goto("/app/editor/demo");
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-view",
    "scroll",
    { timeout: START_MS },
  );
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  await expect(page.locator(".ui-bar")).toBeVisible();
});

test("the autosave switch is in the writing preferences, and nowhere else", async ({
  page,
}) => {
  const autosave = page.getByRole("checkbox", { name: "Autosave" });

  // Not in the bar, and not grown by resting on the save box. Asserted
  // before opening anything, so an open panel cannot make this pass. The
  // rest runs every timer due in the next five seconds, a budget well past
  // any hover delay, and every transition they start, so a reveal on a
  // delay would be on the page.
  await expect(autosave).toHaveCount(0);
  await page.locator(".ed-save-wrap").hover();
  await page.clock.runFor(5_000);
  await settleAnimations(page);
  await expect(autosave).toHaveCount(0);

  // One press, with no delay and no rest, shows the switch.
  await page.getByRole("button", { name: "Writing preferences" }).click();
  await expect(autosave).toBeVisible();

  // It reports the project's state. The demo book has never asked for
  // autosave, so it has the default, on, with the delay it governs beside it.
  await expect(autosave).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Autosave every")).toBeVisible();

  // Off is one press away, and the delay goes with it.
  await autosave.click();
  await expect(autosave).toHaveAttribute("aria-checked", "false");
  await expect(page.getByLabel("Autosave every")).toHaveCount(0);
});
