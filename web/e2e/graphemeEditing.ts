// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// One character to the writer is one grapheme cluster, whatever its code
// units: Backspace and Delete remove it whole, the arrows step over it whole,
// Shift with an arrow selects it whole, and undo puts it back. The engine
// deletes, and the browser moves the caret and the selection, so both are
// checked here in a real layout, once per engine (the desktop project's
// Chromium and the phone projects' WebKit).

import { expect, test, type Page } from "@playwright/test";
import { openDemoEditor } from "./probe-mobile";

const ZWJ = "👩‍💻";
const FLAG = "🇮🇹";
const LINE = `a${ZWJ}${FLAG}b`;

/** A new last paragraph holding `LINE`, with the caret at its end. */
async function writeLine(page: Page) {
  await openDemoEditor(page);
  await page
    .locator(".editor p")
    .last()
    .evaluate((p) => {
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  await page.keyboard.press("Enter");
  await page.keyboard.insertText(LINE);
  await expect(page.locator(".editor p").last()).toHaveText(LINE);
}

/** The editor's undo chord: Meta where it takes the platform for a Mac. */
async function undo(page: Page) {
  const apple = await page.evaluate(() =>
    /Mac|iPod|iPhone|iPad/.test(navigator.userAgent),
  );
  await page.keyboard.press(apple ? "Meta+z" : "Control+z");
}

const last = (page: Page) => page.locator(".editor p").last();

export function graphemeEditingChecks(): void {
  test.describe("editing over grapheme clusters", () => {
    test.beforeEach(async ({ page }) => {
      await writeLine(page);
    });

    test("Backspace removes each cluster whole, and undo puts them back", async ({
      page,
    }) => {
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("Backspace");
      await expect(last(page)).toHaveText(`a${ZWJ}b`);
      await page.keyboard.press("Backspace");
      await expect(last(page)).toHaveText("ab");
      await undo(page);
      await expect(last(page)).toHaveText(LINE);
    });

    test("Delete removes each cluster whole, and undo puts them back", async ({
      page,
    }) => {
      for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("Delete");
      await expect(last(page)).toHaveText(`a${FLAG}b`);
      await page.keyboard.press("Delete");
      await expect(last(page)).toHaveText("ab");
      await undo(page);
      await expect(last(page)).toHaveText(LINE);
    });

    test("the arrows step over a cluster whole", async ({ page }) => {
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.insertText("x");
      await expect(last(page)).toHaveText(`a${ZWJ}x${FLAG}b`);
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.insertText("y");
      await expect(last(page)).toHaveText(`a${ZWJ}yx${FLAG}b`);
    });

    test("Shift with an arrow selects a cluster whole, in both directions", async ({
      page,
    }) => {
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("Shift+ArrowLeft");
      await page.keyboard.insertText("x");
      await expect(last(page)).toHaveText(`a${ZWJ}xb`);
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("Shift+ArrowRight");
      await page.keyboard.insertText("y");
      await expect(last(page)).toHaveText("ayxb");
    });
  });
}
