// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// "Every one" in the selection bubble switches the repetition register to the
// search register: the repetition marks go, the search marks take their
// place, and no page error is thrown. Two registers painting one word throw
// `IndexSizeError` from the highlight pass, because the second register's
// candidates map onto nodes the first register's wraps already split.
// The bubble needs a real browser to position itself.

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
});

test("every one replaces the repetition marks with the search's, without crashing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(m.text());
  });
  // A repeated word with space boundaries, so every occurrence is a whole
  // word. The demo's first paragraph is empty, and the concatenated document
  // has no separator where the heading meets it, so an unbounded first word
  // would not be a whole-word match.
  await page.locator(".editor p").first().click();
  await page.keyboard.type("A window window window B");

  // The middle occurrence, selected with a real mouse drag so the view syncs
  // the engine's selection and the skip lands on the right word. A synthetic
  // Range would leave the engine anchor at the caret.
  const word = await page.evaluate(() => {
    const para = document.querySelector(".editor p") as HTMLElement;
    const node = para.firstChild as Text;
    const range = document.createRange();
    range.setStart(node, 9); // the middle "window"
    range.setEnd(node, 15);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  });
  await page.mouse.move(word.x + 2, word.y + word.h / 2);
  await page.mouse.down();
  await page.mouse.move(word.x + word.w - 2, word.y + word.h / 2);
  await page.mouse.up();

  // The selection listener's 150ms debounce settles, then the repetition
  // register paints the other two occurrences and the bubble offers its
  // questions.
  await expect(page.locator("mark.hl-repetition")).toHaveCount(2);
  await expect(page.getByText("Every one")).toBeVisible();

  // The page-error listener is attached before the press.
  page.on("pageerror", (err) => errors.push(err.message));
  await page.getByText("Every one").click();

  // Repetition marks gone, the find's marks in their place, the field seeded
  // with the word.
  await expect(page.locator("mark.hl-repetition")).toHaveCount(0);
  await expect(
    page.locator("mark.hl-search, mark.hl-search-current"),
  ).toHaveCount(3);
  // Scoped to the editor's bar: the global search's field carries the same
  // class.
  await expect(page.locator(".bar-stack .ui-bar-find-input")).toHaveValue(
    "window",
  );
  expect(errors).toEqual([]);
});
