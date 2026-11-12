// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Henosis widens the measure and narrows it back, which re-wraps every line
// and resizes the editor without touching the surface, so the caret is
// re-measured from the editor's own box. The column's ease is taken out, so
// the reflow lands in one frame with nothing else to repaint the caret; the
// state is set on the shell as `useHenosis` publishes it.

import { expect, test, type Page } from "@playwright/test";
import { openDemoEditor } from "./probe-mobile";

test.use({ viewport: { width: 1400, height: 800 } });

/** The caret's box less the text position it marks. */
const offset = (page: Page) =>
  page.evaluate(() => {
    const caret = document
      .querySelector(".fake-cursor")!
      .getBoundingClientRect();
    const selection = getSelection()!;
    const range = document.createRange();
    range.setStart(selection.focusNode!, selection.focusOffset);
    range.collapse(true);
    const text = range.getClientRects()[0];
    return { x: caret.x - text.x, y: caret.y - text.y, top: caret.y };
  });

const henosis = (page: Page, to: "full" | "0") =>
  page.evaluate(
    (state) =>
      document
        .querySelector(".editor-shell")!
        .setAttribute("data-henosis", state),
    to,
  );

async function open(page: Page, typewriter = false) {
  await openDemoEditor(page);
  if (typewriter) {
    await page.getByRole("button", { name: "Writing preferences" }).click();
    await page.getByRole("checkbox", { name: "Typewriter mode" }).click();
    await page.keyboard.press("Escape");
  }
  await page.addStyleTag({
    content: ".editor { transition: none !important; }",
  });
  await page
    .locator(".editor p")
    .nth(2)
    .click({ position: { x: 60, y: 10 } });
  await page.keyboard.press("End");
}

test("the caret stays on its text as the measure widens and narrows", async ({
  page,
}) => {
  await open(page);
  await expect.poll(async () => (await offset(page)).x).toBeCloseTo(0, 0);
  await henosis(page, "full");
  await expect.poll(async () => (await offset(page)).x).toBeCloseTo(0, 0);
  expect((await offset(page)).y).toBeCloseTo(0, 0);
  await henosis(page, "0");
  await expect.poll(async () => (await offset(page)).x).toBeCloseTo(0, 0);
  expect((await offset(page)).y).toBeCloseTo(0, 0);
});

test("the typewriter's line comes back to its station after the widening", async ({
  page,
}) => {
  await open(page, true);
  await expect.poll(async () => (await offset(page)).x).toBeCloseTo(0, 0);
  // The click docks the line with a glide; the station is where it comes to
  // rest.
  let station = Number.NaN;
  await expect
    .poll(async () => {
      const was = station;
      station = (await offset(page)).top;
      return station === was;
    })
    .toBe(true);
  await henosis(page, "full");
  // The line may never leave the station, so both are asked of one paint.
  await expect
    .poll(async () => {
      const now = await offset(page);
      return Math.abs(now.top - station) <= 2 && Math.abs(now.x) < 0.5;
    })
    .toBe(true);
});
