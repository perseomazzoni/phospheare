// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The block-type fold rests as wide as the word it shows, measured, so the
// text is never cut. `useFoldRestWidth` writes `--ed-fold-rest` from the
// face's laid-out width; jsdom measures every rect as zero, so this reads it
// in a real browser at both ends: a body paragraph rests the fold on the
// glyph alone, and a Subtitle grows it to fit the word. A fixed width cuts
// longer translations such as Italian's "Sottotitolo (H2)". The engaged row
// shows the H1 and H2 marks as text and the body glyph, the same in every
// language.

import { expect, test, type Page } from "@playwright/test";
import { START_MS } from "./start";

test.beforeEach(async ({ page }) => {
  await page.goto("/app/editor/demo");
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-view",
    "scroll",
    { timeout: START_MS },
  );
  // The demo opens on the Desk; the bar mounts once a section is open.
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  await expect(page.locator(".ui-bar")).toBeVisible();
});

const fold = (page: Page) => page.locator(".ed-fold-block");
const face = (page: Page) => page.locator(".ed-fold-block .ed-fold-face");
const restWidth = (page: Page) =>
  fold(page).evaluate(
    (el) => parseFloat(el.style.getPropertyValue("--ed-fold-rest") ?? "") || 0,
  );

/** The fold's laid-out width, which eases over `--t`, so it is polled. */
const drawnWidth = (page: Page) =>
  fold(page).evaluate((el) => el.getBoundingClientRect().width);

test("rests as wide as the word it shows, and grows to fit a longer one", async ({
  page,
}) => {
  // A paragraph caret rests the fold on the body glyph: a small box, with
  // nothing to translate and nothing to cut.
  await expect.poll(() => restWidth(page)).toBeGreaterThan(20);
  const bodyRest = await restWidth(page);
  expect(bodyRest).toBeLessThan(60);
  const bodyFace = await face(page).evaluate((el) => ({
    scroll: el.scrollWidth,
    text: el.textContent?.trim() ?? "",
    glyph: el.querySelector("svg") !== null,
  }));
  expect(bodyFace.glyph).toBe(true);
  expect(bodyFace.text).toBe("");
  expect(bodyRest).toBeGreaterThanOrEqual(bodyFace.scroll);
  // The box is drawn at the measured width, not at a fixed guess.
  await expect.poll(() => drawnWidth(page)).toBeCloseTo(bodyRest, 0);

  // Engage the fold and switch the caret to a Subtitle.
  await fold(page).hover();
  await expect(fold(page)).toHaveAttribute("data-open", "1");
  await page.getByRole("button", { name: "Subtitle (H2)" }).click();
  await expect(face(page)).toContainText("Subtitle (H2)");

  // The resting width grows to fit the word and still holds the face without
  // cutting it.
  await expect.poll(() => restWidth(page)).toBeGreaterThan(80);
  const subRest = await restWidth(page);
  const subScroll = await face(page).evaluate((el) => el.scrollWidth);
  expect(subRest).toBeGreaterThanOrEqual(subScroll);

  // Closed again, the box is drawn at that width, so the word is whole.
  await page.mouse.move(400, 600);
  await expect(fold(page)).not.toHaveAttribute("data-open", "1");
  await expect.poll(() => drawnWidth(page)).toBeCloseTo(subRest, 0);
});

test("a fold reached by keyboard opens to its three cells", async ({
  page,
}) => {
  // The open width is fixed, so the cells land where the thumb expects them
  // whatever the face's word.
  await page.locator(".ed-fold-block .ui-bar-track button").first().focus();
  await expect.poll(() => drawnWidth(page)).toBe(106);
  const cells = await page
    .locator(".ed-fold-block .ui-bar-track button")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right));
  const box = (await fold(page).boundingBox())!;
  expect(cells).toHaveLength(3);
  for (const right of cells)
    expect(right).toBeLessThanOrEqual(box.x + box.width);
});

test("engages to the H1 and H2 marks and the body glyph", async ({ page }) => {
  await fold(page).hover();
  await expect(fold(page)).toHaveAttribute("data-open", "1");
  const cells = page.locator(".ed-fold-block .ui-bar-track button");
  await expect(cells).toHaveCount(3);
  // The tips are portaled out of the bar's scrollport, so a cell's text is its
  // visible mark alone.
  await expect(cells.nth(0)).toHaveText("H1");
  await expect(cells.nth(1)).toHaveText("H2");
  await expect(cells.nth(2).locator("svg")).toHaveCount(1);
});
